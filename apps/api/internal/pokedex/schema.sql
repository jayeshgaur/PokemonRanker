-- Pokemon Ranker — Pokédex schema (read-only).
--
-- This schema is rebuilt from upstream PokeAPI data on every bulk sync.
-- Source of truth: github.com/PokeAPI/api-data + apps/api/data/tags.yaml.
-- Relevant ADRs: D-1 (form identity), D-2 (curated tags), D-4 (storage),
-- D-17 / D-21 (sprite/cry hot-link → R2 mirror), D-22 (single deploy).
--
-- The atomic competitor unit is the `pokemon` row, defined as a (species, form)
-- tuple. Charmander, Charmeleon, Charizard, Mega Charizard X, Mega Charizard Y,
-- and Gigantamax Charizard are six distinct rows.
--
-- All CREATE statements are IF NOT EXISTS so the schema applies idempotently.
-- When the schema changes, bump SchemaVersion in schema.go.
--
-- Schema v2 (2026-04-28) — Phase 1.B.1 expansion: adds PokeAPI fields the
-- data-sync agent flagged as cheap-now / migration-later, trimmed by the PM
-- planning gate to only those columns with foreseeable v1 use. The deferred
-- columns and the `localized_names` table are tracked in OPEN_QUESTIONS.md.

PRAGMA foreign_keys = ON;

-- Schema versioning. The Go-side constant SchemaVersion gates this.
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

-- Sync provenance — one row per sync run (bulk, delta, drift-check).
CREATE TABLE IF NOT EXISTS sync_meta (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ran_at TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('bulk', 'delta', 'drift-check')),
  api_data_commit_sha TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  record_counts_json TEXT NOT NULL DEFAULT '{}',
  schema_version INTEGER NOT NULL,
  binary_version TEXT NOT NULL DEFAULT '',
  tags_yaml_sha TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'failed', 'partial')),
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_meta_ran_at ON sync_meta (ran_at);

-- Generations.
CREATE TABLE IF NOT EXISTS generations (
  id INTEGER PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  region TEXT NOT NULL,
  main_versions TEXT NOT NULL DEFAULT ''
);

-- Species. v2 adds: forms_switchable, evolves_from_species_id (self-FK),
-- pokeapi_order. Other PokeAPI species fields (gender_rate, growth_rate,
-- capture_rate, etc.) deferred per planning gate (PM agent, 2026-04-28) until
-- a feature demands them.
CREATE TABLE IF NOT EXISTS species (
  id INTEGER PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  pokedex_number INTEGER NOT NULL,
  generation_id INTEGER NOT NULL REFERENCES generations(id),
  is_legendary INTEGER NOT NULL DEFAULT 0,
  is_mythical INTEGER NOT NULL DEFAULT 0,
  is_baby INTEGER NOT NULL DEFAULT 0,
  color TEXT,
  shape TEXT,
  habitat TEXT,
  evolution_chain_id INTEGER,
  evolves_from_species_id INTEGER REFERENCES species(id),
  forms_switchable INTEGER NOT NULL DEFAULT 0,
  pokeapi_order INTEGER NOT NULL DEFAULT 0,
  content_hash TEXT NOT NULL DEFAULT '',
  source_commit_sha TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_species_generation ON species (generation_id);
CREATE INDEX IF NOT EXISTS idx_species_pokedex_number ON species (pokedex_number);
CREATE INDEX IF NOT EXISTS idx_species_evolves_from ON species (evolves_from_species_id);

-- Forms (the variant within a species). v2 adds: pokeapi_order, pokeapi_form_order.
-- Form identity is `slug` (unique across all forms). Schema v3 (2026-04-29)
-- removed an earlier `UNIQUE(species_id, form_name)` constraint that turned
-- out to be a false invariant — Urshifu has two distinct pokemon entities
-- (single-strike + rapid-strike) on species 892 and each carries a gmax
-- form whose form_name is "gmax", which legitimately collides under the old
-- constraint. The slug differentiates them (urshifu-single-strike-gmax vs
-- urshifu-rapid-strike-gmax) and is the real uniqueness criterion.
-- Partial unique index on is_default = 1 still prevents multiple species-
-- default forms (FormIngester ANDs form.is_default with parent pokemon's
-- is_default — see data-sync 1.B gate review §A).
-- introduced_in_version_group deferred (planning gate, 2026-04-28).
CREATE TABLE IF NOT EXISTS forms (
  id INTEGER PRIMARY KEY,
  species_id INTEGER NOT NULL REFERENCES species(id),
  slug TEXT UNIQUE NOT NULL,
  form_name TEXT NOT NULL DEFAULT '',
  is_default INTEGER NOT NULL DEFAULT 0,
  is_mega INTEGER NOT NULL DEFAULT 0,
  is_gmax INTEGER NOT NULL DEFAULT 0,
  is_battle_only INTEGER NOT NULL DEFAULT 0,
  is_regional_variant INTEGER NOT NULL DEFAULT 0,
  introduced_in_generation_id INTEGER REFERENCES generations(id),
  pokeapi_order INTEGER NOT NULL DEFAULT 0,
  pokeapi_form_order INTEGER NOT NULL DEFAULT 0,
  content_hash TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_forms_species ON forms (species_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_forms_default_per_species
  ON forms (species_id) WHERE is_default = 1;

-- Pokemon — the atomic competitor unit, one row per (species, form). See D-1.
-- v2 adds: is_default, pokeapi_order.
CREATE TABLE IF NOT EXISTS pokemon (
  id INTEGER PRIMARY KEY,
  species_id INTEGER NOT NULL REFERENCES species(id),
  form_id INTEGER NOT NULL REFERENCES forms(id) UNIQUE,
  slug TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  generation_id INTEGER NOT NULL REFERENCES generations(id),
  is_default INTEGER NOT NULL DEFAULT 0,
  pokeapi_order INTEGER NOT NULL DEFAULT 0,
  height_dm INTEGER NOT NULL DEFAULT 0,
  weight_hg INTEGER NOT NULL DEFAULT 0,
  base_experience INTEGER NOT NULL DEFAULT 0,
  sprite_url TEXT NOT NULL DEFAULT '',
  shiny_sprite_url TEXT NOT NULL DEFAULT '',
  official_artwork_url TEXT NOT NULL DEFAULT '',
  cry_url TEXT NOT NULL DEFAULT '',
  pokedex_db_url TEXT NOT NULL DEFAULT '',
  content_hash TEXT NOT NULL DEFAULT '',
  source_commit_sha TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_pokemon_species ON pokemon (species_id);
CREATE INDEX IF NOT EXISTS idx_pokemon_generation ON pokemon (generation_id);

-- Types.
CREATE TABLE IF NOT EXISTS types (
  id INTEGER PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pokemon_types (
  pokemon_id INTEGER NOT NULL REFERENCES pokemon(id) ON DELETE CASCADE,
  type_id INTEGER NOT NULL REFERENCES types(id),
  slot INTEGER NOT NULL CHECK (slot IN (1, 2)),
  PRIMARY KEY (pokemon_id, slot),
  UNIQUE (pokemon_id, type_id)
);

CREATE INDEX IF NOT EXISTS idx_pokemon_types_type ON pokemon_types (type_id);

-- Stats (6 fixed: hp, attack, defense, special-attack, special-defense, speed).
CREATE TABLE IF NOT EXISTS stats (
  id INTEGER PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pokemon_stats (
  pokemon_id INTEGER NOT NULL REFERENCES pokemon(id) ON DELETE CASCADE,
  stat_id INTEGER NOT NULL REFERENCES stats(id),
  base_value INTEGER NOT NULL CHECK (base_value BETWEEN 0 AND 255),
  effort INTEGER NOT NULL DEFAULT 0 CHECK (effort BETWEEN 0 AND 3),
  PRIMARY KEY (pokemon_id, stat_id)
);

CREATE INDEX IF NOT EXISTS idx_pokemon_stats_stat_value
  ON pokemon_stats (stat_id, base_value);

-- Abilities. v2 adds: is_main_series. abilities.generation_id deferred per
-- planning gate (2026-04-28).
CREATE TABLE IF NOT EXISTS abilities (
  id INTEGER PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  short_effect TEXT NOT NULL DEFAULT '',
  effect TEXT NOT NULL DEFAULT '',
  is_main_series INTEGER NOT NULL DEFAULT 0,
  content_hash TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS pokemon_abilities (
  pokemon_id INTEGER NOT NULL REFERENCES pokemon(id) ON DELETE CASCADE,
  ability_id INTEGER NOT NULL REFERENCES abilities(id),
  slot INTEGER NOT NULL CHECK (slot IN (1, 2, 3)),
  is_hidden INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (pokemon_id, slot)
);

CREATE INDEX IF NOT EXISTS idx_pokemon_abilities_ability ON pokemon_abilities (ability_id);

-- Moves. v2 adds: target. moves.effect_chance deferred per planning gate (2026-04-28).
CREATE TABLE IF NOT EXISTS moves (
  id INTEGER PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  type_id INTEGER REFERENCES types(id),
  damage_class TEXT NOT NULL DEFAULT '' CHECK (damage_class IN ('physical', 'special', 'status', '')),
  power INTEGER,
  accuracy INTEGER,
  pp INTEGER,
  priority INTEGER NOT NULL DEFAULT 0,
  target TEXT NOT NULL DEFAULT '',
  short_effect TEXT NOT NULL DEFAULT '',
  effect TEXT NOT NULL DEFAULT '',
  content_hash TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS pokemon_moves (
  pokemon_id INTEGER NOT NULL REFERENCES pokemon(id) ON DELETE CASCADE,
  move_id INTEGER NOT NULL REFERENCES moves(id),
  learn_method TEXT NOT NULL,
  learn_level INTEGER,
  generation_id INTEGER NOT NULL REFERENCES generations(id),
  PRIMARY KEY (pokemon_id, move_id, learn_method, generation_id)
);

CREATE INDEX IF NOT EXISTS idx_pokemon_moves_move ON pokemon_moves (move_id);
CREATE INDEX IF NOT EXISTS idx_pokemon_moves_learn_method
  ON pokemon_moves (learn_method);

-- Evolution chains and edges. v2 adds: evolutions.gender, evolutions.time_of_day.
CREATE TABLE IF NOT EXISTS evolution_chains (
  id INTEGER PRIMARY KEY,
  baby_trigger_item TEXT
);

CREATE TABLE IF NOT EXISTS evolutions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chain_id INTEGER NOT NULL REFERENCES evolution_chains(id),
  from_species_id INTEGER REFERENCES species(id),
  to_species_id INTEGER NOT NULL REFERENCES species(id),
  trigger TEXT NOT NULL DEFAULT '',
  min_level INTEGER,
  item TEXT,
  gender INTEGER,
  time_of_day TEXT NOT NULL DEFAULT '',
  conditions_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_evolutions_chain ON evolutions (chain_id);
CREATE INDEX IF NOT EXISTS idx_evolutions_to ON evolutions (to_species_id);

-- Flavor text (Pokédex entries) per (species, language, version).
CREATE TABLE IF NOT EXISTS flavor_text (
  species_id INTEGER NOT NULL REFERENCES species(id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  version TEXT NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY (species_id, language, version)
);

-- (localized_names table deferred per planning gate, 2026-04-28; will be added
-- when i18n traffic actually warrants. Tracked in OPEN_QUESTIONS.md.)

-- Tags (curated overlay from tags.yaml). See D-2, D-23.
CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT ''
);

-- Many-to-many: a Pokemon can carry multiple tags
-- (e.g., Necrozma-Ultra is both `legendary` and `ultra_beast`).
CREATE TABLE IF NOT EXISTS pokemon_tags (
  pokemon_id INTEGER NOT NULL REFERENCES pokemon(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (pokemon_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_pokemon_tags_tag ON pokemon_tags (tag_id);
