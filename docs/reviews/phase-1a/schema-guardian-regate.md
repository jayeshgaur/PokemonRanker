# Phase 1.A — schema-guardian re-gate

**Scope.** Re-review of the Phase 1.A fix pass against my prior gate (`schema-guardian.md`, verdict: Request changes; 3 blockers + 4 request-changes + 6 nits). Verifying that the schema and Go-types fixes correctly address the items I called out, and that the new tests actually exercise the constraints they claim to.

**Files re-reviewed.**

- `/Users/jayesh/Experiments/PokemonRanker/apps/api/internal/pokedex/schema.sql`
- `/Users/jayesh/Experiments/PokemonRanker/apps/api/internal/pokedex/types.go`
- `/Users/jayesh/Experiments/PokemonRanker/apps/api/internal/pokedex/db_test.go`
- `/Users/jayesh/Experiments/PokemonRanker/apps/api/internal/pokedex/schema.go`
- `/Users/jayesh/Experiments/PokemonRanker/apps/api/internal/pokedex/ingest/bulk.go` (cross-check on `SchemaVersion` reference)

`go test ./internal/pokedex/...` passes locally (cached: `ok`).

---

## Item-by-item verification

### B1 — `pokemon.generation_id` column ✅ ADDRESSED

`schema.sql:99-119` now includes:

```sql
generation_id INTEGER NOT NULL REFERENCES generations(id),
```

with a supporting `CREATE INDEX IF NOT EXISTS idx_pokemon_generation ON pokemon (generation_id)` (`schema.sql:119`). The column comment block at `schema.sql:97-98` explicitly cites the B1 rationale ("stored on this row to remove silent ambiguity between species.generation_id and forms.introduced_in_generation_id"). Good.

**Column shape verification:**
- Type matches Go's `Pokemon.GenerationID int64` (SQLite INTEGER → Go int64). ✓
- `NOT NULL` is correct: every Pokémon must belong to exactly one generation per the D-1 form-identity model. ✓
- FK to `generations(id)` is enforced (and `TestPokemon_GenerationFKEnforced` at `db_test.go:152-165` verifies it).

**Ingest population (B1's "preferred fix"):** As you noted, ingest population is Phase 1.B work. The column is correctly placed, but Phase 1.B *must* populate it as `COALESCE(forms.introduced_in_generation_id, species.generation_id)` per my prior fix. There is no schema-side enforcement that the value is consistent with the `species`/`forms` rows it references — that's a Phase 1.B invariant test (data-sync agent's beat). I'll re-fire when the ingest lands to verify the COALESCE shape was followed. **For now: column is right.** ✓

### B2 — `pokemon_types UNIQUE (pokemon_id, type_id)` ✅ ADDRESSED

`schema.sql:130-136`:

```sql
CREATE TABLE IF NOT EXISTS pokemon_types (
  pokemon_id INTEGER NOT NULL REFERENCES pokemon(id) ON DELETE CASCADE,
  type_id INTEGER NOT NULL REFERENCES types(id),
  slot INTEGER NOT NULL CHECK (slot IN (1, 2)),
  PRIMARY KEY (pokemon_id, slot),
  UNIQUE (pokemon_id, type_id)
);
```

Both the PK on `(pokemon_id, slot)` and the UNIQUE on `(pokemon_id, type_id)` are present. A Pokémon now cannot have two slots both pointing at Fire. ✓

`TestPokemonTypes_RejectsDuplicateType` at `db_test.go:85-96` exercises it: inserts `(1, 10, 1)` (success), then `(1, 10, 2)` (fails). The test directly forces a same-type-different-slot collision, which is exactly the corruption mode B2 prevents. ✓

### B3 — `forms` uniqueness + partial unique on default ✅ ADDRESSED

`schema.sql:74-92`:

```sql
CREATE TABLE IF NOT EXISTS forms (
  ...
  UNIQUE (species_id, form_name)
);

CREATE INDEX IF NOT EXISTS idx_forms_species ON forms (species_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_forms_default_per_species
  ON forms (species_id) WHERE is_default = 1;
```

Both fixes are in:

1. `UNIQUE (species_id, form_name)` as a table-level constraint. ✓
2. The "stronger fix" partial unique index (`is_default = 1`) is present, named `idx_forms_default_per_species`. ✓

Two tests verify both:

- `TestForms_RejectsDuplicateNameWithinSpecies` (`db_test.go:98-108`) inserts `(species=1, form_name='')`, then a second `(species=1, form_name='')` with a different slug. The second fails — exercises the table UNIQUE. ✓
- `TestForms_RejectsMultipleDefaultsPerSpecies` (`db_test.go:110-121`) inserts `(species=1, form_name='', is_default=1)`, then `(species=1, form_name='mega-x', is_default=1)`. The second fails — exercises the partial unique index (different `form_name` so the table UNIQUE wouldn't catch it; only the partial index does). ✓

The two tests are well-targeted: each isolates one of the two B3 invariants.

### R1 — `pokemon_stats` CHECKs ✅ ADDRESSED

`schema.sql:148-154`:

```sql
CREATE TABLE IF NOT EXISTS pokemon_stats (
  pokemon_id INTEGER NOT NULL REFERENCES pokemon(id) ON DELETE CASCADE,
  stat_id INTEGER NOT NULL REFERENCES stats(id),
  base_value INTEGER NOT NULL CHECK (base_value BETWEEN 0 AND 255),
  effort INTEGER NOT NULL DEFAULT 0 CHECK (effort BETWEEN 0 AND 3),
  PRIMARY KEY (pokemon_id, stat_id)
);
```

Both `CHECK (base_value BETWEEN 0 AND 255)` and `CHECK (effort BETWEEN 0 AND 3)` are present. ✓

`TestPokemonStats_RejectsOutOfRangeBaseValue` (`db_test.go:123-132`) exercises both upper (`256`) and lower (`-1`) bounds — good two-sided test.

`TestPokemonStats_RejectsOutOfRangeEffort` (`db_test.go:134-140`) only tests the upper bound (`effort=4`). It does *not* test the lower bound (`effort=-1`). **Minor gap** — the symmetric test exists for `base_value` but not for `effort`. Add a one-line `effort=-1` assertion for parity.

### R2 — `pokemon_abilities.slot` CHECK ✅ ADDRESSED

`schema.sql:171-177`:

```sql
CREATE TABLE IF NOT EXISTS pokemon_abilities (
  pokemon_id INTEGER NOT NULL REFERENCES pokemon(id) ON DELETE CASCADE,
  ability_id INTEGER NOT NULL REFERENCES abilities(id),
  slot INTEGER NOT NULL CHECK (slot IN (1, 2, 3)),
  is_hidden INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (pokemon_id, slot)
);
```

`CHECK (slot IN (1, 2, 3))` is present. ✓

`TestPokemonAbilities_RejectsInvalidSlot` (`db_test.go:142-150`) inserts `slot = 4`, asserts error. Targeted at the new constraint. ✓

The optional stronger invariant from R2 (`is_hidden = 1 iff slot = 3`) was deferred — that's fine, it was explicitly optional.

### R3 — `pokemon_moves.learn_method` index ✅ ADDRESSED

`schema.sql:208-209`:

```sql
CREATE INDEX IF NOT EXISTS idx_pokemon_moves_learn_method
  ON pokemon_moves (learn_method);
```

Index added; CHECK was not, which is the choice my prior R3 listed as the alternative ("either CHECK against the known set, or add an `idx_pokemon_moves_learn_method` index"). Filter engine in Phase 2 will use it; the comment at `schema.sql:207` cites R3. ✓

The choice (index over CHECK) is defensible: PokeAPI's `learn_method` vocabulary is small but not formally fixed, and a CHECK list could become a footgun if upstream introduces a new method name.

### R4 — `Pokemon` Go struct integer widths ✅ ADDRESSED

`types.go:6-25`:

```go
type Pokemon struct {
    ID                 int64
    SpeciesID          int64
    FormID             int64
    Slug               string
    DisplayName        string
    GenerationID       int64
    Types              []string
    Stats              Stats
    HeightDecimeters   int64
    WeightHectograms   int64
    BaseExperience     int64
    ...
    ContentHash        string
    Tags               []string
}
```

`HeightDecimeters`, `WeightHectograms`, `BaseExperience` all moved to `int64`. The struct is now consistent: every numeric DB-backed field is `int64`. ✓

**Inconsistency note.** `Stats` (`types.go:29-36`) still uses `int` for HP/Attack/Defense/SpecialAttack/SpecialDefense/Speed. This is fine *because* the schema CHECK now enforces `0 ≤ base_value ≤ 255` (R1), so silent narrowing is impossible — values fit in any int width. The Go comment at `types.go:27-28` correctly cites the CHECK as the basis for the narrower type ("Values are guaranteed to be in 0..255 by the schema CHECK constraint on pokemon_stats.base_value"). Good co-location of invariant + type choice. ✓

### N1 — `pokemon_stats(stat_id, base_value)` covering index ✅ ADDRESSED (proactive)

`schema.sql:157-158`:

```sql
CREATE INDEX IF NOT EXISTS idx_pokemon_stats_stat_value
  ON pokemon_stats (stat_id, base_value);
```

The exact index I called out. Phase 2's "speed > 100" filter is now a single seek + range scan rather than a full-table scan. ✓

The other N-items (N2 `form_id` UNIQUE comment, N3 `source_commit_sha` columns, N4 flavor_text language enum, N5 mixed AUTOINCREMENT comment, N6 `pokedex_db_url` posture) were nits — none was required. I see N2's spirit picked up at `schema.sql:95-96`: a comment block on `pokemon` cites the form-identity invariant and warns against relaxing either constraint. ✓ (N3, N4, N5, N6 not addressed, which is fine per their original framing as "address opportunistically.")

---

## Drift check across the four layers

Postgres / OpenAPI / TS / Zod still don't exist in Phase 1.A, so the four-layer contract reduces to "SQL schema ↔ Go types." Comparing column-by-column:

| `pokemon` column          | Type    | Go field             | Type     | Match |
|---------------------------|---------|----------------------|----------|-------|
| `id`                      | INTEGER | `ID`                 | `int64`  | ✓     |
| `species_id`              | INTEGER | `SpeciesID`          | `int64`  | ✓     |
| `form_id`                 | INTEGER | `FormID`             | `int64`  | ✓     |
| `slug`                    | TEXT    | `Slug`               | `string` | ✓     |
| `display_name`            | TEXT    | `DisplayName`        | `string` | ✓     |
| `generation_id`           | INTEGER | `GenerationID`       | `int64`  | ✓ (B1 closed) |
| `height_dm`               | INTEGER | `HeightDecimeters`   | `int64`  | ✓ (R4 closed) |
| `weight_hg`               | INTEGER | `WeightHectograms`   | `int64`  | ✓ (R4 closed) |
| `base_experience`         | INTEGER | `BaseExperience`     | `int64`  | ✓ (R4 closed) |
| `sprite_url`              | TEXT    | `SpriteURL`          | `string` | ✓     |
| `shiny_sprite_url`        | TEXT    | `ShinySpriteURL`     | `string` | ✓     |
| `official_artwork_url`    | TEXT    | `OfficialArtworkURL` | `string` | ✓     |
| `cry_url`                 | TEXT    | `CryURL`             | `string` | ✓     |
| `pokedex_db_url`          | TEXT    | `PokemonDBURL`       | `string` | ✓     |
| `content_hash`            | TEXT    | `ContentHash`        | `string` | ✓ (new field, scanned 1:1 from new column) |
| `source_commit_sha`       | TEXT    | (none)               | —        | unmapped — DB-only audit column, fine |
| —                         | —       | `Types`              | `[]string` | aggregation from `pokemon_types` JOIN, no column expected |
| —                         | —       | `Tags`               | `[]string` | aggregation from `pokemon_tags` JOIN, no column expected |
| —                         | —       | `Stats`              | `Stats`   | aggregation from `pokemon_stats` JOIN, no column expected |

`ContentHash` (new since prior review) and `GenerationID` (now landed) both have backing columns and consistent int64/string types. **No drift.** ✓

`source_commit_sha` remains unmapped on the Go side — this is consistent with N3 ("dead weight under bulk-replace"), which I flagged as opportunistic, not blocking. Phase 1.F will revisit when delta mode lands.

---

## New tests — claim-vs-coverage audit

Six new tests added, each exercising one new constraint:

| Test                                              | Constraint claimed                              | Actually exercised? |
|---------------------------------------------------|-------------------------------------------------|---------------------|
| `TestPokemonTypes_RejectsDuplicateType`           | UNIQUE (pokemon_id, type_id) (B2)               | ✓ slot 1 + slot 2, same type |
| `TestForms_RejectsDuplicateNameWithinSpecies`     | UNIQUE (species_id, form_name) (B3.a)           | ✓ same species+form_name, different slug |
| `TestForms_RejectsMultipleDefaultsPerSpecies`     | partial unique on `is_default = 1` (B3.b)       | ✓ different form_name so only the partial index can catch |
| `TestPokemonStats_RejectsOutOfRangeBaseValue`     | CHECK (base_value BETWEEN 0 AND 255) (R1.a)     | ✓ tests both `256` and `-1` (two-sided) |
| `TestPokemonStats_RejectsOutOfRangeEffort`        | CHECK (effort BETWEEN 0 AND 3) (R1.b)           | ⚠ tests only upper bound (`4`); no `-1` case |
| `TestPokemonAbilities_RejectsInvalidSlot`         | CHECK (slot IN (1, 2, 3)) (R2)                  | ✓ tests `slot=4` |
| `TestPokemon_GenerationFKEnforced`                | new generation_id FK (B1)                       | ✓ inserts gen_id=999, asserts FK rejection |

All seven tests (six new + one reinforcement) target the exact invariant they name. The single nit is `TestPokemonStats_RejectsOutOfRangeEffort` — it doesn't symmetric-test the lower bound the way the `base_value` test does. Trivial to add; not a re-gate blocker.

The seed helpers (`seedSpecies`, `seedBaseRows`) at `db_test.go:178-208` are correctly factored: B3 tests use just `seedSpecies` (no forms/pokemon needed, since we're testing the forms table itself), while pokemon_*-table tests use `seedBaseRows`. Clean separation.

---

## SchemaVersion concern ⚠️

`schema.go:9` still says `const SchemaVersion = 1`. My prior review's caller-update list said:

> 5. Bump `SchemaVersion` to `2` (`schema.go:9`) since you'll change `schema.sql`.

This wasn't done. The argument for not bumping: nothing has shipped externally yet (Phase 1.A is pre-flight scaffolding; there is no v1 SQLite file in the wild for v2 to be incompatible with). The argument for bumping: the schema-versioning contract (`schema.sql:13`: "When the schema changes, bump SchemaVersion in schema.go") is already documented; not following it during the fix pass undermines the contract before it's even tested.

**Verdict on this:** non-blocking — the `SchemaVersion = 1` value is internally consistent (the `recordSchemaVersion` insert and the `bulk.go:111` reference both use the same constant), and the bump-on-change discipline becomes load-bearing only after the first external release. But: I'd prefer to either bump to `2` or add a note in `schema.go` explaining "version stays at 1 because Phase 1.A schema has never been deployed; bump on the first change post-Phase 1.B". Code-reviewer's N about `Open` not actually checking the schema version (`code-reviewer.md:65-67`) overlaps here — both this and that comment are pointing at the same gap.

Flagging, not blocking.

---

## Impact radius after the fix

- **Phase 1.B (bulk ingest).** All five bulk-affecting items (B1, B2, B3, R1, R2) are closed. Phase 1.B's invariant tests will now catch ingest bugs at write time instead of in Phase 2. ✓
- **Phase 1.E (query API).** N1's covering index is in. Stat-threshold filters will be fast from the start. ✓
- **Phase 4 (TS+Zod).** `Pokemon` struct shape is now numerically consistent (all int64), so the OpenAPI schema generated from this struct in Phase 4 will not have a HeightDecimeters-as-int32-but-everything-else-as-int64 ambiguity. ✓

---

## Residual items (informational, not blocking)

1. **Symmetric lower-bound test for `effort`** — add `effort=-1` case to `TestPokemonStats_RejectsOutOfRangeEffort` for parity with `TestPokemonStats_RejectsOutOfRangeBaseValue`. One line.
2. **`SchemaVersion` posture** — either bump to 2 now or doc-comment why staying at 1 is intentional (Phase 1.A pre-deploy). Either is fine; the silence is what bothers me, not the choice.
3. **Phase 1.B re-fire** — when ingest populates `pokemon.generation_id`, this agent re-reviews to confirm the COALESCE shape from B1.
4. **Nits N3, N4, N5, N6 from prior review** — explicitly deferred as opportunistic; no action needed for 1.A → 1.B handoff.

---

**Verdict: Approve**

(All three blockers and all four request-changes are properly addressed in schema, types, and tests. The two residual items above are informational; neither blocks Phase 1.B from starting.)
