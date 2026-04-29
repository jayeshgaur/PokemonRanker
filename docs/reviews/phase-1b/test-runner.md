# Phase 1.B — test-runner gate (1.B.1 → 1.B.4 batched)

**Date:** 2026-04-28
**Scope:** Single Phase 1.B gate covering 1.B.1 (schema), 1.B.2 (constants + core graph), 1.B.3 (joins + evolutions + flavor_text), 1.B.4 (query API + validation + final gate). Compares against `docs/reviews/phase-1b1/test-runner.md` and `docs/reviews/phase-1a/test-runner-regate.md`.

**Commands run:**
- `make all` (vet, lint, typecheck, test — Go and TS) — twice, second pass for cache/flake check
- `rm -f apps/api/data/pokedex.sqlite{,.lock} && make sync && make sync-inspect` — scaffold-mode end-to-end
- `cd apps/api && go test -race -v ./...` — verbose race-detector run
- `cd apps/api && go test -cover ./...` — package-level coverage
- `cd apps/api && go test -coverprofile=… ./... && go tool cover -func=…` — per-function coverage
- `cd apps/api && go test -race -count=2 ./...` — cache-bypass second pass for flake detection

## 1. Top-line results

| Suite | Tests | Passed | Failed | Skipped | Notes |
|---|---|---|---|---|---|
| Go (`apps/api`, `-race -v`) | **34** top-level (+ 3 `TestStats_BST` subtests = 37 total assertions) | 37 | 0 | 0 | pokedex 4.365s, ingest 4.831s |
| Go (`-race -count=2`, second pass) | 34 × 2 = 68 top-level executions | 68 | 0 | 0 | pokedex 8.555s, ingest 10.777s |
| TS (`apps/web`, vitest) | 1 | 1 | 0 | 0 | 3–6 ms |
| `make all` (combined, run 1) | — | green | — | — | clean (vet, lint, typecheck, eslint, go test, vitest) |
| `make all` (combined, run 2) | — | green | — | — | Go tests fully cached; TS test ran in 6 ms; no flake observed |
| `make sync` (scaffold) | n/a (CLI) | OK | — | — | `bulk sync complete: data/pokedex.sqlite (commit=scaffold, 40.305458ms)` |
| `make sync-inspect` | n/a (CLI) | OK | — | — | All four sections rendered (Row counts, Latest sync_meta, Sample pokemon, api-data SHA pin) |

### Go coverage (statement-level, no `-race`)

| Package | Coverage | Δ vs. 1.B.1 gate | Δ vs. 1.A re-gate |
|---|---|---|---|
| `internal/pokedex` | **55.0%** | (1.B.1 not measured separately on this package; comparable to 71.4% in 1.A but `validate.go` and `query.go` expansions added many uncovered statements — see §4) | -16.4 pp |
| `internal/pokedex/ingest` | **72.3%** | comparable / held (1.B.1 was 73.3% on much smaller code; this gate is 72.3% on roughly 4× the statements — effectively held) | +7.6 pp |
| `cmd/pokedex-sync` | 0.0% | unchanged | unchanged |
| **Total** | **62.0%** | **+10.5 pp** (51.5 → 62.0) | **+16.3 pp** (45.7 → 62.0) |

The total jumped because the ingest package — now the bulk of the LOC — is comprehensively tested (12 of 13 ingester `Ingest` methods exercised, `RunBulk` at 60.3%, `walkEvolutionChain` at 82.8%). The `internal/pokedex` package coverage dropped relative to 1.A because Phase 1.B added `validate.go` (`Validate` + `countBySpeciesSlug`, both 0.0%) which is the new 1.B.4 validation module not yet exercised by tests, and added `query.go` decoration helpers (`fetchTypes` 83.3%, `fetchStats` 89.5%, `fetchTags` 83.3%) which *are* covered. See §4-S-7.

### Per-function highlights

| Function | Coverage | Notes |
|---|---|---|
| `pokedex.Open` | 61.1% | unchanged from 1.A |
| `pokedex.NewSQLQuery` / `GetByID` / `GetBySlug` | 100% | NEW, all covered |
| `pokedex.List` | 76.5% | NEW, covered |
| `pokedex.scanPokemonBase` | 100% | NEW, covered |
| `pokedex.Stats.BST` | 100% | unchanged |
| `pokedex.Validate` | **0.0%** | NEW, **uncovered** — see S-7 |
| `pokedex.countBySpeciesSlug` | **0.0%** | NEW, **uncovered** — see S-7 |
| `ingest.RunBulk` | 60.3% | -5.4 pp vs. 1.B.1 (64.5%) — new fail-paths added (`FailsHardWhenAPIDataPathIsNotAGitRepo` covers one, but the in-tx ingester failure rollback is only partially exercised) |
| `ingest.resolveCommitSHA` | 100% | renamed from `commitSHAOrPlaceholder`, now 100% |
| `ingest.shouldWritePin` | 100% | unchanged |
| All 13 ingester `Ingest` methods | 69.6% – 82.4% | NEW, all in the 70–80% band |
| All `Name()` methods on ingesters | 0.0% | NEW, never invoked from tests — trivial constant returns; not a real gap |

## 2. Per-package test breakdown

### `internal/pokedex` (16 top-level tests + 3 `TestStats_BST` subtests; all passed)

Carried from 1.B.1 (all still green):
- `TestOpen_CreatesAllExpectedTables` — PASS (0.12s)
- `TestOpen_RecordsSchemaVersion` — PASS (0.12s)
- `TestOpen_IsIdempotentOnReopen` — PASS (0.20s)
- `TestOpen_EnforcesForeignKeys` — PASS (0.09s)
- `TestPokemonTypes_RejectsDuplicateType` — PASS (0.10s)
- `TestForms_RejectsDuplicateNameWithinSpecies` — PASS (0.10s)
- `TestForms_RejectsMultipleDefaultsPerSpecies` — PASS (0.10s)
- `TestPokemonStats_RejectsOutOfRangeBaseValue` — PASS (0.10s)
- `TestPokemonStats_RejectsOutOfRangeEffort` — PASS (0.10s)
- `TestPokemonAbilities_RejectsInvalidSlot` — PASS (0.09s)
- `TestPokemon_GenerationFKEnforced` — PASS (0.09s)
- `TestSpecies_EvolvesFromSelfFKEnforced` — PASS (0.10s)
- `TestStats_BST` (`all_zeros`, `balanced_100s`, `Garchomp`) — PASS (0.00s)

**New in 1.B.4 — query API tests:**
- `TestSQLQuery_GetByID` — PASS (0.12s). Real test: seeds a full `pokemon` row + types + stats + tags via the schema, calls `GetByID(1)`, asserts the returned struct matches across all decorated fields. Replaces the 1.B.1 `TestSQLQuery_StubsReturnNotImplemented` tripwire (S-2 in 1.A — finally retired).
- `TestSQLQuery_GetByID_NotFound` — PASS (0.09s). Asserts the not-found path returns `(nil, nil)` (or sentinel error per impl) without panicking. Real test.
- `TestSQLQuery_GetBySlug` — PASS (0.13s). Mirror of `GetByID` but keyed by slug. Real test, exercises the slug index path.
- `TestSQLQuery_List` — PASS (0.12s). Seeds multiple species/pokemon, calls `List`, asserts the result is sorted/non-empty and decoration runs. Real test.

The 1.B.1-era `TestSQLQuery_StubsReturnNotImplemented` is **gone** (replaced by the four real tests above). This was flagged as S-2 (tripwire) in the Phase 1.A re-gate — its retirement is the right outcome.

### `internal/pokedex/ingest` (18 tests, all passed)

Carried from 1.B.1 (all still green; one renamed):
- `TestRunBulk_CreatesDatabaseAndRecordsRun` — PASS (0.19s)
- `TestRunBulk_RequiresOutputPath` — PASS (0.00s)
- `TestRunBulk_OverwritesExistingDatabase` — PASS (0.36s)
- `TestRunBulk_CleansUpStaleTempFile` — PASS (0.17s)
- `TestRunBulk_FailsHardWhenAPIDataPathIsNotAGitRepo` — PASS (0.10s). **Renamed and tightened** from 1.B.1's `TestRunBulk_HandlesNonGitAPIDataPath`. The previous version asserted `commit=unknown` was tolerated; this version asserts a hard failure. This matches the policy decision in 1.B.4 that a non-git `--api-data` is a configuration error, not a fallback. Real test.
- `TestRunBulk_PicksUpRealCommitSHAAndWritesPinFile` — PASS (0.98s — wall time, **not a skip**). Confirms the git-fixture test ran end-to-end (initialises a real repo, makes a commit, asserts the captured SHA matches `git rev-parse HEAD` and the pin file is written). Wall time of 980 ms is consistent with five `git` subprocess calls — incompatible with a skip. **Confirmed: did not skip** in this environment, as required by the gate brief.

**New in 1.B.2/1.B.3/1.B.4 — 12 ingester tests, all passed:**
- `TestGenerationIngester_Ingest` — PASS (0.09s). Constants ingester. Reads `generations/index.json` via the per-test `apiData` fixture, asserts the inserted row count and one spot-check name. Real test.
- `TestTypeIngester_Ingest` — PASS (0.10s). Constants ingester. Same pattern.
- `TestStatIngester_Ingest` — PASS (0.10s). Constants ingester.
- `TestAbilityIngester_Ingest` — PASS (0.10s). Constants ingester (descriptions + names).
- `TestSpeciesIngester_Ingest` — PASS (0.10s). Core graph: seeds `species/{id}/index.json` files in the fixture, runs the ingester, asserts species rows + generation FK + `evolves_from_species_id=NULL` for top-of-chain.
- `TestFormIngester_Ingest` — PASS (0.09s). Forms join: covers `lookupSpeciesIDViaPokemon` (75% covered).
- `TestPokemonIngester_Ingest` — PASS (0.11s). Core pokemon row insertion.
- `TestPokemonJoinsIngester_Ingest` — PASS (0.11s). Joins: types, stats, abilities, moves all written off one fixture pokemon — tests the cross-table fan-out.
- `TestEvolutionIngester_Ingest` — PASS (0.12s). Walks an evolution-chain tree (`walkEvolutionChain` 82.8% covered, depth ≥ 2 confirmed by the coverage shape).
- `TestFlavorTextIngester_Ingest` — PASS (0.10s). English-only filter exercised.
- `TestEvolvesFromBackfillIngester_Ingest` — PASS (0.10s). The 1.B.3 backfill pass that fills in `species.evolves_from_species_id` after the species ingester has run.
- `TestMoveIngester_Ingest` — PASS (0.10s). Constants ingester, covers `move.go:78.9%`.

All 12 new ingester tests follow the same pattern (per-test `t.TempDir()` fixture + per-test in-memory or file SQLite + assertion against row counts + spot-check on at least one decorated field). None are placeholders, none are tautologies, none use `t.Skip`.

### `cmd/pokedex-sync`
No test files — `go test` reports `[no test files]`. Coverage 0.0%. Unchanged. This is the CLI shim; behaviour-equivalent code is exercised through `RunBulk` tests.

### TS (`apps/web`)
- `__tests__/sanity.test.ts > sanity > runs the test suite` — PASS (3–6 ms across two runs). **Unchanged at 1 placeholder test as expected per the brief** (Phase 4 will replace).

## 3. `make sync-inspect` section verification

Following `rm -f apps/api/data/pokedex.sqlite{,.lock} && make sync`:

| Section | Rendered? | Content |
|---|---|---|
| `=== Row counts ===` | yes | All 19 tables listed; `schema_version=1`, `sync_meta=1`, all data tables `=0` (scaffold mode) |
| `=== Latest sync_meta ===` | yes | `id=1, ran_at=2026-04-29T02:18:19Z, mode=bulk, api_data_commit_sha=scaffold, duration_ms=38, status=success` |
| `=== Sample pokemon (first 5) ===` | yes | empty (scaffold mode — expected) |
| `=== api-data SHA pin ===` | yes | `(not pinned — sync hasn't seen a real api-data checkout yet)` (expected — scaffold mode does not write the pin file) |

Scaffold-mode end-to-end is clean. The `commit=scaffold` token in the CLI output and `api_data_commit_sha=scaffold` in `sync_meta` are consistent — the resolver returns `"scaffold"` when no `--api-data` flag is passed (vs. a real SHA when it is, vs. a hard error when the path exists but is non-git).

## 4. Suspicious tests — diff against previous review

### S-1 (Major, carried from 1.A) — TS sanity placeholder
File: `apps/web/__tests__/sanity.test.ts`. Unchanged. Still asserts `1 + 1 === 2`; still the only TS test; vitest still runs with `--passWithNoTests`. Phase 1.B did not modify `apps/web` (intended — Phase 4 covers the web suite). Track for Phase 4.

### S-2 (Minor, carried from 1.A) — `TestSQLQuery_StubsReturnNotImplemented` tripwire
**Resolved.** The tripwire is gone, replaced by four real query tests (`TestSQLQuery_GetByID`, `TestSQLQuery_GetByID_NotFound`, `TestSQLQuery_GetBySlug`, `TestSQLQuery_List`). All four assert real return values, not just the absence of an error.

### S-3 (Nit, carried from 1.A/1.B.1) — `TestRunBulk_CreatesDatabaseAndRecordsRun` couples to `"scaffold"`
File: `apps/api/internal/pokedex/ingest/bulk_test.go`. Still couples to `"scaffold"` literal. Now redeemed: `TestRunBulk_PicksUpRealCommitSHAAndWritesPinFile` exercises the real-SHA branch and `TestRunBulk_FailsHardWhenAPIDataPathIsNotAGitRepo` exercises the hard-error branch. The literal `"scaffold"` coupling in `CreatesDatabaseAndRecordsRun` is documenting the no-`--api-data` path, which is the same path `make sync` (no flags) hits — it is a real product behaviour. Carried as a nit, no longer a concern.

### S-4 (Nit, carried) — `TestStats_BST` has two cases summing to 600
Unchanged. `Garchomp` (asymmetric) keeps it real.

### S-5 (Minor, carried from 1.A/1.B.1) — flock contention not directly tested
Unchanged. The four `RunBulk` tests still don't start two concurrent goroutines on the same `OutputPath`. The acquire-then-release happy path is exercised on every passing run; the contention error string is not. Cheap to add (per the previous review's sketch); still non-blocking for 1.B; recommended for Phase 1.C if/when ingest steps grow further.

### S-6 (Nit, carried) — boundary CHECK tests assert one side
Unchanged from 1.B.1. Carried.

### S-7 (NEW, **Major**) — `pokedex.Validate` and `countBySpeciesSlug` are untested (0.0% coverage)
File: `apps/api/internal/pokedex/validate.go`. The Phase 1.B.4 brief includes "validation" as a deliverable, and the file exists with two functions (`Validate` at line 24, `countBySpeciesSlug` at line 144), but neither is exercised by any test in this gate run. Coverage on `validate.go` is 0.0%. The `make sync-inspect` flow does not call `Validate` either (only `make sync-validate` does, and that target was not run by this gate brief).

This is a **real coverage gap on a load-bearing function** (the post-sync validation suite is the safety net for the bulk ingest; if it silently no-ops, regressions in ingest behaviour will not be caught by `make sync-validate` in CI).

**Recommendation:** Add a test that seeds a known-bad SQLite (e.g., a species with no default form, or a pokemon with no types) and asserts `Validate` returns the matching error. At least one happy-path test (seed a valid mini-DB, assert `Validate` returns nil). Without this, `Validate` itself is a tripwire — it can ship broken and nobody will notice until the first real `make sync-from-clone` run.

I am flagging this as **Major** because the Phase 1.B brief includes validation in scope, and the 1.B.4 task is currently in-progress per task tracking. Upgrade or downgrade is at the gate-aggregator's discretion — but the report would be misleading if I marked it as a nit.

### S-8 (NEW, Nit) — `Name()` methods on all 13 ingesters are uncovered (0.0%)
Each ingester has a one-line `Name() string { return "..." }` method that is never invoked from any test (the test calls `Ingest` directly without going through the dispatch loop in `RunBulk`'s default ingester slice). This drags the per-package coverage down by a small amount but is not a real gap — these are constant returns that cannot regress meaningfully. Mention for transparency only.

### S-9 (NEW, Nit) — `cmd/pokedex-sync/main.go` is still 0.0% covered
File: `apps/api/cmd/pokedex-sync/main.go`. The CLI shim grew from one subcommand (`bulk`) to two (`bulk`, `validate`) in 1.B.4. The new `runValidate` (line 71) and the existing `runBulk` (line 101) and `main` (line 36) are all 0.0% covered. The `RunBulk` path is covered through `internal/pokedex/ingest`'s tests, but `runValidate` has no analogue in `internal/pokedex` either (since `Validate` itself is also untested per S-7). This is double-uncovered.

Cheap mitigation: an integration test that runs `go run ./cmd/pokedex-sync validate --db <fixture>` against a known-good SQLite and a known-bad one. Non-blocking but recommended alongside the S-7 fix.

No tests were named after one thing while testing another. No tests with empty assertion bodies. No tests using `t.Skip`. No tests that mutated shared state across runs. The new ingester tests use per-test `t.TempDir()` fixtures so cross-test isolation is by construction.

## 5. Flakes

**None observed across two consecutive `make all` runs and two consecutive `go test -race -count=2 ./...` passes** (effectively four runs of the Go suite, one of the TS suite × 2). Per-package wall-times are stable:

- `internal/pokedex`: 4.365s (`-race -v` first pass) → 0.937s (no `-race`, with coverage) → 8.555s (`-race -count=2` — ≈ 2× single-pass, expected)
- `internal/pokedex/ingest`: 4.831s (`-race -v` first pass) → 2.069s (no `-race`, with coverage) → 10.777s (`-race -count=2` — ≈ 2× single-pass, expected)

Race detector clean across all runs. The git-fixture test (which makes real subprocess calls to `git`) ran twice in `-count=2` cleanly — wall times within tolerance of each other and within tolerance of the single-pass run. No timing variance suggests a hidden race or fixture leak.

The second `make all` run reported `(cached)` on both Go packages — Go's test cache correctly held across the two invocations, no source-file timestamps changed between them. This is the expected and desired behaviour; not a flake.

## 6. Regression check vs. previous gates

| Test | 1.A re-gate | 1.B.1 gate | 1.B (this gate) | Notes |
|---|---|---|---|---|
| `TestOpen_CreatesAllExpectedTables` | PASS (0.08s) | PASS (0.12s) | PASS (0.12s) | table list grew with each phase; test still asserts the expected list |
| `TestOpen_RecordsSchemaVersion` | PASS | PASS | PASS | — |
| `TestOpen_IsIdempotentOnReopen` | PASS | PASS | PASS (0.20s) | — |
| `TestOpen_EnforcesForeignKeys` | PASS | PASS | PASS | — |
| `TestPokemonTypes_RejectsDuplicateType` | PASS | PASS | PASS | — |
| `TestForms_RejectsDuplicateNameWithinSpecies` | PASS | PASS | PASS | — |
| `TestForms_RejectsMultipleDefaultsPerSpecies` | PASS | PASS | PASS | — |
| `TestPokemonStats_RejectsOutOfRangeBaseValue` | PASS | PASS | PASS | — |
| `TestPokemonStats_RejectsOutOfRangeEffort` | PASS | PASS | PASS | — |
| `TestPokemonAbilities_RejectsInvalidSlot` | PASS | PASS | PASS | — |
| `TestPokemon_GenerationFKEnforced` | PASS | PASS | PASS | — |
| `TestSpecies_EvolvesFromSelfFKEnforced` | n/a | PASS | PASS | — |
| `TestSQLQuery_StubsReturnNotImplemented` | PASS | PASS | **GONE** | replaced by 4 real query tests |
| `TestSQLQuery_GetByID` | n/a | n/a | PASS | NEW (1.B.4) |
| `TestSQLQuery_GetByID_NotFound` | n/a | n/a | PASS | NEW (1.B.4) |
| `TestSQLQuery_GetBySlug` | n/a | n/a | PASS | NEW (1.B.4) |
| `TestSQLQuery_List` | n/a | n/a | PASS | NEW (1.B.4) |
| `TestStats_BST` (3 subtests) | PASS | PASS | PASS | — |
| `TestRunBulk_CreatesDatabaseAndRecordsRun` | PASS | PASS | PASS (0.19s) | — |
| `TestRunBulk_RequiresOutputPath` | PASS | PASS | PASS (0.00s) | — |
| `TestRunBulk_OverwritesExistingDatabase` | PASS | PASS | PASS (0.36s) | — |
| `TestRunBulk_CleansUpStaleTempFile` | PASS | PASS | PASS (0.17s) | — |
| `TestRunBulk_HandlesNonGitAPIDataPath` | n/a | PASS | **renamed → `…FailsHardWhenAPIDataPathIsNotAGitRepo`** | semantics tightened: was tolerant (commit=unknown), now hard-fails. Intentional per 1.B.4. |
| `TestRunBulk_FailsHardWhenAPIDataPathIsNotAGitRepo` | n/a | n/a | PASS (0.10s) | renamed/tightened |
| `TestRunBulk_PicksUpRealCommitSHAAndWritesPinFile` | n/a | PASS | PASS (0.98s) | git available, did not skip |
| `TestGenerationIngester_Ingest` | n/a | n/a | PASS | NEW (1.B.2) |
| `TestTypeIngester_Ingest` | n/a | n/a | PASS | NEW (1.B.2) |
| `TestStatIngester_Ingest` | n/a | n/a | PASS | NEW (1.B.2) |
| `TestAbilityIngester_Ingest` | n/a | n/a | PASS | NEW (1.B.2) |
| `TestSpeciesIngester_Ingest` | n/a | n/a | PASS | NEW (1.B.2) |
| `TestFormIngester_Ingest` | n/a | n/a | PASS | NEW (1.B.2) |
| `TestPokemonIngester_Ingest` | n/a | n/a | PASS | NEW (1.B.2) |
| `TestPokemonJoinsIngester_Ingest` | n/a | n/a | PASS | NEW (1.B.3) |
| `TestEvolutionIngester_Ingest` | n/a | n/a | PASS | NEW (1.B.3) |
| `TestFlavorTextIngester_Ingest` | n/a | n/a | PASS | NEW (1.B.3) |
| `TestEvolvesFromBackfillIngester_Ingest` | n/a | n/a | PASS | NEW (1.B.3) |
| `TestMoveIngester_Ingest` | n/a | n/a | PASS | NEW (1.B.3) |
| TS sanity | PASS | PASS | PASS | — |

**No regressions.** Net delta vs. 1.B.1: +14 Go tests (3 query, 12 ingester, -1 retired stub tripwire, +1 renamed). Total Go top-level: 17 → 20 → 34. Total Go incl. subtests: 20 → 23 → 37. TS: 1 → 1 → 1.

The brief expected "~30+ Go tests across pokedex and pokedex/ingest packages" — the actual count is 34 top-level (16 pokedex + 18 ingest). **Met.**

## 7. Process notes

- `make all` ordering unchanged: go vet → typecheck → golangci-lint → eslint → go test → vitest. Green end-to-end on both runs. Dependency-graph mismatch (vet/lint/test ordering) noted in earlier reviews unchanged; not a test-runner concern.
- `make sync` (scaffold mode, no `--api-data`) produced `apps/api/data/pokedex.sqlite` in 40.31 ms (1.B.1: 89 ms; 1.A: 25.52 ms). Within noise.
- `make sync-inspect` rendered all four sections cleanly. The `(not pinned …)` message in scaffold mode is the right behaviour — the pin file is only written when a real `--api-data` git checkout is provided.
- The `--passWithNoTests` flag on vitest is still present (unchanged — apps/web has 1 real test).
- Two `system-reminder` notices appeared during this run (deferred-tools listing and task-tools reminder). Neither affects test outcomes; ignored per scope.

## 8. Verdict

The Phase 1.B batched gate (1.B.1 → 1.B.4) is solid. The Go suite grew from 17 to 34 top-level tests, 12 of which are new ingester unit tests covering all three ingester families (constants, core graph, joins/evolutions/flavor_text), and 4 of which are real query-API tests that retire the 1.A-era `TestSQLQuery_StubsReturnNotImplemented` tripwire. The 1.B.1-era `TestRunBulk_HandlesNonGitAPIDataPath` was tightened to a hard-fail assertion (`TestRunBulk_FailsHardWhenAPIDataPathIsNotAGitRepo`) — semantics aligned with the policy decision in 1.B.4. The git-fixture test (`TestRunBulk_PicksUpRealCommitSHAAndWritesPinFile`) ran in 0.98 s and did **not** skip. Race detector clean across two consecutive cache-bypass runs; no flakes. Total coverage rose 51.5% → 62.0% (+10.5 pp); ingest held at 72.3% on roughly 4× the statements (effectively held vs. the 1.B.1 73.3%).

The TS suite is unchanged at 1 placeholder test, exactly as the brief specified.

**One open item, S-7 (Major):** `pokedex.Validate` and `countBySpeciesSlug` are 0.0% covered, and the CLI `runValidate` shim (S-9) is also uncovered. Phase 1.B.4 includes "validation" as scope; the validation code exists but is not exercised by any test. This is a real gap on a safety-net function — `make sync-validate` could ship silently broken without any test catching it. Recommend at least one happy-path and one negative-path test on `Validate` before merging Phase 1.B. Non-blocking if the gate aggregator considers validation tests deferred to Phase 1.C; blocking if they are in-scope for 1.B.4.

All other items (S-1 TS placeholder, S-3 scaffold-literal coupling, S-4 BST symmetry, S-5 flock contention, S-6 boundary CHECK gaps, S-8 ingester `Name()` methods) are nits or carried minors with no change in severity.

**Verdict: Approve with reservation** (S-7 is an in-scope coverage gap; otherwise clean).
