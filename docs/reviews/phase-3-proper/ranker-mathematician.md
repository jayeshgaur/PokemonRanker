# Phase 3 (proper) — ranker-mathematician review

**Scope.** Audit of the three rankers landed in `packages/ranker/`:

- `src/single-elim.ts`
- `src/glicko-random.ts`
- `src/mergesort.ts`
- `src/comparator.ts`
- accompanying tests in `__tests__/`.

Cross-referenced against `docs/PLAN.md` Phase 3 (lines 175–198), `docs/DECISIONS.md` D-3, and Glickman 1995/1999 ("The Glicko system" tutorial PDF, freely available — http://www.glicko.net/glicko/glicko.pdf).

**Verdict.** **Approve with one blocker (B-1: SingleElim BYE distribution) and four recommendations.** The math is correct; the implementations are crisp; resumability round-trips cleanly; the comparator hook is extensible. The blocker is a fairness defect in single-elim that contaminates loser ranks, not the champion. Everything else is acceptable for ship.

---

## 1. Glicko-1 formulas (verified)

Spot-checked the four formulas in `glicko-random.ts:38–301` against Glickman's tutorial.

- **`Q = ln(10) / 400`** — `glicko-random.ts:38`. Correct. Numeric: 0.005756462732485…
- **`g(RD) = 1 / sqrt(1 + 3·q²·RD² / π²)`** — `glicko-random.ts:273–275`. Correct (Glickman eq. between his §4 step 1).
- **`E(R, Rᵢ, RDᵢ) = 1 / (1 + 10^(−g(RDᵢ)·(R−Rᵢ) / 400))`** — `glicko-random.ts:277–283`. Correct.
- **`d² = 1 / (q²·g(RDᵢ)²·E·(1−E))`** — `glicko-random.ts:297`. Correct for the single-game per-period case (Glickman §4 step 1 with the sum collapsed to a single term).
- **`new RD = sqrt(1 / (1/RD² + 1/d²))`** — `glicko-random.ts:299`. Correct.
- **`new R  = R + (q / (1/RD² + 1/d²)) · g(RDᵢ) · (s − E)`** — `glicko-random.ts:300`. Correct.

**Worked-example sanity check.** I ran the per-game model on Glickman's canonical worked example (player 1500/200 plays {1400/30 W, 1550/100 L, 1700/300 L}). The batched (multi-game) Glickman closed-form gives newR≈1464.11, newRD≈151.40. Our per-game-period model gives newR≈1464.22, newRD≈151.25 — the expected small divergence between batched and per-game updates. The formulas are correctly transcribed.

**Simultaneous update.** `glicko-random.ts:182–195` correctly captures `leftRow` and `rightRow` *before* mutation, calls `updateRating` for each side, and only writes back the new values afterwards. Both updates use the original (pre-update) opposing rating. Correct.

**Tests covering this.** `glicko-random.test.ts:11–55` cover monotonicity of g, symmetry of E at equal R, monotonicity of E in R, sign of update, RD non-increase, draw-pulls-toward-each-other, and equal-and-opposite shifts (to 6 decimals). The math suite is solid. **Recommendation R-1**: add one test that pins a *specific* numeric value (e.g., the worked-example result rounded to 1 decimal). The current tests are all property-shaped and would survive a proportional rescaling bug.

---

## 2. Glicko clamp at extreme E (recommendation, not blocker)

`glicko-random.ts:296`:
```ts
const safeE = Math.max(1e-9, Math.min(1 - 1e-9, E));
```

**When does it engage?** With `rdOpp = 200` (post-convergence value), `1 − E < 1e-9` only at rating gaps ≳ 4270. With `rdOpp = 350` (initial RD), the threshold is ~5000. For Pokémon picker workloads — `targetComparisons = 5N` over 64 entries — gaps don't realistically exceed ~1000 (where `1 − E ≈ 0.008`). **The clamp will essentially never engage in production runs.**

**Is the clamp safe?**
- **Correctness when not engaged**: zero impact, since clamp is a no-op for `E ∈ [1e-9, 1−1e-9]`.
- **When engaged**: introduces a tiny bias because `E·(1−E)` is computed from the clamped value (artificially raising `d²` slightly, which slightly under-shrinks RD). The `(s − E)` factor uses unclamped `E`, which is what we want — so the *direction* of update is unbiased; only the *magnitude* (via `d²`) is mildly perturbed when E is at the singularity.
- **Bias direction**: at clamp, `1−E ≈ 1e-9`, so `safeE·(1−safeE) ≈ 1e-9`, giving `d² ≈ 1/(q²·g²·1e-9) ≈ 3·10¹³`. So `1/d² ≈ 3·10⁻¹⁴`, dwarfed by `1/RD² ≈ 1/350² ≈ 8·10⁻⁶`. The clamp effectively makes the high-confidence side say "this match told me almost nothing about you, I already knew you'd win" — which is the *correct* Bayesian posture. **The clamp is safe.**

**Recommendation R-2.** Add a one-line comment block at line 294 noting the clamp engages only at gaps ≳4000 and is a no-op for typical picker workloads. This pre-empts the next reviewer asking "why 1e-9 not 1e-6?"

---

## 3. Anytime correctness — sort by R (acceptable)

PLAN.md line 215 calls Glicko "anytime — user can stop early". `currentResult()` (`glicko-random.ts:219–222`) sorts by R descending, tie-break by id ascending (`snapshotRanking` lines 240–243).

**Should it be R or R − 2·RD (lower 95% CI)?**

Two legitimate semantics; both are defensible. R alone says "best estimate of your favorite right now." R − 2·RD says "I'm 95% sure this is at least your favorite." For an interactive picker, the user's mental model is "who's winning so far?" — R alone is the right primary ordering. Glickman himself uses R as the point estimate; R − 2·RD is a *confidence display*, not a ranking criterion.

**Edge case to consider.** Early in a run with N=64, RD≈350 for everyone. Tiny rating shifts (a single duel produces ±20 R) reorder the top of the list erratically. R − 2·RD would be even more volatile (since RD shifts too). Neither is great with very few duels, but R is the more interpretable.

**Verdict: keep R as the primary ordering. No blocker.**

**Recommendation R-3 (optional, Phase 4 UI concern).** Expose RD on each row of `currentResult()` so the UI can dim or fade-in low-confidence entries. This requires a small `Ranking` shape extension (`{ rank, pokemon, ratingConfidence?: number }`) — defer to Phase 4. Flagged here as the math says "RD is meaningful and disposable; UI should show it."

---

## 4. Pair selection — uniform vs RD-weighted (recommendation, near-blocker)

`glicko-random.ts:259–268`. Uniform random pick of two distinct ids per duel. Deterministic via Mulberry32 seeded with `seed + comparisonsDone * 0x9e3779b1`.

**Coverage analysis at default `targetComparisons = 5N`:**

| N | Duels (5N) | Pairs (N choose 2) | E[duels/pair] | P(any pair never duels) |
|---|---|---|---|---|
| 8 | 40 | 28 | 1.43 | 0.23 |
| 16 | 80 | 120 | 0.67 | 0.51 |
| 32 | 160 | 496 | 0.32 | 0.72 |
| 64 | 320 | 2016 | 0.16 | 0.85 |

At N=64 (the MVP picker cap) **85% of pairs never duel**. Uniform selection wastes the budget on already-confident matchups while leaving high-RD pairs (the ones where information-gain is highest) untouched.

**RD-weighted selection (Glickman §4 commentary; standard adaptive-tournament literature).** Weight each pair (i, j) by `RDᵢ + RDⱼ` (or by the variance of `(s − E)` under the current model — equivalent up to constants). Implementation:

```ts
private pickPair(): [number, number] | null {
  const rng = mulberry32(this.state.seed + this.state.comparisonsDone * 0x9e3779b1);
  const ratings = this.state.ratings;
  if (ratings.length < 2) return null;
  // Weight by RD sum. After convergence, low-RD entries are deprioritized.
  const weights: number[] = [];
  let total = 0;
  for (let i = 0; i < ratings.length; i++) {
    for (let j = i + 1; j < ratings.length; j++) {
      const w = ratings[i].rd + ratings[j].rd;
      weights.push(w);
      total += w;
    }
  }
  let pick = rng() * total;
  let idx = 0;
  for (let i = 0; i < ratings.length; i++) {
    for (let j = i + 1; j < ratings.length; j++) {
      pick -= weights[idx++];
      if (pick <= 0) return [ratings[i].id, ratings[j].id];
    }
  }
  // Fallback: should be unreachable except for floating-point edge.
  return [ratings[0].id, ratings[1].id];
}
```

This is O(N²) per pair pick — fine for N≤64. For N>200, switch to alias method or stratified sampling.

**Why this is a recommendation, not a blocker.** PLAN.md doesn't explicitly demand convergence speed; the algorithm is "anytime" and the user controls the budget. With targetComparisons=5N the user gets a *low-resolution* ranking; they can `setTargetComparisons(20*N)` for sharper output. But uniform selection means even a 20N budget at N=64 leaves ~60% of pairs unduelled.

**Recommendation R-4 (strong — borderline blocker for product quality).** Switch to RD-weighted selection. It's ~15 lines and makes the default 5N budget genuinely useful. Without it, "anytime Glicko" is anytime in name but converges slowly enough that mergesort's n·log n actually outperforms it on Kendall-tau-vs-comparisons for any N>20.

If you defer this, **bump the default `targetComparisons` to 10N** at minimum (`glicko-random.ts:91`), and document the tradeoff in `RANKER_INFO.comparisonsHint` (`index.ts:127`).

---

## 5. SingleElim BYE distribution — **BLOCKER B-1**

`single-elim.ts:265–280` (function `buildInitialBracket`). The first (K − N) input positions get a free first-round BYE. There is no seeding mechanism — `SingleElimRanker(pool)` accepts the pool in input order with no shuffle.

**The defect.** The BYE recipients are deterministic by **input order**. This is unfair in two ways:

1. **Path to victory.** A BYE recipient skips one round of risk. If the input is naively the canonical Pokédex order (id ascending), Bulbasaur and friends get free passes while later Pokémon must earn their slot. The user has no control over this.
2. **Loser-ranking corruption** (see B-2 below). BYE recipients eliminated in round 1 are treated identically to round-1 losers who actually won round 0 — but they only fought one round, while the round-0 winner fought two.

**The realistic input shape.** In Phase 4 the picker's pool comes from `apps/web/lib/pokedex.ts`, which queries SQLite filtered by user filter; SQL's natural order is by primary key (= dex id). So in practice the lowest-dex-id Pokémon get the BYEs every time. That is a noticeable, reproducible bias.

**Fix options (pick one):**

1. **Random shuffle at construction** with the same Mulberry32 PRNG style Glicko uses. Seed from a hash of pool ids so the bracket is reproducible across serialize/deserialize. Cheapest and unbiased. **Recommended.**
2. **Accept an optional `seed` parameter** (or `seed?: number` option object), defaulting to `hashIds(ids)`. Same shuffle approach; lets the UI override.
3. **Standard tournament seeding (1 vs N, 2 vs N−1, …).** Requires a quality input the user doesn't have. Skip.

Concretely:

```ts
constructor(pool: readonly Pokemon[], opts: { seed?: number } = {}) {
  const ids = pool.map((p) => p.id);
  // Shuffle deterministically so BYE distribution doesn't favor low-dex-id input.
  const seed = opts.seed ?? hashIds(ids);
  const rng = mulberry32(seed);
  const shuffled = [...ids];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  // …rest of constructor uses `shuffled` in place of `ids`.
}
```

Persist the shuffled order in the serialized state (it already lives in `state.ids`, so this is automatic — but be sure to construct the bracket from the shuffled order, not re-derive from input order on deserialize).

**B-1 is a blocker because:** the existing implementation produces a systematically biased ranking. Shipping it would mean every fan-voted single-elim aggregate (Phase 7) has a structural lean toward low-dex-id Pokémon. That is a real product defect, not a theoretical one.

---

## 6. SingleElim loser ranking — **BLOCKER B-2** (related to B-1)

`single-elim.ts:190–202`. Losers are sorted by `round` descending, tie-break by input order.

**Why this is a blocker.** Two issues compound with B-1:

1. **Tie-break by input order is itself unfair** — same vector as B-1. After the B-1 fix (deterministic shuffle), tie-breaking by *shuffled* order is at least neutral, but it still has no semantic justification. Two players who lost in the same round are tied, and the algorithm picks an arbitrary winner.
2. **Round equivalence is misleading.** A round-1 loser who got a BYE in round 0 fought one duel; a round-1 loser who won round 0 fought two. Treating them as the same rank-band understates the latter's achievement.

**Fix.**

For (1) — the input-order tie-break is fine as a *deterministic* tie-break once B-1's shuffle lands. Document it as "ties broken by bracket-position ascending" in a comment. No further work needed.

For (2) — the rigorous fix is **rank by (round eliminated DESC, comparisons-survived DESC)**. A BYE costs zero comparisons; a real win costs one. Implementation:

```ts
// Track per-id "comparisons survived" — increment on any submit() where
// this id was on the winning side. BYE auto-advances do not increment.
// Then sort losers by (round DESC, survivedComparisons DESC, inputIdx ASC).
```

This is a 10-line change: add a `Map<id, survivedCount>` to state, increment on each submit, and use it as the second sort key.

**B-2 fix priority.** B-1 must land. B-2's "comparisons-survived tiebreak" is a clean correctness improvement that becomes trivial once B-1's shuffle lands; recommend doing both in one PR. If the user wants to defer (2) as a follow-up, that's defensible — the impact on top-1 is zero, and the loser ranking is already documented as a partial ranking. **Treating it as a blocker pair is the conservative call given Phase 7 aggregation will roll up these rankings.**

---

## 7. SingleElim — verified (other aspects)

- **n=0, n=1 edge cases.** `single-elim.ts:61–68`. Correct: n=0 has no champion and `isDone()` returns true; n=1 sets champion=ids[0] in constructor, no duels.
- **Total comparisons = N − 1.** Verified by test `single-elim.test.ts:60–94`. The "no BYE pair surfaces in nextDuel" guard at lines 113–117 is a load-bearing invariant; the `advance()` loop correctly auto-resolves BYE pairs before returning. Good.
- **Dead branch at `single-elim.ts:231–234`.** `if (winners.length === 0)` after filtering out BYEs from `pendingWinners`. Because `buildInitialBracket` guarantees no BYE-vs-BYE pair, and BYE never propagates past round 0, this branch is unreachable. Defensive — leave it but a comment "dead under buildInitialBracket invariant; defensive" would help.

---

## 8. MergeSort comparison upper bound — verified

`mergesort.ts:140`: `total = n * Math.ceil(Math.log2(n))`.

**Theoretical upper bound for bottom-up merge sort.** Each level of merging requires up to N − (N / 2^level) comparisons; summed over `ceil(log₂ N)` levels, the total is bounded by `N · ceil(log₂ N)`. Precisely:

- Level 1 (merging pairs of 1 → runs of 2): up to `floor(N/2)` comparisons.
- Level 2: up to `2·floor(N/4) + small` ≤ N − 1.
- …
- Level `ceil(log₂ N)`: up to N − 1.

So the *exact* tight upper bound is `sum over levels of (N − ceil(N / 2^k))`, which is bounded above by `N · ceil(log₂ N) − (N − 1)`. The current bound `N · ceil(log₂ N)` is correct as an upper bound and is the conventional asymptotic statement. The test at `mergesort.test.ts:127–146` only checks `≤` the bound (it passes with margin); good.

**Worst case empirically.** For N=8 reverse-sorted, the actual count is 17 (vs upper bound 24 = 8·3). For N=15 reverse-sorted, 49 (vs 60 = 15·4). The bound is loose by ~25–30% in practice — fine for a "≈" UI hint, but the user-facing copy `index.ts:111` says "≈" which correctly conveys "not exact". Good.

**Recommendation R-5 (optional).** Tighten the formula to `n*ceil(log2(n)) - (n-1)` for a snappier UI hint. Pure cosmetic.

---

## 9. Skip semantics across all three — acceptable

- **MergeSort** (`mergesort.ts:121–123`): `leftFirst = comparisonsDone % 2 === 0`. Deterministic.
- **SingleElim** (`single-elim.ts:155–163`): same parity rule. Deterministic.
- **Glicko** (`glicko-random.ts:157–164`): no rating update; advance comparisonsDone so PRNG yields a fresh pair next call. Pair is regenerated.

**All three are reasonable.** The MergeSort and SingleElim parity rule is clever — it's deterministic across serialize/deserialize *because* `comparisonsDone` is part of the persisted state. That's a non-obvious trick, would be worth a one-line comment: "// parity over comparisonsDone is reproducible across serialize/deserialize because comparisonsDone is persisted." (Code already does this implicitly; just make it explicit.)

The Glicko skip "regenerate pair from advanced PRNG seed" is also correct and tested at `glicko-random.test.ts:146–156`.

**Future work flag.** A "skip" with no rating update on Glicko but a parity-flip on MergeSort/SingleElim means *the user pays a comparison budget* for skip on Glicko. That might surprise users who think "skip" means "this duel doesn't count". Worth surfacing in UI copy. Not a math blocker.

---

## 10. Resumability — verified

All three rankers serialize via `JSON.stringify(this.state)`. Spot-checked each `state` interface for unserializable types:

- **MergeSort `MergeSortState`** (`mergesort.ts:27–36`): all primitives, plain arrays, no Maps/closures/dates. Clean.
- **SingleElim `SingleElimState`** (`single-elim.ts:31–51`): same. The `eliminations: { id: number; round: number }[]` is plain object array. Clean.
- **Glicko `GlickoState`** (`glicko-random.ts:59–71`): same. The `currentPair: { left, right } | null` is plain. The `seed` is a number. Mulberry32 is reconstructed from seed + comparisonsDone on every `pickPair` call (line 263); state holds nothing but the seed integer. **Clean and genuinely reproducible.**

**Round-trip tests** are present and substantial:
- `mergesort.test.ts:149–191` — mid-flight state survives, lockstep continuation produces identical final ranking.
- `single-elim.test.ts:121–158` — same pattern.
- `glicko-random.test.ts:181–195` — same pattern.

**The deterministic-PRNG approach.** `glicko-random.ts:263` rebuilds the PRNG on every `pickPair` call from `seed + comparisonsDone * 0x9e3779b1`. This is *not* the same as a stateful RNG that you'd need to serialize — every call is a fresh Mulberry32 stream from the same seed, deriving one pair. **This trades a little entropy quality for lossless serialization. Acceptable for pair selection; the entropy is sufficient since each call only produces 2 distinct integers in [0, N).** The test at `glicko-random.test.ts:181–195` confirms determinism.

**One subtle point.** `mulberry32(s)` returns a closure; we call it twice (`rng()` and `rng()` on lines 264–265). Inside, the closure mutates `s`, so the two calls produce different outputs — good. But because we recreate the PRNG every call, the `s` mutation does not leak across pair picks; each `pickPair` is a fresh, deterministic 2-output sequence. **This is correct and round-trips perfectly.**

---

## 11. D-3 LLM-augmentation hook (`comparator.ts`) — sufficient with one note

The interface (`comparator.ts:14–16`):
```ts
export interface Comparator {
  pick(duel: Duel): Promise<Decision> | Decision;
}
```

**What it covers (per D-3 / Phase 9 in PLAN.md):**

- Default `UserComparator` (the picker UI is itself a Comparator) — straightforward.
- `LLMSuggestionComparator` for full agent-driven runs — straightforward.
- Async API (returns `Promise | Decision`) — supports LLM tool calls. Good.

**What it might be missing for Phase 9:**

1. **Tiebreaking only** (not full pick). Phase 9 lists "agent suggests picks during a session with reasoning, never overriding the user's vote." For that, the contract is: user picks, agent *commentary* attaches; or user is undecided, agent suggests. The current `Comparator` doesn't model "suggest, not decide." A richer interface would be:
   ```ts
   export interface Suggester {
     suggest(duel: Duel): Promise<{ decision: Decision; reasoning?: string; confidence?: number }>;
   }
   ```
   The Picker UI then chooses whether to display, take, or ignore the suggestion. **Recommendation R-6**: layer `Suggester` on top of `Comparator` in Phase 9; do not retrofit `Comparator`. Today's interface is correctly minimal.

2. **Seeding.** Phase 9 also lists "aggregate-aware seeding." Seeding is *constructor-time*, not duel-time, so it doesn't fit `Comparator`. It needs a separate `Seeder` interface that lives outside the duel loop:
   ```ts
   export interface Seeder {
     seed(pool: readonly Pokemon[]): readonly Pokemon[];
   }
   ```
   Apply before passing the pool to `createRanker`. **Recommendation R-7**: define `Seeder` as a separate interface in Phase 9; `Comparator`'s scope is correct.

3. **Commentary mode.** Mid-duel narration is a different surface (a stream from the agent) and should not pollute `Comparator`. Phase 9's UI can subscribe to that separately.

**Verdict.** `Comparator` is correct for what it claims to cover (the per-duel decision surface). The LLM-augmentation work in Phase 9 will need *two more* interfaces (`Seeder`, `Suggester`) and that's normal and clean. No blocker.

---

## Summary

### Blockers

- **B-1 (`single-elim.ts:265–280`).** BYE distribution is deterministic by input order, producing systematic bias toward low-dex-id Pokémon. Fix: deterministic Fisher–Yates shuffle seeded from `hashIds(ids)`. Persist the shuffled order in `state.ids` (already happens). ~10-line change.

- **B-2 (`single-elim.ts:190–202`).** Loser-rank tie-break by raw input order compounds B-1 *and* fails to credit comparisons survived. After B-1's shuffle, the input-order tie-break becomes neutral; the comparisons-survived secondary key is a separate clean fix. Recommend bundling both into the same PR.

### Recommendations (non-blocking)

- **R-1.** Add one Glicko numeric pin test against Glickman's worked example (newR≈1464.2, newRD≈151.3 with our per-game model). Hardens against proportional-rescaling bugs.
- **R-2.** Comment the E-clamp at `glicko-random.ts:296` explaining when it engages (never, in practice) and what it costs (nothing material).
- **R-3.** Optional Phase 4 — surface RD on each ranking row so UI can dim low-confidence entries. Math is ready; UI is the consumer.
- **R-4 (strong).** Switch Glicko pair selection to RD-weighted (~15 lines). Without it, default `targetComparisons = 5N` leaves >85% of pairs unduelled at N=64. If deferred, raise default to `10N` and document.
- **R-5.** Tighten the MergeSort upper-bound display formula from `n·ceil(log₂ n)` to `n·ceil(log₂ n) − (n − 1)`. Pure cosmetic.
- **R-6 / R-7.** When Phase 9 lands, define `Seeder` and `Suggester` as separate interfaces from `Comparator`. Today's `Comparator` interface is correctly minimal; do not retrofit.

### Praise

- Glicko-1 transcription is faithful; tests cover monotonicity, symmetry, sign, draw-pull, and equal-and-opposite to 6 decimals.
- All three rankers serialize via plain JSON; no Maps, closures, or Dates leak in. Round-trip tests are real (drive both copies in lockstep, compare final rankings).
- Mulberry32 + comparisonsDone-derived seed is a clean trick for resumable randomness that doesn't require persisting RNG state.
- The skip-parity rule (MergeSort, SingleElim) is deterministic across serialize/deserialize *because* `comparisonsDone` is persisted — non-obvious and correct.
- `Comparator` interface is correctly minimal; expanding it to `Suggester` / `Seeder` later is a clean evolution path, not a refactor.

### Closing posture

Math is correct. The single-elim seeding/loser-ranking issues (B-1, B-2) are fairness defects, not correctness defects — they don't break the algorithm but they do bias outputs in a way that contaminates downstream Phase 7 aggregation. **Block on these two; ship the rest.**

— ranker-mathematician, 2026-04-29
