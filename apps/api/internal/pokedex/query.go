package pokedex

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

// ErrNotFound is returned when a query targets a record that does not exist.
var ErrNotFound = errors.New("pokedex: not found")

// Query is the read-only API the rest of the application uses to read the
// Pokédex. Implementations are backed by SQLite (production) or in-memory
// fixtures (tests).
type Query interface {
	GetByID(ctx context.Context, id int64) (Pokemon, error)
	GetBySlug(ctx context.Context, slug string) (Pokemon, error)
	List(ctx context.Context) ([]Pokemon, error)
}

// SQLQuery implements Query against a *sql.DB.
type SQLQuery struct {
	db *sql.DB
}

// NewSQLQuery wraps a *sql.DB with the Query interface.
func NewSQLQuery(db *sql.DB) *SQLQuery {
	return &SQLQuery{db: db}
}

// GetByID returns the Pokemon with the given id (or ErrNotFound).
func (q *SQLQuery) GetByID(ctx context.Context, id int64) (Pokemon, error) {
	row := q.db.QueryRowContext(ctx, `
		SELECT
			id, species_id, form_id, slug, display_name, generation_id,
			is_default, pokeapi_order,
			height_dm, weight_hg, base_experience,
			sprite_url, shiny_sprite_url, official_artwork_url, cry_url, pokedex_db_url,
			content_hash
		FROM pokemon WHERE id = ?
	`, id)
	return q.scanAndDecorate(ctx, row)
}

// GetBySlug returns the Pokemon with the given slug (or ErrNotFound).
func (q *SQLQuery) GetBySlug(ctx context.Context, slug string) (Pokemon, error) {
	row := q.db.QueryRowContext(ctx, `
		SELECT
			id, species_id, form_id, slug, display_name, generation_id,
			is_default, pokeapi_order,
			height_dm, weight_hg, base_experience,
			sprite_url, shiny_sprite_url, official_artwork_url, cry_url, pokedex_db_url,
			content_hash
		FROM pokemon WHERE slug = ?
	`, slug)
	return q.scanAndDecorate(ctx, row)
}

// List returns every Pokemon ordered by PokeAPI's canonical sort order.
// N+1 query pattern is acceptable at ~1300 rows; can be optimized later.
func (q *SQLQuery) List(ctx context.Context) ([]Pokemon, error) {
	rows, err := q.db.QueryContext(ctx, `
		SELECT
			id, species_id, form_id, slug, display_name, generation_id,
			is_default, pokeapi_order,
			height_dm, weight_hg, base_experience,
			sprite_url, shiny_sprite_url, official_artwork_url, cry_url, pokedex_db_url,
			content_hash
		FROM pokemon ORDER BY pokeapi_order, id
	`)
	if err != nil {
		return nil, fmt.Errorf("list pokemon: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var pokemon []Pokemon
	for rows.Next() {
		p, err := scanPokemonBase(rows)
		if err != nil {
			return nil, fmt.Errorf("scan pokemon: %w", err)
		}
		pokemon = append(pokemon, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate pokemon: %w", err)
	}

	for i := range pokemon {
		if err := q.decorate(ctx, &pokemon[i]); err != nil {
			return nil, fmt.Errorf("decorate pokemon %d: %w", pokemon[i].ID, err)
		}
	}
	return pokemon, nil
}

// scanAndDecorate handles the GetByID / GetBySlug shared tail.
func (q *SQLQuery) scanAndDecorate(ctx context.Context, row *sql.Row) (Pokemon, error) {
	p, err := scanPokemonBase(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Pokemon{}, ErrNotFound
	}
	if err != nil {
		return Pokemon{}, fmt.Errorf("fetch pokemon: %w", err)
	}
	if err := q.decorate(ctx, &p); err != nil {
		return Pokemon{}, fmt.Errorf("decorate pokemon %d: %w", p.ID, err)
	}
	return p, nil
}

// scanner is the narrow row-scanning surface that *sql.Row and *sql.Rows share.
type scanner interface {
	Scan(dest ...any) error
}

// scanPokemonBase scans the base pokemon columns. Caller decorates with types,
// stats, and tags via decorate().
func scanPokemonBase(s scanner) (Pokemon, error) {
	var (
		p         Pokemon
		isDefault int
	)
	err := s.Scan(
		&p.ID, &p.SpeciesID, &p.FormID, &p.Slug, &p.DisplayName, &p.GenerationID,
		&isDefault, &p.PokeAPIOrder,
		&p.HeightDecimeters, &p.WeightHectograms, &p.BaseExperience,
		&p.SpriteURL, &p.ShinySpriteURL, &p.OfficialArtworkURL,
		&p.CryURL, &p.PokemonDBURL, &p.ContentHash,
	)
	if err != nil {
		return Pokemon{}, err
	}
	p.IsDefault = isDefault != 0
	return p, nil
}

// decorate populates Types, Stats, and Tags via three follow-up queries.
func (q *SQLQuery) decorate(ctx context.Context, p *Pokemon) error {
	types, err := q.fetchTypes(ctx, p.ID)
	if err != nil {
		return err
	}
	p.Types = types

	stats, err := q.fetchStats(ctx, p.ID)
	if err != nil {
		return err
	}
	p.Stats = stats

	tags, err := q.fetchTags(ctx, p.ID)
	if err != nil {
		return err
	}
	p.Tags = tags
	return nil
}

func (q *SQLQuery) fetchTypes(ctx context.Context, pokemonID int64) ([]string, error) {
	rows, err := q.db.QueryContext(ctx, `
		SELECT t.slug FROM pokemon_types pt
		JOIN types t ON pt.type_id = t.id
		WHERE pt.pokemon_id = ? ORDER BY pt.slot
	`, pokemonID)
	if err != nil {
		return nil, fmt.Errorf("query types: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var out []string
	for rows.Next() {
		var slug string
		if err := rows.Scan(&slug); err != nil {
			return nil, fmt.Errorf("scan type: %w", err)
		}
		out = append(out, slug)
	}
	return out, rows.Err()
}

func (q *SQLQuery) fetchStats(ctx context.Context, pokemonID int64) (Stats, error) {
	rows, err := q.db.QueryContext(ctx, `
		SELECT s.slug, ps.base_value FROM pokemon_stats ps
		JOIN stats s ON ps.stat_id = s.id
		WHERE ps.pokemon_id = ?
	`, pokemonID)
	if err != nil {
		return Stats{}, fmt.Errorf("query stats: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var stats Stats
	for rows.Next() {
		var slug string
		var value int
		if err := rows.Scan(&slug, &value); err != nil {
			return Stats{}, fmt.Errorf("scan stat: %w", err)
		}
		switch slug {
		case "hp":
			stats.HP = value
		case "attack":
			stats.Attack = value
		case "defense":
			stats.Defense = value
		case "special-attack":
			stats.SpecialAttack = value
		case "special-defense":
			stats.SpecialDefense = value
		case "speed":
			stats.Speed = value
		}
	}
	return stats, rows.Err()
}

func (q *SQLQuery) fetchTags(ctx context.Context, pokemonID int64) ([]string, error) {
	rows, err := q.db.QueryContext(ctx, `
		SELECT t.slug FROM pokemon_tags pt
		JOIN tags t ON pt.tag_id = t.id
		WHERE pt.pokemon_id = ? ORDER BY t.slug
	`, pokemonID)
	if err != nil {
		return nil, fmt.Errorf("query tags: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var out []string
	for rows.Next() {
		var slug string
		if err := rows.Scan(&slug); err != nil {
			return nil, fmt.Errorf("scan tag: %w", err)
		}
		out = append(out, slug)
	}
	return out, rows.Err()
}
