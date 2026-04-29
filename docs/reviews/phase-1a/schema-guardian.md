# Phase 1.A — schema-guardian review

**Scope.** Sub-phase 1.A introduced the Pokédex SQLite schema, the `Pokemon`/`Stats` Go types, the `Open`/`SchemaVersion` plumbing, the `Query` interface with `ErrNotImplemented` stubs, and the bulk-sync skeleton. No Postgres, no OpenAPI, no TS/Zod yet (those layers light up in Phase 4 and Phase 6+).

**Files reviewed.**

- `/Users/jayesh/Experiments/PokemonRanker/apps/api/internal/pokedex/schema.sql`
- `/Users/jayesh/Experiments/PokemonRanker/apps/api/internal/pokedex/schema.go`
- `/Users/jayesh/Experiments/PokemonRanker/apps/api/internal/pokedex/db.go`
- `/Users/jayesh/Experiments/PokemonRanker/apps/api/internal/pokedex/types.go`
- `/Users/jayesh/Experiments/PokemonRanker/apps/api/internal/pokedex/query.go`
- `/Users/jayesh/Experiments/PokemonRanker/apps/api/internal/pokedex/ingest/bulk.go`
- `/Users/jayesh/Experiments/PokemonRanker/apps/api/internal/pokedex/{db,types,query}_test.go`
- `/Users/jayesh/Experiments/PokemonRanker/apps/api/internal/pokedex/ingest/bulk_test.go`

---

## Synchronization summary

The four-layer contract for which this agent is responsible (DB schema, Go types, OpenAPI, TS+Zod) is degenerate at Phase 1.A: only the bottom two layers exist. So the question "are all four representations in lockstep" reduces to "are the SQL schema and the Go `Pokemon`/`Stats`/`Query` surface coherent, and is the scaffolding ready to absorb Phase 1.B without introducing silent drift?"

**Verdict on coherence: mostly yes**, with one real shape mismatch (generation routing), several missing constraints that will let Phase 1.B / 1.E bugs hide until 1.E's exit criteria, and a small set of integer-width nits.

---

## Findings

### Blockers (must address before declaring 1.A complete or starting 1.B)

#### B1. `Pokemon.GenerationID` has no corresponding column on the `pokemon` table

`types.go:13` declares:

```go
GenerationID int64
```

But `pokemon` (`schema.sql:81-96`) has no `generation_id`. The closest sources are `species.generation_id` (the species' debut gen, e.g. Charizard = 1) and `forms.introduced_in_generation_id` (the form's debut gen, e.g. Mega Charizard X = 6). D-1 is explicit that these can differ and that the *form* gen is what the user reasons about ("Megas may be in or out of a given generation's metagame"). So which one fills `Pokemon.GenerationID`?

This is a silent-drift trap waiting for Phase 1.B: the row scanner will pick one, future filter logic in Phase 2 will assume the other, and nothing in either layer will tell you which. Resolve before Phase 1.B starts. Two acceptable shapes:

- **(preferred)** Add a `generation_id INTEGER NOT NULL REFERENCES generations(id)` column to `pokemon`, populated by the ingest with `COALESCE(forms.introduced_in_generation_id, species.generation_id)`. That's the value `GenerationFilter` in Phase 2 will use, and it removes a join from every Phase 1.E query. (`forms.introduced_in_generation_id` is currently nullable, which is part of why this matters.)
- Or remove `GenerationID` from the `Pokemon` struct, document that gen filtering goes through `species` + `forms`, and let Phase 1.E expose helper queries.

Either is fine; picking neither and discovering the disagreement in Phase 2 is not.

#### B2. `pokemon_types` lets a Pokémon carry the same type in both slots

`schema.sql:107-112`:

```sql
CREATE TABLE IF NOT EXISTS pokemon_types (
  pokemon_id INTEGER NOT NULL REFERENCES pokemon(id) ON DELETE CASCADE,
  type_id INTEGER NOT NULL REFERENCES types(id),
  slot INTEGER NOT NULL CHECK (slot IN (1, 2)),
  PRIMARY KEY (pokemon_id, slot)
);
```

The PK is `(pokemon_id, slot)`, so `(123, 1, fire)` + `(123, 2, fire)` is permitted. Real-world Pokémon never have the same type twice; ingest should be authoritative against this corruption mode. Add `UNIQUE (pokemon_id, type_id)`.

#### B3. `forms` has no uniqueness across `(species_id, form_name)`

`schema.sql:65-76` only enforces `forms.slug UNIQUE`. Two forms of the same species with the same `form_name` (empty string included — note the default is `''`) are permitted. With `is_default` also unconstrained, the schema allows two "default" forms per species, breaking the (species, form) → pokemon model from D-1.

Add at minimum `UNIQUE (species_id, form_name)`. A partial-index "at most one default per species" (`CREATE UNIQUE INDEX ... ON forms(species_id) WHERE is_default = 1`) is the stronger fix and is supported by SQLite.

### Request-changes (should fix in 1.A; trivial)

#### R1. `pokemon_stats.base_value` has no CHECK

Game stat values are `0..255`. A bug in ingest could write a negative or 999 and nothing would notice until Phase 1.E's BST snapshot test (or worse, Phase 4 ranking). Add `CHECK (base_value BETWEEN 0 AND 255)` and `CHECK (effort BETWEEN 0 AND 3)` (effort yields are 0–3 per game rules).

#### R2. `pokemon_abilities.slot` has no CHECK

Pokémon have at most three ability slots (slot 1, slot 2, hidden). The schema currently allows any integer. Add `CHECK (slot IN (1, 2, 3))`. Optionally, also require that `is_hidden = 1` iff `slot = 3` — that's a stronger invariant but tightens ingest expectations and is reversible.

#### R3. `pokemon_moves.learn_method` has no CHECK

It's a free-form text column. PokeAPI's vocabulary is small and stable: `level-up`, `egg`, `tutor`, `machine`, `light-ball-egg`, `colosseum-purification`, etc. Either CHECK against the known set, or add an `idx_pokemon_moves_learn_method` index since the filter engine (Phase 2) and aggregate queries will lean on this.

#### R4. `Pokemon` Go struct uses `int` for height/weight/base_experience while IDs use `int64`

```go
HeightDecimeters   int
WeightHectograms   int
BaseExperience     int
```

vs. `ID int64`, `SpeciesID int64`. SQLite INTEGER is 64-bit; the Go-side scan into `int` is platform-dependent (32-bit on some old ARM targets). Values are tiny in practice so we won't actually overflow, but this is silent-narrowing-by-platform — exactly the drift class this agent is supposed to refuse. Either move all numeric DB columns to `int64` in Go, or add a comment justifying the deliberate narrowing. Consistency over correctness-at-the-margin; pick one.

### Nits (address opportunistically)

#### N1. Missing indexes for Phase 1.E / Phase 2 query patterns

The Phase 1.E query API will support lookups by slug, by tag, by type, by generation, and BST-range / stat-threshold filters. Current indexing:

- `species.slug`, `forms.slug`, `pokemon.slug`, `types.slug`, `stats.slug`, `abilities.slug`, `moves.slug`, `tags.slug`, `generations.slug` — all UNIQUE → implicit B-tree index in SQLite. Good.
- `idx_species_generation`, `idx_pokemon_species`, `idx_forms_species`, `idx_pokemon_types_type`, `idx_pokemon_abilities_ability`, `idx_pokemon_moves_move`, `idx_evolutions_chain`, `idx_evolutions_to`, `idx_pokemon_tags_tag`. Reasonable.

Gaps the filter engine will want:

- **No index on `pokemon_stats(stat_id, base_value)`.** BST and stat-threshold filters scan all stats rows. With ~1300 pokemon × 6 = ~7800 rows it's tolerable, but a covering index on `(stat_id, base_value, pokemon_id)` makes "speed > 100" a single seek.
- **No index supporting "Pokémon by tag" the way the filter engine wants it.** `idx_pokemon_tags_tag` covers tag lookups; you'll also want it as a covering index `(tag_id, pokemon_id)` (it already is, since the PK is `(pokemon_id, tag_id)` — but that PK orders the wrong way for "give me everyone with tag=mega". The dedicated `idx_pokemon_tags_tag` saves you. Fine.
- **`pokemon.species_id` is indexed; `pokemon.form_id` is `UNIQUE` (implicit index). Good.**

This isn't blocker territory because dataset is tiny, but the `pokemon_stats` covering index will pay back the moment Phase 2 lands.

#### N2. `pokemon.form_id` `UNIQUE` is the load-bearing form-identity invariant; comment it

The (species, form) → pokemon rule from D-1 is enforced by the lone `UNIQUE` on `pokemon.form_id` (since each form belongs to one species via `forms.species_id`, and each form participates in at most one pokemon row). That's correct, but the comment block at `schema.sql:80` says only "one row per (species, form)". Add a sentence that says "enforced by `forms.species_id` FK + `pokemon.form_id UNIQUE`; do not relax either." Future edits won't notice the load-bearing constraint otherwise. Optional but cheap.

#### N3. `source_commit_sha` columns on `species` and `pokemon` duplicate `sync_meta`

The whole DB is rebuilt atomically per bulk run (`ingest/bulk.go:54-93`), so every row in every table has the same provenance: the most recent `sync_meta` row. Per-row `source_commit_sha` is dead weight under the bulk-replace strategy. It will become useful only if Phase 1.F's `delta` mode actually writes per-row, at which point I'd expect it on every entity, not just two. For now: either drop these columns or document the intent so 1.F doesn't sprout a third copy.

#### N4. `flavor_text.language` and `version` are free-form

Globalization isn't until Phase 7+, but the schema allows `language='en'` and `language='english'` to coexist, etc. A CHECK against an enum (`'en'`, `'fr'`, ...) or a foreign key to a `languages` table prevents drift the day Phase 1.D ingest lands. Defer is fine; flagging.

#### N5. `evolutions.id` autoincrements; `tags.id` autoincrements; `sync_meta.id` autoincrements

Mixed style. Other tables (`generations`, `species`, `forms`, `pokemon`, `types`, `stats`, `abilities`, `moves`, `evolution_chains`) use the upstream PokeAPI id directly. This is intentional and correct (PokeAPI ids are stable; the three autoincrement tables don't have an upstream id). Worth a one-line comment in the schema header so a future contributor doesn't "fix" the inconsistency.

#### N6. `Pokemon.PokemonDBURL` is computed, not stored

`schema.sql:94` has `pokedex_db_url TEXT NOT NULL DEFAULT ''`, mirrored in Go as `PokemonDBURL string`. Per D-12 we link out to PokemonDB. The URL is deterministic from the slug (`https://pokemondb.net/pokedex/{slug}`); storing it adds a column that has to be kept in sync with the ingest's URL-construction logic. If the slug is the source of truth, drop the column and let the API layer compute the URL on read. (Or: keep the column and document that the ingest is the only writer.) Either way, pick one; don't let two writers exist.

### Praise

- `pokemon.form_id UNIQUE` is exactly the right way to express the (species, form) bijection without a redundant composite key. Compact and correct.
- `PRAGMA foreign_keys = ON` at the top of `schema.sql` plus the same pragma in the `Open` DSN belt-and-suspenders the most common SQLite footgun (FKs default off). Tested in `db_test.go:72`. Good.
- `pokemon_types`, `pokemon_stats`, `pokemon_abilities`, `pokemon_tags` all `ON DELETE CASCADE` from `pokemon`. The associated `_test.go` doesn't exercise cascade explicitly, but the constraint is right — prevents orphan rows if a `pokemon` row ever gets deleted (which is rare under bulk-replace, but the guard costs nothing).
- The bulk-replace strategy in `ingest/bulk.go` (write to `.tmp`, `os.Rename`, stale-tmp cleanup) is the correct pattern and is tested at `bulk_test.go:69-82`. Nice.
- The `ErrNotImplemented` stubs are tested at `query_test.go:17-33`. The test will fail loudly the day the stubs are replaced — that's the right contract for a phase boundary, far better than a silent `nil` return that ranks Pokémon as `[]`.
- `SchemaVersion` constant lives next to the `//go:embed` directive (`schema.go:9`), so any schema edit that should bump the version is one file away from the constant. Good co-location.

---

## Impact radius

**Phase 1.B (bulk ingest).** Will write rows for every table. Blockers above directly affect 1.B's correctness:

- **B1 (generation routing)** is in the path — 1.B has to populate Pokémon's gen *somewhere*. Decide before 1.B starts.
- **B2/B3 (uniqueness)** — without these, ingest bugs will corrupt the DB and the snapshot test in 1.B's exit criteria might pass anyway (snapshot diff is shape, not invariants).
- **R1/R2/R3 (CHECKs)** — adding CHECKs now means 1.B catches its own ingest bugs at write time instead of in Phase 2 acceptance. Cheaper.

**Phase 1.C (sprite/cry URLs + flavor text).** Sprite/cry columns (`sprite_url`, `shiny_sprite_url`, `official_artwork_url`, `cry_url`) are present and `NOT NULL DEFAULT ''` per D-17. That's right: storage as columns, hot-link from PokeAPI's GitHub, no proxy. No changes needed here.

**Phase 1.D (tag curation).** Schema is clean: `tags`, `pokemon_tags` with cascade, `pokemon_tags_tag` index. The curator agent (`data-sync`) can drop in. No changes.

**Phase 1.E (query API + validation).** This is where N1's missing indexes start to matter; the gap is small at scale ~1300 but the `pokemon_stats(stat_id, base_value)` covering index is the one I'd add proactively.

**Phase 2 (filter engine).** `EvolutionStageFilter` (PLAN.md, Phase 2) will need "fully evolved?" semantics. Two paths:

1. Compute on the fly via `evolutions` joins: the species has no outgoing edge → fully evolved. Works, joins on every filter.
2. Denormalize `species.is_fully_evolved` (or `species.evolution_stage INTEGER`) at sync time. Cheaper at query time.

Not blocking 1.A, but worth deciding before Phase 2 starts so `data-sync` ingests it correctly the first time. Flag for the implementation gate aggregation.

**Phase 4 (TS+Zod).** When the OpenAPI/TS pipeline lights up in Phase 4, the `Pokemon` Go struct shape becomes the contract source. The drift risks are:

- `Pokemon.Tags []string` and `Pokemon.Types []string` are not columns — they're aggregations. Phase 1.B's row scanner has to populate them; Phase 4's OpenAPI generation has to know they're arrays-of-strings, not nested objects. Fine if 1.B exposes them with a stable shape; bad if 1.B introduces a `TypeWithSlot` struct and Phase 4 tries to keep the `[]string` contract.
- `Pokemon.Stats Stats` is a nested struct in Go. OpenAPI will inline it. That's the right shape.

This isn't blocking 1.A; it's the kind of thing this agent should flag at the 1.B → 1.E boundary. Noting for the paper trail.

---

## Caller updates needed

**Phase 1.A → Phase 1.B (immediate).**

1. Resolve B1: add `pokemon.generation_id` (preferred) or remove `Pokemon.GenerationID`.
2. Add UNIQUE constraints from B2 and B3.
3. Add CHECKs from R1, R2, R3 (or accept risk and document).
4. Pick a posture on R4 (int vs int64) and apply consistently to the `Pokemon` struct.
5. Bump `SchemaVersion` to `2` (`schema.go:9`) since you'll change `schema.sql`.
6. Update `expectedTables` in `db_test.go:17` only if a table is added; none of the above adds one.
7. Add a test that asserts the new constraints reject the bad cases (e.g. inserting two forms with the same `(species_id, form_name)` fails).

**Phase 1.B onward.** When `Pokemon` gains real fields backed by row scans, this agent re-fires to ensure the SQL `SELECT` columns match the struct. The `query.go` stubs are the right entry points — just don't let them grow beyond the `Query` interface without a re-review.

**No Postgres / OpenAPI / TS changes today** — those layers don't exist yet.

---

**Verdict: Request changes**

(Three blockers are mechanically small and the rest are cheap. Re-run this gate after the schema edits land; I expect the next pass to approve.)
