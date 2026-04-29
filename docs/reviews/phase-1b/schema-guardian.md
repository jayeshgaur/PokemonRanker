# Phase 1.B (final) — schema-guardian gate

**Reviewer:** schema-guardian
**Date:** 2026-04-28
**Scope:** Schema v2 in its final 1.B form, plus the 12 ingesters that
populate it. This is the single 1.B gate; 1.B.1 was reviewed against the
schema-only sub-phase and is now folded in.

**Files re-read.**

- `apps/api/internal/pokedex/schema.sql`
- `apps/api/internal/pokedex/schema.go`
- `apps/api/internal/pokedex/types.go`
- `apps/api/internal/pokedex/query.go`
- `apps/api/internal/pokedex/validate.go`
- `apps/api/internal/pokedex/db.go`
- `apps/api/internal/pokedex/db_test.go`
- `apps/api/internal/pokedex/ingest/{bulk,ingester,helpers}.go`
- `apps/api/internal/pokedex/ingest/{generation,type,stat,ability,move}.go`
- `apps/api/internal/pokedex/ingest/{species,form,pokemon,pokemon_joins}.go`
- `apps/api/internal/pokedex/ingest/{evolution,evolves_from,flavor_text}.go`
- `apps/api/internal/pokedex/ingest/ingesters_test.go`

---

## 1. Schema correctness — final-state pass

### Constraints that hold up

The Phase 1.A invariants survive 1.B intact and are reinforced where 1.B
expanded the surface:

- `pokemon.form_id UNIQUE` + `pokemon.species_id` FK → species(id) +
  `forms.UNIQUE(species_id, form_name)` → D-1 atomic-competitor invariant
  enforced at the row level.
- `idx_forms_default_per_species` (partial unique on `is_default = 1`) →
  exactly one default form per species.
- `pokemon_types.PRIMARY KEY (pokemon_id, slot)` + `slot IN (1,2)` +
  `UNIQUE (pokemon_id, type_id)` → precludes both "duplicate type in slot 1
  and 2" and "three types".
- `pokemon_stats.base_value BETWEEN 0 AND 255`, `effort BETWEEN 0 AND 3`.
- `moves.damage_class IN ('physical','special','status','')`.
- `pokemon_abilities.slot IN (1,2,3)`.
- `idx_species_evolves_from` is the load-bearing index for evolution-graph
  reverse traversal — present.
- `pokemon_types ON DELETE CASCADE`, `pokemon_stats ON DELETE CASCADE`,
  `pokemon_abilities ON DELETE CASCADE`, `pokemon_moves ON DELETE CASCADE`,
  `flavor_text ON DELETE CASCADE`, `pokemon_tags ON DELETE CASCADE` —
  consistent cascading from the parent `pokemon`/`species` rows.

### Two structural gaps the schema cannot enforce

These are not v2 regressions — they were latent in v1 too — but flagging
them here because both will eventually need ingest-side guards:

**1.1 — `pokemon.species_id` ↛ `forms.species_id` consistency.** Nothing
binds the species selected on the pokemon row to the species the form
belongs to. A buggy ingester could write `pokemon(species_id=6, form_id=25)`
where form 25 belongs to species 25. The schema accepts both rows. The
`PokemonIngester` derives `species_id` from `pokemon.species.url` and
`form_id` from `pokemon.forms[0].url` (`pokemon.go:59-67`); upstream
PokeAPI is consistent so this never fires today, but the FK pair does not
*guarantee* it. **Mitigation suggestion (1.B.4 validate):** add a check
that `SELECT COUNT(*) FROM pokemon p JOIN forms f ON p.form_id = f.id
WHERE p.species_id <> f.species_id` is zero. One-line addition.

**1.2 — `pokemon.is_default` ↔ `forms.is_default` parity.** Carried over
from 1.B.1 review §5. Same fact in two places; ingest could write divergent
values and both rows commit. Not in `validate.go`'s 14-check suite as of
this read.  **Mitigation:** add to validate (`SELECT COUNT(*) FROM pokemon p
JOIN forms f ON p.form_id = f.id WHERE p.is_default <> f.is_default = 0`).
One-line addition.

### Minor issues

- **Schema.go docstring is now correct.** The Phase 1.B.1 review flagged
  stale claims about a `localized_names` table being added. Both the
  `schema.sql` top comment and `schema.go` `SchemaVersion` docstring are now
  accurate (deferred-with-rationale wording at `schema.sql:14-18` and
  `schema.go:11-17`). Cleanup landed; closing that residual.

- **`forms.introduced_in_generation_id` is a dead column.** Declared at
  `schema.sql:96`, indexed nowhere, populated by no ingester. The
  `PokemonIngester` comment at `pokemon.go:13-14` says future enhancement is
  to COALESCE pokemon.generation_id with this column, but nobody is
  writing it. Two options:
  1. Delete the column until a feature needs it. Cheaper.
  2. Populate it now from `forms.version_group.url` lookup. Larger lift.

  Since the trim posture for v2 was "drop columns nobody populates", the
  consistent move is option 1. **Concern, not blocker** — schema accepts NULL
  so existing rows are fine; this is a "schema fragment without a write path"
  drift hazard.

- **`pokemon_moves.learn_level` is policy-governed, not constraint-governed.**
  The PK is `(pokemon_id, move_id, learn_method, generation_id)` — does *not*
  include `learn_level`. Two version groups within the same generation that
  teach the same move at different levels (e.g., RB vs YL teach Pound at
  different levels) collide on the PK and `INSERT OR IGNORE` keeps whichever
  inserted first. This is documented (`pokemon_joins.go:130-133`) and
  acceptable per the design note, but the schema does not encode "lowest
  learn-level wins" or any deterministic tiebreaker. If a future feature
  cares about exact level semantics, this becomes a correctness issue.
  **Concern, not blocker.**

---

## 2. Ingester ↔ schema fidelity

I walked every `INSERT` against the table definition.

| Ingester | Target | Columns written | Schema columns | Verdict |
|---|---|---|---|---|
| GenerationIngester | generations | id, slug, name, region, main_versions | same | ✓ |
| TypeIngester | types | id, slug, name | same | ✓ |
| StatIngester | stats | id, slug, name | same | ✓ |
| AbilityIngester | abilities | id, slug, name, short_effect, effect, is_main_series | + content_hash (defaulted) | ✓ |
| MoveIngester | moves | id, slug, name, type_id, damage_class, power, accuracy, pp, priority, target, short_effect, effect | + content_hash (defaulted) | ✓ |
| SpeciesIngester | species | id, slug, name, pokedex_number, generation_id, is_legendary, is_mythical, is_baby, color, shape, habitat, evolution_chain_id, forms_switchable, pokeapi_order | + evolves_from_species_id (NULL — second pass), + content_hash, + source_commit_sha (defaulted) | ✓ |
| FormIngester | forms | id, species_id, slug, form_name, is_default, is_mega, is_gmax, is_battle_only, is_regional_variant, pokeapi_order, pokeapi_form_order | + introduced_in_generation_id (NULL — never populated; see §1), + content_hash (defaulted) | ✓ (with §1 dead-column caveat) |
| PokemonIngester | pokemon | id, species_id, form_id, slug, display_name, generation_id, is_default, pokeapi_order, height_dm, weight_hg, base_experience, sprite_url, shiny_sprite_url, official_artwork_url, cry_url, pokedex_db_url | + content_hash, + source_commit_sha (defaulted) | ✓ |
| PokemonJoinsIngester | pokemon_types, pokemon_stats, pokemon_abilities, pokemon_moves | full PK + payload columns | same | ✓ |
| EvolutionIngester | evolution_chains, evolutions | chain_id, from_species_id, to_species_id, trigger, min_level, item, gender, time_of_day, conditions_json | same | ✓ |
| FlavorTextIngester | flavor_text | species_id, language, version, text | same | ✓ |
| EvolvesFromBackfillIngester | species (UPDATE) | evolves_from_species_id | matches column shape | ✓ |

**Counted carefully — INSERT statement list against schema column list with
the not-null/default gates: no drift.** Every NOT NULL column without a
DEFAULT is written by every INSERT path. Every column written exists in
the schema with the right type.

### Sub-points worth flagging

**2.1 — INSERTs vs. INSERT OR IGNORE.** Most ingesters use bare `INSERT`.
That is correct for a fresh-DB bulk run; if it ever runs against a
non-empty DB the constraints will trip immediately, which is the desired
behavior since Phase 1.A's atomic-rename strategy guarantees the bulk path
always sees a clean tmpfile (`bulk.go:102`). `pokemon_moves` and
`flavor_text` use `INSERT OR IGNORE` because both have row-level dedup
across version groups — that's correct. Other ingesters do not need it.

**2.2 — `EvolvesFromBackfillIngester` is a second pass over the same
species index.** It re-reads every species JSON to extract one field. At
~1300 species this is fine; the comment at `evolves_from.go:11` flags
it as "second pass per PLAN.md". The schema relies on this UPDATE to
populate the self-FK column post-INSERT, which is correct because all FK
targets must exist before the column is non-NULL. The order in
`defaultIngesters()` (`bulk.go:54-69`) puts this last among species-touching
ingesters — correct.

**2.3 — `EvolutionIngester` re-reads each chain JSON.** `walkEvolutionChain`
takes both the typed `evolutionNodeJSON` and the raw `map[string]any`,
because `conditions_json` needs the full evolution_detail object, not just
the typed subset. The two trees are walked in lockstep
(`evolution.go:101-110`). Reasonable; the only fragility is if PokeAPI ever
reorders `evolves_to` between two reads of the same file, which can't happen
because we read the same file twice from disk. ✓

**2.4 — `flavor_text` text normalization.** `flavor_text.go:30` strips `\f`,
`\n`, `\r`, and the soft-hyphen `\u00ad`, then `strings.Fields` collapses
runs of whitespace. That's well beyond the data-sync agent's stated
minimum. Test coverage at `ingesters_test.go:301-305` confirms `\f` and
`\n` are gone post-ingest. ✓

**2.5 — `pokemon.generation_id` is sourced from species.generation_id, not
from any forms-level introduction column.** Schema docstring at
`schema.sql:114` says generation_id is the form's debut generation; ingest
sets it to the species's debut generation. They agree today (no form
crosses a generation boundary in PokeAPI's data) and `validate.go` check
#14 verifies the default-form case. For non-default forms there is no
schema-side check. Acceptable for v2; flag for the future
`forms.introduced_in_generation_id` migration.

---

## 3. Form-identity invariant (D-1)

D-1 says the atomic competitor unit is the (species, form) tuple, and
each tuple must materialize as exactly one pokemon row.

**Schema enforcement:**

- `pokemon.species_id INTEGER NOT NULL REFERENCES species(id)` — must exist.
- `pokemon.form_id INTEGER NOT NULL REFERENCES forms(id) UNIQUE` — must
  exist; each form id appears at most once in pokemon.
- `pokemon.slug TEXT UNIQUE NOT NULL` — slug uniqueness is the user-facing
  guarantee.
- `forms.UNIQUE(species_id, form_name)` — within a species, no two forms
  share a form_name.

**Combined invariant:** for any (species_id, form_id), at most one pokemon
row. Form id is unique across all pokemon (UNIQUE on form_id), and the form
itself is unique within its species, so transitively the (species_id,
form_id) tuple is unique per pokemon row. ✓

**Ingest path enforcement:**

- `FormIngester` writes one form per pokemon-form JSON file, keyed on
  form id (no chance of duplicates within a single bulk run).
- `PokemonIngester` writes one pokemon per pokemon JSON file, with
  form_id = `idFromURL(p.Forms[0].URL)`. PokeAPI emits forms in slot order
  with the default form first; `forms[0]` is the canonical form for that
  pokemon. Schema's `UNIQUE(form_id)` will reject duplicates if upstream
  ever emits two pokemon JSON files referencing the same form.

**The remaining risk is the §1.1 species/form mismatch case** —
`pokemon.species_id` and `forms.species_id` are not bound to be equal.
Upstream PokeAPI is consistent so this hasn't bitten. Recommended
validate-side check is the one-line JOIN noted above.

**D-1 invariant: holds at the schema level. Ingest fidelity is sound.**

---

## 4. Phase 2 readiness — index audit for the filter engine

I looked at `validate.go`'s checks plus the canonical filter axes called
out in the brief.

| Filter axis | Predicate | Index | Verdict |
|---|---|---|---|
| By type | `WHERE type_id = ?` on pokemon_types | `idx_pokemon_types_type` (type_id) | ✓ |
| By tag | `WHERE tag_id = ?` on pokemon_tags | `idx_pokemon_tags_tag` (tag_id) | ✓ |
| By generation | `WHERE generation_id = ?` on pokemon | `idx_pokemon_generation` | ✓ |
| By species generation | `WHERE generation_id = ?` on species | `idx_species_generation` | ✓ |
| By form-inclusion mode | `WHERE is_default = 1` on pokemon, or `WHERE is_mega = 0 AND is_gmax = 0…` on forms | none | ⚠ see below |
| By BST range | `SUM(base_value) BETWEEN x AND y` | `idx_pokemon_stats_stat_value` only goes per-stat | ⚠ see below |
| By individual stat range | `WHERE stat_id = ? AND base_value BETWEEN x AND y` | `idx_pokemon_stats_stat_value` (stat_id, base_value) | ✓ |
| By name (slug) | `WHERE slug LIKE ?` | `slug UNIQUE` (covers `=`; not `LIKE %x%`) | ✓ for exact-match; partial-match needs scan |
| Evolution graph traversal | `WHERE evolves_from_species_id = ?` | `idx_species_evolves_from` | ✓ |

### Two indexes worth considering before Phase 2

**4.1 — Form-inclusion-mode filter.** The most common Phase-2 filter is
"only default-form pokemon" (the obvious user-facing default) or "exclude
megas/gmax/regionals". With `pokemon.is_default` having no index, the
default-only filter is a 1300-row scan. That's fast enough at v1 scale to
not be a blocker, but adding `idx_pokemon_is_default ON pokemon (is_default)`
is a one-liner and makes the query plan unambiguous. **Recommendation,
not blocker.**

**4.2 — BST.** Both the brief and Phase-2 filter design call for "BST
range" filters. The schema does not store BST anywhere; it is computed by
`Stats.BST()` after the per-stat decoration. SQL-side BST predicates would
need a 6-row aggregation per pokemon. Two options:
1. **Materialized column:** add `pokemon.bst INTEGER NOT NULL DEFAULT 0`,
   populated by `PokemonJoinsIngester` after stats land. Then add
   `idx_pokemon_bst ON pokemon (bst)`. Cleanest for the filter engine.
2. **View-only:** keep computing BST in Go after fetching stats. Fine at
   ~1300 rows (BST is computed once per Pokemon load and is O(6)).

The Pokemon struct already has `Stats.BST()` (`types.go:42`), so option 2
is what the codebase reaches for today. Option 1 is worth doing *iff*
Phase 2 wants SQL-side BST predicates rather than in-memory filtering.
Today's read is option 2 is fine: the filter engine will likely load and
filter in memory at this dataset size. **Open question for Phase 2 design,
not a 1.B blocker.**

### One column gap worth highlighting for Phase 2

**4.3 — Tags are not yet ingested.** `pokemon_tags` exists; `tags` exists;
no ingester populates either. The `Pokemon.Tags` field
(`types.go:26`) is wired through `query.go:218-237` and will return an
empty slice until the tags-overlay ingester lands (Phase 1.C per the plan).
Not a 1.B issue (curated tags are explicitly a separate phase) but worth
noting that Phase 2's "filter by tag" axis is index-ready and surface-ready
but data-empty.

---

## 5. Drift waiting to happen

These are silent-disagreement risks across the SQL ↔ ingester ↔ Go-type
seam. None block 1.B.

**5.1 — `pokemon.is_default` parity with `forms.is_default`.** Same fact,
two columns, no constraint binding them. Carried over from 1.B.1 review.
Recommend adding to `validate.go`. (See §1.2.)

**5.2 — `pokemon.species_id` vs `forms.species_id` consistency.** Schema
permits a pokemon row whose form belongs to a different species. Recommend
adding to `validate.go`. (See §1.1.)

**5.3 — `pokeapi_order` 0 sentinel.** `species.pokeapi_order`,
`forms.pokeapi_order`, `forms.pokeapi_form_order`, `pokemon.pokeapi_order`
all default to 0. Ingest writes the upstream `order` field directly, which
PokeAPI does set, but if upstream ever emits a missing `order` (zero in
JSON), the row passes silently and Phase-2's "sort by canonical order"
returns undefined order. Recommend a validate.go check:
`SELECT COUNT(*) FROM pokemon WHERE pokeapi_order = 0` should be zero (or
exactly one — id=1 / Bulbasaur is order=1 in PokeAPI, so 0 is genuinely
unused). **Concern, not blocker.**

**5.4 — `forms.introduced_in_generation_id` dead column.** No ingester
writes it; the column accepts NULL by FK shape. If a future ingester
turns on, callers reading it now will see NULL across the board. Either
delete the column or populate it. (See §1.)

**5.5 — `pokemon_moves` first-VG-wins for `learn_level`.** Documented
policy, but the schema has no encoding of "min level wins" or "max level
wins" — whichever VG iterates first wins. PokeAPI's per-pokemon JSON has
`version_group_details` ordered by version_group id ascending, which is
roughly chronological, so "first encountered wins" ≈ "earliest game's
level wins". Worth a one-line comment in `schema.sql` on the
`pokemon_moves` PK explaining the policy. **Nit.**

**5.6 — `Pokemon` Go type drift.** Verified clean. The struct surfaces
exactly the columns the brief calls out (id, species_id, form_id, slug,
display_name, generation_id, is_default, pokeapi_order, height/weight/base_xp,
sprite/shiny/art/cry/pokedex_db urls, content_hash) plus the three derived
fields (Types, Stats, Tags). Every `pokemon` table column with v1 read-side
relevance is on the struct; deferred attribute columns (e.g.,
`forms.is_mega`) correctly do not propagate to `Pokemon` because they are
form-level concerns surfaced via a different query path (when added).

**5.7 — `query.go` SELECT lists vs. schema column drift.** All three
SELECTs (`GetByID`, `GetBySlug`, `List`) enumerate the same 17 columns in
the same order, and `scanPokemonBase` scans them in the same order
(`query.go:124-130`). If a future schema column lands and the SELECT lists
forget it, the scan fails fast. Low drift risk. ✓

---

## 6. Test coverage — claim-vs-coverage audit (incremental over 1.B.1)

| Test | Constraint claimed | Exercised? |
|---|---|---|
| `TestSpecies_EvolvesFromSelfFKEnforced` | self-FK on `species.evolves_from_species_id` | ✓ from 1.B.1 |
| `TestForms_RejectsMultipleDefaultsPerSpecies` | partial unique on `is_default = 1` | ✓ |
| `TestForms_RejectsDuplicateNameWithinSpecies` | `UNIQUE(species_id, form_name)` | ✓ |
| `TestPokemonStats_RejectsOutOfRangeBaseValue` | both bounds (256 and -1) | ✓ |
| `TestPokemonStats_RejectsOutOfRangeEffort` | only upper bound (4); -1 not exercised | ⚠ residual from 1.A |
| `TestPokemon_GenerationFKEnforced` | `pokemon.generation_id` FK | ✓ |
| `TestPokemonTypes_RejectsDuplicateType` | `UNIQUE(pokemon_id, type_id)` | ✓ |
| `TestPokemonAbilities_RejectsInvalidSlot` | `slot IN (1,2,3)` | ✓ |

Plus per-ingester fixture tests covering happy-path INSERT for every
ingester (`ingesters_test.go`).

**Gaps (informational, none blocking):**

- **`evolutions.gender` NULL** — no test that NULL gender INSERT
  succeeds. One-liner.
- **`pokemon.is_default` ↔ `forms.is_default` parity** — no test, schema
  cannot enforce this; covered by validate.go addition (recommended).
- **`pokemon.species_id` ↔ `forms.species_id` parity** — same as above.
- **`effort = -1` lower bound** — Phase 1.A residual still open.
- **`pokemon_moves` PK collision dedup** — `INSERT OR IGNORE` policy is
  unverified by any test. A two-row test (same PK, different
  learn_level) would lock in the documented behavior.

---

## 7. Residual items

1. **(concern)** `forms.introduced_in_generation_id` is a dead column. Decide
   whether to delete or populate before Phase 2 lands.
2. **(concern)** Add validate.go checks for the two structural-gap
   invariants (`is_default` parity, `species_id` parity).
3. **(concern)** Add validate.go check for `pokeapi_order = 0` rows.
4. **(nit)** Add a comment on `pokemon_moves` PK explaining the
   first-VG-wins level policy.
5. **(nit)** `effort = -1` lower-bound test (Phase 1.A residual).
6. **(open question)** BST materialization for Phase 2. Defer to filter-engine
   gate. Current `Stats.BST()` is fine at v1 scale.

None of the residuals are blockers. The structural gaps in §1 are
expressible as ingest-side invariants (validate.go additions) and are
already on the data-sync / test-runner beat.

---

## 8. Impact radius going into Phase 2

- **Filter engine readiness.** Indexes for type / tag / generation / per-stat
  range / evolution-graph traversal are all in place. The two soft gaps
  (form-inclusion-mode index, BST materialization) can land if/when Phase 2
  declares them hot.
- **Tags surface.** `pokemon_tags` is index-ready and query-ready but
  data-empty until Phase 1.C ingests `tags.yaml`. Phase 2's tag-filter axis
  is wired all the way through; only the data is missing.
- **Evolution graph.** `species.evolves_from_species_id` populated by
  second-pass UPDATE; `evolutions` populated by chain walker with full
  `conditions_json`. Graph is queryable from day one of Phase 2.
- **Form-identity invariant.** Holds at the schema level via
  `pokemon.form_id UNIQUE` + `forms.UNIQUE(species_id, form_name)`. The
  one residual gap (species_id consistency) is a validate-time check away.
- **Schema versioning.** SchemaVersion = 2, recorded on Open via
  `schema_version` row. Schema migration path for v3 is the same `IF NOT
  EXISTS` pattern; bump and add columns.

---

**Verdict: Approve**

(Schema v2 is structurally sound — 11 column additions are sensibly typed,
the load-bearing self-FK index is present, FK cascading is complete, and
D-1's atomic-competitor invariant is enforced through the
form_id/species_id/form_name uniqueness chain. All 12 ingesters write
columns that match their target tables; no drift between ingest and schema.
Three residual concerns — `is_default` parity, `species_id` parity, dead
`forms.introduced_in_generation_id` column — are all expressible as
validate.go additions or a one-line schema cleanup, none block 1.B → 2
handoff. Phase 2's filter engine has every index it needs for the canonical
filter axes; two soft gaps (form-inclusion-mode index, BST materialization)
can land lazily when Phase 2 declares them hot.)
