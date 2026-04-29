import { describe, expect, it } from "vitest";
import type { EvolutionStage, Pokemon } from "@pokemon-ranker/shared";
import {
  apply,
  canonicalKey,
  DEFAULT_FORM_INCLUSION,
  effectiveFormInclusion,
  eligibleCount,
  emptyFilter,
  isEmpty,
  matches,
  parseFilter,
  toSearchParams,
} from "../src/index.js";

function pkmn(over: Partial<Pokemon> & { id: number; slug: string }): Pokemon {
  return {
    speciesId: over.id,
    formId: over.id,
    displayName: over.slug.replace(/-/g, " "),
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

// Pool covering every primitive: stages, megas, regional variants, BST band,
// stat outliers, legendary/mythical/baby, tags.
const bulbasaur = pkmn({
  id: 1,
  slug: "bulbasaur",
  types: ["grass", "poison"],
  tags: ["starter"],
  evolutionStage: "first" as EvolutionStage,
  stats: { hp: 45, attack: 49, defense: 49, specialAttack: 65, specialDefense: 65, speed: 45 },
});
const ivysaur = pkmn({
  id: 2,
  slug: "ivysaur",
  types: ["grass", "poison"],
  evolutionStage: "middle",
  stats: { hp: 60, attack: 62, defense: 63, specialAttack: 80, specialDefense: 80, speed: 60 },
});
const venusaur = pkmn({
  id: 3,
  slug: "venusaur",
  types: ["grass", "poison"],
  evolutionStage: "final",
  stats: { hp: 80, attack: 82, defense: 83, specialAttack: 100, specialDefense: 100, speed: 80 },
});
const charmander = pkmn({
  id: 4,
  slug: "charmander",
  types: ["fire"],
  tags: ["starter"],
  evolutionStage: "first",
  stats: { hp: 39, attack: 52, defense: 43, specialAttack: 60, specialDefense: 50, speed: 65 },
});
const charizard = pkmn({
  id: 6,
  slug: "charizard",
  types: ["fire", "flying"],
  evolutionStage: "final",
  stats: { hp: 78, attack: 84, defense: 78, specialAttack: 109, specialDefense: 85, speed: 100 },
});
const charizardMegaX = pkmn({
  id: 10034,
  slug: "charizard-mega-x",
  types: ["fire", "dragon"],
  isDefault: false,
  isMega: true,
  isBattleOnly: true,
  evolutionStage: "final",
  tags: ["mega"],
  stats: { hp: 78, attack: 130, defense: 111, specialAttack: 130, specialDefense: 85, speed: 100 },
});
const charizardGmax = pkmn({
  id: 10365,
  slug: "charizard-gmax",
  types: ["fire", "flying"],
  isDefault: false,
  isGmax: true,
  isBattleOnly: true,
  evolutionStage: "final",
  tags: ["gmax"],
});
const pikachu = pkmn({
  id: 25,
  slug: "pikachu",
  types: ["electric"],
  evolutionStage: "middle",
});
const raichu = pkmn({
  id: 26,
  slug: "raichu",
  types: ["electric"],
  evolutionStage: "final",
});
const raichuAlola = pkmn({
  id: 10100,
  slug: "raichu-alola",
  types: ["electric", "psychic"],
  isDefault: false,
  isRegionalVariant: true,
  evolutionStage: "final",
});
const mewtwo = pkmn({
  id: 150,
  slug: "mewtwo",
  types: ["psychic"],
  evolutionStage: "final",
  isLegendary: true,
  stats: { hp: 106, attack: 110, defense: 90, specialAttack: 154, specialDefense: 90, speed: 130 },
});
const mew = pkmn({
  id: 151,
  slug: "mew",
  types: ["psychic"],
  evolutionStage: "final",
  isMythical: true,
});
const pichu = pkmn({
  id: 172,
  slug: "pichu",
  types: ["electric"],
  evolutionStage: "first",
  isBaby: true,
});
const treecko = pkmn({
  id: 252,
  slug: "treecko",
  types: ["grass"],
  generationId: 3,
  evolutionStage: "first",
  tags: ["starter"],
});
const sceptile = pkmn({
  id: 254,
  slug: "sceptile",
  types: ["grass"],
  generationId: 3,
  evolutionStage: "final",
});

const pool: Pokemon[] = [
  bulbasaur, ivysaur, venusaur,
  charmander, charizard, charizardMegaX, charizardGmax,
  pikachu, raichu, raichuAlola,
  mewtwo, mew, pichu,
  treecko, sceptile,
];

describe("emptyFilter / isEmpty", () => {
  it("emptyFilter is empty by canonicalKey", () => {
    expect(isEmpty(emptyFilter())).toBe(true);
  });
  it("filter that matches the default form-inclusion is still empty", () => {
    expect(isEmpty({ formInclusion: DEFAULT_FORM_INCLUSION })).toBe(true);
  });
  it("filter with one explicit field is non-empty", () => {
    expect(isEmpty({ generationIds: [1] })).toBe(false);
  });
});

describe("apply — default form-inclusion (final-evolutions-excluding-mega)", () => {
  it("excludes pre-evolutions (the Charmander/Charmeleon fix)", () => {
    const slugs = apply({}, pool).map((p) => p.slug);
    expect(slugs).not.toContain("bulbasaur");
    expect(slugs).not.toContain("ivysaur");
    expect(slugs).not.toContain("charmander");
    expect(slugs).not.toContain("pikachu");
    expect(slugs).not.toContain("treecko");
    expect(slugs).not.toContain("pichu");
  });
  it("excludes Mega and GMax forms", () => {
    const slugs = apply({}, pool).map((p) => p.slug);
    expect(slugs).not.toContain("charizard-mega-x");
    expect(slugs).not.toContain("charizard-gmax");
  });
  it("includes regional variants of final-stage species", () => {
    expect(apply({}, pool).map((p) => p.slug)).toContain("raichu-alola");
  });
  it("includes single-stage Pokémon (Mewtwo) and Mythicals (Mew)", () => {
    const slugs = apply({}, pool).map((p) => p.slug);
    expect(slugs).toContain("mewtwo");
    expect(slugs).toContain("mew");
  });
});

describe("FormInclusionMode", () => {
  it("all-forms returns every row", () => {
    expect(apply({ formInclusion: "all-forms" }, pool).length).toBe(pool.length);
  });
  it("default-forms-only returns one per species's canonical form", () => {
    const slugs = apply({ formInclusion: "default-forms-only" }, pool).map((p) => p.slug);
    expect(slugs).toContain("bulbasaur");
    expect(slugs).toContain("charizard");
    expect(slugs).toContain("pikachu");
    expect(slugs).not.toContain("charizard-mega-x");
    expect(slugs).not.toContain("raichu-alola");
  });
  it("final-evolutions-only includes Megas and GMax", () => {
    const slugs = apply({ formInclusion: "final-evolutions-only" }, pool).map((p) => p.slug);
    expect(slugs).toContain("charizard");
    expect(slugs).toContain("charizard-mega-x");
    expect(slugs).toContain("charizard-gmax");
    expect(slugs).not.toContain("charmander");
  });
  it("only-megas returns just Megas", () => {
    expect(apply({ formInclusion: "only-megas" }, pool).map((p) => p.slug)).toEqual([
      "charizard-mega-x",
    ]);
  });
  it("only-gmax returns just GMax forms", () => {
    expect(apply({ formInclusion: "only-gmax" }, pool).map((p) => p.slug)).toEqual([
      "charizard-gmax",
    ]);
  });
  it("only-regional-variants returns just regional variants", () => {
    expect(apply({ formInclusion: "only-regional-variants" }, pool).map((p) => p.slug)).toEqual([
      "raichu-alola",
    ]);
  });
});

describe("primitive filters compose AND across fields", () => {
  it("generation + type", () => {
    expect(
      apply({ generationIds: [1], typeSlugs: ["fire"] }, pool).map((p) => p.slug),
    ).toEqual(["charizard"]);
  });
  it("generation + type — gen 3 grass final-stage", () => {
    expect(
      apply({ generationIds: [3], typeSlugs: ["grass"] }, pool).map((p) => p.slug),
    ).toEqual(["sceptile"]);
  });
  it("generation OR within field (gen 1 or gen 3)", () => {
    expect(
      apply({ generationIds: [1, 3], typeSlugs: ["grass"] }, pool).map((p) => p.slug),
    ).toEqual(["venusaur", "sceptile"]);
  });
});

describe("tag filter", () => {
  it("tagMode default = 'all' (must carry every listed tag)", () => {
    // No pokemon carries both starter AND legendary.
    expect(
      apply({ tagSlugs: ["starter", "legendary"], formInclusion: "all-forms" }, pool),
    ).toEqual([]);
  });
  it("tagMode 'any' = OR", () => {
    const slugs = apply(
      { tagSlugs: ["mega", "gmax"], tagMode: "any", formInclusion: "all-forms" },
      pool,
    ).map((p) => p.slug);
    expect(slugs).toEqual(["charizard-mega-x", "charizard-gmax"]);
  });
});

describe("BST + stat thresholds", () => {
  it("bstMin filters out low-BST Pokémon", () => {
    const slugs = apply(
      { bstMin: 600, formInclusion: "all-forms" },
      pool,
    ).map((p) => p.slug);
    expect(slugs).toContain("mewtwo");        // BST 680
    expect(slugs).toContain("charizard-mega-x"); // BST 634
    expect(slugs).not.toContain("charizard");   // BST 534
  });
  it("bstMax filters out high-BST Pokémon", () => {
    expect(
      apply({ bstMax: 350, formInclusion: "all-forms" }, pool).map((p) => p.slug),
    ).toContain("charmander"); // BST 309
    expect(
      apply({ bstMax: 350, formInclusion: "all-forms" }, pool).map((p) => p.slug),
    ).not.toContain("mewtwo");
  });
  it("statThresholds: speed >= 100", () => {
    const slugs = apply(
      { statThresholds: { speed: { min: 100 } }, formInclusion: "all-forms" },
      pool,
    ).map((p) => p.slug);
    expect(slugs).toContain("charizard");
    expect(slugs).toContain("mewtwo");
    expect(slugs).not.toContain("bulbasaur");
  });
});

describe("EvolutionStage filter", () => {
  it("first-stage only", () => {
    const slugs = apply(
      { evolutionStages: ["first"], formInclusion: "all-forms" },
      pool,
    ).map((p) => p.slug);
    expect(slugs).toEqual(["bulbasaur", "charmander", "pichu", "treecko"]);
  });
  it("middle-stage only", () => {
    const slugs = apply(
      { evolutionStages: ["middle"], formInclusion: "all-forms" },
      pool,
    ).map((p) => p.slug);
    expect(slugs).toEqual(["ivysaur", "pikachu"]);
  });
});

describe("Categorical flags (legendary / mythical / baby)", () => {
  it("isLegendary=true returns just Mewtwo", () => {
    expect(
      apply({ isLegendary: true, formInclusion: "all-forms" }, pool).map((p) => p.slug),
    ).toEqual(["mewtwo"]);
  });
  it("isMythical=true returns just Mew", () => {
    expect(
      apply({ isMythical: true, formInclusion: "all-forms" }, pool).map((p) => p.slug),
    ).toEqual(["mew"]);
  });
  it("isLegendary=false excludes legendaries", () => {
    expect(
      apply({ isLegendary: false, formInclusion: "all-forms" }, pool).map((p) => p.slug),
    ).not.toContain("mewtwo");
  });
  it("isBaby=true returns just Pichu", () => {
    expect(
      apply({ isBaby: true, formInclusion: "all-forms" }, pool).map((p) => p.slug),
    ).toEqual(["pichu"]);
  });
});

describe("eligibleCount + matches", () => {
  it("eligibleCount matches apply().length", () => {
    const f = { generationIds: [1], typeSlugs: ["fire"] };
    expect(eligibleCount(f, pool)).toBe(apply(f, pool).length);
  });
  it("matches returns true when any other field filter would admit", () => {
    expect(matches({ formInclusion: "all-forms" }, charmander)).toBe(true);
    expect(matches({ formInclusion: "final-evolutions-only" }, charmander)).toBe(false);
  });
});

describe("Backward-compat: includeAlternateForms shim", () => {
  it("includeAlternateForms=true ⇒ all-forms", () => {
    const slugs = apply({ includeAlternateForms: true }, pool).map((p) => p.slug);
    expect(slugs.length).toBe(pool.length);
  });
  it("includeAlternateForms=false ⇒ default (final-no-mega)", () => {
    const a = apply({ includeAlternateForms: false }, pool).map((p) => p.slug);
    const b = apply({}, pool).map((p) => p.slug);
    expect(a).toEqual(b);
  });
  it("explicit formInclusion overrides the shim", () => {
    expect(effectiveFormInclusion({ includeAlternateForms: true, formInclusion: "only-megas" }))
      .toBe("only-megas");
  });
});

describe("URL serialization", () => {
  it("round-trips an extended filter", () => {
    const original = {
      generationIds: [1, 3],
      typeSlugs: ["fire", "water"],
      tagSlugs: ["starter"],
      tagMode: "any" as const,
      formInclusion: "only-megas" as const,
      evolutionStages: ["first", "final"] as EvolutionStage[],
      bstMin: 400,
      bstMax: 700,
      statThresholds: { speed: { min: 100 } },
      isLegendary: true,
    };
    const params = toSearchParams(original);
    const parsed = parseFilter(params);
    expect(parsed).toEqual(original);
  });

  it("round-trips empty filter as empty params", () => {
    expect(toSearchParams({}).toString()).toBe("");
    expect(parseFilter(new URLSearchParams())).toEqual({});
  });

  it("default form-inclusion is omitted from URL", () => {
    const params = toSearchParams({
      formInclusion: "final-evolutions-excluding-mega",
    });
    expect(params.has("forms")).toBe(false);
  });

  it("legacy ?forms=all maps to all-forms", () => {
    expect(parseFilter({ forms: "all" })).toEqual({ formInclusion: "all-forms" });
  });

  it("canonicalKey is order-independent and ignores includeAlternateForms shim", () => {
    const a = canonicalKey({ generationIds: [3, 1], typeSlugs: ["water", "fire"] });
    const b = canonicalKey({ generationIds: [1, 3], typeSlugs: ["fire", "water"] });
    expect(a).toBe(b);
    const c = canonicalKey({ includeAlternateForms: true });
    const d = canonicalKey({ formInclusion: "all-forms" });
    expect(c).toBe(d);
  });

  // PM blocker B-3: canonicalKey must be a true equivalence-class hash, not
  // just a faithful serialization. These collisions were called out in the
  // Phase 2 product-manager review.
  describe("canonicalKey collision normalizations (PM B-3)", () => {
    it("tagMode is irrelevant when 0 or 1 tags are listed", () => {
      // Single tag: "all" and "any" select the same set.
      expect(canonicalKey({ tagSlugs: ["legendary"], tagMode: "all" }))
        .toBe(canonicalKey({ tagSlugs: ["legendary"], tagMode: "any" }));
      // No tags: tagMode is meaningless entirely.
      expect(canonicalKey({ tagMode: "any" })).toBe("");
    });

    it("evolutionStages = {first,middle,final} is identity, collapses", () => {
      const allStages = canonicalKey({
        evolutionStages: ["first", "middle", "final"],
      });
      expect(allStages).toBe("");
      // Order doesn't matter for the identity collapse.
      expect(canonicalKey({ evolutionStages: ["final", "first", "middle"] }))
        .toBe("");
    });

    it("open BST range collapses to no-op", () => {
      expect(canonicalKey({ bstMin: 0 })).toBe("");
      expect(canonicalKey({ bstMin: 0, bstMax: 720 })).toBe("");
      // Real ranges are NOT collapsed.
      expect(canonicalKey({ bstMin: 600 })).not.toBe("");
    });

    it("open per-stat thresholds collapse to no-op", () => {
      expect(canonicalKey({ statThresholds: { hp: { min: 0, max: 255 } } }))
        .toBe("");
      expect(canonicalKey({ statThresholds: { hp: { min: 0 } } })).toBe("");
      // Real thresholds survive.
      expect(canonicalKey({ statThresholds: { hp: { min: 100 } } }))
        .not.toBe("");
    });

    it("two semantically equivalent filters share canonicalKey", () => {
      // Filter A: just legendaries. Filter B: legendaries via the (vacuous)
      // identity stage filter and tagMode-on-single-tag. Same eligibility set.
      const a = canonicalKey({ isLegendary: true });
      const b = canonicalKey({
        isLegendary: true,
        evolutionStages: ["first", "middle", "final"],
        tagMode: "any",
      });
      expect(a).toBe(b);
    });

    it("dedupes list-field inputs (B-3 corollary)", () => {
      expect(canonicalKey({ generationIds: [1, 1, 2] }))
        .toBe(canonicalKey({ generationIds: [1, 2] }));
      expect(canonicalKey({ typeSlugs: ["fire", "fire"] }))
        .toBe(canonicalKey({ typeSlugs: ["fire"] }));
    });
  });

  describe("slug primitive (curated allowlist)", () => {
    it("filters by exact slug match", () => {
      const small: Pokemon[] = [
        pkmn({ id: 134, slug: "vaporeon" }),
        pkmn({ id: 135, slug: "jolteon" }),
        pkmn({ id: 6, slug: "charizard" }),
      ];
      expect(
        apply({ slugs: ["vaporeon", "jolteon"] }, small).map((p) => p.slug),
      ).toEqual(["vaporeon", "jolteon"]);
    });
    it("URL round-trip (sorted on the wire)", () => {
      const filter = { slugs: ["vaporeon", "jolteon", "flareon"] };
      const params = toSearchParams(filter);
      expect(params.get("slug")).toBe("flareon,jolteon,vaporeon");
      // Parser returns the canonical (sorted) form.
      expect(parseFilter(params)).toEqual({
        slugs: ["flareon", "jolteon", "vaporeon"],
      });
    });
  });

  it("parseFilter accepts Next.js searchParams shape", () => {
    expect(parseFilter({ gen: "1,2", type: "fire", forms: "all" })).toEqual({
      generationIds: [1, 2],
      typeSlugs: ["fire"],
      formInclusion: "all-forms",
    });
  });

  it("parseFilter ignores garbage input gracefully", () => {
    expect(parseFilter({ gen: "abc,,xyz", type: ",,," })).toEqual({});
  });

  it("BST range round-trips with open ends", () => {
    const params = toSearchParams({ bstMin: 600 });
    expect(params.get("bst")).toBe("600-");
    expect(parseFilter(params)).toEqual({ bstMin: 600 });
  });

  it("per-stat thresholds round-trip", () => {
    const params = toSearchParams({
      statThresholds: { speed: { min: 100 }, hp: { min: 50, max: 200 } },
    });
    const parsed = parseFilter(params);
    expect(parsed.statThresholds).toEqual({
      speed: { min: 100 },
      hp: { min: 50, max: 200 },
    });
  });
});
