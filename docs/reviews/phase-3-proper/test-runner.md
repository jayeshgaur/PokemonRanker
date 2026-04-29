# Phase 3 (proper) — test-runner review

**Date.** 2026-04-29
**Agent.** test-runner
**Scope.** Verify the test suite from a fresh state and critique Phase 3 ranker test coverage.
**Verdict.** **Approve-with-reservation.** All three commands are green; the suite is stable; the new tests cover the headline contracts well. Several real coverage gaps exist (partial-rank correctness for single-elim with n>4, glicko draw symmetry / extreme rating gaps, glicko `forcedStop` round-trip, an unseeded `Math.random` in the merge-sort property test) — none are blockers, but they are exactly the kind of holes that let a future regression land green. Logged below for the relevant beat owners.

---

## Run results

### 1. `make all`

- **Exit 0.** Wall: ~30 s.
- Go vet — clean.
- golangci-lint — `0 issues.`
- Go tests — `ok` for `internal/pokedex` and `internal/pokedex/ingest` (cached). No test files for `cmd/pokedex-sync` (no regression — never had any).
- pnpm typecheck — 4 workspaces clean (shared, filter, ranker, web).
- pnpm lint — 4 workspaces clean. `apps/web` emits a Next.js deprecation note (`next lint` → ESLint CLI in Next 16) — informational, not a failure. Worth a follow-up issue, not a gate blocker.
- pnpm test:
  - `packages/shared` — no test files (passWithNoTests).
  - `packages/filter` — 83 tests passed (presets 23, apply 49, composition 11).
  - `packages/ranker` — **60 tests passed** (mergesort 11, factory 14, single-elim 14, glicko-random 21).
  - `apps/web` — 1 test passed (sanity).

### 2. `pnpm -C apps/web build`

- **Exit 0.** Compiled in ~1 s, page generation clean.
- Routes: `/` (static, 163 B / 105 kB First Load), `/_not-found` (static), `/pick` (dynamic, 5.25 kB / 110 kB First Load). Bundle sizes are unremarkable for this stage.

### 3. `make sync-validate`

- **Exit 0.** `validate: 0 issues — all checks passed`. The 16-check suite is satisfied against the current SQLite snapshot.

### Flake check

Re-ran `pnpm -C packages/ranker test` three consecutive times. All three runs: `4 passed (4)` / `60 passed (60)`, durations within ±1 ms. No flake observed.

Caveat: the merge-sort property test (`mergesort.test.ts:107-125`) uses `Math.random()` without a seed for both the input order and the true-rank assignment, across 32 trials. It happened to pass three times in a row, but a seeded PRNG would make this test reproducibly debuggable. Not a regression introduced by this gate (the test is pre-existing) but a smell I'd fix opportunistically.

---

## Coverage critique — file by file

### `single-elim.test.ts` (14 tests)

**Strong.**

- The n-1 comparison count is asserted for every n in `[2, 16]` (`single-elim.test.ts:85-94`), which broadly exercises BYE auto-advance for non-power-of-2 sizes.
- Determinism of `skip` across serialize/deserialize is asserted (`121-127`).
- Both deserialize error paths (`incompatible` and `missing pokemon`) are covered.
- The "submit on completed" guard is covered (`177-181`).

**Gaps.**

1. **Partial-rank correctness for n>4 is not validated.** The "ranks losers by elimination round" test (`96-113`) is the only case that asserts the full ordered list, and it's only n=4 with a manually-driven bracket. The n=2..16 sweep checks `ordered.length` and `ordered[0]` only — a regression that mis-sorts the eliminations array (e.g., flipping the round comparator from `b.round - a.round` to `a.round - b.round`) would leave the headline asserts intact. **Recommendation (ranker-mathematician beat):** add one explicit n=8 case asserting the full `ordered.map(x => x.rank)` shape, including the ranks of semifinal/quarterfinal losers, with a deterministic decision driver.
2. **`skip` parity is never directly asserted.** `single-elim.ts:156-163` chooses the winner from `comparisonsDone % 2`. The current test only verifies that two instances agree across serialize/deserialize — a bug that flips the parity (left↔right on even/odd) would still pass. **Recommendation:** add a test that submits `"skip"` first and asserts the eliminated id is the right-side competitor (parity 0 ⇒ left wins ⇒ right is loser), then submits another `"skip"` and asserts the opposite parity outcome.
3. **No serialize-after-`isDone`-and-restore test.** Restoring a finished ranker should preserve `result()`. The mid-flight round-trip is covered, end-state isn't.
4. **The internal "BYE pair" guards** (`single-elim.ts:117, 139-141`) are unreachable from the public API. Acceptable to leave untested — they're defensive assertions, not user-facing branches.

### `glicko-random.test.ts` (21 tests)

**Strong.**

- The math suite (g monotonicity, E symmetry at equal ratings, RD non-increase, draw-toward-each-other, winner/loser symmetry) is well-aimed.
- Anytime property (`currentResult` mid-flight) is covered.
- `stopEarly` flips `isDone` and unlocks `result`.
- `setTargetComparisons` extends a stopped run and rejects targets below `comparisonsDone`.
- `skip` doesn't update ratings but does advance `comparisonsDone`.
- Convergence test (`158-179`): with consistent decisions over 30 rounds at n=4, top and bottom land correctly.
- PRNG self-pair guard (`b >= a ⇒ b++`) is exercised by the "never returns a self-pair" sweep.

**Gaps.**

1. **`forcedStop` is not tested through serialize/deserialize.** `stopEarly()` mutates `state.forcedStop`. If a future refactor moves that flag out of the persisted state, the round-trip test would still pass (it doesn't call `stopEarly` before serializing). **Recommendation:** call `stopEarly()` then serialize, deserialize into a new ranker, and assert `isDone()` remains true. Symmetric: `setTargetComparisons` after deserialize on a previously stopped run.
2. **`result()` mid-flight is not asserted to be `null`.** Source returns null when `!isDone()` (`glicko-random.ts:213-216`). Only `currentResult()` is checked mid-flight. A bug that makes `result()` leak partial state would not be caught.
3. **Draw symmetry at equal ratings is not tested.** When A and B have identical R and RD and the decision is `"draw"`, both ratings should remain unchanged (E=0.5, score=0.5). The closest existing test is "draw moves both ratings toward each other" (asymmetric ratings only). **Recommendation:** assert that `updateRating(1500, 200, 1500, 200, 0.5)` returns `r === 1500` (within 1e-9).
4. **Extreme rating gaps are not tested.** `glicko-random.ts:296` clamps `safeE = max(1e-9, min(1-1e-9, E))` to avoid `dSquared` exploding. A regression that removes this clamp would not be caught: with R=1500 vs Rop=3000, raw E ≈ 1.7e-5, no division-by-zero is provoked. But R=1500 vs Rop=10000 gets E close enough to zero that `1 / (E·(1-E))` could overflow if the clamp is gone. **Recommendation:** add a test with rating gap of 5000+ asserting `updateRating` returns finite numbers.
5. **`targetComparisons: 0`** with n≥2: `isDone()` should return true immediately (`comparisonsDone (0) >= targetComparisons (0)`). Untested. Cheap to add; it's the natural "I want zero rounds" UI corner.
6. **n=2 pair variety.** A buggy PRNG that always returns `[1, 2]` would pass every existing test (since for n=2 there's only one valid pair anyway). Not really fixable for n=2; for n≥3 the self-pair sweep does observe variety implicitly. Logged for awareness, not a recommendation.
7. **`currentResult` ordering is not validated by ranking.** Test at `101-111` asserts `ordered.length === 3` only. After one `"left_wins"` submit, the left competitor should have a higher rating than the right. Not asserted — a wrong comparator in `snapshotRanking` would not be caught here.
8. **`hashIds` determinism (default seed)** is implicitly exercised but not asserted. Two `GlickoRandomRanker` instances over the same pool with no seed should produce the same first pair. **Recommendation:** one assert.

### `factory.test.ts` (14 tests)

**Strong.**

- All three `RankerKind` values dispatch to the right class.
- All three deserialize round-trips succeed via `restoreRanker`.
- Backward-compat for `"mergesort"` legacy algo string is covered.
- `runRanker` works with both sync and async `Comparator`.
- Three error paths in `restoreRanker`: invalid JSON, missing algo, unknown algo.
- `RANKER_INFO` order and `comparisonsHint` smoke-tested at three n values.

**Gaps.**

1. **`restoreRanker` with non-object JSON.** `JSON.parse("null")` returns null, `JSON.parse("[1,2]")` returns an array (typeof "object" but no `algo` field — would land in "missing algo"). The "missing algo" branch covers the array case incidentally. The `null` case falls into `!parsed`, which the test doesn't directly hit. Minor.
2. **`runRanker` with an already-done ranker.** `createRanker("merge-sort", pool([]))` followed by `runRanker(ranker, comparator)` should resolve to a `Ranking` with `ordered: []` without ever calling `comparator.pick`. Not asserted; relevant for the agent driver in Phase 8+ where the LLM may receive an empty pool.
3. **`runRanker` with a `Comparator` returning `"skip"`.** All three rankers accept `"skip"`; the runner test only exercises decisive picks. A Comparator that always skips would loop forever for `glicko-random` (since skip advances `comparisonsDone`, it terminates) — actually fine, but worth one explicit run to lock the contract.
4. **`RANKER_INFO.comparisonsHint` for n=1** is not checked, only n=0 / 8 / 150. Source has the `n <= 1` branch in all three entries; n=1 is the boundary. Cheap to add.

### `mergesort.test.ts` (11 tests, unchanged)

**Pre-existing concern (not new in this gate).**

- Property test (`107-125`) uses `Math.random()` without a seed for both shuffling and rank assignment. 32 trials × n in [4,15]. Three triple-runs were green; the test is empirically stable, but it is not deterministic. A failure mode that triggers only on a specific permutation would surface as an irreproducible flake. Not a Phase-3-proper regression — flagging for the ranker-mathematician beat as a hygiene fix.

---

## Wrong-reason / unrealistic-fixture sweep

- **Fixture realism.** `_fixture.ts` zeroes most fields and uses `id == speciesId == formId`. Rankers treat Pokemon as opaque, so this is fine — they only read `id`. No wrong-reason risk here.
- **Oracle drivers** in `single-elim.test.ts:6-27` and `mergesort.test.ts:42-63` use a true-rank Map and resolve every duel decisively. The decision derivation `lr < rr ? left_wins : rr < lr ? right_wins : draw` is correct under a strict total order — no draws ever fire because trueRank values are unique. The tests pass for the right reason.
- **Backward-compat string substitution** (`factory.test.ts:62-67`) relies on the literal `"merge-sort"` appearing in the snapshot. Today, that string appears only as the value of `algo`, so the substitution is well-targeted. Brittle if a future state field is also called `"merge-sort"`, but unlikely.

---

## Summary of recommendations (priority-ordered)

| # | Owner | Severity | Item |
|---|-------|----------|------|
| 1 | ranker-mathematician | medium | Single-elim: assert full partial-rank shape for n=8 (not just `length` and `[0]`). |
| 2 | ranker-mathematician | medium | Glicko: round-trip `forcedStop` through serialize/deserialize. |
| 3 | ranker-mathematician | medium | Glicko: assert draw symmetry at equal ratings (R unchanged) and extreme-gap stability. |
| 4 | ranker-mathematician | low | Single-elim: directly assert `skip` parity outcome (not just round-trip). |
| 5 | ranker-mathematician | low | Glicko: `result()` mid-flight returns null; `targetComparisons: 0` boundary; `currentResult` ordering after one decision. |
| 6 | ranker-mathematician | low (pre-existing) | Mergesort property test should use a seeded PRNG, not `Math.random`. |
| 7 | agent-tool-author (future) | low | `runRanker` on already-done ranker; `runRanker` with a `"skip"`-only Comparator. |
| 8 | code-reviewer (informational) | trivial | `apps/web` lint emits Next.js 16 deprecation note for `next lint` — separate follow-up. |

---

## Verdict

**Approve-with-reservation.** Phase 3 (proper) ships green: `make all`, `pnpm -C apps/web build`, and `make sync-validate` are all clean; the new ranker test files (49 new tests across single-elim, glicko-random, factory) lock the headline contracts including the D-3 `Comparator` hook. The reservations above are coverage *gaps*, not failures — none rise to a blocker. They would, however, let a regression land silently, so I recommend the ranker-mathematician beat-owner triage them before Phase 4 work that depends on these rankers' correctness assumptions (especially the algorithm dropdown's behavior for non-power-of-2 pools and stop-early flows).
