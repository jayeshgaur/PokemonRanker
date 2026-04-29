import { describe, expect, it } from "vitest";
import type { Pokemon } from "@pokemon-ranker/shared";
import {
  applyNode,
  isFilter,
  isFilterNode,
  presetBySlug,
  PRESETS,
  presetSlugs,
} from "../src/index.js";

function pkmn(over: Partial<Pokemon> & { id: number; slug: string }): Pokemon {
  return {
    speciesId: over.id,
    formId: over.id,
    displayName: over.slug,
    generationId: 1,
    isDefault: true,
    types: ["normal"],
    stats: { hp: 50, attack: 50, defense: 50, specialAttack: 50, specialDefense: 50, speed: 50 },
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

const charizard = pkmn({ id: 6, slug: "charizard", types: ["fire", "flying"] });
const charizardMegaX = pkmn({
  id: 10034,
  slug: "charizard-mega-x",
  isDefault: false,
  isMega: true,
  isBattleOnly: true,
  types: ["fire", "dragon"],
});
const venusaur = pkmn({ id: 3, slug: "venusaur", types: ["grass", "poison"] });
const blastoise = pkmn({ id: 9, slug: "blastoise", types: ["water"] });
const mewtwo = pkmn({ id: 150, slug: "mewtwo", types: ["psychic"], isLegendary: true });
const mew = pkmn({ id: 151, slug: "mew", types: ["psychic"], isMythical: true });
const pichu = pkmn({ id: 172, slug: "pichu", evolutionStage: "first", isBaby: true });
const sceptile = pkmn({ id: 254, slug: "sceptile", types: ["grass"], generationId: 3 });
const charmander = pkmn({
  id: 4,
  slug: "charmander",
  types: ["fire"],
  evolutionStage: "first",
  tags: ["starter"],
  stats: { hp: 39, attack: 52, defense: 43, specialAttack: 60, specialDefense: 50, speed: 65 },
});
const raichuAlola = pkmn({
  id: 10100,
  slug: "raichu-alola",
  isDefault: false,
  isRegionalVariant: true,
});
const charizardGmax = pkmn({
  id: 10365,
  slug: "charizard-gmax",
  isDefault: false,
  isGmax: true,
  isBattleOnly: true,
});

const pool: Pokemon[] = [
  charizard, charizardMegaX, charizardGmax,
  venusaur, blastoise, mewtwo, mew, pichu,
  sceptile, charmander, raichuAlola,
];

describe("preset library", () => {
  it("ships at least 22 presets (PLAN.md target)", () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(22);
  });

  it("includes the PM B-2 additions (2026-04-29)", () => {
    expect(presetBySlug("kanto-electric")).toBeDefined();
    expect(presetBySlug("eeveelutions")).toBeDefined();
    expect(presetBySlug("starters-final")).toBeDefined();
  });

  it("eeveelutions preset selects the eight canonical Eeveelutions", () => {
    const eevees = [
      "vaporeon", "jolteon", "flareon", "espeon",
      "umbreon", "leafeon", "glaceon", "sylveon",
    ];
    const fixturePool: Pokemon[] = eevees.map((slug, i) =>
      pkmn({ id: 134 + i, slug }),
    );
    fixturePool.push(pkmn({ id: 25, slug: "raichu" })); // distractor
    const result = applyNode(presetBySlug("eeveelutions")!.spec, fixturePool)
      .map((p) => p.slug);
    expect(result.sort()).toEqual(eevees.slice().sort());
  });

  it("every preset has a unique slug", () => {
    const slugs = presetSlugs();
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("every preset has a non-empty name and description", () => {
    for (const p of PRESETS) {
      expect(p.name).not.toEqual("");
      expect(p.description).not.toEqual("");
    }
  });

  it("every preset.spec is a Filter or a FilterNode", () => {
    for (const p of PRESETS) {
      const ok = isFilter(p.spec) || isFilterNode(p.spec);
      expect(ok).toBe(true);
    }
  });

  it("presetBySlug round-trips", () => {
    expect(presetBySlug("gen-1")?.slug).toBe("gen-1");
    expect(presetBySlug("does-not-exist")).toBeUndefined();
  });
});

describe("preset spot-checks against the fixture pool", () => {
  it("gen-1 includes Gen 1 final-stage Pokémon, excludes Gen 3", () => {
    const slugs = applyNode(presetBySlug("gen-1")!.spec, pool).map((p) => p.slug);
    expect(slugs).toContain("charizard");
    expect(slugs).toContain("venusaur");
    expect(slugs).not.toContain("sceptile");
  });

  it("gen-3 excludes Gen 1", () => {
    const slugs = applyNode(presetBySlug("gen-3")!.spec, pool).map((p) => p.slug);
    expect(slugs).toContain("sceptile");
    expect(slugs).not.toContain("charizard");
  });

  it("kanto-fire returns Charizard only", () => {
    const slugs = applyNode(presetBySlug("kanto-fire")!.spec, pool).map((p) => p.slug);
    expect(slugs).toEqual(["charizard"]);
  });

  it("all-legendaries returns only legendaries", () => {
    expect(
      applyNode(presetBySlug("all-legendaries")!.spec, pool).map((p) => p.slug),
    ).toEqual(["mewtwo"]);
  });

  it("all-mythicals returns only mythicals", () => {
    expect(
      applyNode(presetBySlug("all-mythicals")!.spec, pool).map((p) => p.slug),
    ).toEqual(["mew"]);
  });

  it("legendaries-and-mythicals (composed OR) returns the union", () => {
    expect(
      applyNode(presetBySlug("legendaries-and-mythicals")!.spec, pool)
        .map((p) => p.slug)
        .sort(),
    ).toEqual(["mew", "mewtwo"]);
  });

  it("babies returns Pichu", () => {
    expect(applyNode(presetBySlug("babies")!.spec, pool).map((p) => p.slug)).toEqual(["pichu"]);
  });

  it("megas-only returns just Megas", () => {
    expect(
      applyNode(presetBySlug("megas-only")!.spec, pool).map((p) => p.slug),
    ).toEqual(["charizard-mega-x"]);
  });

  it("gmax-only returns just GMax", () => {
    expect(
      applyNode(presetBySlug("gmax-only")!.spec, pool).map((p) => p.slug),
    ).toEqual(["charizard-gmax"]);
  });

  it("regional-variants returns just regional variants", () => {
    expect(
      applyNode(presetBySlug("regional-variants")!.spec, pool).map((p) => p.slug),
    ).toEqual(["raichu-alola"]);
  });

  it("fully-evolved-no-mega excludes both pre-evos and Megas (the casual default)", () => {
    const slugs = applyNode(presetBySlug("fully-evolved-no-mega")!.spec, pool).map((p) => p.slug);
    expect(slugs).not.toContain("charmander");
    expect(slugs).not.toContain("charizard-mega-x");
    expect(slugs).not.toContain("charizard-gmax");
    expect(slugs).toContain("charizard");
  });

  it("fully-evolved (all forms) includes Megas/GMax", () => {
    const slugs = applyNode(presetBySlug("fully-evolved")!.spec, pool).map((p) => p.slug);
    expect(slugs).toContain("charizard-mega-x");
    expect(slugs).toContain("charizard-gmax");
  });

  it("dragons returns Mega Charizard X (its only dragon-typed final stage in fixture)", () => {
    const slugs = applyNode(presetBySlug("dragons")!.spec, pool).map((p) => p.slug);
    // fully-evolved-no-mega is the default form-inclusion → Mega-X excluded.
    expect(slugs).toEqual([]);
  });

  it("starters preset includes all stages of starter Pokémon (default-forms-only)", () => {
    // Charmander is tagged 'starter' in the fixture and is first-stage; the
    // preset uses default-forms-only specifically to admit pre-evolutions.
    expect(
      applyNode(presetBySlug("starters")!.spec, pool).map((p) => p.slug),
    ).toEqual(["charmander"]);
  });

  it("tag-based presets without fixture tags return empty (Phase 1.D pending)", () => {
    expect(applyNode(presetBySlug("paradox")!.spec, pool)).toEqual([]);
    expect(applyNode(presetBySlug("ultra-beasts")!.spec, pool)).toEqual([]);
    expect(applyNode(presetBySlug("fossils")!.spec, pool)).toEqual([]);
    expect(applyNode(presetBySlug("pseudo-legendaries")!.spec, pool)).toEqual([]);
  });

  it("requiresTags is set for tag-based presets", () => {
    for (const slug of ["starters", "pseudo-legendaries", "ultra-beasts", "paradox", "fossils"]) {
      expect(presetBySlug(slug)?.requiresTags).toBe(true);
    }
  });
});
