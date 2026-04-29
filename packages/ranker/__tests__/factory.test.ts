import { describe, expect, it } from "vitest";
import {
  createRanker,
  GlickoRandomRanker,
  MergeSortComparator,
  RANKER_INFO,
  restoreRanker,
  runRanker,
  SingleElimRanker,
  type Decision,
  type Comparator,
} from "../src/index";
import { pool } from "./_fixture";

describe("createRanker", () => {
  it("returns a MergeSortComparator for 'merge-sort'", () => {
    const r = createRanker("merge-sort", pool([1, 2]));
    expect(r).toBeInstanceOf(MergeSortComparator);
    expect(r.kind).toBe("merge-sort");
  });
  it("returns a SingleElimRanker for 'single-elim'", () => {
    const r = createRanker("single-elim", pool([1, 2]));
    expect(r).toBeInstanceOf(SingleElimRanker);
    expect(r.kind).toBe("single-elim");
  });
  it("returns a GlickoRandomRanker for 'glicko-random'", () => {
    const r = createRanker("glicko-random", pool([1, 2]), {
      glicko: { seed: 1, targetComparisons: 5 },
    });
    expect(r).toBeInstanceOf(GlickoRandomRanker);
    expect(r.kind).toBe("glicko-random");
  });
});

describe("restoreRanker", () => {
  it("restores merge-sort by algo discriminator", () => {
    const original = createRanker("merge-sort", pool([1, 2, 3]));
    original.submit("left_wins");
    const restored = restoreRanker(original.serialize(), pool([1, 2, 3]));
    expect(restored.kind).toBe("merge-sort");
    expect(restored.serialize()).toBe(original.serialize());
  });

  it("restores single-elim by algo discriminator", () => {
    const original = createRanker("single-elim", pool([1, 2, 3]));
    original.submit("left_wins");
    const restored = restoreRanker(original.serialize(), pool([1, 2, 3]));
    expect(restored.kind).toBe("single-elim");
    expect(restored.serialize()).toBe(original.serialize());
  });

  it("restores glicko-random by algo discriminator", () => {
    const original = createRanker("glicko-random", pool([1, 2, 3]), {
      glicko: { seed: 1, targetComparisons: 10 },
    });
    original.nextDuel();
    original.submit("left_wins");
    const restored = restoreRanker(original.serialize(), pool([1, 2, 3]));
    expect(restored.kind).toBe("glicko-random");
    expect(restored.serialize()).toBe(original.serialize());
  });

  it("accepts the pre-Phase-3 'mergesort' algo string for backward compat", () => {
    const original = createRanker("merge-sort", pool([1, 2]));
    const snapshot = original.serialize().replace('"merge-sort"', '"mergesort"');
    const restored = restoreRanker(snapshot, pool([1, 2]));
    expect(restored.kind).toBe("merge-sort");
  });

  it("throws on invalid JSON", () => {
    expect(() => restoreRanker("not json", pool([1, 2]))).toThrow(/JSON/);
  });

  it("throws on missing algo field", () => {
    expect(() => restoreRanker(JSON.stringify({ foo: 1 }), pool([]))).toThrow(/algo/);
  });

  it("throws on unknown algo", () => {
    expect(() =>
      restoreRanker(JSON.stringify({ algo: "elgreco" }), pool([])),
    ).toThrow(/unknown algo/);
  });
});

describe("runRanker (Comparator integration)", () => {
  it("drives a ranker to completion via Comparator.pick", async () => {
    // Comparator that always picks the lower-id pokemon.
    const comparator: Comparator = {
      pick: (duel) => (duel.left.id < duel.right.id ? "left_wins" : "right_wins"),
    };
    const ranker = createRanker("merge-sort", pool([3, 1, 2, 4]));
    const ranking = await runRanker(ranker, comparator);
    expect(ranking?.ordered.map((x) => x.pokemon.id)).toEqual([1, 2, 3, 4]);
  });

  it("works with an async Comparator", async () => {
    const comparator: Comparator = {
      pick: async (duel) =>
        new Promise<Decision>((resolve) =>
          setTimeout(() => resolve(duel.left.id < duel.right.id ? "left_wins" : "right_wins"), 0),
        ),
    };
    const ranker = createRanker("single-elim", pool([3, 1, 2]));
    const ranking = await runRanker(ranker, comparator);
    expect(ranking?.ordered[0]?.pokemon.id).toBe(1);
  });
});

describe("RANKER_INFO", () => {
  it("has one entry per RankerKind, in canonical order", () => {
    expect(RANKER_INFO.map((i) => i.kind)).toEqual([
      "merge-sort",
      "single-elim",
      "glicko-random",
    ]);
  });
  it("comparisonsHint produces a non-empty string for any reasonable n", () => {
    for (const info of RANKER_INFO) {
      expect(info.comparisonsHint(0)).toBeTruthy();
      expect(info.comparisonsHint(8)).toBeTruthy();
      expect(info.comparisonsHint(150)).toBeTruthy();
    }
  });
});
