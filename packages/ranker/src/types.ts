// Shared types for all rankers (D-3 — pluggable algorithms behind one
// `Ranker` interface). Each algorithm implementation lives in its own file
// (mergesort.ts, single-elim.ts, glicko-random.ts) but conforms to this
// contract so the Phase 4 UI never reaches into ranker internals.

import type { Pokemon } from "@pokemon-ranker/shared";

export type Decision = "left_wins" | "right_wins" | "draw" | "skip";

export interface Duel {
  left: Pokemon;
  right: Pokemon;
}

export interface Progress {
  done: number;
  // Total upper-bound estimate. For finite-comparison rankers (mergesort,
  // single-elim) this is exact; for anytime rankers (glicko) it's a target.
  total: number;
  // Clamped to [0, 1].
  fraction: number;
}

export interface RankedPokemon {
  rank: number;
  pokemon: Pokemon;
}

export interface Ranking {
  ordered: RankedPokemon[];
}

// Shared algorithm discriminator. Persisted in the serialize() snapshot.
export type RankerKind = "merge-sort" | "single-elim" | "glicko-random";

export interface Ranker {
  kind: RankerKind;
  nextDuel(): Duel | null;
  submit(decision: Decision): void;
  progress(): Progress;
  // Final ranking when the ranker is done. For anytime rankers, callers can
  // also call result() before isDone() to get the current best estimate via
  // the optional currentResult() method.
  result(): Ranking | null;
  // Anytime rankers expose this for "stop early and show me the ranking
  // now." Finite rankers return null until isDone().
  currentResult?(): Ranking | null;
  isDone(): boolean;
  serialize(): string;
}
