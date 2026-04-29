import { describe, expect, it } from "vitest";
import type { Pokemon } from "@pokemon-ranker/shared";
import {
  and,
  applyNode,
  eligibleCountNode,
  isFilter,
  isFilterNode,
  leaf,
  matchesNode,
  not,
  or,
} from "../src/index.js";

function pkmn(over: Partial<Pokemon> & { id: number; slug: string }): Pokemon {
  return {
    speciesId: over.id,
    formId: over.id,
    displayName: over.slug,
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
    ...over,
  };
}

const pool: Pokemon[] = [
  pkmn({ id: 6, slug: "charizard", types: ["fire", "flying"] }),
  pkmn({ id: 9, slug: "blastoise", types: ["water"] }),
  pkmn({ id: 150, slug: "mewtwo", types: ["psychic"], isLegendary: true }),
  pkmn({ id: 151, slug: "mew", types: ["psychic"], isMythical: true }),
  pkmn({ id: 384, slug: "rayquaza", types: ["dragon", "flying"], isLegendary: true }),
];

describe("FilterNode constructors + applyNode", () => {
  it("leaf wraps a Filter and behaves like apply()", () => {
    const node = leaf({ typeSlugs: ["fire"], formInclusion: "all-forms" });
    expect(applyNode(node, pool).map((p) => p.slug)).toEqual(["charizard"]);
  });

  it("and: intersection of constraints", () => {
    const node = and(
      leaf({ formInclusion: "all-forms" }),
      leaf({ typeSlugs: ["psychic"] }),
      leaf({ isLegendary: true }),
    );
    expect(applyNode(node, pool).map((p) => p.slug)).toEqual(["mewtwo"]);
  });

  it("or: union of constraints (legendaries + mythicals)", () => {
    const node = or(
      leaf({ isLegendary: true, formInclusion: "all-forms" }),
      leaf({ isMythical: true, formInclusion: "all-forms" }),
    );
    expect(applyNode(node, pool).map((p) => p.slug).sort()).toEqual([
      "mew",
      "mewtwo",
      "rayquaza",
    ]);
  });

  it("not: negation of constraint", () => {
    // Everything that is NOT fire-typed.
    const node = and(
      leaf({ formInclusion: "all-forms" }),
      not(leaf({ typeSlugs: ["fire"] })),
    );
    expect(applyNode(node, pool).map((p) => p.slug).sort()).toEqual([
      "blastoise",
      "mew",
      "mewtwo",
      "rayquaza",
    ]);
  });

  it("De Morgan: not(or(A,B)) == and(not(A), not(B))", () => {
    const a = leaf({ typeSlugs: ["fire"] });
    const b = leaf({ typeSlugs: ["water"] });
    const left = and(
      leaf({ formInclusion: "all-forms" }),
      not(or(a, b)),
    );
    const right = and(
      leaf({ formInclusion: "all-forms" }),
      not(a),
      not(b),
    );
    const slugsLeft = applyNode(left, pool).map((p) => p.slug).sort();
    const slugsRight = applyNode(right, pool).map((p) => p.slug).sort();
    expect(slugsLeft).toEqual(slugsRight);
  });

  it("empty AND matches everything (vacuous truth)", () => {
    expect(applyNode(and(), pool).length).toBe(pool.length);
  });

  it("empty OR matches nothing", () => {
    expect(applyNode(or(), pool).length).toBe(0);
  });

  it("eligibleCountNode is consistent with applyNode().length", () => {
    const node = or(
      leaf({ typeSlugs: ["fire"], formInclusion: "all-forms" }),
      leaf({ typeSlugs: ["water"], formInclusion: "all-forms" }),
    );
    expect(eligibleCountNode(node, pool)).toBe(applyNode(node, pool).length);
  });

  it("applyNode accepts a bare Filter (auto-wraps as leaf)", () => {
    expect(
      applyNode({ typeSlugs: ["psychic"], formInclusion: "all-forms" }, pool)
        .map((p) => p.slug)
        .sort(),
    ).toEqual(["mew", "mewtwo"]);
  });

  it("matchesNode operates per-pokemon", () => {
    const node = leaf({ typeSlugs: ["fire"], formInclusion: "all-forms" });
    expect(matchesNode(node, pool[0]!)).toBe(true);   // charizard
    expect(matchesNode(node, pool[1]!)).toBe(false);  // blastoise
  });

  it("isFilter / isFilterNode discriminate correctly", () => {
    const f = { typeSlugs: ["fire"] };
    const n = leaf(f);
    expect(isFilterNode(n)).toBe(true);
    expect(isFilter(n)).toBe(false);
    expect(isFilter(f)).toBe(true);
    expect(isFilterNode(f)).toBe(false);
    expect(isFilter(null)).toBe(false);
  });
});
