# Code review — Phase 3 (proper) ranker package

**Scope.** `packages/ranker/src/{types,comparator,mergesort,single-elim,glicko-random,index}.ts` and `packages/ranker/__tests__/{single-elim,glicko-random,factory,_fixture}.{ts,test.ts}`. Mergesort behavior + tests unchanged from Phase 1. Phase 4 picker UI consumers are out of scope.

**Verdict.** **Approve-with-nits.** No blockers. Math is correct, tests are thorough, the `Ranker` interface is honored uniformly across three implementations, ADR D-3 is fully realized, and `make all` is green (144 TS tests, Go tests pass, Next.js build clean). A handful of recommendations follow — pick them up at convenience or punt to a follow-up commit.

---

## Verification I ran

- Re-read D-3 (pluggable rankers + Comparator hook), D-22 (TS engines), D-5 (URL state), D-6 (validation at IO edges).
- Re-ran `make all` locally — green.
- Re-ran `pnpm --filter @pokemon-ranker/ranker test` — 60 ranker tests pass.
- Hand-derived the Glicko-1 update against `glicko-random.ts` line-by-line vs Glickman 1995 §4.
- Traced single-elim BYE handling for n ∈ {1, 2, 3, 4, 5, 8, 16}.
- Cross-checked that `apps/web/components/picker/Picker.tsx` (still consuming `MergeSortComparator` directly) is not broken by the refactor — backward-compat preserved.

---

## ADR compliance

- **D-3 (pluggable rankers).** [praise] Three implementations behind one `Ranker` interface, plus a factory `createRanker` and snapshot router `restoreRanker`. The `Comparator` interface in `comparator.ts` is the explicit LLM-augmentation hook the ADR called for; the comment also names the user-vote invariant (Comparator proposes, user decides) and defers its property-test to Phase 9. Exactly what D-3 asked for.
- **D-22 (TS engines).** [praise] All three rankers in TypeScript under `packages/ranker/`. No Go bleed.
- **D-5 (URL is source of truth).** Snapshots are JSON strings (compact-ish; not yet URL-friendly). Not a Phase-3 obligation but flagged below for Phase 4/5.
- **D-6 (strict validation at IO edges).** [recommendation, see #1 below] Each `deserialize` validates `version` + `algo` only. Full-state Zod validation should land before serialized snapshots travel through user-controlled URLs.

No ADR violations. No diff implies a decision change.

---

## Itemized comments

### 1. [recommendation, not a Phase-3 blocker] `deserialize` validates `version` + `algo` only

`MergeSortComparator.deserialize`, `SingleElimRanker.deserialize`, `GlickoRandomRanker.deserialize` each `JSON.parse` the snapshot, then check `state.version === 1` and `state.algo === <expected>`. The remaining state shape (typed arrays of numbers, nested `merge` object, `rounds` 2D array, `ratings` row shape, etc.) is trusted. Once snapshots ship through D-5 URL state in Phase 4/5, an attacker-supplied URL becomes an IO edge per D-6.

**What I'd want before that lands.** A `RankerSnapshotSchema` Zod parser per ranker, called inside `deserialize`. Cheap to add, document the contract, and the agent (Phase 4.5) is the same threat surface — it could feed an LLM-hallucinated snapshot through `restoreRanker`.

Not a Phase-3 blocker because the only current consumer is `apps/web/components/picker/Picker.tsx` reading from same-origin localStorage. Track this as a Phase 4 entry blocker rather than a Phase 3 nit, and capture in `docs/OPEN_QUESTIONS.md` Phase 4 section.

### 2. [nit] Mergesort `deserialize` does not normalize the legacy `algo: "mergesort"` value

`mergesort.ts:62-66` accepts both spellings on read but does not rewrite `state.algo` to the canonical `"merge-sort"`. So a legacy snapshot deserialized → re-serialized still says `"mergesort"`. The factory test `accepts the pre-Phase-3 'mergesort' algo string for backward compat` only asserts `restored.kind === "merge-sort"`, not the re-serialized form. Functionally fine (deserialize accepts both indefinitely), but a stale snapshot survives forever. Trivial fix:

```ts
inst.state = state;
if (state.algo === "mergesort") inst.state.algo = "merge-sort";
```

### 3. [nit] Glicko `submit` falls back to populating `currentPair` if `nextDuel` was never called

`glicko-random.ts:142-153`. Mergesort and single-elim both throw if you `submit()` without calling `nextDuel()`. Glicko silently calls `nextDuel()` for you. The asymmetry is small but a Phase-4 picker bug ("we forgot to fetch the next duel before submitting") would be loud on two rankers and silent on the third. Recommend matching the strict behavior — throw `"submit called without nextDuel"`.

### 4. [nit] `pickPair` seed arithmetic mixes JS-double math with `>>> 0` truncation

`glicko-random.ts:263`: `mulberry32(this.state.seed + this.state.comparisonsDone * 0x9e3779b1)`. For comparisonsDone ≲ 2²¹ the multiplication is exact in IEEE-754 doubles and the subsequent `>>> 0` inside mulberry32 truncates cleanly. At our scale (`5n` ≈ thousands of comparisons max) this is fine. Document the bound, or replace with `Math.imul(this.state.comparisonsDone, 0x9e3779b1) >>> 0`-style 32-bit arithmetic so the seed derivation is portable to any future precision-sensitive context.

### 5. [nit] `decisions: Decision[]` and `comparisonsDone` are persisted but `decisions` is never read

All three rankers append the user's decision to `state.decisions[]` and never consume it. Useful for replay/debug/audit; worth a one-line comment noting the intent (e.g., "audit trail for Phase 7 aggregation re-derivation"). Otherwise a future reader will assume it's dead state and remove it.

### 6. [nit] Single-elim `result()` rank tie-breaking is documented in the comment but not in a test

`single-elim.ts:184-203` ties losers eliminated in the same round by input index. The comment explains it; the test `ranks losers by elimination round (later round = higher rank)` partially covers via `expect(ranked.slice(2)).toEqual([2, 4])`. A focused n=8-with-input-shuffle test would lock the contract more tightly. Not blocking — the existing test does cover the path that matters.

### 7. [nit] `MergeSortComparator.deserialize` constructs a throwaway instance with `[]`

`mergesort.ts:72-75` (and the parallel paths in single-elim:91-94 and glicko:111-114): `const inst = new MergeSortComparator([])` then `inst.state = state`. The constructor's bookkeeping (initial `runs`, `byId`, the `advance()` call) is wasted work that's immediately overwritten. Tiny perf cost; readability cost is the bigger thing — the "construct and replace" idiom is a footgun (constructor side effects could leak). Consider a `private static fromState(state, byId)` factory that bypasses the constructor.

### 8. [nit] `glickoExpectation` parameter order is `(r, rOpp, rdOpp)` — own `rd` is missing

The exported helper takes only the opponent's RD, not the player's. That's actually correct for Glicko-1 in the simplified one-game-period form (the player's own RD enters via `d²` and the new RD update, not via E). The signature is fine but a one-line docstring saying so will save a future reader the formula check.

### 9. [praise] Test fixture is well-isolated and documented

`__tests__/_fixture.ts` exports `pkmn(id)` and `pool(ids)` that synthesize the engine-relevant `Pokemon` fields and zero everything else. Good ergonomics; the duplicated copy in `mergesort.test.ts` is acceptable (the tests predate the fixture extraction). Optionally migrate `mergesort.test.ts` to use `_fixture` for consistency.

### 10. [praise] Glicko math tests are textbook

`glicko-random.test.ts:11-56` covers the monotonicity properties (g↘ in RD, E=0.5 at equal R, E↗ in own R), the rating-update sanity (winner up, loser down, RD non-increasing, draws move toward each other), and a symmetry property (`w.r - 1500 ≈ 1500 - l.r`). This is the right shape for math tests — properties over magic numbers — and the `toBeCloseTo(0.5, 12)` precision is appropriately tight.

### 11. [praise] BYE invariant guarded at the throw site

`single-elim.ts:113-118` and `:139-141`: if `nextDuel`/`submit` ever sees a BYE pair it throws an explicit `"internal: nextDuel called on a BYE pair"`. That's exactly the right defensive posture — `advance()` is supposed to skip those, and a regression in `advance()` should fail loud, not produce a silently-corrupted ranking. The test `never raises a BYE pair into nextDuel for any n in [2, 16]` exercises this directly.

### 12. [question] Glicko `setTargetComparisons` resets `forcedStop` even on a no-op extension

`glicko-random.ts:231-237`: calling `setTargetComparisons(comparisonsDone)` (no-op) sets `forcedStop = false` then `isDone()` flips back to checking `comparisonsDone >= targetComparisons` which is true. Net result: still done. But if `forcedStop` was true and the user picks `setTargetComparisons(comparisonsDone)`, `forcedStop` clears — surprising. A one-line guard `if (target > comparisonsDone) this.state.forcedStop = false` makes the intent explicit. Question, not a bug.

### 13. [scope] Comments in source explain *why*, not just *what*

[praise] `comparator.ts` opens with a paragraph on the LLM-augmentation hook + user-vote invariant. `glicko-random.ts` reproduces the four formulas verbatim with the citation. `single-elim.ts` BYE comment names the user complaint it closes. This is exactly the comment style the code-reviewer brief asks for ("validates the WHY").

---

## Test coverage assessment

**Strong:**
- Mergesort: 11 tests including a property test over 32 random total orders, an upper-bound check against `n*ceil(log2(n))`, and a serialize/deserialize lockstep test.
- Single-elim: 14 tests including the n ∈ [2, 16] BYE sweep, a known-bracket trace for n=4, and a deserialize-rejects-missing-id test.
- Glicko: 21 tests split across the math helpers and the ranker. Math tests cover monotonicity, expectation, draws, and update symmetry. Ranker tests cover serialize/deserialize, anytime `currentResult`, `stopEarly`, `setTargetComparisons`, and a 30-round convergence run.
- Factory: 14 tests over `createRanker`, `restoreRanker` (including the legacy `mergesort` algo path), and `runRanker` with sync + async Comparator.

**Gaps that would tighten the suite (none blocking):**
1. No test that two `GlickoRandomRanker` instances seeded identically produce identical first-pair sequences. The seed-determinism contract is the basis of D-5 reproducibility — worth one assertion.
2. No property test over single-elim with random true ranks (analogous to mergesort's). Would catch any regression in BYE advancement or loser ranking under non-monotone input order.
3. No test that `restoreRanker` of a re-serialized legacy `mergesort` snapshot still works after one round-trip (relates to nit #2).
4. No dedicated cross-instance test that `forcedStop` flag survives `serialize()`/`deserialize()`. Implicit in the round-trip test, but not asserted directly.

---

## Summary

The diff lands D-3's interface in a clean, three-implementation form: `MergeSortComparator` (extracted, behavior-preserving), `SingleElimRanker` (new, with correct BYE handling and partial loser ranking), `GlickoRandomRanker` (new, anytime, deterministically seeded, math matches Glickman 1995). The `Comparator` interface is the explicit LLM-augmentation hook D-3 named, with the user-vote invariant called out in comments and deferred for property-testing in Phase 9. Tests are thorough (60 ranker tests, including a property test and serialize/deserialize lockstep coverage) and `make all` is green.

The one structural concern — full Zod validation of deserialized snapshots per D-6 — is a Phase 4/5 boundary concern, not a Phase 3 boundary concern, because today's only consumer is same-origin localStorage. Track it in `docs/OPEN_QUESTIONS.md` Phase 4 entry. Everything else is nits.

This is a strong sub-phase. Approve.
