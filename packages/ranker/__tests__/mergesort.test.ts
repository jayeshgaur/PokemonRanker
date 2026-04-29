import { describe, expect, it } from "vitest";
import type { Pokemon } from "@pokemon-ranker/shared";
import { MergeSortComparator, type Decision } from "../src/index.js";

function pkmn(id: number): Pokemon {
  return {
    id,
    speciesId: id,
    formId: id,
    slug: `p-${id}`,
    displayName: `P${id}`,
    generationId: 1,
    isDefault: true,
    types: ["normal"],
    stats: {
      hp: 50,
      attack: 50,
      defense: 50,
      specialAttack: 50,
      specialDefense: 50,
      speed: 50,
    },
    spriteUrl: "",
    shinySpriteUrl: "",
    officialArtworkUrl: "",
    cryUrl: "",
    pokedexDbUrl: "",
    tags: [],
    isMega: false,
    isGmax: false,
    isBattleOnly: false,
    isRegionalVariant: false,
    isLegendary: false,
    isMythical: false,
    isBaby: false,
    evolutionStage: "final",
  };
}

// Run a comparator to completion against a "true rank" oracle: lower trueRank
// is preferred. Returns the final ordered IDs.
function runToCompletion(
  pool: Pokemon[],
  trueRank: Map<number, number>,
  pickDecision?: (left: number, right: number) => Decision,
): number[] {
  const ranker = new MergeSortComparator(pool);
  let safety = 100_000;
  while (!ranker.isDone()) {
    const duel = ranker.nextDuel();
    if (!duel) break;
    const lr = trueRank.get(duel.left.id)!;
    const rr = trueRank.get(duel.right.id)!;
    const decision: Decision =
      pickDecision?.(duel.left.id, duel.right.id) ??
      (lr < rr ? "left_wins" : rr < lr ? "right_wins" : "draw");
    ranker.submit(decision);
    if (--safety === 0) throw new Error("ranker did not converge");
  }
  const r = ranker.result();
  if (!r) throw new Error("done but no result");
  return r.ordered.map((x) => x.pokemon.id);
}

describe("MergeSortComparator", () => {
  it("handles n=0 (empty pool)", () => {
    const r = new MergeSortComparator([]);
    expect(r.isDone()).toBe(true);
    expect(r.nextDuel()).toBeNull();
    expect(r.result()?.ordered).toEqual([]);
  });

  it("handles n=1 (single pokemon)", () => {
    const r = new MergeSortComparator([pkmn(7)]);
    expect(r.isDone()).toBe(true);
    expect(r.nextDuel()).toBeNull();
    expect(r.result()?.ordered.map((x) => x.pokemon.id)).toEqual([7]);
  });

  it("handles n=2 with one comparison", () => {
    const r = new MergeSortComparator([pkmn(1), pkmn(2)]);
    expect(r.isDone()).toBe(false);
    const d = r.nextDuel()!;
    expect([d.left.id, d.right.id]).toEqual([1, 2]);
    r.submit("right_wins");
    expect(r.isDone()).toBe(true);
    expect(r.result()?.ordered.map((x) => x.pokemon.id)).toEqual([2, 1]);
  });

  it("ranks a known total order correctly (small)", () => {
    // True rank: id=4 best, then 1, 3, 2, 5 worst.
    const ids = [1, 2, 3, 4, 5];
    const trueRank = new Map([
      [4, 0],
      [1, 1],
      [3, 2],
      [2, 3],
      [5, 4],
    ]);
    const result = runToCompletion(
      ids.map(pkmn),
      trueRank,
    );
    expect(result).toEqual([4, 1, 3, 2, 5]);
  });

  it("ranks 32 randomized total orders correctly (property test)", () => {
    for (let trial = 0; trial < 32; trial++) {
      const n = 4 + Math.floor(Math.random() * 12); // n in [4, 15]
      const ids = Array.from({ length: n }, (_, i) => i + 1);
      // Shuffle ids to randomize input order, then assign random true ranks.
      const shuffledIds = [...ids].sort(() => Math.random() - 0.5);
      const ranks = [...ids].sort(() => Math.random() - 0.5);
      const trueRank = new Map<number, number>();
      shuffledIds.forEach((id, i) => trueRank.set(id, ranks[i]!));
      const result = runToCompletion(
        shuffledIds.map(pkmn),
        trueRank,
      );
      const expected = [...shuffledIds].sort(
        (a, b) => trueRank.get(a)! - trueRank.get(b)!,
      );
      expect(result).toEqual(expected);
    }
  });

  it("respects the comparison upper bound n*ceil(log2(n))", () => {
    const n = 8;
    const ids = Array.from({ length: n }, (_, i) => i + 1);
    // worst case: alternating preferences (already sorted descending then we
    // request ascending so every merge step uses every comparison).
    const trueRank = new Map(ids.map((id, idx) => [id, n - idx]));
    const ranker = new MergeSortComparator(ids.map(pkmn));
    let comparisons = 0;
    while (!ranker.isDone()) {
      const d = ranker.nextDuel()!;
      const lr = trueRank.get(d.left.id)!;
      const rr = trueRank.get(d.right.id)!;
      ranker.submit(lr < rr ? "left_wins" : "right_wins");
      comparisons++;
    }
    const upper = n * Math.ceil(Math.log2(n));
    expect(comparisons).toBeLessThanOrEqual(upper);
    const prog = ranker.progress();
    expect(prog.done).toBe(comparisons);
    expect(prog.fraction).toBeLessThanOrEqual(1);
  });

  it("serialize/deserialize round-trip preserves state mid-flight", () => {
    const pool = [1, 2, 3, 4, 5, 6].map(pkmn);
    const trueRank = new Map([
      [3, 0],
      [1, 1],
      [5, 2],
      [2, 3],
      [6, 4],
      [4, 5],
    ]);
    const a = new MergeSortComparator(pool);
    // submit a couple of decisions
    for (let i = 0; i < 3 && !a.isDone(); i++) {
      const d = a.nextDuel()!;
      const lr = trueRank.get(d.left.id)!;
      const rr = trueRank.get(d.right.id)!;
      a.submit(lr < rr ? "left_wins" : "right_wins");
    }

    const snapshot = a.serialize();
    const b = MergeSortComparator.deserialize(snapshot, pool);

    // Both should have identical state.
    expect(b.serialize()).toBe(snapshot);
    expect(b.progress()).toEqual(a.progress());
    expect(b.isDone()).toBe(a.isDone());
    if (!b.isDone()) {
      const da = a.nextDuel()!;
      const db = b.nextDuel()!;
      expect([db.left.id, db.right.id]).toEqual([da.left.id, da.right.id]);
    }

    // Drive both to completion in lockstep — final rankings must match.
    while (!a.isDone()) {
      const da = a.nextDuel()!;
      const lr = trueRank.get(da.left.id)!;
      const rr = trueRank.get(da.right.id)!;
      const decision: Decision = lr < rr ? "left_wins" : "right_wins";
      a.submit(decision);
      b.submit(decision);
    }
    expect(b.result()).toEqual(a.result());
  });

  it("treats draw as left-first (stable)", () => {
    const r = new MergeSortComparator([pkmn(1), pkmn(2)]);
    r.submit("draw");
    expect(r.result()?.ordered.map((x) => x.pokemon.id)).toEqual([1, 2]);
  });

  it("skip is deterministic across serialize/deserialize", () => {
    const pool = [1, 2, 3, 4].map(pkmn);
    const a = new MergeSortComparator(pool);
    a.submit("skip");
    const snap = a.serialize();
    const b = MergeSortComparator.deserialize(snap, pool);
    // Same next duel after the skip submit.
    expect(b.nextDuel()).toEqual(a.nextDuel());
  });

  it("rejects deserialize when pool is missing referenced ids", () => {
    const pool = [1, 2].map(pkmn);
    const a = new MergeSortComparator(pool);
    const snap = a.serialize();
    expect(() =>
      MergeSortComparator.deserialize(snap, [pkmn(99)]),
    ).toThrowError(/missing pokemon/);
  });

  it("rejects deserialize for incompatible state shape", () => {
    expect(() =>
      MergeSortComparator.deserialize(
        JSON.stringify({ version: 99, algo: "elgreco" }),
        [],
      ),
    ).toThrowError(/incompatible/);
  });
});
