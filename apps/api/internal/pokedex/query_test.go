package pokedex_test

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/jayesh/pokemon-ranker/api/internal/pokedex"
)

// seedQueryFixture inserts one species + form + pokemon row plus types/stats/tags
// so the SQLQuery methods have something to return.
func seedQueryFixture(t *testing.T, db *sql.DB) {
	t.Helper()
	_, err := db.Exec(`
		INSERT INTO generations (id, slug, name, region) VALUES (1, 'generation-i', 'Generation I', 'kanto');
		INSERT INTO species (id, slug, name, pokedex_number, generation_id)
			VALUES (6, 'charizard', 'Charizard', 6, 1);
		INSERT INTO forms (id, species_id, slug, form_name, is_default)
			VALUES (6, 6, 'charizard', '', 1);
		INSERT INTO pokemon (id, species_id, form_id, slug, display_name, generation_id,
		                     is_default, pokeapi_order, height_dm, weight_hg, base_experience,
		                     sprite_url, pokedex_db_url)
			VALUES (6, 6, 6, 'charizard', 'Charizard', 1,
			        1, 7, 17, 905, 267,
			        'https://example.test/sprite.png', 'https://pokemondb.net/pokedex/charizard');

		INSERT INTO types (id, slug, name) VALUES
			(3, 'flying', 'Flying'),
			(10, 'fire', 'Fire');
		INSERT INTO pokemon_types (pokemon_id, type_id, slot) VALUES
			(6, 10, 1),
			(6, 3, 2);

		INSERT INTO stats (id, slug, name) VALUES
			(1, 'hp', 'HP'), (2, 'attack', 'Attack'), (3, 'defense', 'Defense'),
			(4, 'special-attack', 'Special Attack'), (5, 'special-defense', 'Special Defense'),
			(6, 'speed', 'Speed');
		INSERT INTO pokemon_stats (pokemon_id, stat_id, base_value) VALUES
			(6, 1, 78), (6, 2, 84), (6, 3, 78),
			(6, 4, 109), (6, 5, 85), (6, 6, 100);

		INSERT INTO tags (slug, name) VALUES ('starter-final', 'Starter Final');
		INSERT INTO pokemon_tags (pokemon_id, tag_id) VALUES (6, 1);
	`)
	require.NoError(t, err)
}

func TestSQLQuery_GetByID(t *testing.T) {
	db, err := pokedex.Open(context.Background(), ":memory:")
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	seedQueryFixture(t, db)

	q := pokedex.NewSQLQuery(db)
	p, err := q.GetByID(context.Background(), 6)
	require.NoError(t, err)

	assert.Equal(t, int64(6), p.ID)
	assert.Equal(t, "charizard", p.Slug)
	assert.Equal(t, "Charizard", p.DisplayName)
	assert.Equal(t, int64(1), p.GenerationID)
	assert.True(t, p.IsDefault)
	assert.Equal(t, []string{"fire", "flying"}, p.Types, "types ordered by slot")
	assert.Equal(t, 78, p.Stats.HP)
	assert.Equal(t, 84, p.Stats.Attack)
	assert.Equal(t, 109, p.Stats.SpecialAttack)
	assert.Equal(t, 534, p.Stats.BST())
	assert.Equal(t, []string{"starter-final"}, p.Tags)
	assert.Equal(t, "https://pokemondb.net/pokedex/charizard", p.PokemonDBURL)
}

func TestSQLQuery_GetByID_NotFound(t *testing.T) {
	db, err := pokedex.Open(context.Background(), ":memory:")
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	q := pokedex.NewSQLQuery(db)
	_, err = q.GetByID(context.Background(), 999)
	assert.True(t, errors.Is(err, pokedex.ErrNotFound), "missing id should map to ErrNotFound")
}

func TestSQLQuery_GetBySlug(t *testing.T) {
	db, err := pokedex.Open(context.Background(), ":memory:")
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	seedQueryFixture(t, db)

	q := pokedex.NewSQLQuery(db)
	p, err := q.GetBySlug(context.Background(), "charizard")
	require.NoError(t, err)
	assert.Equal(t, int64(6), p.ID)

	_, err = q.GetBySlug(context.Background(), "missingno")
	assert.True(t, errors.Is(err, pokedex.ErrNotFound))
}

func TestSQLQuery_List(t *testing.T) {
	db, err := pokedex.Open(context.Background(), ":memory:")
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	seedQueryFixture(t, db)

	q := pokedex.NewSQLQuery(db)
	list, err := q.List(context.Background())
	require.NoError(t, err)
	require.Len(t, list, 1)
	assert.Equal(t, "charizard", list[0].Slug)
	assert.Equal(t, []string{"fire", "flying"}, list[0].Types)
}
