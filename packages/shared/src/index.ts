// Canonical Pokemon shape consumed by the filter and ranker engines and the
// Next.js picker UI. Maps onto the SQLite Pokédex (apps/api/internal/pokedex/
// schema.sql): a `pokemon` row is one (species, form) tuple per D-1.

export interface Stats {
  hp: number;
  attack: number;
  defense: number;
  specialAttack: number;
  specialDefense: number;
  speed: number;
}

export type StatKey = keyof Stats;

export const STAT_KEYS: readonly StatKey[] = [
  "hp",
  "attack",
  "defense",
  "specialAttack",
  "specialDefense",
  "speed",
];

export function bst(s: Stats): number {
  return (
    s.hp +
    s.attack +
    s.defense +
    s.specialAttack +
    s.specialDefense +
    s.speed
  );
}

// Where this (species, form) row sits in its evolution chain.
//
//   - "first" : no parent species AND has at least one descendant (Charmander).
//   - "middle": has a parent AND has descendants (Charmeleon).
//   - "final" : has no descendants — *includes* single-stage species like
//               Tauros, Lapras, Mewtwo. The filter UI's "final-evolutions-only"
//               mode trusts this, which is what casual fans expect.
export type EvolutionStage = "first" | "middle" | "final";

export interface Pokemon {
  id: number;
  speciesId: number;
  formId: number;
  slug: string;
  displayName: string;
  generationId: number;
  isDefault: boolean;
  // Type slugs in slot order (length 1 or 2).
  types: string[];
  stats: Stats;
  spriteUrl: string;
  shinySpriteUrl: string;
  officialArtworkUrl: string;
  cryUrl: string;
  pokedexDbUrl: string;
  // Tag slugs, alphabetical. Curated from tags.yaml (Phase 1.D).
  tags: string[];

  // --- Phase 2 additions: form / status / evolution metadata ---

  // Form metadata (from `forms` table).
  isMega: boolean;
  isGmax: boolean;
  isBattleOnly: boolean;
  isRegionalVariant: boolean;

  // Species metadata (from `species` table — already populated by the
  // SpeciesIngester, just not exposed to the engine until now).
  isLegendary: boolean;
  isMythical: boolean;
  isBaby: boolean;

  // Derived from the species evolution graph (computed at load time, see
  // apps/web/lib/pokedex.ts). Not stored in SQLite — depends on the full
  // species set.
  evolutionStage: EvolutionStage;
}
