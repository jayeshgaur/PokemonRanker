// Public surface of @pokemon-ranker/ranker.
//
// Three rankers (D-3 — pluggable algorithms behind one Ranker interface):
//
//   - MergeSortComparator  — true total ranking, ~n·log(n) comparisons.
//   - SingleElimRanker     — n-1 comparisons, top-1 + partial ranking.
//   - GlickoRandomRanker   — anytime, stop whenever, ranked by rating.
//
// The Phase 4 picker UI selects an algorithm via the `RankerKind`
// discriminator and `createRanker(kind, pool)`. Saved games are restored
// via `restoreRanker(snapshot, pool)` which reads the embedded `algo`
// field and dispatches to the right deserializer.
//
// LLM-augmentation hook (D-3): the `Comparator` interface in
// `./comparator` is what the Phase 9 LLM-driven decision provider will
// implement. The picker UI is itself a Comparator (the user is the
// picker). Today: only the user; tomorrow: agents.

import type { Pokemon } from "@pokemon-ranker/shared";
import type { Ranker, RankerKind } from "./types";
import { MergeSortComparator } from "./mergesort";
import { SingleElimRanker } from "./single-elim";
import { GlickoRandomRanker, type GlickoOptions } from "./glicko-random";

export type {
  Decision,
  Duel,
  Progress,
  RankedPokemon,
  Ranker,
  RankerKind,
  Ranking,
} from "./types";

export { MergeSortComparator } from "./mergesort";
export { SingleElimRanker } from "./single-elim";
export {
  GlickoRandomRanker,
  glickoG,
  glickoExpectation,
  updateRating,
  type GlickoOptions,
} from "./glicko-random";

export type { Comparator } from "./comparator";
export { runRanker } from "./comparator";

export interface CreateRankerOptions {
  glicko?: GlickoOptions;
}

// Factory. Constructs a fresh ranker for the chosen algorithm.
export function createRanker(
  kind: RankerKind,
  pool: readonly Pokemon[],
  opts: CreateRankerOptions = {},
): Ranker {
  switch (kind) {
    case "merge-sort":
      return new MergeSortComparator(pool);
    case "single-elim":
      return new SingleElimRanker(pool);
    case "glicko-random":
      return new GlickoRandomRanker(pool, opts.glicko);
  }
}

// Restore from a serialize() snapshot. Routes by the embedded `algo` field.
// Accepts the legacy `algo: "mergesort"` value (pre-Phase-3 saves).
export function restoreRanker(
  snapshot: string,
  pool: readonly Pokemon[],
): Ranker {
  let parsed: { algo?: unknown };
  try {
    parsed = JSON.parse(snapshot);
  } catch (err) {
    throw new Error(`restoreRanker: invalid JSON: ${(err as Error).message}`);
  }
  if (!parsed || typeof parsed !== "object" || typeof parsed.algo !== "string") {
    throw new Error("restoreRanker: missing 'algo' field");
  }
  switch (parsed.algo) {
    case "merge-sort":
    case "mergesort":
      return MergeSortComparator.deserialize(snapshot, pool);
    case "single-elim":
      return SingleElimRanker.deserialize(snapshot, pool);
    case "glicko-random":
      return GlickoRandomRanker.deserialize(snapshot, pool);
    default:
      throw new Error(`restoreRanker: unknown algo '${String(parsed.algo)}'`);
  }
}

// Human-readable algorithm metadata for the Phase 4 dropdown.
export interface RankerInfo {
  kind: RankerKind;
  name: string;
  shortDescription: string;
  comparisonsHint: (n: number) => string;
}

export const RANKER_INFO: readonly RankerInfo[] = [
  {
    kind: "merge-sort",
    name: "Tournament rank (Merge Sort)",
    shortDescription:
      "Builds a true total ranking through pairwise comparisons. Best for top-N.",
    comparisonsHint: (n) =>
      n <= 1 ? "0 comparisons" : `≈ ${n * Math.ceil(Math.log2(n))} comparisons`,
  },
  {
    kind: "single-elim",
    name: "Single elimination (fastest)",
    shortDescription:
      "Standard knockout bracket. One winner, fast — top-1 only is reliable.",
    comparisonsHint: (n) =>
      n <= 1 ? "0 comparisons" : `${n - 1} comparisons`,
  },
  {
    kind: "glicko-random",
    name: "Anytime ratings (Glicko)",
    shortDescription:
      "Random pairings build a Glicko rating. Stop whenever — see your top-N at any moment.",
    comparisonsHint: (n) =>
      n <= 1 ? "0 comparisons" : `up to ${5 * n} (stop early any time)`,
  },
];
