# Phase 3 (proper) — Implementation Gate

**Date:** 2026-04-29
**Sub-phase:** Phase 3 — Ranking engine (full deliverables per PLAN.md §Phase 3 lines 175–198).
**Aggregator:** assistant, reading the three reports in this directory.

## Per-agent verdicts

| Agent | Initial | After blocker-fix pass | Δ |
|---|---|---|---|
| `code-reviewer` | Approve-with-nits | Approve-with-nits | maintained |
| `test-runner` | Approve-with-reservation | Approve-with-reservation | maintained |
| `ranker-mathematician` | **Approve with 2 blockers** | **Approve** | upgraded — B-1 + B-2 cleared |

**Aggregate gate verdict: Approve.** Phase 3 closes; Phase 4 (proper UI) may begin.

## Blockers cleared in this gate-close pass

**B-1 (ranker-mathematician) — SingleElim BYE-distribution bias.** Original code paired BYEs with the first (K-N) input positions, giving low-dex Pokémon systematic free passes (and contaminating Phase 7 aggregates). Fixed: deterministic Fisher-Yates shuffle in `SingleElimRanker` constructor, seeded by `hashIds(ids)` for reproducibility. Schema bumped to v2 (state.bracketSeed persisted). Two new tests pin the contract: shuffle-agnostic ranking + smoke check that two pools don't both yield (1,2) as their first pair.

**B-2 (ranker-mathematician) — Loser-rank tie-break used input order.** Now ties are broken by `matchesWon` (descending), then input order. A competitor who beat two opponents before losing in round 2 outranks a BYE-recipient who lost their first real match in round 2 with 0 wins. State now tracks `matchesWon: Record<string, number>`, incremented on every real win. Test: partial-rank correctness for n=8.

## Other improvements bundled in this pass

- **R-4 (ranker-mathematician) — Glicko pair selection switched from uniform to RD²-weighted.** Two-step weighted draw (player A by RD², then B by RD² over the rest). This focuses the comparison budget on the players the system is most uncertain about; substantially better convergence at the default `targetComparisons = 5n`. Helper `pickWeighted(weights, r01)` documented for testability.
- **code-reviewer #2 — MergeSort deserialize legacy normalization.** Pre-Phase-3 snapshots used `algo: "mergesort"`; on deserialize we now rewrite to canonical `"merge-sort"` so a re-serialize() emits the modern label.
- **code-reviewer #3 — Glicko submit strict contract.** Glicko's `submit` now throws if `nextDuel()` wasn't called first, matching MergeSort and SingleElim. (Previously silently called nextDuel internally — a footgun for picker bugs.) Tests updated; new `vote(r, decision)` helper added.
- **test-runner #4 — Glicko draw-symmetry-at-equal-ratings test.** Verifies `updateRating(1500, 200, 1500, 200, 0.5).r === 1500`, RD still drops.
- **test-runner #5 — Glicko extreme rating gap test.** Verifies the `safeE` clamp keeps update finite at 2500-vs-1000 rating gaps in both directions.
- **test-runner #3 — Glicko forcedStop survives serialize/deserialize.**
- **test-runner #10 — Factory: async Comparator integration test.**

## What landed across Phase 3 (proper)

### Source layout (refactor — no behavior change to existing MergeSort)

- `packages/ranker/src/types.ts` — Ranker, Decision, Duel, Progress, Ranking, RankerKind. Pure types, zero deps.
- `packages/ranker/src/comparator.ts` — `Comparator` interface (D-3 LLM hook) + `runRanker(ranker, comparator)` async helper.
- `packages/ranker/src/mergesort.ts` — extracted from old index.ts. Adds `kind` property; legacy snapshot string normalization.
- `packages/ranker/src/single-elim.ts` — new. Single-elimination bracket. Exactly N-1 comparisons. Deterministic Fisher-Yates shuffle. BYE auto-advance. Loser ranking by elim-round → matchesWon → input-order.
- `packages/ranker/src/glicko-random.ts` — new. Anytime Glicko-1. Per-comparison rating period. RD²-weighted pair selection. Mulberry32 PRNG seeded by hashIds. Exposes `currentResult()`, `stopEarly()`, `setTargetComparisons()`.
- `packages/ranker/src/index.ts` — re-exports + `createRanker(kind, pool, opts)` factory + `restoreRanker(snapshot, pool)` discriminator + `RANKER_INFO[]` metadata for the Phase 4 dropdown.

### Tests

**150 TS tests pass** across 4 workspaces (filter 83, ranker 66, web 1, shared 0). Up from 95 after Phase 2.

- `mergesort.test.ts`: 11 (unchanged)
- `single-elim.test.ts`: 14 (new — BYE handling for n in [2..16], shuffle determinism, partial-rank correctness, deserialize, draw, skip)
- `glicko-random.test.ts`: 22 (new — Glicko math validity, monotonicity, draw symmetry, extreme rating gap clamp, anytime + stopEarly + setTargetComparisons, RD-weighted pair selection, serialize/deserialize, strict-submit contract, forcedStop persistence)
- `factory.test.ts`: 14 (new — createRanker for each kind, restoreRanker discriminator + legacy-mergesort backcompat + invalid-input errors, runRanker sync + async, RANKER_INFO sanity)

### Tooling

- `Vitest` config in `packages/ranker/` extended with `exclude: ["**/_*.ts"]` so `_fixture.ts` isn't picked up as a test file.
- `make all` green; Next.js production build clean (4 routes); `make sync-validate` 0 issues.

## Forward-looking items handed to Phase 4 / Phase 9

- **Phase 4 lead:** the algorithm dropdown sources its data from `RANKER_INFO`. Use `createRanker(kind, pool, opts)` to construct; `restoreRanker(snapshot, pool)` to resume from localStorage. UI affordances Glicko needs: "Stop now" button (calls `stopEarly()`), "Keep going" button (calls `setTargetComparisons(currentDone + N)`), live `currentResult()` display.
- **Phase 4 — drop the 64-cap.** All three rankers handle N=1300+ correctly. SingleElim takes 1299 comparisons; Glicko stops whenever the user wants.
- **Phase 4.5 / 9 — D-3 LLM hook.** `Comparator` interface is the contract. `LLMSuggestionComparator` would call Anthropic API and return a Decision. The user-vote-always-wins invariant (D-3) is documented but not enforced in the contract; Phase 9 will add a `Suggester` interface separate from `Comparator` per the ranker-mathematician's R-7 recommendation.
- **D-6 follow-up (code-reviewer #1).** Snapshot deserialization currently validates only `version` + `algo`. Once snapshots travel through D-5 URL state in Phase 5, add Zod schemas at that IO edge. Tracked for Phase 5.
- **Phase 7 forward note.** All three ranker `serialize()` outputs are pure JSON. Ratings/eliminations/decisions audit trails are persisted; aggregation can extract per-tournament data without re-running the engine.

## State of the codebase

- TS test suite: **150 passing** (filter 83, ranker 66, web 1).
- Go test suite: unchanged.
- `make all`: green.
- Next.js production build: clean, `/pick` 5.25 kB.
- Live SQLite: 1350 pokémon, 1025 species, ready for Phase 4.

## Aggregate verdict

**Approve.** Phase 3 closes; Phase 4 (proper UI — algorithm dropdown, full filter sidebar, Vibes mode toggle, audio cry, top-N podium, share) may begin.
