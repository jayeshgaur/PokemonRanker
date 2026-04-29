// Phase 2 filter engine. Extends the MVP three-dimensional Filter into the
// full surface specified in PLAN.md §Phase 2:
//
//   - Seven primitives (Generation / Type / Tag / BST-range / Stat-threshold /
//     EvolutionStage / FormInclusion) plus three categorical flags
//     (isLegendary / isMythical / isBaby).
//   - AND/OR/NOT composition via FilterNode (see ./composition).
//   - 20+ named presets (see ./presets).
//   - URL round-trip with stable canonicalKey for Phase 7 aggregation.
//
// Backward compatibility: every Filter field is optional. The MVP shape
// (generationIds, typeSlugs, tagSlugs, includeAlternateForms) still type-
// checks and applies. The default form-inclusion changed from "default-forms-
// only" to "final-evolutions-excluding-mega" per OPEN_QUESTIONS.md L51 — this
// is the fix for the user complaint "I was asked to compare Charmander vs
// Charmeleon."

import {
  bst,
  STAT_KEYS,
  type EvolutionStage,
  type Pokemon,
  type StatKey,
} from "@pokemon-ranker/shared";

export type { EvolutionStage, StatKey } from "@pokemon-ranker/shared";

// Form-inclusion modes. The picker UI exposes these as a radio group.
//
//   all-forms                       — every (species, form) row
//   default-forms-only              — is_default=1 across all stages
//                                     (1025 rows, every species's canonical form)
//   final-evolutions-only           — final stage, all forms (Mega Charizard X
//                                     included)
//   final-evolutions-excluding-mega — DEFAULT. Final stage, no Mega/GMax.
//                                     Regional variants of final-stage species
//                                     are kept (e.g., Alolan Raichu).
//   only-megas                      — is_mega=1
//   only-gmax                       — is_gmax=1
//   only-paradox                    — has 'paradox' tag (needs Phase 1.D)
//   only-regional-variants          — is_regional_variant=1
export type FormInclusionMode =
  | "all-forms"
  | "default-forms-only"
  | "final-evolutions-only"
  | "final-evolutions-excluding-mega"
  | "only-megas"
  | "only-gmax"
  | "only-paradox"
  | "only-regional-variants";

export const DEFAULT_FORM_INCLUSION: FormInclusionMode =
  "final-evolutions-excluding-mega";

export const FORM_INCLUSION_MODES: readonly FormInclusionMode[] = [
  "all-forms",
  "default-forms-only",
  "final-evolutions-only",
  "final-evolutions-excluding-mega",
  "only-megas",
  "only-gmax",
  "only-paradox",
  "only-regional-variants",
];

export interface StatRange {
  min?: number;
  max?: number;
}

export type StatThresholds = Partial<Record<StatKey, StatRange>>;

export interface Filter {
  // --- Generation / type / tag (MVP-era, unchanged shape) ---
  generationIds?: number[];
  typeSlugs?: string[];
  tagSlugs?: string[];
  // How tagSlugs combine: "all" (must carry every listed tag — default) or
  // "any" (must carry at least one).
  tagMode?: "all" | "any";

  // --- Curated slug lists ---
  // Exact pokemon-slug allowlist (e.g., the eight Eeveelutions). OR-joined
  // with itself; AND-joined with the rest of the filter.
  slugs?: string[];

  // --- Form / evolution gate ---
  formInclusion?: FormInclusionMode;
  evolutionStages?: EvolutionStage[];

  // --- BST + per-stat thresholds ---
  bstMin?: number;
  bstMax?: number;
  statThresholds?: StatThresholds;

  // --- Categorical species flags ---
  isLegendary?: boolean;
  isMythical?: boolean;
  isBaby?: boolean;

  // --- Deprecated MVP shim. Kept until Phase 4 replaces the sidebar. ---
  // When set without an explicit formInclusion: true ⇒ "all-forms",
  // false ⇒ DEFAULT_FORM_INCLUSION.
  includeAlternateForms?: boolean;
}

export function emptyFilter(): Filter {
  return {};
}

export function isEmpty(f: Filter): boolean {
  return canonicalKey(f) === "";
}

// Compute the effective form-inclusion: explicit > shim > default.
export function effectiveFormInclusion(f: Filter): FormInclusionMode {
  if (f.formInclusion) return f.formInclusion;
  if (f.includeAlternateForms === true) return "all-forms";
  return DEFAULT_FORM_INCLUSION;
}

export function matches(filter: Filter, p: Pokemon): boolean {
  if (!matchesFormInclusion(effectiveFormInclusion(filter), p)) return false;

  if (filter.generationIds && filter.generationIds.length > 0) {
    if (!filter.generationIds.includes(p.generationId)) return false;
  }
  if (filter.typeSlugs && filter.typeSlugs.length > 0) {
    if (!p.types.some((t) => filter.typeSlugs!.includes(t))) return false;
  }
  if (filter.slugs && filter.slugs.length > 0) {
    if (!filter.slugs.includes(p.slug)) return false;
  }
  if (filter.tagSlugs && filter.tagSlugs.length > 0) {
    const mode = filter.tagMode ?? "all";
    if (mode === "all") {
      if (!filter.tagSlugs.every((tag) => p.tags.includes(tag))) return false;
    } else {
      if (!filter.tagSlugs.some((tag) => p.tags.includes(tag))) return false;
    }
  }
  if (filter.evolutionStages && filter.evolutionStages.length > 0) {
    if (!filter.evolutionStages.includes(p.evolutionStage)) return false;
  }
  if (filter.bstMin !== undefined || filter.bstMax !== undefined) {
    const value = bst(p.stats);
    if (filter.bstMin !== undefined && value < filter.bstMin) return false;
    if (filter.bstMax !== undefined && value > filter.bstMax) return false;
  }
  if (filter.statThresholds) {
    for (const key of STAT_KEYS) {
      const range = filter.statThresholds[key];
      if (!range) continue;
      const value = p.stats[key];
      if (range.min !== undefined && value < range.min) return false;
      if (range.max !== undefined && value > range.max) return false;
    }
  }
  if (filter.isLegendary === true && !p.isLegendary) return false;
  if (filter.isLegendary === false && p.isLegendary) return false;
  if (filter.isMythical === true && !p.isMythical) return false;
  if (filter.isMythical === false && p.isMythical) return false;
  if (filter.isBaby === true && !p.isBaby) return false;
  if (filter.isBaby === false && p.isBaby) return false;
  return true;
}

function matchesFormInclusion(mode: FormInclusionMode, p: Pokemon): boolean {
  switch (mode) {
    case "all-forms":
      return true;
    case "default-forms-only":
      return p.isDefault;
    case "final-evolutions-only":
      return p.evolutionStage === "final";
    case "final-evolutions-excluding-mega":
      return p.evolutionStage === "final" && !p.isMega && !p.isGmax;
    case "only-megas":
      return p.isMega;
    case "only-gmax":
      return p.isGmax;
    case "only-paradox":
      return p.tags.includes("paradox");
    case "only-regional-variants":
      return p.isRegionalVariant;
  }
}

export function apply(filter: Filter, pool: readonly Pokemon[]): Pokemon[] {
  return pool.filter((p) => matches(filter, p));
}

export function eligibleCount(
  filter: Filter,
  pool: readonly Pokemon[],
): number {
  let n = 0;
  for (const p of pool) if (matches(filter, p)) n++;
  return n;
}

// --- URL round-trip --------------------------------------------------------
//
// Supported params:
//   gen=1,3                     generationIds
//   type=fire,water             typeSlugs
//   tag=starter,legendary       tagSlugs
//   tag-mode=any                tagMode (default: "all")
//   forms=all|default|final|final-no-mega|mega|gmax|paradox|regional
//                               formInclusion (default: final-no-mega → omit)
//   evo=first,middle,final      evolutionStages
//   bst=400-700 | bst=400- | bst=-700
//                               bstMin / bstMax
//   stat-hp=80-200 | stat-attack=120-
//                               per-stat statThresholds
//   legendary=1 | legendary=0   isLegendary
//   mythical=1 | mythical=0     isMythical
//   baby=1 | baby=0             isBaby

const FORM_CODE_TO_MODE: Record<string, FormInclusionMode> = {
  all: "all-forms",
  "all-forms": "all-forms",
  default: "default-forms-only",
  "default-forms-only": "default-forms-only",
  final: "final-evolutions-only",
  "final-evolutions-only": "final-evolutions-only",
  "final-no-mega": "final-evolutions-excluding-mega",
  "final-evolutions-excluding-mega": "final-evolutions-excluding-mega",
  mega: "only-megas",
  "only-megas": "only-megas",
  gmax: "only-gmax",
  "only-gmax": "only-gmax",
  paradox: "only-paradox",
  "only-paradox": "only-paradox",
  regional: "only-regional-variants",
  "only-regional-variants": "only-regional-variants",
};

const FORM_MODE_TO_CODE: Record<FormInclusionMode, string> = {
  "all-forms": "all",
  "default-forms-only": "default",
  "final-evolutions-only": "final",
  "final-evolutions-excluding-mega": "final-no-mega",
  "only-megas": "mega",
  "only-gmax": "gmax",
  "only-paradox": "paradox",
  "only-regional-variants": "regional",
};

const STAT_PARAM_FOR: Record<StatKey, string> = {
  hp: "stat-hp",
  attack: "stat-attack",
  defense: "stat-defense",
  specialAttack: "stat-spatk",
  specialDefense: "stat-spdef",
  speed: "stat-speed",
};

export function toSearchParams(filter: Filter): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.generationIds && filter.generationIds.length > 0) {
    params.set(
      "gen",
      [...new Set(filter.generationIds)].sort((a, b) => a - b).join(","),
    );
  }
  if (filter.typeSlugs && filter.typeSlugs.length > 0) {
    params.set("type", [...new Set(filter.typeSlugs)].sort().join(","));
  }
  if (filter.tagSlugs && filter.tagSlugs.length > 0) {
    params.set("tag", [...new Set(filter.tagSlugs)].sort().join(","));
  }
  if (filter.slugs && filter.slugs.length > 0) {
    params.set("slug", [...new Set(filter.slugs)].sort().join(","));
  }
  if (filter.tagMode === "any") {
    params.set("tag-mode", "any");
  }

  const formMode = effectiveFormInclusion(filter);
  if (formMode !== DEFAULT_FORM_INCLUSION) {
    params.set("forms", FORM_MODE_TO_CODE[formMode]);
  }

  if (filter.evolutionStages && filter.evolutionStages.length > 0) {
    const order: EvolutionStage[] = ["first", "middle", "final"];
    const sorted = order.filter((s) => filter.evolutionStages!.includes(s));
    params.set("evo", sorted.join(","));
  }

  if (filter.bstMin !== undefined || filter.bstMax !== undefined) {
    params.set("bst", encodeRange(filter.bstMin, filter.bstMax));
  }
  if (filter.statThresholds) {
    for (const key of STAT_KEYS) {
      const range = filter.statThresholds[key];
      if (!range) continue;
      if (range.min === undefined && range.max === undefined) continue;
      params.set(STAT_PARAM_FOR[key], encodeRange(range.min, range.max));
    }
  }
  if (filter.isLegendary === true) params.set("legendary", "1");
  else if (filter.isLegendary === false) params.set("legendary", "0");
  if (filter.isMythical === true) params.set("mythical", "1");
  else if (filter.isMythical === false) params.set("mythical", "0");
  if (filter.isBaby === true) params.set("baby", "1");
  else if (filter.isBaby === false) params.set("baby", "0");

  return params;
}

function encodeRange(min: number | undefined, max: number | undefined): string {
  return `${min ?? ""}-${max ?? ""}`;
}

function parseRange(raw: string): StatRange | undefined {
  const idx = raw.indexOf("-");
  if (idx < 0) return undefined;
  const left = raw.slice(0, idx).trim();
  const right = raw.slice(idx + 1).trim();
  const r: StatRange = {};
  if (left !== "") {
    const n = Number.parseInt(left, 10);
    if (Number.isFinite(n)) r.min = n;
  }
  if (right !== "") {
    const n = Number.parseInt(right, 10);
    if (Number.isFinite(n)) r.max = n;
  }
  return r.min === undefined && r.max === undefined ? undefined : r;
}

export function parseFilter(
  source: URLSearchParams | Record<string, string | string[] | undefined>,
): Filter {
  const get = (key: string): string | undefined => {
    if (source instanceof URLSearchParams) {
      return source.get(key) ?? undefined;
    }
    const raw = source[key];
    if (raw === undefined) return undefined;
    return Array.isArray(raw) ? raw[0] : raw;
  };

  const filter: Filter = {};

  const gen = get("gen");
  if (gen) {
    const ids = gen
      .split(",")
      .map((s) => Number.parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (ids.length > 0) filter.generationIds = ids;
  }

  const type = get("type");
  if (type) {
    const slugs = type
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0);
    if (slugs.length > 0) filter.typeSlugs = slugs;
  }

  const tag = get("tag");
  if (tag) {
    const slugs = [
      ...new Set(
        tag
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter((s) => s.length > 0),
      ),
    ];
    if (slugs.length > 0) filter.tagSlugs = slugs;
  }
  const slugRaw = get("slug");
  if (slugRaw) {
    const list = [
      ...new Set(
        slugRaw
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter((s) => s.length > 0),
      ),
    ];
    if (list.length > 0) filter.slugs = list;
  }
  const tagMode = get("tag-mode");
  if (tagMode === "any") filter.tagMode = "any";

  const forms = get("forms");
  if (forms) {
    const mode = FORM_CODE_TO_MODE[forms.trim().toLowerCase()];
    if (mode) filter.formInclusion = mode;
  }

  const evo = get("evo");
  if (evo) {
    const allowed: EvolutionStage[] = ["first", "middle", "final"];
    const stages = evo
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s): s is EvolutionStage =>
        (allowed as string[]).includes(s),
      );
    if (stages.length > 0) filter.evolutionStages = stages;
  }

  const bst = get("bst");
  if (bst) {
    const range = parseRange(bst);
    if (range) {
      if (range.min !== undefined) filter.bstMin = range.min;
      if (range.max !== undefined) filter.bstMax = range.max;
    }
  }

  for (const key of STAT_KEYS) {
    const raw = get(STAT_PARAM_FOR[key]);
    if (!raw) continue;
    const range = parseRange(raw);
    if (range) {
      filter.statThresholds = { ...(filter.statThresholds ?? {}), [key]: range };
    }
  }

  const legendary = get("legendary");
  if (legendary === "1") filter.isLegendary = true;
  else if (legendary === "0") filter.isLegendary = false;
  const mythical = get("mythical");
  if (mythical === "1") filter.isMythical = true;
  else if (mythical === "0") filter.isMythical = false;
  const baby = get("baby");
  if (baby === "1") filter.isBaby = true;
  else if (baby === "0") filter.isBaby = false;

  return filter;
}

// Stable hash of a Filter for Phase 7 aggregate rollups. Two Filters that
// describe the same eligibility set MUST produce the same canonicalKey —
// otherwise the aggregation moat (D-11) leaks: identical-result tournaments
// fail to roll up. This function normalizes every redundant or default-
// equivalent representation before serializing.
//
// IMPORTANT (Phase 7 forward note, per product-manager review): the preset
// SLUG is NOT the rollup key. Aggregation code must re-compute canonicalKey
// from the resolved Filter spec each time, otherwise a future preset rename
// or expansion silently shards the rollup buckets.
export function canonicalKey(filter: Filter): string {
  const normalized: Filter = { ...filter };
  // Deep-copy mutable nested fields so we don't disturb the caller.
  if (normalized.statThresholds) {
    normalized.statThresholds = { ...normalized.statThresholds };
  }

  // (1) Legacy MVP shim: collapse includeAlternateForms into formInclusion.
  delete normalized.includeAlternateForms;
  const formMode = effectiveFormInclusion(filter);
  if (formMode === DEFAULT_FORM_INCLUSION) {
    delete normalized.formInclusion;
  } else {
    normalized.formInclusion = formMode;
  }

  // (2) tagMode is meaningless when there are 0 or 1 tags ("all" of one tag
  // and "any" of one tag select the same set).
  if (!normalized.tagSlugs || normalized.tagSlugs.length <= 1) {
    delete normalized.tagMode;
  }

  // (3) evolutionStages = {first, middle, final} (in any order, deduped) is
  // the identity transform — collapse to undefined.
  if (normalized.evolutionStages) {
    const set = new Set(normalized.evolutionStages);
    if (set.size === 3 && set.has("first") && set.has("middle") && set.has("final")) {
      delete normalized.evolutionStages;
    }
  }

  // (4) Open BST range — when both min and max are no-ops in the realistic
  // BST band [180, 720], drop. Treat min ≤ 0 as "no lower bound" and max
  // unset (or ≥ 720) as "no upper bound" — neither contributes to selection.
  const bstMinOpen = normalized.bstMin === undefined || normalized.bstMin <= 0;
  const bstMaxOpen = normalized.bstMax === undefined || normalized.bstMax >= 720;
  if (bstMinOpen && bstMaxOpen) {
    delete normalized.bstMin;
    delete normalized.bstMax;
  }

  // (5) Per-stat thresholds: drop ranges where both ends are no-ops in the
  // realistic [0, 255] base-stat range.
  if (normalized.statThresholds) {
    for (const key of STAT_KEYS) {
      const range = normalized.statThresholds[key];
      if (!range) continue;
      const minOpen = range.min === undefined || range.min <= 0;
      const maxOpen = range.max === undefined || range.max >= 255;
      if (minOpen && maxOpen) {
        delete normalized.statThresholds[key];
      }
    }
    if (Object.keys(normalized.statThresholds).length === 0) {
      delete normalized.statThresholds;
    }
  }

  return toSearchParams(normalized).toString();
}

// Re-exports.
export {
  type FilterNode,
  leaf,
  and,
  or,
  not,
  applyNode,
  matchesNode,
  eligibleCountNode,
  isFilter,
  isFilterNode,
} from "./composition";

export {
  type Preset,
  PRESETS,
  presetBySlug,
  presetSlugs,
} from "./presets";
