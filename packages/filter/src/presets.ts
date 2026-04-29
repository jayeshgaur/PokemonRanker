// Preset library — at least 22 named filter presets covering the YouTube-
// top-10 archetypes called out in PLAN.md §Phase 2: per-generation,
// starters, pseudo-legendaries, megas-only, fully-evolved-only, etc.
//
// Each preset is either a flat Filter shorthand or a composed FilterNode.
// Tag-based presets (starters, pseudo-legendaries, ultra-beasts, paradox,
// fossils) require Phase 1.D to populate `tags.yaml` member lists; until
// then they return an empty pool — which is the correct behavior, not a
// bug. Once 1.D lands, no preset code changes.

import type { Filter } from "./index";
import { type FilterNode, leaf, or } from "./composition";

export interface Preset {
  slug: string;
  name: string;
  description: string;
  // Either a Filter (most presets) or a FilterNode (when OR/NOT composition
  // is needed, e.g., legendaries-or-mythicals).
  spec: Filter | FilterNode;
  // True when the preset depends on tag curation (Phase 1.D). Useful for the
  // UI to dim/hide presets that aren't usable yet.
  requiresTags?: boolean;
}

const perGenPresets: Preset[] = ([1, 2, 3, 4, 5, 6, 7, 8, 9] as const).map(
  (gen) => ({
    slug: `gen-${gen}`,
    name: `Generation ${gen}`,
    description: `All Pokémon introduced in Generation ${gen}.`,
    spec: { generationIds: [gen] } satisfies Filter,
  }),
);

// Mono-type-per-Kanto: the four iconic-elemental-mascot types. Adding
// `electric` closes the "you forgot Pikachu types" gap flagged by the PM
// review (Gap A); psychic added for parity with the legendary trio.
const kantoTypePresets: Preset[] = (
  [
    ["fire", "Fire-types"],
    ["water", "Water-types"],
    ["grass", "Grass-types"],
    ["electric", "Electric-types"],
    ["psychic", "Psychic-types"],
  ] as const
).map(([slug, label]) => ({
  slug: `kanto-${slug}`,
  name: `Kanto ${label}`,
  description: `Generation 1 ${label.toLowerCase()}.`,
  spec: { generationIds: [1], typeSlugs: [slug] } satisfies Filter,
}));

const statusPresets: Preset[] = [
  {
    slug: "all-legendaries",
    name: "Legendaries",
    description: "Every legendary Pokémon (excluding mythicals).",
    // Most legendaries are single-stage and pass the default form-inclusion;
    // explicitly admit alt forms so multi-form legendaries (Necrozma family,
    // Calyrex riders) all show up.
    spec: { isLegendary: true, formInclusion: "all-forms" } satisfies Filter,
  },
  {
    slug: "all-mythicals",
    name: "Mythicals",
    description: "Every mythical Pokémon (Mew, Celebi, Jirachi, …).",
    spec: { isMythical: true, formInclusion: "all-forms" } satisfies Filter,
  },
  {
    slug: "legendaries-and-mythicals",
    name: "Legendaries + Mythicals (Ubers tier)",
    description: "Union of legendaries and mythicals — the Smogon Ubers pool.",
    spec: or(
      leaf({ isLegendary: true, formInclusion: "all-forms" }),
      leaf({ isMythical: true, formInclusion: "all-forms" }),
    ),
  },
  {
    slug: "babies",
    name: "Baby Pokémon",
    description: "Pichu, Cleffa, Igglybuff, … all baby-stage Pokémon.",
    // Baby Pokémon are first-stage by definition; the default form-inclusion
    // would exclude them. Use default-forms-only to admit them while keeping
    // Megas/GMax out (no baby Pokémon has those anyway).
    spec: { isBaby: true, formInclusion: "default-forms-only" } satisfies Filter,
  },
];

const formInclusionPresets: Preset[] = [
  {
    slug: "fully-evolved",
    name: "Final evolutions (all forms)",
    description:
      "Every final-stage Pokémon, including Megas / GMax / regional variants.",
    spec: { formInclusion: "final-evolutions-only" } satisfies Filter,
  },
  {
    slug: "fully-evolved-no-mega",
    name: "Final evolutions (no Mega/GMax)",
    description:
      "Final-stage Pokémon excluding Mega and Gigantamax forms — the casual default.",
    spec: { formInclusion: "final-evolutions-excluding-mega" } satisfies Filter,
  },
  {
    slug: "megas-only",
    name: "Mega Evolutions",
    description: "All Mega Evolutions (Gen 6/7).",
    spec: { formInclusion: "only-megas" } satisfies Filter,
  },
  {
    slug: "gmax-only",
    name: "Gigantamax forms",
    description: "All Gigantamax forms (Gen 8).",
    spec: { formInclusion: "only-gmax" } satisfies Filter,
  },
  {
    slug: "regional-variants",
    name: "Regional Variants",
    description: "Alolan, Galarian, Hisuian, and Paldean forms.",
    spec: { formInclusion: "only-regional-variants" } satisfies Filter,
  },
];

const typePresets: Preset[] = (
  [
    ["dragons", "Dragon-types", "dragon"],
    ["ghosts", "Ghost-types", "ghost"],
    ["psychics", "Psychic-types", "psychic"],
  ] as const
).map(([slug, name, type]) => ({
  slug,
  name,
  description: `Every ${name.toLowerCase()} (final-stage default forms).`,
  spec: { typeSlugs: [type] } satisfies Filter,
}));

const bstPresets: Preset[] = [
  // Renamed from `bst-600-club` per PM review — the original name lied
  // about its meaning. The pseudo-legendary tier is exactly BST 600 by
  // tradition and is already covered by the `pseudo-legendaries` preset;
  // this one is "strong non-legendaries (600–679)".
  {
    slug: "bst-600-679",
    name: "Strong non-legendaries (BST 600–679)",
    description:
      "Final-stage Pokémon with BST in the 600–679 band — pseudo-tier strength, excluding actual legendaries.",
    spec: { bstMin: 600, bstMax: 679 } satisfies Filter,
  },
  {
    slug: "high-bst",
    name: "High BST (≥ 600)",
    description: "All Pokémon with BST ≥ 600 (pseudos, legendaries, Mega tier).",
    spec: { bstMin: 600 } satisfies Filter,
  },
];

// PM blocker B-2 additions (2026-04-29).
const curatedPresets: Preset[] = [
  // Eeveelutions — the most-requested fan ranking. Modeled as an explicit
  // slug allowlist so it works WITHOUT 1.D tag curation; once 1.D ships an
  // `eeveelution` tag we can switch to tagSlugs.
  {
    slug: "eeveelutions",
    name: "Eeveelutions",
    description: "The eight Eevee evolutions — Vaporeon through Sylveon.",
    spec: {
      slugs: [
        "vaporeon",
        "jolteon",
        "flareon",
        "espeon",
        "umbreon",
        "leafeon",
        "glaceon",
        "sylveon",
      ],
      formInclusion: "all-forms",
    } satisfies Filter,
  },
  // Final-form starters — the canonical "best starter" question. Requires
  // the `starter` tag from Phase 1.D; final-form filter is a runtime gate.
  {
    slug: "starters-final",
    name: "Starter Pokémon (final forms only)",
    description:
      "Final-evolution starters across all regions — Venusaur, Charizard, Blastoise, …",
    spec: {
      tagSlugs: ["starter"],
      formInclusion: "final-evolutions-excluding-mega",
    } satisfies Filter,
    requiresTags: true,
  },
];

const tagPresets: Preset[] = [
  {
    slug: "starters",
    name: "Starter Pokémon",
    description: "All starter Pokémon across all regions, every stage.",
    // "Starter" spans first/middle/final stages (Bulbasaur → Ivysaur → Venusaur).
    // Use default-forms-only to admit all stages without Megas/GMax.
    spec: { tagSlugs: ["starter"], formInclusion: "default-forms-only" } satisfies Filter,
    requiresTags: true,
  },
  {
    slug: "pseudo-legendaries",
    name: "Pseudo-Legendaries",
    description: "Dragonite, Tyranitar, Salamence, Metagross, Garchomp, …",
    spec: { tagSlugs: ["pseudo-legendary"] } satisfies Filter,
    requiresTags: true,
  },
  {
    slug: "ultra-beasts",
    name: "Ultra Beasts",
    description: "The Gen 7 inter-dimensional beasts.",
    spec: { tagSlugs: ["ultra-beast"] } satisfies Filter,
    requiresTags: true,
  },
  {
    slug: "paradox",
    name: "Paradox Pokémon",
    description: "Past- and future-form Paradox Pokémon (Gen 9).",
    spec: { tagSlugs: ["paradox"] } satisfies Filter,
    requiresTags: true,
  },
  {
    slug: "fossils",
    name: "Fossil Pokémon",
    description: "Restored fossil Pokémon, all generations.",
    spec: { tagSlugs: ["fossil"] } satisfies Filter,
    requiresTags: true,
  },
];

export const PRESETS: Preset[] = [
  ...perGenPresets, // 9
  ...kantoTypePresets, // 5 (was 3; +2 per PM B-2)
  ...statusPresets, // 4
  ...formInclusionPresets, // 5
  ...typePresets, // 3
  ...bstPresets, // 2
  ...curatedPresets, // 2 (eeveelutions + starters-final)
  ...tagPresets, // 5
];
// Total: 35 presets (post PM B-2 fixes; original target was 20+).

export function presetBySlug(slug: string): Preset | undefined {
  return PRESETS.find((p) => p.slug === slug);
}

export function presetSlugs(): string[] {
  return PRESETS.map((p) => p.slug);
}
