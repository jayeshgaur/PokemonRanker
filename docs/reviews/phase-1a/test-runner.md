# Phase 1.A — test-runner review

**Date:** 2026-04-28
**Scope:** Phase 1.A (Pokédex schema + sync skeleton).
**Commands run:**
- `make all` (vet, lint, typecheck, test — Go and TS)
- `make sync`
- `go test -race -v ./...` in `apps/api`
- `go test -cover ./...` and `go tool cover -func` for per-function coverage

## 1. Top-line results

| Suite | Tests | Passed | Failed | Skipped | Duration (wall) |
|---|---|---|---|---|---|
| Go (`apps/api`, `-race -v`) | 12 (10 top-level; `TestStats_BST` has 3 subtests) | 12 | 0 | 0 | 1m15s (`time` total); per-package: health 2.28s, pokedex 2.29s, ingest 3.26s |
| TS (`apps/web`, vitest) | 1 | 1 | 0 | 0 | 893 ms |
| `make all` (combined) | — | green | — | — | 11.97s |
| `make sync` | n/a (CLI) | OK | — | — | ~1.87s wall (35.5 ms reported by binary) |

Go coverage (statement-level, no `-race` to keep numbers comparable to default toolchain output):

| Package | Coverage |
|---|---|
| `internal/health` | 100.0% |
| `internal/pokedex` | 71.4% |
| `internal/pokedex/ingest` | 60.0% |
| `cmd/api` | 0.0% (no test files) |
| `cmd/pokedex-sync` | 0.0% (no test files) |
| **Total** | **34.5%** |

## 2. Per-package test breakdown

### `internal/health` (1 test, 1 passed)
- `TestHandler_ReturnsOK` — PASS (0.00s). Hits `/healthz`, asserts 200, JSON content-type, and decoded body `{"status":"ok"}`.

### `internal/pokedex` (5 tests; `TestStats_BST` has 3 subtests; all passed)
- `TestOpen_CreatesAllExpectedTables` — PASS (0.08s)
- `TestOpen_RecordsSchemaVersion` — PASS (0.08s)
- `TestOpen_IsIdempotentOnReopen` — PASS (0.16s)
- `TestOpen_EnforcesForeignKeys` — PASS (0.07s)
- `TestSQLQuery_StubsReturnNotImplemented` — PASS (0.07s)
- `TestStats_BST` — PASS (0.00s)
  - `all_zeros` PASS, `balanced_100s` PASS, `Garchomp` PASS

### `internal/pokedex/ingest` (4 tests, all passed)
- `TestRunBulk_CreatesDatabaseAndRecordsRun` — PASS (0.12s)
- `TestRunBulk_RequiresOutputPath` — PASS (0.00s)
- `TestRunBulk_OverwritesExistingDatabase` — PASS (0.23s)
- `TestRunBulk_CleansUpStaleTempFile` — PASS (0.10s)

### `cmd/api`, `cmd/pokedex-sync`
No test files — `go test` reports `[no test files]`.

### TS (`apps/web`)
- `__tests__/sanity.test.ts > sanity > runs the test suite` — PASS (3 ms). Asserts `1 + 1 === 2`. See suspicious-tests note.

## 3. Failures

None. `make all`, `make sync`, and `go test -race -v ./...` are all green.

## 4. Suspicious tests

### S-1 (Major) — `apps/web/__tests__/sanity.test.ts` is a placeholder, not a test
File: `apps/web/__tests__/sanity.test.ts:1-7`
```ts
describe("sanity", () => {
  it("runs the test suite", () => {
    expect(1 + 1).toBe(2);
  });
});
```
This exercises no application code. The TS suite count of "1 passed" is misleading — there is zero TS coverage of any file in `apps/web`. The vitest config also passes `--passWithNoTests`, so removing this stub would still yield a green build. Acceptable as a wiring smoke for Phase 0; for Phase 1.A specifically nothing in `apps/web` was changed, so the absence of meaningful TS tests is not a Phase 1.A regression — but the test should not be counted toward "TS test coverage" in any future status reporting. Recommend filing as a tracked nit and replacing with a real test at the first Phase 4 (UI MVP) sub-phase.

### S-2 (Minor) — `TestSQLQuery_StubsReturnNotImplemented` tests the absence of behavior
File: `apps/api/internal/pokedex/query_test.go:17-33`
The test asserts that `GetByID`, `GetBySlug`, and `List` all return `ErrNotImplemented`. This is intentional — the test header comment explicitly says it's a tripwire so 1.B will fail this test the day the stubs are filled in. That is a legitimate test design choice (it documents the contract and forces explicit deletion when the contract changes), but it is "suspicious" in the literal sense the prompt asked about: it does not exercise real query behavior. Calling it out for transparency, not as a defect.

### S-3 (Nit) — `TestRunBulk_CreatesDatabaseAndRecordsRun` couples to a placeholder constant
File: `apps/api/internal/pokedex/ingest/bulk_test.go:24-25, 39-40`
```go
assert.Equal(t, "scaffold", res.APIDataCommitSHA)
...
assert.Equal(t, "scaffold", sha)
```
`"scaffold"` is the Phase 1.A placeholder return value of `commitSHAOrPlaceholder` when no `APIDataPath` is provided. Hard-coding the literal in the test is fine for now, but the assertion will start lying about what it tests as soon as Phase 1.B replaces `commitSHAOrPlaceholder` with `git rev-parse`. Suggest changing to `assert.NotEmpty(t, res.APIDataCommitSHA)` or extracting a package-level constant. Non-blocking.

### S-4 (Nit) — `TestStats_BST/balanced_100s` and `TestStats_BST/Garchomp` have the same expected total
File: `apps/api/internal/pokedex/types_test.go:21-45`
Both subcases assert `BST() == 600`. The `BST` function is `HP + Atk + Def + SpA + SpD + Spe`, and a permutation/ordering bug (e.g., `s.HP + s.HP + ...`) would still pass `balanced_100s` but be caught by `Garchomp`'s asymmetric numbers — so the second case does add real signal. The `all_zeros` case mostly proves the function returns `0` for the zero value. Coverage is fine; just noting that two of the three cases sum to 600.

No tests were named after one thing while testing another. No tests with empty assertion bodies. No tests using `t.Skip`. No tests that mutated shared state across runs.

## 5. Coverage notes

Functions / branches not covered:

- **`cmd/api/main` and `cmd/api/envOr`** — 0% (Phase 0 entry point; not in Phase 1.A scope).
- **`cmd/pokedex-sync/main` and `cmd/pokedex-sync/runBulk`** — 0%. The CLI is exercised end-to-end by `make sync` (which succeeds), but there is no Go-level test for argument parsing, the unknown-command branch, the `delta`/`drift-check` exit-2 paths, or the `--help` branch. Not a blocker for 1.A (the CLI is a thin wrapper around `ingest.RunBulk`, which is well-tested), but the unknown-command path is the kind of thing that will silently regress.
- **`pokedex.Open`** — 61.1%. The uncovered lines are the `sql.Open` failure path, the `db.PingContext` failure path, the `db.ExecContext(schemaSQL)` failure path, and the `recordSchemaVersion` failure-after-success path. These all `_ = db.Close()` and return wrapped errors; reaching them requires injecting a broken DSN or a half-applied schema. Acceptable; the happy path and the schema-version idempotency path are both tested.
- **`pokedex.recordSchemaVersion`** — 80.0%. Only the `db.ExecContext` error wrapping branch is uncovered.
- **`ingest.RunBulk`** — 59.1%. Uncovered: `os.MkdirAll` failure path, `pokedex.Open(tmp)` failure path, `db.ExecContext(INSERT INTO sync_meta)` failure path, `db.Close()` failure path, and `os.Rename` failure path. All five are filesystem-edge / driver-edge errors and would require either a test helper that mocks the FS or a deliberately-poisoned tempdir. For 1.A the happy path, the `OutputPath required` validation, the overwrite-leaves-one-row invariant, and the stale-`.tmp` cleanup are all covered.
- **`ingest.commitSHAOrPlaceholder`** — 66.7%. The empty-path branch (`"scaffold"`) is hit; the non-empty branch (`"unknown"`) is not. Trivial to add a test; will be replaced in 1.B anyway.
- **`pokedex.Pokemon` struct** has no field-level tests (it's a plain data carrier — no logic to test). `Stats.BST` is at 100%.
- **Schema** — `db_test.go` confirms all 19 expected tables exist and that one foreign-key violation (species → generation) is rejected. It does **not** verify column types, NOT NULL constraints, UNIQUE constraints, indices, or other foreign-key relationships (e.g., `pokemon_types.pokemon_id`, `evolutions.evolved_form_id`). For a 19-table schema this is a noticeable gap; the `schema-guardian` agent should be the one to weigh in on whether a schema-introspection test is warranted now or in 1.B when ingestion exposes any constraint mistakes.

## 6. Flakes

None observed. The Go suite was run once with `-race -v`; no data races, no intermittent failures. (A second run was not performed because nothing failed; if a flake report is desired pre-merge, request a re-run.)

## 7. Process notes

- `make all` runs go vet → typecheck → golangci-lint → eslint → go test → vitest, in that order, and was green end-to-end in 11.97s.
- `make sync` produced `apps/api/data/pokedex.sqlite` in 35.5 ms (reported by the binary). The atomic-rename strategy means a partial failure leaves the previous file intact — exercised by `TestRunBulk_CleansUpStaleTempFile`.
- Race detector clean.
- Vitest runs with `--passWithNoTests`. This is contrary to the test-runner role's "do not silence failures" rule in spirit, but in practice the suite has 1 test today so the flag is inert. Flag for the human / `code-reviewer` to consider removing once a real TS test exists.

## 8. Verdict

The Go test suite is solid for a 1.A schema-skeleton sub-phase: 12 tests, all passing, race-clean, with focused coverage of schema application, idempotency, foreign-key enforcement, and atomic-rename invariants. The TS suite is a stub (S-1) but Phase 1.A did not modify `apps/web`. No failing tests, no flakes, no silenced failures, no tests-named-after-one-thing-testing-another. The suspicious-test notes (S-1 through S-4) are all transparency callouts, not blockers.

**Verdict: Approve with nits**
