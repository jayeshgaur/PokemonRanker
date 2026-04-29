// SQLite reader for the Phase 1 Pokédex (per D-22: Next.js reads SQLite via
// better-sqlite3, no Go HTTP backend at runtime). Server-only — better-sqlite3
// is a Node native binding and can't run in Edge or in the client bundle.

import "server-only";
import path from "node:path";
import { existsSync } from "node:fs";
import Database from "better-sqlite3";
import type {
  EvolutionStage,
  Pokemon,
  Stats,
} from "@pokemon-ranker/shared";

export interface Facets {
  generations: { id: number; name: string }[];
  types: { slug: string; name: string }[];
  tags: { slug: string; name: string }[];
}

export interface PokedexSnapshot {
  pool: Pokemon[];
  facets: Facets;
}

let cached: PokedexSnapshot | null = null;
let cachedDbPath: string | null = null;

function dbPath(): string {
  if (process.env.POKEDEX_DB_PATH) return process.env.POKEDEX_DB_PATH;
  const candidates = [
    // Production / Vercel: the SQLite is bundled with the web app via
    // next.config.ts `outputFileTracingIncludes`. cwd on a Vercel
    // serverless function points at the Next.js project root (apps/web).
    path.join(process.cwd(), "data", "pokedex.sqlite"),
    // Local dev (cwd = apps/web from `next dev`).
    path.join(process.cwd(), "..", "..", "apps", "web", "data", "pokedex.sqlite"),
    // Local dev (cwd = repo root from `make web`).
    path.join(process.cwd(), "apps", "web", "data", "pokedex.sqlite"),
    // Legacy: the freshly-built api-side artifact (kept for `make sync` flow).
    path.join(process.cwd(), "..", "api", "data", "pokedex.sqlite"),
    path.join(process.cwd(), "apps", "api", "data", "pokedex.sqlite"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0]!;
}

export function pokedexAvailable(): boolean {
  return existsSync(dbPath());
}

export function pokedexPathHint(): string {
  return dbPath();
}

interface PokemonRow {
  id: number;
  species_id: number;
  form_id: number;
  slug: string;
  display_name: string;
  generation_id: number;
  is_default: number;
  sprite_url: string;
  shiny_sprite_url: string;
  official_artwork_url: string;
  cry_url: string;
  pokedex_db_url: string;
  is_mega: number;
  is_gmax: number;
  is_battle_only: number;
  is_regional_variant: number;
  is_legendary: number;
  is_mythical: number;
  is_baby: number;
}

interface SpeciesEvoRow {
  id: number;
  evolves_from_species_id: number | null;
}

interface SlugJoin {
  pokemon_id: number;
  slug: string;
}

interface StatJoin {
  pokemon_id: number;
  slug: string;
  base_value: number;
}

export function loadPokedex(): PokedexSnapshot {
  const dbFile = dbPath();
  if (cached && cachedDbPath === dbFile) return cached;
  if (!pokedexAvailable()) {
    cached = { pool: [], facets: { generations: [], types: [], tags: [] } };
    cachedDbPath = dbFile;
    return cached;
  }

  const db = new Database(dbFile, { readonly: true, fileMustExist: true });
  try {
    db.pragma("foreign_keys = ON");

    const rows = db
      .prepare(
        `SELECT
           p.id, p.species_id, p.form_id, p.slug, p.display_name,
           p.generation_id, p.is_default,
           p.sprite_url, p.shiny_sprite_url, p.official_artwork_url,
           p.cry_url, p.pokedex_db_url,
           f.is_mega, f.is_gmax, f.is_battle_only, f.is_regional_variant,
           s.is_legendary, s.is_mythical, s.is_baby
         FROM pokemon p
         JOIN forms f ON f.id = p.form_id
         JOIN species s ON s.id = p.species_id
         ORDER BY p.pokeapi_order, p.id`,
      )
      .all() as PokemonRow[];

    const speciesEvo = db
      .prepare(`SELECT id, evolves_from_species_id FROM species`)
      .all() as SpeciesEvoRow[];
    const stageBySpecies = computeEvolutionStages(speciesEvo);

    const typeRows = db
      .prepare(
        `SELECT pt.pokemon_id AS pokemon_id, t.slug AS slug
         FROM pokemon_types pt
         JOIN types t ON t.id = pt.type_id
         ORDER BY pt.pokemon_id, pt.slot`,
      )
      .all() as SlugJoin[];
    const typesByPokemon = groupSlugs(typeRows);

    const statRows = db
      .prepare(
        `SELECT ps.pokemon_id AS pokemon_id, s.slug AS slug, ps.base_value AS base_value
         FROM pokemon_stats ps
         JOIN stats s ON s.id = ps.stat_id`,
      )
      .all() as StatJoin[];
    const statsByPokemon = groupStats(statRows);

    const tagRows = db
      .prepare(
        `SELECT pt.pokemon_id AS pokemon_id, t.slug AS slug
         FROM pokemon_tags pt
         JOIN tags t ON t.id = pt.tag_id
         ORDER BY pt.pokemon_id, t.slug`,
      )
      .all() as SlugJoin[];
    const tagsByPokemon = groupSlugs(tagRows);

    const pool: Pokemon[] = rows.map((r) => ({
      id: r.id,
      speciesId: r.species_id,
      formId: r.form_id,
      slug: r.slug,
      displayName: r.display_name,
      generationId: r.generation_id,
      isDefault: r.is_default === 1,
      types: typesByPokemon.get(r.id) ?? [],
      stats: statsByPokemon.get(r.id) ?? zeroStats(),
      spriteUrl: r.sprite_url,
      shinySpriteUrl: r.shiny_sprite_url,
      officialArtworkUrl: r.official_artwork_url,
      cryUrl: r.cry_url,
      pokedexDbUrl: r.pokedex_db_url,
      tags: tagsByPokemon.get(r.id) ?? [],
      isMega: r.is_mega === 1,
      isGmax: r.is_gmax === 1,
      isBattleOnly: r.is_battle_only === 1,
      isRegionalVariant: r.is_regional_variant === 1,
      isLegendary: r.is_legendary === 1,
      isMythical: r.is_mythical === 1,
      isBaby: r.is_baby === 1,
      evolutionStage: stageBySpecies.get(r.species_id) ?? "final",
    }));

    const generations = db
      .prepare(`SELECT id, name FROM generations ORDER BY id`)
      .all() as { id: number; name: string }[];
    const types = db
      .prepare(`SELECT slug, name FROM types ORDER BY name`)
      .all() as { slug: string; name: string }[];
    const tags = db
      .prepare(`SELECT slug, name FROM tags ORDER BY name`)
      .all() as { slug: string; name: string }[];

    cached = { pool, facets: { generations, types, tags } };
    cachedDbPath = dbFile;
    return cached;
  } finally {
    db.close();
  }
}

// Compute the evolution stage of every species from the (id, evolves_from)
// graph. A species is:
//   - "first"  if it has no parent AND at least one descendant (Charmander)
//   - "middle" if it has a parent AND descendants (Charmeleon)
//   - "final"  if it has no descendants (Charizard, Tauros, Mewtwo, …)
//
// Single-stage species (no parent, no descendants — Tauros, Lapras) collapse
// to "final", which matches casual user expectation: ranking "final
// evolutions" should include them.
export function computeEvolutionStages(
  rows: SpeciesEvoRow[],
): Map<number, EvolutionStage> {
  const parentSet = new Set<number>();
  for (const r of rows) {
    if (r.evolves_from_species_id !== null) {
      parentSet.add(r.evolves_from_species_id);
    }
  }
  const result = new Map<number, EvolutionStage>();
  for (const r of rows) {
    const hasParent = r.evolves_from_species_id !== null;
    const hasDescendants = parentSet.has(r.id);
    let stage: EvolutionStage;
    if (!hasDescendants) stage = "final";
    else if (!hasParent) stage = "first";
    else stage = "middle";
    result.set(r.id, stage);
  }
  return result;
}

function groupSlugs(rows: SlugJoin[]): Map<number, string[]> {
  const m = new Map<number, string[]>();
  for (const r of rows) {
    let arr = m.get(r.pokemon_id);
    if (!arr) {
      arr = [];
      m.set(r.pokemon_id, arr);
    }
    arr.push(r.slug);
  }
  return m;
}

function groupStats(rows: StatJoin[]): Map<number, Stats> {
  const m = new Map<number, Stats>();
  for (const r of rows) {
    let s = m.get(r.pokemon_id);
    if (!s) {
      s = zeroStats();
      m.set(r.pokemon_id, s);
    }
    switch (r.slug) {
      case "hp":
        s.hp = r.base_value;
        break;
      case "attack":
        s.attack = r.base_value;
        break;
      case "defense":
        s.defense = r.base_value;
        break;
      case "special-attack":
        s.specialAttack = r.base_value;
        break;
      case "special-defense":
        s.specialDefense = r.base_value;
        break;
      case "speed":
        s.speed = r.base_value;
        break;
    }
  }
  return m;
}

function zeroStats(): Stats {
  return {
    hp: 0,
    attack: 0,
    defense: 0,
    specialAttack: 0,
    specialDefense: 0,
    speed: 0,
  };
}
