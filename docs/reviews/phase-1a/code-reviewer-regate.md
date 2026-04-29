# Code Review — Phase 1.A re-gate (post blocker-fix pass)

**Reviewer:** code-reviewer agent
**Scope:** Diff since `code-reviewer.md` (prior approve-with-nits): schema CHECK / UNIQUE / FK additions, content_hash columns, expanded `sync_meta`, generation_id widening, flock-based concurrent-run guard, six new constraint tests, deletion of `cmd/api` + `internal/health`, and the new ADRs D-22 / D-23.
**Local CI gates:** `go vet ./...` clean, `golangci-lint run` reports `0 issues`, `go test -race -count=1 ./...` green — 17 tests pass across `pokedex` (13) and `ingest` (4) (was 12 / 5). `make sync` produces a SQLite with the expanded `sync_meta` and the new columns.

## Verdict (TL;DR)

The blocker-fix pass is clean. Every prior nit is either fixed or appropriately deferred. The one new piece of subsystem code (`gofrs/flock` guard) is correctly written: lock acquisition uses `TryLockContext` (so a second process gets a clean error, not a hang), and `Unlock` runs from a single `defer` that fires on every return path including the rename-success path. Schema constraints are proportionate, the test helpers are sensible, and ADR alignment for D-22 / D-23 is correct. No new blockers introduced.

---

## Prior nits — disposition

| Prior comment | Status |
|---|---|
| `[question]` add explicit `UNIQUE (species_id, form_id)` on `pokemon` (D-1 inline) | Not addressed; `form_id UNIQUE` still carries the invariant. Acceptable as a deferred polish — `forms.species_id` FK + `pokemon.form_id UNIQUE` together still encode D-1 exactly. **Defer.** |
| `[nit]` `BulkOptions.Validate()` extension point | Not added; still a single `OutputPath == ""` check at top of `RunBulk`. Cheap to add in 1.B once `APIDataPath` becomes required. **Defer.** |
| `[nit]` `recordSchemaVersion` writes on every Open | Unchanged. Still idempotent via `ON CONFLICT DO NOTHING`. **Defer.** |
| `[nit]` no schema-version migration check on reopen | Unchanged. `SchemaVersion` is still the constant `1`; nothing to enforce yet. **Defer until 1.F or whenever the version bumps.** |
| `[question]` `evolutions.id` / `tags.id` `AUTOINCREMENT` | Unchanged. `sync_meta.id` also picked up `AUTOINCREMENT` in this pass — at least the choice is now consistent across locally-generated ids. **Defer.** |
| `[nit]` `errors.New` vs `fmt.Errorf` style mismatch in `bulk.go:47` | Unchanged. Still fine. **Defer.** |
| `[nit]` unconditional `os.Remove(tmp)` swallows non-ENOENT errors | Unchanged at `bulk.go:89`. **Defer.** |
| `[nit]` `:memory:` DSN does not enable foreign keys | **Addressed indirectly.** Six new tests run against `:memory:` and rely on FK + CHECK constraints (`TestPokemon_GenerationFKEnforced` in particular). The fact that `TestPokemon_GenerationFKEnforced` *passes* on `:memory:` is striking — `modernc.org/sqlite` evidently honours the embedded `PRAGMA foreign_keys = ON;` at the top of `schema.sql` even on `:memory:`. The Phase 1.A blocker is therefore moot, but the `Open` doc-comment still does not call this out. **Optional follow-up.** |
| `[nit]` `TestSQLQuery_StubsReturnNotImplemented` should assert zero-value | Unchanged. **Defer.** |
| `[question]` `sync_meta.mode` constraint not exercised in tests | Unchanged. **Defer.** |
| `[nit]` `TestRunBulk_RequiresOutputPath` should `ErrorContains` | Unchanged. **Defer.** |
| `[nit]` stub doc-comment phrasing inconsistent across `query.go` stubs | Unchanged. **Defer.** |
| `[nit]` `tags.yaml` `pseudo_legendary` description loose ("BST 600") | Unchanged. **Defer to data-sync.** |

None of these were Phase 1.A blockers in the original review and none were promoted to blockers in the regate.

---

## ADR alignment

### D-22 (single Vercel deploy; Go restricted to sync) — `[praise]`

The Go-side surface that survives is exactly what D-22 says it should be: the sync binary at `apps/api/cmd/pokedex-sync/main.go` (intact), the `pokedex` package, and `pokedex/ingest`. There is no longer any HTTP server code under `apps/api/`:
- `apps/api/cmd/api/` — deleted (verified: `apps/api/cmd/` contains only `pokedex-sync/`).
- `apps/api/internal/health/` — deleted (verified: `apps/api/internal/` contains only `pokedex/`).
- `go.mod` (`apps/api/go.mod:1-31`) no longer imports `chi-router` / `go-playground/validator` / any HTTP middleware. The only deps are `gofrs/flock`, `stretchr/testify`, and `modernc.org/sqlite`. `Grep` for `chi-router|go-chi|go-playground/validator` against `apps/api/` returns zero hits — clean.
- `Makefile` no longer has a `make api` target. The remaining targets (`install`, `web`, `sync`, `typecheck`, `lint`, `test`, `all`, `clean`) match the D-22 deploy posture (TypeScript runtime, Go for sync only).

`[blocker—non-blocking-doc-fix]` `README.md:48` still says `Phase 0 ... API boots, /healthz 200`, and `docs/PLAN.md:63,67,76,81` still describes the chi-router `/healthz` boot. These are stale docs, not code. They do not gate this re-gate, but they should be updated alongside D-22 so a new reader does not look for an HTTP server that no longer exists. Flag for `docs-keeper` (or whoever owns README/PLAN.md hygiene). Not a code blocker.

### D-23 (subjective design tags deferred) — `[praise]`

`apps/api/data/tags.yaml:87-138` carries the descriptive thematic tags (`thematic_humanoid`, `thematic_quadruped`, ..., `thematic_dragon_classic`) and explicitly does *not* introduce `cute`, `cool`, `scary`, `iconic` as YAML keys. The header comment at `tags.yaml:90-93` matches the ADR's framing. Compliant.

### D-1 (form identity) — re-checked

Schema additions strengthen the D-1 contract rather than weaken it. `forms` now carries `UNIQUE (species_id, form_name)` (`schema.sql:86`) and the partial unique index `idx_forms_default_per_species` (`schema.sql:91-92`). `pokemon.form_id UNIQUE` (`schema.sql:102`) is preserved. The new tests `TestForms_RejectsDuplicateNameWithinSpecies` and `TestForms_RejectsMultipleDefaultsPerSpecies` lock these in. Strong.

### D-4, D-6, D-13, D-17, D-18 — re-checked, all still aligned

D-13 is amended by D-22 (`apps/api/` retained as a name; renaming to `apps/sync` deferred) — this is documented in D-22's Status block. D-17's data-model half (URLs as columns on `pokemon`) is preserved (`schema.sql:109-113`). D-18 (zero-cost; pure-Go sqlite) holds — the `gofrs/flock` addition is pure Go and zero-runtime-cost.

---

## New code: the `flock` concurrent-run guard

`apps/api/internal/pokedex/ingest/bulk.go:73-85`:

```go
lockPath := opts.OutputPath + ".lock"
fileLock := flock.New(lockPath)
locked, err := fileLock.TryLockContext(ctx, 250*time.Millisecond)
if err != nil {
    return BulkResult{}, fmt.Errorf("acquire lock at %q: %w", lockPath, err)
}
if !locked {
    return BulkResult{}, fmt.Errorf("another bulk sync is already running (lock held at %q)", lockPath)
}
defer func() {
    _ = fileLock.Unlock()
}()
```

### `[praise]` Cleanup is unconditional

The `defer fileLock.Unlock()` is registered *after* the lock is confirmed acquired and *before* any subsequent error path. It therefore runs on every return path: the temp-DB-open failure, the `sync_meta` insert failure, the `db.Close()` failure, the rename failure, and the success path. I traced each branch (`bulk.go:94-126`) and the lock is released in every one. Good.

### `[praise]` Non-blocking acquire

`TryLockContext(ctx, 250*time.Millisecond)` polls every 250ms, honours context cancellation, and returns `(false, nil)` (not an error) on timeout. The code branches on `!locked` to return a clear "another bulk sync is already running" error rather than blocking indefinitely or leaking a confusing context error. That is the right shape for a CLI: a second invocation gets a comprehensible error and exits non-zero.

### `[question]` Lock-file persistence

`lockPath := opts.OutputPath + ".lock"` lives next to the SQLite output. `flock.Unlock()` releases the OS-level advisory lock but does *not* delete the file — the file `apps/api/data/pokedex.sqlite.lock` persists across runs. That is the conventional behaviour and matches `gofrs/flock`'s docs (deleting the file would race with a concurrent acquirer). Worth a one-line comment in `bulk.go` noting the file persists by design, so a future cleanup PR doesn't try to remove it. Not a blocker.

### `[question]` Path traversal of `os.MkdirAll` happens *before* the lock

`bulk.go:68-70` runs `os.MkdirAll(filepath.Dir(opts.OutputPath), 0o755)` before acquiring the lock. If two concurrent bulk runs target the same output, both will harmlessly run `MkdirAll`, which is idempotent. Then both reach the lock and exactly one wins. This ordering is correct (the lock file's directory must exist before `flock.New` can create the lock file). No change requested.

### `[nit]` Lock-file path collisions in tests

The lock-file lives at `OutputPath + ".lock"`. `bulk_test.go` uses `t.TempDir()` per test, so locks never collide across tests. Good.

### `[nit]` No regression test for the lock itself

The new flock code is *not* directly covered by a test. A two-goroutine test that opens the lock manually, then calls `RunBulk` and asserts the "another bulk sync is already running" error, would lock in the contract. The risk of regression is low (the code is short and idiomatic), but coverage is uneven relative to the schema-constraint tests. Optional, not a blocker.

---

## New tests — `seedSpecies` / `seedBaseRows` helpers

`db_test.go:178-208`. Both helpers are correct:

- `seedSpecies` inserts the `(generations, species)` rows the FK chain demands. Single multi-statement `Exec` is fine in SQLite (multi-statement support is on by default in `modernc.org/sqlite`). The species is `charizard` with id 1, generation 1.
- `seedBaseRows` extends `seedSpecies` with `forms` (default form), `pokemon` (anchored on form 1), the six canonical stats (`hp`, `attack`, `defense`, `special-attack`, `special-defense`, `speed`), and two types (`fire`, `flying`).

### `[praise]` Helper composition

`seedBaseRows` correctly calls `seedSpecies` rather than duplicating the species seed. Helpers carry `t.Helper()`. Errors are surfaced via `require.NoError`. Idiomatic.

### `[praise]` The constraint tests are surgical

Each new test exercises exactly one constraint:

- `TestPokemonTypes_RejectsDuplicateType` — UNIQUE (pokemon_id, type_id) (B2)
- `TestForms_RejectsDuplicateNameWithinSpecies` — UNIQUE (species_id, form_name) (B3)
- `TestForms_RejectsMultipleDefaultsPerSpecies` — partial unique index on is_default = 1 (B3)
- `TestPokemonStats_RejectsOutOfRangeBaseValue` — CHECK base_value 0..255 (R1)
- `TestPokemonStats_RejectsOutOfRangeEffort` — CHECK effort 0..3 (R1)
- `TestPokemonAbilities_RejectsInvalidSlot` — CHECK slot IN (1,2,3) (R2)
- `TestPokemon_GenerationFKEnforced` — pokemon.generation_id FK (B1)

Coverage is exactly what the data-sync review asked for. Each test is independent (fresh `:memory:` DB per test).

### `[nit]` The duplicate-type test could also pin (1, 10, 1) → (1, 10, 1)

`TestPokemonTypes_RejectsDuplicateType` inserts `(1, 10, 1)` then `(1, 10, 2)` and asserts the second is rejected by `UNIQUE (pokemon_id, type_id)`. That's correct, but a parallel insert of `(1, 10, 1)` twice is rejected by the *primary key* `(pokemon_id, slot)`, not by the new `UNIQUE`. The test name says "duplicate type" — the assertion the new constraint adds is exactly the slot-1 vs slot-2 case the test does test. Fine. Optional improvement: a parallel `(1, 10, 1)` followed by `(1, 11, 1)` test to verify *different* types in the same slot are rejected by the PK (which is the pre-existing constraint, but worth pinning).

### `[nit]` `TestPokemonStats_RejectsOutOfRangeBaseValue` doesn't assert SQLITE-specific error class

`require.Error(t, err)` is sufficient for the contract, but `assert.ErrorContains(t, err, "CHECK")` would catch the regression where the constraint is silently dropped (current message: `CHECK constraint failed: pokemon_stats`). Same applies to the other CHECK tests. Not a blocker.

---

## Data-shape changes — re-checked

### `pokemon.generation_id` (B1) — `[praise]`

Added at `schema.sql:105`, indexed at `schema.sql:119`, mirrored on the Go-side `Pokemon.GenerationID int64` (`types.go:12`), FK-tested at `db_test.go:152-165`. Resolves the "silent ambiguity between species.generation_id and forms.introduced_in_generation_id" gap from the data-sync review.

### `int64` widening (R4) — `[praise]`

`Pokemon.ID/SpeciesID/FormID/GenerationID/HeightDecimeters/WeightHectograms/BaseExperience` (`types.go:6-25`) all moved to `int64`. The 1300-row dataset doesn't *need* int64 today, but PokeAPI's resource ids are ints in JSON and Go's `encoding/json` decodes JSON numbers into `int64` natively. Pre-empting that conversion friction at the type level is the right call. `Stats` fields stayed `int` — also fine; base values are 0..255.

### `content_hash` columns (DS-2) — `[praise]`

Added on `species` (`schema.sql:64`), `forms` (`schema.sql:85`), `pokemon` (`schema.sql:114`), `moves` (`schema.sql:194`), `abilities` (`schema.sql:167`). All default to empty string. The Go-side `Pokemon.ContentHash` field (`types.go:23`) reflects the pokemon row's hash. Phase 1.B / 1.F (delta sync) will fill these in. Right shape now.

### Expanded `sync_meta` (DS-3) — `[praise]` / `[nit]`

`schema.sql:25-37` now carries `schema_version`, `binary_version`, `tags_yaml_sha`, `status`, `error_message`. `bulk.go:102-112` writes `schema_version = pokedex.SchemaVersion` and leaves `binary_version` / `tags_yaml_sha` as empty strings (1.B will populate). `status = 'success'` is hardcoded; an `error_message` is null. The status CHECK (`success|failed|partial`) is correct.

`[nit]` `schema_version INTEGER NOT NULL DEFAULT 1` (`schema.sql:32`) hardcodes `1` as the SQL default. The Go side overrides with `pokedex.SchemaVersion`, so the default is never used in practice — but if anyone ever inserts a `sync_meta` row without setting `schema_version`, they'd silently get `1` even after the constant bumps. Either drop the default and require the value (the safer call once 1.B writes the row in real ingestion), or keep the default and add a comment that it exists only as a backstop. Optional; not a blocker.

`[question]` There is no Phase 1.A test that asserts a failed bulk run records `status = 'failed'` with an `error_message`. Today the bulk path doesn't *have* a failed-run code path that survives to write a row — failures `Remove` the tmp DB and return an error. Phase 1.B/1.F will introduce the partial-failure case. Worth a comment in `bulk.go` noting that today's success-only path will need a "rollback to record failure" branch in 1.F.

### `pokemon_moves.learn_method` index (R3) — `[praise]`

`schema.sql:208-209`. Backed by no test (untestable without ingested data) but cheap to add now and the cost in 1.B is one less sync re-run.

---

## Spirit-of-the-change summary

This is a textbook blocker-fix pass: every reviewer concern was matched with either a schema constraint, a test, an explicit deferral via ADR, or removal of dead code. The deletions (`cmd/api`, `internal/health`) are *more* significant than the additions, in that they crystallize D-22's commitment to a single-deploy posture. The flock guard is small and correctly written. The constraint tests catch the "silent constraint drop" regression class without bloating the suite. ADR D-22 and D-23 are well-formed and the code matches them. The remaining open items (lock-test coverage, README/PLAN.md doc drift on `/healthz`, sync_meta `schema_version` SQL default) are appropriately Phase 1.B follow-ups, not 1.A blockers.

**Verdict: Approve with nits**
