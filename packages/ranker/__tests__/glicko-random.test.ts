import { describe, expect, it } from "vitest";
import {
  GlickoRandomRanker,
  glickoExpectation,
  glickoG,
  updateRating,
  type Decision,
} from "../src/index";
import { pkmn, pool } from "./_fixture";

// Helper: nextDuel + submit, since the strict contract requires nextDuel
// before each submit (per code-reviewer review item).
function vote(r: GlickoRandomRanker, decision: Decision): void {
  r.nextDuel();
  r.submit(decision);
}

describe("Glicko-1 math", () => {
  it("g(RD) decreases monotonically with RD", () => {
    expect(glickoG(0)).toBeGreaterThan(glickoG(50));
    expect(glickoG(50)).toBeGreaterThan(glickoG(200));
    expect(glickoG(200)).toBeGreaterThan(glickoG(350));
  });

  it("E(R, R, RD) === 0.5 when ratings are equal", () => {
    expect(glickoExpectation(1500, 1500, 350)).toBeCloseTo(0.5, 12);
  });

  it("E increases as own rating exceeds opponent", () => {
    const a = glickoExpectation(1500, 1500, 50);
    const b = glickoExpectation(1700, 1500, 50);
    const c = glickoExpectation(2000, 1500, 50);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  it("winner's rating goes up; loser's rating goes down", () => {
    const winner = updateRating(1500, 200, 1500, 200, 1);
    const loser = updateRating(1500, 200, 1500, 200, 0);
    expect(winner.r).toBeGreaterThan(1500);
    expect(loser.r).toBeLessThan(1500);
  });

  it("RD always decreases or stays the same after a comparison", () => {
    const before = 200;
    const after = updateRating(1500, before, 1500, before, 1).rd;
    expect(after).toBeLessThanOrEqual(before);
  });

  it("draw moves both ratings toward each other", () => {
    const high = updateRating(1700, 200, 1500, 200, 0.5); // high player draws weaker
    const low = updateRating(1500, 200, 1700, 200, 0.5);
    expect(high.r).toBeLessThan(1700);
    expect(low.r).toBeGreaterThan(1500);
  });

  it("update is symmetric: winner-vs-loser produces equal-and-opposite shifts (approx)", () => {
    // Equal initial RDs ⇒ update magnitudes should be approximately mirrored.
    const w = updateRating(1500, 200, 1500, 200, 1);
    const l = updateRating(1500, 200, 1500, 200, 0);
    expect(w.r - 1500).toBeCloseTo(1500 - l.r, 6);
  });

  it("draw at equal ratings leaves R unchanged (closes ranker-mathematician test gap)", () => {
    const result = updateRating(1500, 200, 1500, 200, 0.5);
    expect(result.r).toBeCloseTo(1500, 6);
    // RD should still decrease (information was gained even from a draw).
    expect(result.rd).toBeLessThan(200);
  });

  it("extreme rating gap: clamp keeps update finite and signed correctly", () => {
    // 2500 vs 1000, opponent's expected score ≈ 0 ⇒ winning is "expected"
    // and barely moves the high player's rating; losing would crash it.
    const expectedWin = updateRating(2500, 50, 1000, 50, 1);
    const upset = updateRating(2500, 50, 1000, 50, 0);
    expect(Number.isFinite(expectedWin.r)).toBe(true);
    expect(Number.isFinite(upset.r)).toBe(true);
    // The expected win moves the high player up only slightly.
    expect(expectedWin.r - 2500).toBeLessThan(5);
    // The upset moves the high player DOWN.
    expect(upset.r).toBeLessThan(2500);
  });
});

describe("GlickoRandomRanker", () => {
  it("kind is 'glicko-random'", () => {
    expect(new GlickoRandomRanker([]).kind).toBe("glicko-random");
  });

  it("handles n=0 / n=1 (immediately done)", () => {
    expect(new GlickoRandomRanker([]).isDone()).toBe(true);
    expect(new GlickoRandomRanker([pkmn(7)]).isDone()).toBe(true);
    expect(new GlickoRandomRanker([pkmn(7)]).result()?.ordered.length).toBe(1);
  });

  it("nextDuel returns the same pair on repeated calls before submit", () => {
    const r = new GlickoRandomRanker(pool([1, 2, 3]), { seed: 12345 });
    const a = r.nextDuel()!;
    const b = r.nextDuel()!;
    expect([a.left.id, a.right.id]).toEqual([b.left.id, b.right.id]);
  });

  it("nextDuel never returns a self-pair", () => {
    const r = new GlickoRandomRanker(pool([1, 2, 3]), {
      seed: 999,
      targetComparisons: 30,
    });
    while (!r.isDone()) {
      const d = r.nextDuel()!;
      expect(d.left.id).not.toBe(d.right.id);
      r.submit("left_wins");
    }
  });

  it("submit advances comparisonsDone; isDone after target", () => {
    const r = new GlickoRandomRanker(pool([1, 2]), {
      seed: 1,
      targetComparisons: 3,
    });
    vote(r, "left_wins");
    expect(r.progress().done).toBe(1);
    vote(r, "right_wins");
    vote(r, "draw");
    expect(r.isDone()).toBe(true);
    expect(r.result()).not.toBeNull();
  });

  it("currentResult is available before isDone (anytime property)", () => {
    const r = new GlickoRandomRanker(pool([1, 2, 3]), {
      seed: 1,
      targetComparisons: 100,
    });
    vote(r, "left_wins");
    const ranking = r.currentResult();
    expect(ranking).not.toBeNull();
    expect(ranking!.ordered.length).toBe(3);
    expect(r.isDone()).toBe(false);
  });

  it("stopEarly flips isDone and result returns the current ranking", () => {
    const r = new GlickoRandomRanker(pool([1, 2, 3]), {
      seed: 1,
      targetComparisons: 1000,
    });
    vote(r, "left_wins");
    expect(r.isDone()).toBe(false);
    r.stopEarly();
    expect(r.isDone()).toBe(true);
    expect(r.result()).not.toBeNull();
  });

  it("setTargetComparisons can extend a stopped run", () => {
    const r = new GlickoRandomRanker(pool([1, 2]), {
      seed: 1,
      targetComparisons: 1,
    });
    vote(r, "left_wins");
    expect(r.isDone()).toBe(true);
    r.setTargetComparisons(5);
    expect(r.isDone()).toBe(false);
    for (let i = 0; i < 4; i++) vote(r, "left_wins");
    expect(r.isDone()).toBe(true);
  });

  it("setTargetComparisons rejects targets below comparisonsDone", () => {
    const r = new GlickoRandomRanker(pool([1, 2]));
    vote(r, "left_wins");
    vote(r, "left_wins");
    expect(() => r.setTargetComparisons(1)).toThrow();
  });

  it("skip does NOT update ratings but advances pair", () => {
    const r = new GlickoRandomRanker(pool([1, 2]), {
      seed: 1,
      targetComparisons: 5,
    });
    const before = r.currentResult()!.ordered.map((x) => x.pokemon.id);
    vote(r, "skip");
    const after = r.currentResult()!.ordered.map((x) => x.pokemon.id);
    expect(after).toEqual(before); // ratings unchanged ⇒ same order
    expect(r.progress().done).toBe(1);
  });

  it("converges to the correct top-1 with consistent decisions (n=4, 30 rounds)", () => {
    // Enforce a strict total order: id 1 beats everyone, id 2 beats {3,4}, etc.
    const trueRank = new Map([
      [1, 0],
      [2, 1],
      [3, 2],
      [4, 3],
    ]);
    const r = new GlickoRandomRanker(pool([1, 2, 3, 4]), {
      seed: 7,
      targetComparisons: 30,
    });
    while (!r.isDone()) {
      const d = r.nextDuel()!;
      const lr = trueRank.get(d.left.id)!;
      const rr = trueRank.get(d.right.id)!;
      r.submit(lr < rr ? "left_wins" : "right_wins");
    }
    const ordered = r.result()!.ordered.map((x) => x.pokemon.id);
    expect(ordered[0]).toBe(1); // best true rank ends up top
    expect(ordered[ordered.length - 1]).toBe(4); // worst at bottom
  });

  it("serialize/deserialize round-trip preserves state mid-flight", () => {
    const a = new GlickoRandomRanker(pool([1, 2, 3, 4, 5]), {
      seed: 42,
      targetComparisons: 10,
    });
    vote(a, "left_wins");
    vote(a, "right_wins");
    vote(a, "draw");
    const snap = a.serialize();
    const b = GlickoRandomRanker.deserialize(snap, pool([1, 2, 3, 4, 5]));
    expect(b.serialize()).toBe(snap);
    expect(b.progress()).toEqual(a.progress());
    expect(b.isDone()).toBe(a.isDone());
    expect(b.nextDuel()).toEqual(a.nextDuel());
  });

  it("rejects deserialize for missing pokemon ids", () => {
    const a = new GlickoRandomRanker(pool([1, 2]));
    const snap = a.serialize();
    expect(() =>
      GlickoRandomRanker.deserialize(snap, pool([99])),
    ).toThrow(/missing pokemon/);
  });

  it("submit before nextDuel throws (per code-reviewer #3)", () => {
    const r = new GlickoRandomRanker(pool([1, 2]), { targetComparisons: 5 });
    expect(() => r.submit("left_wins")).toThrow(/nextDuel/);
  });

  it("forcedStop survives serialize/deserialize", () => {
    const a = new GlickoRandomRanker(pool([1, 2, 3]), {
      seed: 1,
      targetComparisons: 100,
    });
    vote(a, "left_wins");
    a.stopEarly();
    const snap = a.serialize();
    const b = GlickoRandomRanker.deserialize(snap, pool([1, 2, 3]));
    expect(b.isDone()).toBe(true);
    expect(b.result()).not.toBeNull();
  });

  it("rejects deserialize for incompatible algo", () => {
    expect(() =>
      GlickoRandomRanker.deserialize(
        JSON.stringify({ version: 99, algo: "wrong" }),
        [],
      ),
    ).toThrow(/incompatible/);
  });
});
