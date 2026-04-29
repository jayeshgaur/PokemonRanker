// GlickoRandomRanker: anytime ranker built on Glicko-1 ratings (Mark E.
// Glickman, 1995). Each comparison is a one-game rating period. Pair
// selection is uniformly random with a deterministic seed (so the run
// is reproducible across serialize/deserialize). The user can stop at
// any time and get the current ranking sorted by rating — this is the
// answer to the user's "I want it to feel snappy, not exhaustive"
// complaint.
//
// Glicko-1 update formulas (per Glickman):
//
//   q   = ln(10) / 400
//   g(RD) = 1 / sqrt(1 + 3q²·RD² / π²)
//   E(R, Rᵢ, RDᵢ) = 1 / (1 + 10^(-g(RDᵢ)·(R - Rᵢ) / 400))
//
// After one game with score s ∈ {0, 0.5, 1}:
//
//   d² = 1 / (q² · g(RDᵢ)² · E · (1 - E))
//   new RD = sqrt( 1 / (1/RD² + 1/d²) )
//   new R  = R + (q / (1/RD² + 1/d²)) · g(RDᵢ) · (s - E)
//
// Both players' ratings update *simultaneously* using the original (pre-
// update) values of the other player.
//
// Tie semantics. `draw` ⇒ score = 0.5 for both (the rating-system meaning of
// a draw). `skip` ⇒ no rating update; pair is regenerated for the next call
// (comparisonsDone advances so the seeded PRNG produces a new pair).

import type { Pokemon } from "@pokemon-ranker/shared";
import type {
  Decision,
  Duel,
  Progress,
  Ranker,
  RankerKind,
  Ranking,
} from "./types";

const Q = Math.LN10 / 400; // ≈ 0.005756462732485
const DEFAULT_R = 1500;
const DEFAULT_RD = 350;

export interface GlickoOptions {
  // Stop-early threshold on number of comparisons. Default = 5n. UI can
  // override or call `stopEarly()`.
  targetComparisons?: number;
  // Initial seed for the PRNG. Defaults to a hash of pool ids so two
  // identical pools produce identical first-pair sequences.
  seed?: number;
  initialR?: number;
  initialRD?: number;
}

interface RatingRow {
  id: number;
  r: number;
  rd: number;
}

interface GlickoState {
  version: 1;
  algo: "glicko-random";
  ids: number[];
  ratings: RatingRow[];
  seed: number;
  // Cached current pair so `nextDuel()` is idempotent before submit.
  currentPair: { left: number; right: number } | null;
  comparisonsDone: number;
  targetComparisons: number;
  forcedStop: boolean;
  decisions: Decision[];
}

export class GlickoRandomRanker implements Ranker {
  readonly kind: RankerKind = "glicko-random";
  private state: GlickoState;
  private byId: Map<number, Pokemon>;

  constructor(pool: readonly Pokemon[], opts: GlickoOptions = {}) {
    const ids = pool.map((p) => p.id);
    this.byId = new Map(pool.map((p) => [p.id, p]));
    const initR = opts.initialR ?? DEFAULT_R;
    const initRD = opts.initialRD ?? DEFAULT_RD;
    this.state = {
      version: 1,
      algo: "glicko-random",
      ids,
      ratings: ids.map((id) => ({ id, r: initR, rd: initRD })),
      seed: opts.seed ?? hashIds(ids),
      currentPair: null,
      comparisonsDone: 0,
      targetComparisons: opts.targetComparisons ?? Math.max(0, 5 * ids.length),
      forcedStop: false,
      decisions: [],
    };
  }

  static deserialize(
    serialized: string,
    pool: readonly Pokemon[],
  ): GlickoRandomRanker {
    const state = JSON.parse(serialized) as GlickoState;
    if (state.version !== 1 || state.algo !== "glicko-random") {
      throw new Error("incompatible serialized ranker state");
    }
    const byId = new Map(pool.map((p) => [p.id, p]));
    for (const id of state.ids) {
      if (!byId.has(id)) {
        throw new Error(`pool missing pokemon id=${id} from serialized state`);
      }
    }
    const inst = new GlickoRandomRanker([]);
    inst.state = state;
    inst.byId = byId;
    return inst;
  }

  serialize(): string {
    return JSON.stringify(this.state);
  }

  isDone(): boolean {
    if (this.state.ids.length < 2) return true;
    if (this.state.forcedStop) return true;
    return this.state.comparisonsDone >= this.state.targetComparisons;
  }

  nextDuel(): Duel | null {
    if (this.isDone()) return null;
    if (!this.state.currentPair) {
      const pair = this.pickPair();
      if (!pair) return null;
      this.state.currentPair = { left: pair[0], right: pair[1] };
    }
    const left = this.byId.get(this.state.currentPair.left);
    const right = this.byId.get(this.state.currentPair.right);
    if (!left || !right) {
      throw new Error("pool missing pokemon for current duel");
    }
    return { left, right };
  }

  submit(decision: Decision): void {
    if (this.isDone()) {
      throw new Error("submit called on a completed ranker");
    }
    if (!this.state.currentPair) {
      // Match the strict contract of MergeSort and SingleElim: callers
      // must call nextDuel() before submit(). Silent recovery would mask
      // picker bugs (per Phase 3 code-reviewer recommendation).
      throw new Error("submit called without an active duel — call nextDuel() first");
    }
    const leftId = this.state.currentPair.left;
    const rightId = this.state.currentPair.right;

    if (decision === "skip") {
      // No rating update; advance comparisonsDone so the PRNG yields a fresh
      // pair next time.
      this.state.currentPair = null;
      this.state.decisions.push(decision);
      this.state.comparisonsDone++;
      return;
    }

    let scoreLeft: number;
    switch (decision) {
      case "left_wins":
        scoreLeft = 1;
        break;
      case "right_wins":
        scoreLeft = 0;
        break;
      case "draw":
        scoreLeft = 0.5;
        break;
    }

    const leftRow = this.findRating(leftId);
    const rightRow = this.findRating(rightId);
    // Use ORIGINAL ratings for both updates.
    const newLeft = updateRating(
      leftRow.r,
      leftRow.rd,
      rightRow.r,
      rightRow.rd,
      scoreLeft,
    );
    const newRight = updateRating(
      rightRow.r,
      rightRow.rd,
      leftRow.r,
      leftRow.rd,
      1 - scoreLeft,
    );
    leftRow.r = newLeft.r;
    leftRow.rd = newLeft.rd;
    rightRow.r = newRight.r;
    rightRow.rd = newRight.rd;

    this.state.comparisonsDone++;
    this.state.decisions.push(decision);
    this.state.currentPair = null;
  }

  progress(): Progress {
    const total = this.state.targetComparisons;
    const done = this.state.comparisonsDone;
    const fraction = total === 0 ? 1 : Math.min(1, done / total);
    return { done, total, fraction };
  }

  result(): Ranking | null {
    if (!this.isDone()) return null;
    return this.snapshotRanking();
  }

  // Anytime hook: ranking sorted by current rating, available before isDone.
  currentResult(): Ranking | null {
    if (this.state.ids.length === 0) return { ordered: [] };
    return this.snapshotRanking();
  }

  // UI affordance: user clicked "show me my ranking" without finishing.
  // Sets forcedStop so isDone() flips true and result() unlocks.
  stopEarly(): void {
    this.state.forcedStop = true;
  }

  // Allow the UI to extend the run if the user wants more confidence.
  setTargetComparisons(target: number): void {
    if (target < this.state.comparisonsDone) {
      throw new Error("target cannot be less than comparisons already done");
    }
    this.state.targetComparisons = target;
    this.state.forcedStop = false;
  }

  private snapshotRanking(): Ranking {
    const sorted = [...this.state.ratings].sort((a, b) => {
      if (b.r !== a.r) return b.r - a.r;
      return a.id - b.id;
    });
    return {
      ordered: sorted.map((row, idx) => {
        const p = this.byId.get(row.id);
        if (!p) throw new Error(`missing pokemon id=${row.id}`);
        return { rank: idx + 1, pokemon: p };
      }),
    };
  }

  private findRating(id: number): RatingRow {
    const row = this.state.ratings.find((r) => r.id === id);
    if (!row) throw new Error(`no rating for id=${id}`);
    return row;
  }

  // Pick two distinct ids deterministically from comparisonsDone + seed.
  // Weighted by RD² so we focus duels on the players the system is most
  // uncertain about — this is what makes Glicko-with-budget converge well
  // (per Phase 3 ranker-mathematician review R-4).
  private pickPair(): [number, number] | null {
    const ratings = this.state.ratings;
    if (ratings.length < 2) return null;
    const rng = mulberry32(
      this.state.seed + this.state.comparisonsDone * 0x9e3779b1,
    );

    // First selection: weighted by RD².
    const aIdx = pickWeighted(ratings.map((r) => r.rd * r.rd), rng());
    // Second selection: weighted by RD² over the remaining ids.
    const remainingWeights = ratings.map((r, i) =>
      i === aIdx ? 0 : r.rd * r.rd,
    );
    let bIdx = pickWeighted(remainingWeights, rng());
    if (bIdx === aIdx) {
      // Defensive fallback: shouldn't happen because aIdx's weight is 0,
      // but guards against degenerate "all RDs identical and equal to 0"
      // states (would only arise post-stopEarly with extreme convergence).
      bIdx = (aIdx + 1) % ratings.length;
    }
    return [ratings[aIdx]!.id, ratings[bIdx]!.id];
  }
}

// Pick an index from `weights` with probability proportional to its weight.
// `r` is a uniform sample in [0, 1). Falls back to the first non-zero index
// (or 0 if all zero) when the cumulative weight is 0.
function pickWeighted(weights: number[], r: number): number {
  let total = 0;
  for (const w of weights) total += w;
  if (total <= 0) {
    for (let i = 0; i < weights.length; i++) {
      if (weights[i]! > 0) return i;
    }
    return 0;
  }
  const target = r * total;
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i]!;
    if (target < acc) return i;
  }
  return weights.length - 1;
}

// --- Glicko-1 math --------------------------------------------------------

export function glickoG(rd: number): number {
  return 1 / Math.sqrt(1 + (3 * Q * Q * rd * rd) / (Math.PI * Math.PI));
}

export function glickoExpectation(
  r: number,
  rOpp: number,
  rdOpp: number,
): number {
  return 1 / (1 + 10 ** ((-glickoG(rdOpp) * (r - rOpp)) / 400));
}

export function updateRating(
  r: number,
  rd: number,
  rOpp: number,
  rdOpp: number,
  score: number,
): { r: number; rd: number } {
  const gOpp = glickoG(rdOpp);
  const E = glickoExpectation(r, rOpp, rdOpp);
  // Guard against degenerate E ∈ {0, 1} when ratings differ wildly: dSquared
  // would explode/divide-by-zero. Clamp E away from the singularities.
  const safeE = Math.max(1e-9, Math.min(1 - 1e-9, E));
  const dSquared = 1 / (Q * Q * gOpp * gOpp * safeE * (1 - safeE));
  const inv = 1 / (rd * rd) + 1 / dSquared;
  const newRD = Math.sqrt(1 / inv);
  const newR = r + (Q / inv) * gOpp * (score - E);
  return { r: newR, rd: newRD };
}

// --- PRNG -----------------------------------------------------------------

// Mulberry32: small, fast, non-cryptographic 32-bit PRNG. Sufficient for
// pair selection determinism. Period 2^32.
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashIds(ids: readonly number[]): number {
  let h = 2166136261 >>> 0;
  for (const id of ids) {
    h = Math.imul(h ^ id, 16777619) >>> 0;
  }
  return h >>> 0;
}
