# Phase 1.A — test-runner re-gate

**Date:** 2026-04-28
**Scope:** Re-run after the Phase 1.A blocker fix pass. Compares against `test-runner.md`.
**Commands run:**
- `make all` (vet, lint, typecheck, test — Go and TS)
- `make sync`
- `go test -race -v ./...` in `apps/api`
- `go test -race -count=1 ./...` (cache-bypass second run for flake check)
- `go test -coverprofile=… ./...` + `go tool cover -func`

## 1. Top-line results

| Suite | Tests | Passed | Failed | Skipped | Notes |
|---|---|---|---|---|---|
| Go (`apps/api`, `-race -v`) | **17** (15 top-level; `TestStats_BST` has 3 subtests) | 17 | 0 | 0 | pokedex 3.02s, ingest 2.12s; total 18.4s wall |
| Go (`-race -count=1`, second pass) | 17 | 17 | 0 | 0 | pokedex 2.57s, ingest 2.43s — no flakes |
| TS (`apps/web`, vitest) | 1 | 1 | 0 | 0 | 472 ms |
| `make all` (combined) | — | green | — | — | end-to-end clean |
| `make sync` | n/a (CLI) | OK | — | — | `bulk sync complete: data/pokedex.sqlite (commit=scaffold, 25.52ms)` |

Go coverage (statement-level, no `-race`):

| Package | Coverage | Δ vs. previous |
|---|---|---|
| `internal/pokedex` | 71.4% | unchanged |
| `internal/pokedex/ingest` | 64.7% | **+4.7 pp** (60.0 → 64.7) |
| `cmd/pokedex-sync` | 0.0% | unchanged |
| **Total** | **45.7%** | **+11.2 pp** (34.5 → 45.7) |

The total jumped because `internal/health` (100% coverage of one tiny package) was deleted and now no longer drags the denominator with a fully-covered low-statement package; meanwhile the ingest package gained statements (the flock guard) of which a meaningful share is exercised.

Per-function:

| Function | Coverage | Δ |
|---|---|---|
| `pokedex.Open` | 61.1% | unchanged |
| `pokedex.recordSchemaVersion` | 80.0% | unchanged |
| `pokedex.NewSQLQuery` / `GetByID` / `GetBySlug` / `List` | 100% | unchanged |
| `pokedex.Stats.BST` | 100% | unchanged |
| `ingest.RunBulk` | **64.5%** | +5.4 pp (59.1 → 64.5) — flock-acquire path now covered |
| `ingest.commitSHAOrPlaceholder` | 66.7% | unchanged |

## 2. Per-package test breakdown

### `internal/pokedex` (12 tests; `TestStats_BST` has 3 subtests; all passed)

Pre-existing tests (still present, still green):
- `TestOpen_CreatesAllExpectedTables` — PASS (0.08s)
- `TestOpen_RecordsSchemaVersion` — PASS (0.08s)
- `TestOpen_IsIdempotentOnReopen` — PASS (0.13s)
- `TestOpen_EnforcesForeignKeys` — PASS (0.10s)
- `TestSQLQuery_StubsReturnNotImplemented` — PASS (0.07s)
- `TestStats_BST` (`all_zeros`, `balanced_100s`, `Garchomp`) — PASS (0.00s)

**New constraint tests added in the blocker fix pass — all passed:**
- `TestPokemonTypes_RejectsDuplicateType` — PASS (0.08s). Inserts `(pokemon_id=1, type_id=10, slot=1)` (Fire), then `(pokemon_id=1, type_id=10, slot=2)` (Fire again). Expects the second insert to fail. **Exercises the `UNIQUE (pokemon_id, type_id)` declared on `pokemon_types`** at `schema.sql:135`. The first insert is asserted with `require.NoError`, so the test would also catch a regression where the seed schema rejects a legitimate first slot. Real test, not a placeholder.
- `TestForms_RejectsDuplicateNameWithinSpecies` — PASS (0.08s). Inserts two `forms` rows with the same `(species_id=1, form_name='')`. Expects the second to fail. **Exercises `UNIQUE (species_id, form_name)`** at `schema.sql:86`. The two rows have distinct `id` and `slug`, so the only constraint that can fire is the composite UNIQUE — which is the constraint the test claims to test. Real test.
- `TestForms_RejectsMultipleDefaultsPerSpecies` — PASS (0.11s). Inserts a default form (`is_default=1`) with `form_name=''`, then a *second* default (`is_default=1`) for the same species but with `form_name='mega-x'`. Expects the second to fail. The composite UNIQUE on `(species_id, form_name)` would *not* fire here because `form_name` differs — so the only thing that can reject this is **the partial unique index `idx_forms_default_per_species ON forms (species_id) WHERE is_default = 1`** (`schema.sql:91-92`). Real test, and it's the only constraint test that genuinely distinguishes the partial index from the composite UNIQUE; well-designed.
- `TestPokemonStats_RejectsOutOfRangeBaseValue` — PASS (0.10s). Tries `base_value = 256` (above max) and `base_value = -1` (below min). Both must fail. **Exercises `CHECK (base_value BETWEEN 0 AND 255)`** at `schema.sql:151`. Real test; both boundaries asserted.
- `TestPokemonStats_RejectsOutOfRangeEffort` — PASS (0.07s). Tries `effort = 4`. Must fail. **Exercises `CHECK (effort BETWEEN 0 AND 3)`** at `schema.sql:152`. Real test. Mild gap: only the upper boundary is asserted; `-1` is not exercised. Non-blocking.
- `TestPokemonAbilities_RejectsInvalidSlot` — PASS (0.07s). Tries `slot = 4`. Must fail. **Exercises `CHECK (slot IN (1, 2, 3))`** at `schema.sql:174`. Real test. Same minor gap as above: only one out-of-range value (4) is checked; `0` and `99` would also be useful, but the CHECK is an enumerated set so a single negative case is defensible.
- `TestPokemon_GenerationFKEnforced` — PASS (0.07s). Inserts a `pokemon` row pointing at `generation_id = 999` (non-existent). Must fail. **Exercises the `pokemon.generation_id REFERENCES generations(id)` FK** at `schema.sql:105`. Distinct from the pre-existing `TestOpen_EnforcesForeignKeys`, which tests `species.generation_id` — this one closes the gap on the redundant `pokemon.generation_id` FK that the schema-guardian's B1 finding was about. Real test.

All six new constraint tests use `require.NoError` for the seed insert and `require.Error` for the violation, so a regression in either direction (constraint accidentally dropped, *or* the schema starts rejecting legitimate rows) would surface immediately. Helpers `seedSpecies` / `seedBaseRows` populate the FK-required parent rows in advance, isolating each test to the constraint under examination. None of the new tests are placeholders, none are tautologies, none assert the absence of behavior. Verdict on the new tests: **substantive**.

### `internal/pokedex/ingest` (4 tests, all passed — count unchanged)
- `TestRunBulk_CreatesDatabaseAndRecordsRun` — PASS (0.11s)
- `TestRunBulk_RequiresOutputPath` — PASS (0.00s)
- `TestRunBulk_OverwritesExistingDatabase` — PASS (0.20s)
- `TestRunBulk_CleansUpStaleTempFile` — PASS (0.10s)

The bulk pipeline now acquires an exclusive flock on `<output>.lock` before any file operation (`bulk.go:73-85` — `flock.New(...).TryLockContext(ctx, 250ms)`). All four pre-existing tests **still pass with the new lock in place**:
- Each test uses `t.TempDir()` so the lock file path is per-test and per-run; there is no cross-test contention.
- The `TryLockContext(250ms)` call is short-lived and does not introduce noticeable wall-time overhead (per-test durations are unchanged from the previous review).
- The tests do not exercise contention (two concurrent `RunBulk` calls fighting for the same lock). That gap is noted in §4.S-5 below as a coverage observation, not a blocker — the lock acquire/release happy path is exercised by every passing run.

### `cmd/pokedex-sync`
No test files — `go test` reports `[no test files]`.

### TS (`apps/web`)
- `__tests__/sanity.test.ts > sanity > runs the test suite` — PASS (2 ms). Unchanged from previous review; still a placeholder. See §4.S-1.

## 3. Verifying the deletes landed

- **`apps/api/cmd/api/`** — directory does not exist. `ls apps/api/cmd/` returns only `pokedex-sync`. The `cmd/api` package no longer appears in `go test ./...` output (previously: `?  …/cmd/api  [no test files]`). Confirmed deleted.
- **`apps/api/internal/health/`** — directory does not exist. `ls apps/api/internal/` returns only `pokedex`. `TestHandler_ReturnsOK` no longer appears in `-v` output. Confirmed deleted.

Both deletes match the brief.

## 4. Suspicious tests — diff against previous review

### S-1 (Major, carried forward) — TS sanity placeholder
File: `apps/web/__tests__/sanity.test.ts`. Unchanged. Still asserts `1 + 1 === 2`; still the only TS test; vitest still runs with `--passWithNoTests`. Phase 1.A did not modify `apps/web`, so this is not a 1.A regression. Track for Phase 4.

### S-2 (Minor, carried forward) — `TestSQLQuery_StubsReturnNotImplemented` is a tripwire
File: `apps/api/internal/pokedex/query_test.go`. Unchanged. Documented as intentional in the previous review.

### S-3 (Nit, carried forward) — `TestRunBulk_CreatesDatabaseAndRecordsRun` couples to `"scaffold"`
File: `apps/api/internal/pokedex/ingest/bulk_test.go:25, 40`. Unchanged. Will be replaced in Phase 1.B when `commitSHAOrPlaceholder` becomes a real `git rev-parse`.

### S-4 (Nit, carried forward) — `TestStats_BST` has two cases summing to 600
Unchanged. Already explained as adequately mitigated by the asymmetric `Garchomp` case.

### S-5 (NEW, Minor) — flock contention is not directly tested
File: `apps/api/internal/pokedex/ingest/bulk.go:73-85` introduces `flock.New(...).TryLockContext(ctx, 250*time.Millisecond)` and the "another bulk sync is already running" error path. None of the four ingest tests start two `RunBulk` goroutines against the same `OutputPath`, so the contention path (`!locked` returning the formatted-error) is uncovered. The acquire/defer-unlock happy path is covered by every passing test (the `RunBulk_CreatesDatabaseAndRecordsRun` etc. all reach `os.Rename` successfully, which can only happen after `Unlock`).

A focused test would be cheap: `t.TempDir()` for `out`, manually call `flock.New(out + ".lock").Lock()` to hold the lock, then call `RunBulk` and assert the returned error matches `another bulk sync is already running`. Would lift `RunBulk` coverage by another ~3 pp. **Non-blocking** for Phase 1.A — the lock is exercised on every run and the error string is grep-able — but recommended to add before Phase 1.B starts hooking real ingest steps in, because once `RunBulk` does real work the cost of two concurrent runs corrupting state grows quickly.

### S-6 (NEW, Nit) — `TestPokemonStats_RejectsOutOfRangeEffort` and `TestPokemonAbilities_RejectsInvalidSlot` only test one boundary each
Both new tests assert one violating value. The CHECK constraints they target are bidirectional (`BETWEEN 0 AND 3`) or set-membership (`IN (1, 2, 3)`); a regression that, say, changed `BETWEEN 0 AND 3` to `<= 3` would not be caught by `TestPokemonStats_RejectsOutOfRangeEffort` because it does not assert `effort = -1` is rejected. Trivial to extend; non-blocking.

No tests were named after one thing while testing another. No tests with empty assertion bodies. No tests using `t.Skip`. No tests that mutated shared state across runs. The new constraint tests use only `t.TempDir()`-ed in-memory DBs (`:memory:`) so cross-test isolation is by construction.

## 5. Flakes

None observed across two consecutive runs (one `-race -v`, one `-race -count=1` to defeat the test cache). Per-test wall-times are stable: pokedex 3.02s vs 2.57s (within noise — the first run includes compile and the `-v` overhead), ingest 2.12s vs 2.43s (within noise). Race detector clean both runs.

## 6. Regression check vs. previous review

| Test | Previous | Now | Notes |
|---|---|---|---|
| `TestHandler_ReturnsOK` (health) | PASS | **GONE** | Confirmed delete per brief |
| `TestOpen_CreatesAllExpectedTables` | PASS (0.08s) | PASS (0.08s) | Still asserts the full table list; the table list now reflects `sync_meta` audit columns and the partial unique index but the *table count* (19) is unchanged |
| `TestOpen_RecordsSchemaVersion` | PASS | PASS | — |
| `TestOpen_IsIdempotentOnReopen` | PASS (0.16s) | PASS (0.13s) | — |
| `TestOpen_EnforcesForeignKeys` | PASS (0.07s) | PASS (0.10s) | — |
| `TestSQLQuery_StubsReturnNotImplemented` | PASS | PASS | — |
| `TestStats_BST` (3 subtests) | PASS | PASS | — |
| `TestPokemonTypes_RejectsDuplicateType` | n/a | PASS (0.08s) | NEW |
| `TestForms_RejectsDuplicateNameWithinSpecies` | n/a | PASS (0.08s) | NEW |
| `TestForms_RejectsMultipleDefaultsPerSpecies` | n/a | PASS (0.11s) | NEW |
| `TestPokemonStats_RejectsOutOfRangeBaseValue` | n/a | PASS (0.10s) | NEW |
| `TestPokemonStats_RejectsOutOfRangeEffort` | n/a | PASS (0.07s) | NEW |
| `TestPokemonAbilities_RejectsInvalidSlot` | n/a | PASS (0.07s) | NEW |
| `TestPokemon_GenerationFKEnforced` | n/a | PASS (0.07s) | NEW |
| `TestRunBulk_CreatesDatabaseAndRecordsRun` | PASS (0.12s) | PASS (0.11s) | flock added — still green |
| `TestRunBulk_RequiresOutputPath` | PASS (0.00s) | PASS (0.00s) | early-return path; flock not reached |
| `TestRunBulk_OverwritesExistingDatabase` | PASS (0.23s) | PASS (0.20s) | second `RunBulk` re-acquires lock fine after first defer-unlocks |
| `TestRunBulk_CleansUpStaleTempFile` | PASS (0.10s) | PASS (0.10s) | — |
| TS sanity | PASS | PASS | — |

**No regressions. No newly-flaky tests.** Net delta: +6 Go tests (all substantive), -1 Go test (deleted package), +0 TS tests. Total Go: 12 → 17 as briefed.

## 7. Process notes

- `make all` ordering: go vet → typecheck → golangci-lint → eslint → go test → vitest. Green end-to-end. Dependency-graph mismatch flagged in the previous review (vet runs before lint, lint runs before test) is unchanged; not a test-runner concern.
- `make sync` produced `apps/api/data/pokedex.sqlite` in 25.52 ms (down from 35.5 ms previously — within noise, the schema is similar size).
- The flock library `github.com/gofrs/flock` is now a dependency. Not a test-runner concern, but it does introduce a new platform abstraction — the linter and `go vet` did not complain.
- Vitest still runs with `--passWithNoTests`. Carried forward as a tracked nit.

## 8. Verdict

The blocker fix pass landed cleanly. The 17-test Go suite is race-clean across two consecutive runs, the six new constraint tests each genuinely exercise the constraint they claim to test (no placeholders, no tautologies, no fake-positive risks), the flock-based concurrency guard does not perturb any pre-existing ingest test, and the deletes of `cmd/api` and `internal/health` are confirmed both at the filesystem level and in the test output. Coverage is up materially (34.5 → 45.7 total; ingest 60.0 → 64.7). The two new minor callouts (S-5: flock contention not directly tested; S-6: each CHECK test asserts only one boundary) are explicitly transparency notes, not blockers.

**Verdict: Approve**
