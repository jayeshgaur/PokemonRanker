# Phase 1.B.1 — schema-guardian sub-phase gate

**Reviewer:** schema-guardian
**Date:** 2026-04-28
**Scope:** schema v1 → v2 expansion landed in Phase 1.B.1. Verifying the new
columns/indexes are sensibly typed, that the Go `Pokemon` type still tracks
SQL, that the PM planning-gate trim didn't drop anything load-bearing, and
that Phase 1.B.2 ingest can proceed cleanly.

**Files re-read.**

- `/Users/jayesh/Experiments/PokemonRanker/apps/api/internal/pokedex/schema.sql`
- `/Users/jayesh/Experiments/PokemonRanker/apps/api/internal/pokedex/types.go`
- `/Users/jayesh/Experiments/PokemonRanker/apps/api/internal/pokedex/schema.go`
- `/Users/jayesh/Experiments/PokemonRanker/apps/api/internal/pokedex/db_test.go`
- `/Users/jayesh/Experiments/PokemonRanker/apps/api/internal/pokedex/ingest/bulk.go`
- `/Users/jayesh/Experiments/PokemonRanker/apps/api/internal/pokedex/ingest/ingester.go`

`go test ./internal/pokedex/...` from `apps/api` passes (cached: `ok` for both
`pokedex` and `pokedex/ingest`).

---

## 1. Schema correctness — column-by-column

### `pokemon.is_default INTEGER NOT NULL DEFAULT 0`

Type matches the `forms.is_default` precedent. Default `0` is the right
posture (non-default until ingest proves otherwise). One observation, taken
up in §5: there is no DB-side enforcement that
`pokemon.is_default = forms.is_default` for the joined `form_id`. Fine for
v2 schema-correctness; an ingest invariant for 1.B.2.

### `pokemon.pokeapi_order INTEGER NOT NULL DEFAULT 0`

Type and default match the precedent set by other PokeAPI integer-ordering
columns. `0` as the default is acceptable but technically a colliding sentinel
(every unset row sorts together). Phase 1.B.2 must populate this for all rows
or Phase 2's "sort by canonical PokeAPI order" filter will produce undefined
order across the unpopulated rows. **Sub-phase invariant for 1.B.2** (not a
schema defect; a population requirement).

### `species.evolves_from_species_id INTEGER REFERENCES species(id)` (self-FK)

Nullable is correct (root-of-chain species — Bulbasaur, Caterpie, Charmander —
have no predecessor). `REFERENCES species(id)` is the right self-FK shape.
The supporting index `idx_species_evolves_from` is present at `schema.sql:79`;
this is exactly what evolution-graph reverse traversals (find-children-of-X)
need. ✓

`TestSpecies_EvolvesFromSelfFKEnforced` (`db_test.go:169-179`) inserts a
species with `evolves_from_species_id = 999` and asserts FK rejection —
correctly targets the self-FK.

One subtle: the second-pass population step at `bulk.go:69`
("11. (second pass) populate species.evolves_from_species_id") is
necessary precisely because all species rows must exist before any FK target
can resolve. The schema is consistent with that ordering — the FK is not
declared `DEFERRABLE` but it doesn't need to be since the second pass is an
UPDATE, not an INSERT, by which time all targets are present.

### `species.forms_switchable INTEGER NOT NULL DEFAULT 0`

Boolean-as-integer matches every other 0/1 column in the schema. Default `0`
(not switchable) is the right posture for the long tail; ingest flips to `1`
for the rare case (Rotom, Deoxys, Aegislash family, etc.). ✓

### `species.pokeapi_order INTEGER NOT NULL DEFAULT 0` and `forms.pokeapi_order` / `forms.pokeapi_form_order`

Same shape as `pokemon.pokeapi_order`. The two `forms` order columns are
distinct upstream concepts (PokeAPI exposes both `Pokemon.order` and
`PokemonForm.order`); keeping both is consistent with how PokeAPI models the
form/pokemon split. Default `0` carries the same population caveat as above.

### `evolutions.gender INTEGER` (nullable) and `evolutions.time_of_day TEXT NOT NULL DEFAULT ''`

`gender` is correctly nullable — the vast majority of evolutions have no
gender condition. Storing it as INTEGER is the right narrowing of PokeAPI's
gender enum (1/2/3 → female-only / male-only / genderless-only).

`time_of_day` as `TEXT NOT NULL DEFAULT ''` (rather than NULL) is a defensible
choice: PokeAPI's vocabulary is small (`day`, `night`, `dusk`, `''`),
and using empty-string-as-no-condition keeps `evolutions` queryable without
NULL-aware predicates. No CHECK constraint on the values; that's consistent
with the project's R3 precedent (prefer indexed strings over CHECK lists for
upstream-controlled vocabularies). Fine.

### `abilities.is_main_series INTEGER NOT NULL DEFAULT 0`

Filters out spin-off-only abilities. Default `0` is wrong-as-default in a
mild sense — if ingest forgets the column, every ability will look spin-off,
which is the inverse of reality. But a default of `1` would be equally wrong
in the other direction. The conservative posture (default `0`, force ingest
to flip on) is correct: a missing-data bug surfaces visibly (no abilities in
filters) rather than silently (everything passes through). ✓

### `moves.target TEXT NOT NULL DEFAULT ''`

Same shape as `evolutions.time_of_day`. Empty-string-as-unset; PokeAPI
vocabulary (`selected-pokemon`, `all-opponents`, `user`, etc.) is not
constrained by CHECK. Consistent with the project's R3 stance.

### Index assessment

`idx_species_evolves_from` on the new self-FK is present (`schema.sql:79`).
Evolution graph queries need this; without it, "find all evolutions of
Eevee" is an O(N) scan over all species. ✓

No new indexes proposed for `pokeapi_order` / `pokeapi_form_order` —
defensible: these are sort keys, not filter keys, and a covering composite
index is premature until Phase 2's query plans declare what sort orders are
hot.

**Schema correctness: clean.** All eleven additions are sensibly typed,
defaults match project precedent, and the one new index is the load-bearing
one.

---

## 2. Go ↔ SQL alignment

The brief states `Pokemon` adds only `IsDefault bool` and `PokeAPIOrder int64`.
Verified at `types.go:13-14`.

| New SQL column | Surface to Go `Pokemon`? | Verdict |
|---|---|---|
| `pokemon.is_default` | yes (`IsDefault bool`) | ✓ |
| `pokemon.pokeapi_order` | yes (`PokeAPIOrder int64`) | ✓ |
| `species.evolves_from_species_id` | no | correctly omitted — evolution graph is its own query surface (Phase 1.B.3) and the `Pokemon` struct is the *atomic competitor unit*, not the species view |
| `species.forms_switchable` | no | correctly omitted — species-level concern, not a Pokemon-row attribute |
| `species.pokeapi_order` | no | correctly omitted — consumed by ingest for ordering, not by `Pokemon` consumers |
| `forms.pokeapi_order` / `forms.pokeapi_form_order` | no | correctly omitted — same rationale |
| `evolutions.gender` / `evolutions.time_of_day` | no | correctly omitted — evolutions is a separate query surface |
| `abilities.is_main_series` | no | correctly omitted — abilities are a separate query surface, not a `Pokemon` field |
| `moves.target` | no | correctly omitted — moves are a separate query surface |

The drift posture is right. `Pokemon` is deliberately *not* a denormalized
view of every joined attribute; it surfaces the (species, form) tuple plus
the small set of attributes that travel with the row in the picker UX. The
v2 expansion correctly only added the two pokemon-table-level columns.

The `Pokemon` struct field declarations follow the established int64-for-DB
convention (`PokeAPIOrder int64`); `IsDefault` as `bool` is the standard
Go-side mapping for `INTEGER NOT NULL DEFAULT 0` boolean columns and is
consistent with how this project would surface a SQL bool (no precedent yet
in the struct, but `IsDefault bool` matches Go idiom).

**Go ↔ SQL alignment: clean.** No unsurfaced columns that should have been
surfaced; no surfaced fields without a backing column.

---

## 3. PM trim assessment — load-bearing deferrals?

Deferred per planning gate: `gender_rate`, `has_gender_differences`,
`growth_rate`, `base_happiness`, `capture_rate`, `hatch_counter`,
`introduced_in_version_group`, `effect_chance`, `abilities.generation_id`,
`localized_names` table.

For each, the schema-correctness question is: would Phase 1.B.2 ingest still
satisfy the schema's invariants if upstream changed shape, *given the column
is absent*? In other words, does the trim let an ingest bug pass silently
that the column would have caught?

**`gender_rate`, `has_gender_differences`, `growth_rate`, `base_happiness`,
`capture_rate`, `hatch_counter`, `effect_chance`** — all pure species/move
*attributes*. Their absence cannot let a 1.B.2 ingest bug pass silently
because they are not referenced by any other table. Trim is safe.

**`introduced_in_version_group`** — analogous to
`forms.introduced_in_generation_id`. Trimming it means we lose the
narrower introduction-context (e.g., "was this form introduced in
ORAS or in USUM?"), but `forms.introduced_in_generation_id` is still present
and provides the coarse-grained version. No silent-bug hazard.

**`abilities.generation_id`** — this is the borderline one. Without it,
"abilities introduced after generation X" is unanswerable directly; you'd
have to derive it from `pokemon_abilities → pokemon → generation_id` which
gives "first appearance of the ability on a Pokémon" — close enough but not
identical. *No silent-bug hazard for ingest*, but a future query feature
will eventually want the column. Tracked deferral is the right posture; flag
is `[concern]` rather than `[blocker]`.

**`localized_names` table** — flagged as deferred in the schema comment at
`schema.sql:251`. **One inconsistency to fix**: `schema.go:13`'s SchemaVersion
docstring still says v2 "introduces the `localized_names` table for future
i18n", and `schema.sql:17`'s top-of-file comment block also says "Adds the
localized_names table for future i18n." Both are stale relative to the
planning-gate trim. Not a schema defect (the table is correctly absent in
the actual SQL), but a documentation drift. **Action:** update both
docstrings to match the deferral. One-line edit each.

**Most load-bearing deferral check: pokemon-level normalization.** The
strongest reason to keep `localized_names` would have been if `pokemon`,
`forms`, or `species` had FKs to it. They don't — names are stored inline as
TEXT columns and `flavor_text` already covers the species-language-version
matrix for Pokédex entries. So the absence of `localized_names` doesn't
silently weaken any FK. Safe to defer.

**PM trim assessment: nothing load-bearing was dropped.** One documentation
drift (schema-version comment claims `localized_names` was added; it wasn't).

---

## 4. Phase 1.B.2 readiness

Sub-phase 1.B.2 ingests species → forms → pokemon (and the join tables
behind them).

**Cleanly sequenced FK shape.** The dependency order spelled out at
`bulk.go:59-70` lines up against the schema:

1. generations → species (FK) → forms (FK) → pokemon (FK) — clean
2. types/stats/abilities/moves before their pokemon_* join tables — clean
3. evolution_chains → evolutions before species back-fill — clean
4. species.evolves_from_species_id back-fill in step 11 — correct (target
   species must exist before the UPDATE; the self-FK is satisfiable).

**Schema-side prerequisites for 1.B.2 are all in.** Specifically:

- The partial unique on `forms.is_default = 1` (B3.b) prevents two
  defaults per species at write time — 1.B.2 can rely on this rather than
  re-checking.
- The new `idx_forms_default_per_species` is `IF NOT EXISTS` so re-running
  bulk ingest is idempotent.
- `pokemon.form_id UNIQUE` (`schema.sql:111`) plus `pokemon.species_id` FK
  guarantee the (species, form) tuple is unique per pokemon row — D-1's
  atomic-competitor-unit invariant is enforced.

**Anything still missing?** Two ingest invariants need test coverage in
1.B.2 that the schema *cannot* enforce:

- `pokemon.is_default` ↔ `forms.is_default` consistency (see §5). The
  schema permits divergence; ingest must be tested to write them
  consistently.
- `pokemon.pokeapi_order` and `forms.pokeapi_order*` populated for every
  row (no leftover `0` sentinels). Schema's `DEFAULT 0` is an ingest-
  population hazard, not a schema defect.

These are 1.B.2 invariant tests, not 1.B.1 blockers. The data-sync agent
should add them when ingest lands.

**Phase 1.B.2 readiness: green.** Schema is sufficient; the two ingest
invariants above are flagged for the data-sync agent's beat.

---

## 5. `is_default` redundancy — distinct or conflicting?

Both `forms.is_default` and `pokemon.is_default` exist. The question is
whether they encode the same fact twice (inviting drift) or genuinely
distinct invariants.

**Walking the model:** `forms` is the variant table; `pokemon` is the
(species, form) tuple. Each species has exactly one default form (enforced
by the partial unique on `forms.is_default = 1`). Each pokemon row has a
1:1 relationship with a form (enforced by `pokemon.form_id UNIQUE`). So
*structurally*, `pokemon.is_default = 1` is fully derivable from
`pokemon.form_id → forms.is_default = 1`. They are the same fact.

**Why the duplication is still acceptable:**

1. **Query convenience.** The most common query is "give me the default
   pokemon for this species" — answered by
   `SELECT * FROM pokemon WHERE species_id = ? AND is_default = 1`. Without
   the column on `pokemon`, that's a join: `pokemon JOIN forms ON
   pokemon.form_id = forms.id WHERE species_id = ? AND forms.is_default = 1`.
   The join is cheap but the column-on-pokemon is cheaper and reads better
   in user-facing query code.

2. **PokeAPI source-of-truth alignment.** PokeAPI exposes `Pokemon.is_default`
   directly on the `pokemon` endpoint (it's *not* derived there either —
   PokeAPI publishes it on both surfaces). Mirroring that posture means our
   ingest is a 1:1 copy rather than a derivation. Less translation, fewer
   ingest bugs.

3. **No partial-unique conflict.** `forms.is_default = 1` is constrained to
   exactly one form per species (partial unique index). `pokemon.is_default`
   has no analogous constraint — and that's correct, because for a
   single-form species there's exactly one pokemon row, and for a
   multi-form species the *default-form's pokemon row* is the default
   pokemon. The "one default pokemon per species" invariant is *transitively*
   enforced through `forms.is_default` plus `pokemon.form_id UNIQUE`.

**Where the duplication is hazardous: drift at write time.** Nothing in the
schema enforces `pokemon.is_default = (forms.is_default WHERE id =
pokemon.form_id)`. A buggy 1.B.2 ingester could insert the form with
`is_default = 1` but the pokemon with `is_default = 0`, or vice versa, and
both rows would commit. Two queries that should agree would then disagree.

**Mitigation options, in order of cost:**

- **(cheapest, recommended)** add an ingest-time invariant test in 1.B.2:
  after ingest, assert `SELECT COUNT(*) FROM pokemon p JOIN forms f ON
  p.form_id = f.id WHERE p.is_default != f.is_default` is zero.
- **(stronger)** drop `pokemon.is_default` and either always go through
  the join or materialize it as a view. Cost: changes Go surface
  (`Pokemon.IsDefault` would need to be filled by a query that reads
  `forms.is_default` via the join). Worth the cost only if drift bugs
  actually appear.
- **(strongest)** SQLite trigger `BEFORE INSERT/UPDATE ON pokemon` that
  enforces the equality. Cost: triggers are write-perf hazards under bulk
  ingest, and the project so far has avoided triggers entirely. Not
  recommended.

**Verdict on §5:** redundant but not conflicting. Distinct invariants in
the same sense PokeAPI distinguishes them, with one shared truth. The
1.B.2 ingest invariant test (option 1 above) is the right tool. Flag is
`[concern]` for data-sync agent's beat, not a schema-side blocker.

---

## Drift check across layers (SQL ↔ Go)

Updated since Phase 1.A re-gate. New columns vs. Go fields:

| `pokemon` v2 column | SQL type | Go field        | Go type | Match |
|---|---|---|---|---|
| `is_default` | INTEGER NOT NULL DEFAULT 0 | `IsDefault` | `bool` | ✓ |
| `pokeapi_order` | INTEGER NOT NULL DEFAULT 0 | `PokeAPIOrder` | `int64` | ✓ |

Schema additions on `species`, `forms`, `evolutions`, `abilities`, `moves`
correctly do not propagate to `Pokemon` — they belong to other query
surfaces yet to be defined (1.B.3 evolutions, 1.B.4 query API).

`SchemaVersion` was correctly bumped from 1 → 2 in `schema.go:14`. Test
`TestOpen_RecordsSchemaVersion` (db_test.go:47-53) reads the value back via
`pokedex.SchemaVersion`, so the bump is exercised end-to-end.

**No drift.**

---

## Test coverage — claim-vs-coverage audit

| Test | Constraint claimed | Exercised? |
|---|---|---|
| `TestSpecies_EvolvesFromSelfFKEnforced` | self-FK on `species.evolves_from_species_id` | ✓ inserts target=999, asserts FK rejection |

One v2-specific test was added; it correctly targets the highest-risk new
constraint (the self-FK is the most likely to be implemented incorrectly).

**Coverage gaps for v2 — informational, not blocking:**

1. **Partial unique on default-per-species is fine** — already covered by
   the Phase 1.A `TestForms_RejectsMultipleDefaultsPerSpecies`. v2 didn't
   change that constraint.
2. **`pokeapi_order` column shape** — no test that the column accepts an
   integer. Trivial to verify implicitly via 1.B.2 ingest tests.
3. **`abilities.is_main_series` / `moves.target` / `evolutions.time_of_day`
   shape** — same as above; will be exercised by 1.B.2/1.B.3 ingest tests.
4. **`evolutions.gender` nullability** — would be nice to have a one-line
   "INSERT with NULL gender succeeds" test, parallel to the species self-FK
   test. Not blocking.

The Phase 1.A residual ("symmetric lower-bound test for `effort`") was
*not* picked up in the 1.B.1 fix pass. Still a one-line nit, still
non-blocking, and unrelated to v2.

---

## Residual items

1. **Documentation drift on `localized_names`.** `schema.sql:15-17` and
   `schema.go:13` both claim v2 "adds the localized_names table." It does
   not — the table is correctly deferred per planning gate (`schema.sql:251`
   has the deferral comment). Update both top-of-file docstrings to match.
   Two one-line edits.
2. **`pokemon.is_default` ↔ `forms.is_default` invariant.** Add an ingest-
   time post-condition test in 1.B.2 (zero-row JOIN check). Data-sync agent's
   beat.
3. **`pokeapi_order` `0` sentinel.** Add an ingest-time post-condition that
   no row has the sentinel after bulk ingest completes. Data-sync agent's
   beat.
4. **`evolutions.gender` NULL-shape test.** Optional one-liner for v2 test
   coverage parity.
5. **Phase 1.A residual still open** — `TestPokemonStats_RejectsOutOfRange
   Effort` lacks a `-1` lower-bound case. Carried forward as a nit.

None of the residuals block the 1.B.1 → 1.B.2 handoff.

---

## Impact radius after v2

- **Phase 1.B.2 (constants + core graph).** All schema dependencies for
  species → forms → pokemon ingest are present. Self-FK and partial-unique
  constraints will catch ingest bugs at write time. ✓
- **Phase 1.B.3 (joins + evolutions + flavor_text).** `evolutions.gender`,
  `evolutions.time_of_day` are in; the second-pass species back-fill is
  consistent with the schema. ✓
- **Phase 1.B.4 (query API).** Go `Pokemon` type is consistent with v2;
  no new surface is required for the query API to compile against. ✓
- **Phase 2 (filter engine).** `idx_species_evolves_from` makes
  evolution-graph filters tractable from day one. ✓

---

**Verdict: Approve**

(All eleven v2 column additions are sensibly typed; the new self-FK index
is the load-bearing one and is present; Go ↔ SQL alignment is clean; the
PM planning-gate trim dropped nothing load-bearing for 1.B.2; the
`is_default` redundancy is a soft concern resolvable by one ingest invariant
test in 1.B.2 rather than a schema change. The two stale comments naming
`localized_names` as "added" should be cleaned up but neither is a blocker.)
