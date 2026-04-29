package ingest_test

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/jayesh/pokemon-ranker/api/internal/pokedex"
	"github.com/jayesh/pokemon-ranker/api/internal/pokedex/ingest"
)

// fixturePath returns the on-disk testdata directory shipped with this package.
func fixturePath() string {
	return filepath.Join("testdata", "api-data")
}

// openTestDB opens a fresh in-memory pokedex SQLite for each ingester test.
func openTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := pokedex.Open(context.Background(), ":memory:")
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func TestGenerationIngester_Ingest(t *testing.T) {
	db := openTestDB(t)

	res, err := ingest.GenerationIngester{}.Ingest(context.Background(), db, fixturePath())
	require.NoError(t, err)
	assert.Equal(t, 1, res.RowCounts["generations"])

	var slug, name, region, mainVersions string
	require.NoError(t, db.QueryRow(
		`SELECT slug, name, region, main_versions FROM generations WHERE id = 1`,
	).Scan(&slug, &name, &region, &mainVersions))
	assert.Equal(t, "generation-i", slug)
	assert.Equal(t, "Generation I", name)
	assert.Equal(t, "kanto", region)
	assert.Contains(t, mainVersions, "red-blue")
	assert.Contains(t, mainVersions, "yellow")
}

func TestTypeIngester_Ingest(t *testing.T) {
	db := openTestDB(t)

	res, err := ingest.TypeIngester{}.Ingest(context.Background(), db, fixturePath())
	require.NoError(t, err)
	assert.Equal(t, 1, res.RowCounts["types"])

	var slug, name string
	require.NoError(t, db.QueryRow(
		`SELECT slug, name FROM types WHERE id = 1`,
	).Scan(&slug, &name))
	assert.Equal(t, "normal", slug)
	assert.Equal(t, "Normal", name)
}

func TestStatIngester_Ingest(t *testing.T) {
	db := openTestDB(t)

	res, err := ingest.StatIngester{}.Ingest(context.Background(), db, fixturePath())
	require.NoError(t, err)
	assert.Equal(t, 1, res.RowCounts["stats"])

	var slug, name string
	require.NoError(t, db.QueryRow(
		`SELECT slug, name FROM stats WHERE id = 1`,
	).Scan(&slug, &name))
	assert.Equal(t, "hp", slug)
	assert.Equal(t, "HP", name)
}

func TestAbilityIngester_Ingest(t *testing.T) {
	db := openTestDB(t)

	res, err := ingest.AbilityIngester{}.Ingest(context.Background(), db, fixturePath())
	require.NoError(t, err)
	assert.Equal(t, 1, res.RowCounts["abilities"])

	var (
		slug, name, shortEffect, effect string
		isMainSeries                    int
	)
	require.NoError(t, db.QueryRow(
		`SELECT slug, name, short_effect, effect, is_main_series FROM abilities WHERE id = 1`,
	).Scan(&slug, &name, &shortEffect, &effect, &isMainSeries))
	assert.Equal(t, "stench", slug)
	assert.Equal(t, "Stench", name)
	assert.Contains(t, effect, "flinch")
	assert.Equal(t, 1, isMainSeries)
}

func TestSpeciesIngester_Ingest(t *testing.T) {
	db := openTestDB(t)
	// Seed generation 1 to satisfy species.generation_id FK.
	_, err := db.Exec(`INSERT INTO generations (id, slug, name, region) VALUES (1, 'generation-i', 'Generation I', 'kanto')`)
	require.NoError(t, err)

	res, err := ingest.SpeciesIngester{}.Ingest(context.Background(), db, fixturePath())
	require.NoError(t, err)
	assert.Equal(t, 1, res.RowCounts["species"])

	var (
		slug, name              string
		pokedexNum              int
		generationID            int64
		isLegendary, isMythical int
		isBaby, formsSwitchable int
		color, shape            *string
		habitat                 *string
		evolutionChainID        *int64
		evolvesFromSpeciesID    *int64
		pokeAPIOrder            int64
	)
	require.NoError(t, db.QueryRow(`
		SELECT slug, name, pokedex_number, generation_id,
		       is_legendary, is_mythical, is_baby, forms_switchable,
		       color, shape, habitat,
		       evolution_chain_id, evolves_from_species_id, pokeapi_order
		FROM species WHERE id = 6
	`).Scan(&slug, &name, &pokedexNum, &generationID,
		&isLegendary, &isMythical, &isBaby, &formsSwitchable,
		&color, &shape, &habitat,
		&evolutionChainID, &evolvesFromSpeciesID, &pokeAPIOrder))

	assert.Equal(t, "charizard", slug)
	assert.Equal(t, "Charizard", name)
	assert.Equal(t, 6, pokedexNum)
	assert.Equal(t, int64(1), generationID)
	assert.Equal(t, 0, isLegendary)
	assert.Equal(t, 0, isMythical)
	assert.Equal(t, 0, isBaby)
	assert.Equal(t, 0, formsSwitchable)
	require.NotNil(t, color)
	assert.Equal(t, "red", *color)
	require.NotNil(t, shape)
	assert.Equal(t, "upright", *shape)
	assert.Nil(t, habitat, "Charizard has no habitat in PokeAPI post-Gen-3")
	require.NotNil(t, evolutionChainID)
	assert.Equal(t, int64(2), *evolutionChainID)
	assert.Nil(t, evolvesFromSpeciesID, "evolves_from is deferred to 1.B.3 second pass")
	assert.Equal(t, int64(7), pokeAPIOrder)
}

func TestFormIngester_Ingest(t *testing.T) {
	db := openTestDB(t)
	// Seed generation + species (species is FK target; pokemon JSON read for species lookup).
	_, err := db.Exec(`
		INSERT INTO generations (id, slug, name, region) VALUES (1, 'generation-i', 'Generation I', 'kanto');
		INSERT INTO species (id, slug, name, pokedex_number, generation_id) VALUES (6, 'charizard', 'Charizard', 6, 1);
	`)
	require.NoError(t, err)

	res, err := ingest.FormIngester{}.Ingest(context.Background(), db, fixturePath())
	require.NoError(t, err)
	assert.Equal(t, 1, res.RowCounts["forms"])

	var (
		slug, formName                                             string
		speciesID                                                  int64
		isDefault, isMega, isGmax, isBattleOnly, isRegionalVariant int
		pokeAPIOrder, pokeAPIFormOrder                             int64
	)
	require.NoError(t, db.QueryRow(`
		SELECT species_id, slug, form_name,
		       is_default, is_mega, is_gmax, is_battle_only, is_regional_variant,
		       pokeapi_order, pokeapi_form_order
		FROM forms WHERE id = 6
	`).Scan(&speciesID, &slug, &formName,
		&isDefault, &isMega, &isGmax, &isBattleOnly, &isRegionalVariant,
		&pokeAPIOrder, &pokeAPIFormOrder))

	assert.Equal(t, int64(6), speciesID)
	assert.Equal(t, "charizard", slug)
	assert.Equal(t, "", formName)
	assert.Equal(t, 1, isDefault)
	assert.Equal(t, 0, isMega)
	assert.Equal(t, 0, isGmax)
	assert.Equal(t, 0, isBattleOnly)
	assert.Equal(t, 0, isRegionalVariant)
	assert.Equal(t, int64(7), pokeAPIOrder)
	assert.Equal(t, int64(1), pokeAPIFormOrder)
}

func TestPokemonIngester_Ingest(t *testing.T) {
	db := openTestDB(t)
	// Seed generation, species, form (FK targets for pokemon).
	_, err := db.Exec(`
		INSERT INTO generations (id, slug, name, region) VALUES (1, 'generation-i', 'Generation I', 'kanto');
		INSERT INTO species (id, slug, name, pokedex_number, generation_id) VALUES (6, 'charizard', 'Charizard', 6, 1);
		INSERT INTO forms (id, species_id, slug, form_name, is_default) VALUES (6, 6, 'charizard', '', 1);
	`)
	require.NoError(t, err)

	res, err := ingest.PokemonIngester{}.Ingest(context.Background(), db, fixturePath())
	require.NoError(t, err)
	assert.Equal(t, 1, res.RowCounts["pokemon"])

	var (
		speciesID, formID, generationID int64
		slug, displayName               string
		isDefault                       int
		pokeAPIOrder                    int64
		heightDm, weightHg, baseExp     int64
		spriteURL, shinyURL, artURL     string
		cryURL, pokedexDBURL            string
	)
	require.NoError(t, db.QueryRow(`
		SELECT species_id, form_id, slug, display_name, generation_id,
		       is_default, pokeapi_order,
		       height_dm, weight_hg, base_experience,
		       sprite_url, shiny_sprite_url, official_artwork_url,
		       cry_url, pokedex_db_url
		FROM pokemon WHERE id = 6
	`).Scan(&speciesID, &formID, &slug, &displayName, &generationID,
		&isDefault, &pokeAPIOrder,
		&heightDm, &weightHg, &baseExp,
		&spriteURL, &shinyURL, &artURL,
		&cryURL, &pokedexDBURL))

	assert.Equal(t, int64(6), speciesID)
	assert.Equal(t, int64(6), formID)
	assert.Equal(t, "charizard", slug)
	assert.Equal(t, "Charizard", displayName)
	assert.Equal(t, int64(1), generationID)
	assert.Equal(t, 1, isDefault)
	assert.Equal(t, int64(7), pokeAPIOrder)
	assert.Equal(t, int64(17), heightDm)
	assert.Equal(t, int64(905), weightHg)
	assert.Equal(t, int64(267), baseExp)
	assert.Contains(t, spriteURL, "raw.githubusercontent.com")
	assert.Contains(t, shinyURL, "shiny")
	assert.Contains(t, artURL, "official-artwork")
	assert.Contains(t, cryURL, "cries")
	assert.Equal(t, "https://pokemondb.net/pokedex/charizard", pokedexDBURL)
}

func TestEvolutionIngester_Ingest(t *testing.T) {
	db := openTestDB(t)
	_, err := db.Exec(`
		INSERT INTO generations (id, slug, name, region) VALUES (1, 'generation-i', 'Generation I', 'kanto');
		INSERT INTO species (id, slug, name, pokedex_number, generation_id) VALUES
			(4, 'charmander', 'Charmander', 4, 1),
			(5, 'charmeleon', 'Charmeleon', 5, 1),
			(6, 'charizard', 'Charizard', 6, 1);
	`)
	require.NoError(t, err)

	res, err := ingest.EvolutionIngester{}.Ingest(context.Background(), db, fixturePath())
	require.NoError(t, err)
	assert.Equal(t, 1, res.RowCounts["evolution_chains"])
	assert.Equal(t, 2, res.RowCounts["evolutions"], "Charizard chain has 2 edges")

	var (
		fromSp, toSp int64
		trigger      string
		minLevel     *int
	)
	require.NoError(t, db.QueryRow(`
		SELECT from_species_id, to_species_id, trigger, min_level
		FROM evolutions WHERE chain_id = 2 AND from_species_id = 4
	`).Scan(&fromSp, &toSp, &trigger, &minLevel))
	assert.Equal(t, int64(4), fromSp)
	assert.Equal(t, int64(5), toSp)
	assert.Equal(t, "level-up", trigger)
	require.NotNil(t, minLevel)
	assert.Equal(t, 16, *minLevel)

	require.NoError(t, db.QueryRow(`
		SELECT from_species_id, to_species_id, trigger, min_level
		FROM evolutions WHERE chain_id = 2 AND from_species_id = 5
	`).Scan(&fromSp, &toSp, &trigger, &minLevel))
	assert.Equal(t, int64(5), fromSp)
	assert.Equal(t, int64(6), toSp)
	assert.Equal(t, "level-up", trigger)
	require.NotNil(t, minLevel)
	assert.Equal(t, 36, *minLevel)
}

func TestFlavorTextIngester_Ingest(t *testing.T) {
	db := openTestDB(t)
	_, err := db.Exec(`
		INSERT INTO generations (id, slug, name, region) VALUES (1, 'generation-i', 'Generation I', 'kanto');
		INSERT INTO species (id, slug, name, pokedex_number, generation_id) VALUES (6, 'charizard', 'Charizard', 6, 1);
	`)
	require.NoError(t, err)

	res, err := ingest.FlavorTextIngester{}.Ingest(context.Background(), db, fixturePath())
	require.NoError(t, err)
	assert.Equal(t, 1, res.RowCounts["flavor_text"])

	var text string
	require.NoError(t, db.QueryRow(`
		SELECT text FROM flavor_text WHERE species_id = 6 AND language = 'en' AND version = 'red'
	`).Scan(&text))
	assert.NotContains(t, text, "\f")
	assert.NotContains(t, text, "\n")
	assert.Contains(t, text, "Spits fire")
	assert.Contains(t, text, "forest fires")
}

func TestEvolvesFromBackfillIngester_Ingest(t *testing.T) {
	db := openTestDB(t)
	_, err := db.Exec(`
		INSERT INTO generations (id, slug, name, region) VALUES (1, 'generation-i', 'Generation I', 'kanto');
		INSERT INTO species (id, slug, name, pokedex_number, generation_id) VALUES
			(5, 'charmeleon', 'Charmeleon', 5, 1),
			(6, 'charizard', 'Charizard', 6, 1);
	`)
	require.NoError(t, err)

	res, err := ingest.EvolvesFromBackfillIngester{}.Ingest(context.Background(), db, fixturePath())
	require.NoError(t, err)
	assert.Equal(t, 1, res.RowCounts["species_evolves_from_updated"])

	var evolvesFrom *int64
	require.NoError(t, db.QueryRow(
		`SELECT evolves_from_species_id FROM species WHERE id = 6`,
	).Scan(&evolvesFrom))
	require.NotNil(t, evolvesFrom)
	assert.Equal(t, int64(5), *evolvesFrom)
}

func TestPokemonJoinsIngester_Ingest(t *testing.T) {
	db := openTestDB(t)

	// Seed every FK target: generation, species, form, pokemon, types (10/fire, 3/flying),
	// stats (1..6), abilities (66/blaze, 94/solar-power), moves (1/pound).
	_, err := db.Exec(`
		INSERT INTO generations (id, slug, name, region) VALUES (1, 'generation-i', 'Generation I', 'kanto');
		INSERT INTO species (id, slug, name, pokedex_number, generation_id) VALUES (6, 'charizard', 'Charizard', 6, 1);
		INSERT INTO forms (id, species_id, slug, form_name, is_default) VALUES (6, 6, 'charizard', '', 1);
		INSERT INTO pokemon (id, species_id, form_id, slug, display_name, generation_id) VALUES (6, 6, 6, 'charizard', 'Charizard', 1);
		INSERT INTO types (id, slug, name) VALUES (3, 'flying', 'Flying'), (10, 'fire', 'Fire');
		INSERT INTO stats (id, slug, name) VALUES
			(1, 'hp', 'HP'), (2, 'attack', 'Attack'), (3, 'defense', 'Defense'),
			(4, 'special-attack', 'Special Attack'), (5, 'special-defense', 'Special Defense'),
			(6, 'speed', 'Speed');
		INSERT INTO abilities (id, slug, name) VALUES (66, 'blaze', 'Blaze'), (94, 'solar-power', 'Solar Power');
		INSERT INTO moves (id, slug, name) VALUES (1, 'pound', 'Pound');
	`)
	require.NoError(t, err)

	res, err := ingest.PokemonJoinsIngester{}.Ingest(context.Background(), db, fixturePath())
	require.NoError(t, err)

	assert.Equal(t, 2, res.RowCounts["pokemon_types"])
	assert.Equal(t, 6, res.RowCounts["pokemon_stats"])
	assert.Equal(t, 2, res.RowCounts["pokemon_abilities"])
	assert.Equal(t, 1, res.RowCounts["pokemon_moves"])

	// Type slot 1 = fire, slot 2 = flying.
	var slot1, slot2 int64
	require.NoError(t, db.QueryRow(`SELECT type_id FROM pokemon_types WHERE pokemon_id = 6 AND slot = 1`).Scan(&slot1))
	assert.Equal(t, int64(10), slot1, "slot 1 should be fire (id=10)")
	require.NoError(t, db.QueryRow(`SELECT type_id FROM pokemon_types WHERE pokemon_id = 6 AND slot = 2`).Scan(&slot2))
	assert.Equal(t, int64(3), slot2, "slot 2 should be flying (id=3)")

	// Stat HP = 78, BST sums to 530.
	var hp, bst int
	require.NoError(t, db.QueryRow(`SELECT base_value FROM pokemon_stats WHERE pokemon_id = 6 AND stat_id = 1`).Scan(&hp))
	assert.Equal(t, 78, hp)
	require.NoError(t, db.QueryRow(`SELECT SUM(base_value) FROM pokemon_stats WHERE pokemon_id = 6`).Scan(&bst))
	assert.Equal(t, 534, bst, "Charizard BST = 78+84+78+109+85+100 = 534")

	// Hidden ability is solar-power, slot 3.
	var abilityID int64
	var isHidden int
	require.NoError(t, db.QueryRow(`SELECT ability_id, is_hidden FROM pokemon_abilities WHERE pokemon_id = 6 AND slot = 3`).Scan(&abilityID, &isHidden))
	assert.Equal(t, int64(94), abilityID)
	assert.Equal(t, 1, isHidden)

	// Move pound learned by level-up at level 1, generation 1.
	var moveID int64
	var learnMethod string
	var learnLevel *int
	var generationID int64
	require.NoError(t, db.QueryRow(`SELECT move_id, learn_method, learn_level, generation_id FROM pokemon_moves WHERE pokemon_id = 6`).Scan(&moveID, &learnMethod, &learnLevel, &generationID))
	assert.Equal(t, int64(1), moveID)
	assert.Equal(t, "level-up", learnMethod)
	require.NotNil(t, learnLevel)
	assert.Equal(t, 1, *learnLevel)
	assert.Equal(t, int64(1), generationID)
}

func TestMoveIngester_Ingest(t *testing.T) {
	db := openTestDB(t)
	// Pre-seed type 1 (Normal) so the FK on moves.type_id is satisfied.
	_, err := db.Exec(`INSERT INTO types (id, slug, name) VALUES (1, 'normal', 'Normal')`)
	require.NoError(t, err)

	res, err := ingest.MoveIngester{}.Ingest(context.Background(), db, fixturePath())
	require.NoError(t, err)
	assert.Equal(t, 1, res.RowCounts["moves"])

	var (
		slug, name, damageClass, target string
		typeID                          *int64
		power, accuracy, pp             *int
		priority                        int
	)
	require.NoError(t, db.QueryRow(
		`SELECT slug, name, type_id, damage_class, power, accuracy, pp, priority, target FROM moves WHERE id = 1`,
	).Scan(&slug, &name, &typeID, &damageClass, &power, &accuracy, &pp, &priority, &target))
	assert.Equal(t, "pound", slug)
	assert.Equal(t, "Pound", name)
	require.NotNil(t, typeID)
	assert.Equal(t, int64(1), *typeID)
	assert.Equal(t, "physical", damageClass)
	require.NotNil(t, power)
	assert.Equal(t, 40, *power)
	require.NotNil(t, accuracy)
	assert.Equal(t, 100, *accuracy)
	require.NotNil(t, pp)
	assert.Equal(t, 35, *pp)
	assert.Equal(t, 0, priority)
	assert.Equal(t, "selected-pokemon", target)
}
