// SingleElimRanker: single-elimination bracket. Exactly N-1 comparisons.
// Top-1 is the ranker's headline output; losers are partially ranked by
// elimination round (final loser → rank 2, semifinal losers → ranks 3-4, …).
// This is the answer to "I just want a winner, fast" — closes the user's
// "1300 comparisons is too tiring" complaint when paired with Phase 4's
// algorithm dropdown.
//
// BYE handling. When N is not a power of 2, we pad the bracket to the next
// power of 2 and assign BYEs to the first (K - N) slots in the layout, so
// no first-round pair contains two BYEs. Pairs with one BYE auto-advance
// the real competitor without consuming a comparison. Total real
// comparisons = N - 1. The bracket order is **shuffled deterministically**
// (Fisher-Yates seeded from hashIds(ids)) so that input order — typically
// pokedex number — does not give low-dex Pokémon systematic free passes
// (per Phase 3 ranker-mathematician review B-1).
//
// Loser ranking. Sort by elimination round descending; tie-break by
// **matches won before elimination** descending (a competitor who beat two
// opponents before losing in round 2 outranks a BYE-recipient who lost
// their first real match in round 2 with 0 wins) — per ranker-
// mathematician review B-2.
//
// Tie semantics. `draw` ⇒ left advances (deterministic, stable). `skip` ⇒
// deterministic side based on `comparisonsDone` parity (preserves
// resumability across serialize/deserialize). Same convention as MergeSort.

import type { Pokemon } from "@pokemon-ranker/shared";
import type {
  Decision,
  Duel,
  Progress,
  Ranker,
  RankerKind,
  RankedPokemon,
  Ranking,
} from "./types";

const BYE = -1;

interface SingleElimState {
  version: 2;
  algo: "single-elim";
  // Original input order (kept for deserialize pool validation).
  ids: number[];
  // Bracket-randomization seed. Persisted so deserialize reproduces.
  bracketSeed: number;
  // rounds[r] = slots in round r; -1 means BYE. rounds[0] is the initial
  // padded layout (post-shuffle). As rounds resolve, rounds.push(winners)
  // appends the next round.
  rounds: number[][];
  currentRound: number;
  // Index of the next pair to play within rounds[currentRound].
  currentMatch: number;
  pendingWinners: number[];
  // Loser-by-loser timeline for ranking.
  eliminations: { id: number; round: number }[];
  // Match wins per id, used for the rank-tie-break (B-2). BYEs never
  // increment this counter.
  matchesWon: Record<string, number>;
  comparisonsDone: number;
  decisions: Decision[];
  champion: number | null;
}

export class SingleElimRanker implements Ranker {
  readonly kind: RankerKind = "single-elim";
  private state: SingleElimState;
  private byId: Map<number, Pokemon>;

  constructor(pool: readonly Pokemon[]) {
    const ids = pool.map((p) => p.id);
    this.byId = new Map(pool.map((p) => [p.id, p]));
    if (ids.length === 0) {
      this.state = baseState(ids, 0);
      return;
    }
    const bracketSeed = hashIds(ids);
    if (ids.length === 1) {
      this.state = { ...baseState(ids, bracketSeed), champion: ids[0]! };
      return;
    }
    const shuffled = deterministicShuffle(ids, bracketSeed);
    this.state = {
      ...baseState(ids, bracketSeed),
      rounds: [buildInitialBracket(shuffled)],
    };
    this.advance();
  }

  static deserialize(
    serialized: string,
    pool: readonly Pokemon[],
  ): SingleElimRanker {
    const state = JSON.parse(serialized) as SingleElimState;
    if (state.version !== 2 || state.algo !== "single-elim") {
      throw new Error("incompatible serialized ranker state");
    }
    const byId = new Map(pool.map((p) => [p.id, p]));
    for (const id of state.ids) {
      if (!byId.has(id)) {
        throw new Error(`pool missing pokemon id=${id} from serialized state`);
      }
    }
    const inst = new SingleElimRanker([]);
    inst.state = state;
    inst.byId = byId;
    return inst;
  }

  serialize(): string {
    return JSON.stringify(this.state);
  }

  isDone(): boolean {
    return this.state.ids.length === 0 || this.state.champion !== null;
  }

  nextDuel(): Duel | null {
    if (this.isDone()) return null;
    const round = this.state.rounds[this.state.currentRound];
    if (!round) return null;
    const i = this.state.currentMatch * 2;
    const left = round[i];
    const right = round[i + 1];
    if (left === undefined || right === undefined) return null;
    if (left === BYE || right === BYE) {
      // advance() should have already auto-resolved this. If we land here
      // with a BYE pair, advance() has a bug — fail loudly rather than
      // silently corrupt state.
      throw new Error("internal: nextDuel called on a BYE pair");
    }
    const l = this.byId.get(left);
    const r = this.byId.get(right);
    if (!l || !r) {
      throw new Error("pool missing pokemon for current duel");
    }
    return { left: l, right: r };
  }

  submit(decision: Decision): void {
    if (this.isDone()) {
      throw new Error("submit called on a completed ranker");
    }
    const round = this.state.rounds[this.state.currentRound];
    if (!round) throw new Error("submit: no current round");
    const i = this.state.currentMatch * 2;
    const left = round[i];
    const right = round[i + 1];
    if (left === undefined || right === undefined) {
      throw new Error("submit: no pending match");
    }
    if (left === BYE || right === BYE) {
      throw new Error("submit called on a BYE pair");
    }

    let winner: number;
    let loser: number;
    switch (decision) {
      case "left_wins":
      case "draw":
        winner = left;
        loser = right;
        break;
      case "right_wins":
        winner = right;
        loser = left;
        break;
      case "skip":
        if (this.state.comparisonsDone % 2 === 0) {
          winner = left;
          loser = right;
        } else {
          winner = right;
          loser = left;
        }
        break;
    }

    this.state.pendingWinners.push(winner);
    this.state.eliminations.push({ id: loser, round: this.state.currentRound });
    this.state.matchesWon[String(winner)] =
      (this.state.matchesWon[String(winner)] ?? 0) + 1;
    this.state.comparisonsDone++;
    this.state.decisions.push(decision);
    this.state.currentMatch++;
    this.advance();
  }

  progress(): Progress {
    const total = Math.max(0, this.state.ids.length - 1);
    const done = this.state.comparisonsDone;
    const fraction = total === 0 ? 1 : Math.min(1, done / total);
    return { done, total, fraction };
  }

  result(): Ranking | null {
    if (!this.isDone()) return null;
    if (this.state.ids.length === 0) return { ordered: [] };
    const ordered: RankedPokemon[] = [];
    if (this.state.champion !== null) {
      const champ = this.byId.get(this.state.champion);
      if (!champ) throw new Error(`missing pokemon id=${this.state.champion}`);
      ordered.push({ rank: 1, pokemon: champ });
    }
    // Sort eliminations: later round = better rank; tie-break by matches
    // won before elimination (descending — more wins = better rank), then
    // by original input order (stable, deterministic). Per ranker-
    // mathematician review B-2.
    const inputIndex = new Map<number, number>();
    this.state.ids.forEach((id, idx) => inputIndex.set(id, idx));
    const winsOf = (id: number): number =>
      this.state.matchesWon[String(id)] ?? 0;
    const sortedElims = [...this.state.eliminations].sort((a, b) => {
      if (a.round !== b.round) return b.round - a.round;
      const wa = winsOf(a.id);
      const wb = winsOf(b.id);
      if (wa !== wb) return wb - wa;
      return (inputIndex.get(a.id) ?? 0) - (inputIndex.get(b.id) ?? 0);
    });
    let nextRank = 2;
    for (const elim of sortedElims) {
      const p = this.byId.get(elim.id);
      if (!p) throw new Error(`missing pokemon id=${elim.id}`);
      ordered.push({ rank: nextRank++, pokemon: p });
    }
    return { ordered };
  }

  // Skip past auto-advance (BYE) pairs and finalize finished rounds. After
  // this returns, either isDone() is true or nextDuel() points at a real
  // real-vs-real pair.
  private advance(): void {
    while (true) {
      if (this.isDone()) return;
      const round = this.state.rounds[this.state.currentRound];
      if (!round) return;
      while (this.state.currentMatch * 2 + 1 < round.length) {
        const i = this.state.currentMatch * 2;
        const left = round[i]!;
        const right = round[i + 1]!;
        if (left !== BYE && right !== BYE) return; // real-vs-real, wait for submit
        if (left === BYE && right === BYE) {
          this.state.pendingWinners.push(BYE);
        } else if (left === BYE) {
          this.state.pendingWinners.push(right);
        } else {
          this.state.pendingWinners.push(left);
        }
        this.state.currentMatch++;
      }
      // Round consumed. Promote winners to next round.
      const winners = this.state.pendingWinners.filter((w) => w !== BYE);
      this.state.pendingWinners = [];
      if (winners.length === 0) {
        this.state.champion = this.state.ids[0] ?? null;
        return;
      }
      if (winners.length === 1) {
        this.state.champion = winners[0]!;
        return;
      }
      this.state.rounds.push(winners);
      this.state.currentRound++;
      this.state.currentMatch = 0;
    }
  }
}

function baseState(ids: number[], bracketSeed: number): SingleElimState {
  return {
    version: 2,
    algo: "single-elim",
    ids,
    bracketSeed,
    rounds: [],
    currentRound: 0,
    currentMatch: 0,
    pendingWinners: [],
    eliminations: [],
    matchesWon: {},
    comparisonsDone: 0,
    decisions: [],
    champion: null,
  };
}

// Fisher-Yates shuffle, seeded for reproducibility. Same seed ⇒ same
// permutation. Each permutation has equal probability under a fair PRNG.
function deterministicShuffle(ids: readonly number[], seed: number): number[] {
  const out = ids.slice();
  const rng = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

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

// Build the round-0 layout. K = next power of 2 ≥ N. The first (K - N)
// pairs each take one real competitor and one BYE; the remaining pairs are
// real-vs-real. Guarantees no first-round pair contains two BYEs.
function buildInitialBracket(ids: number[]): number[] {
  const n = ids.length;
  if (n < 2) return ids.slice();
  const k = nextPow2(n);
  const byes = k - n;
  const slots: number[] = [];
  let next = 0;
  for (let i = 0; i < k / 2; i++) {
    if (i < byes) {
      slots.push(ids[next++]!, BYE);
    } else {
      slots.push(ids[next++]!, ids[next++]!);
    }
  }
  return slots;
}

function nextPow2(n: number): number {
  return 2 ** Math.ceil(Math.log2(n));
}
