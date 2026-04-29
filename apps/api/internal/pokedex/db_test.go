package pokedex_test

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/jayesh/pokemon-ranker/api/internal/pokedex"
)

// expectedTables is every table the schema must create. Update when the schema
// gains or drops a table.
var expectedTables = []string{
	"schema_version",
	"sync_meta",
	"generations",
	"species",
	"forms",
	"pokemon",
	"types",
	"pokemon_types",
	"stats",
	"pokemon_stats",
	"abilities",
	"pokemon_abilities",
	"moves",
	"pokemon_moves",
	"evolution_chains",
	"evolutions",
	"flavor_text",
	"tags",
	"pokemon_tags",
}

func TestOpen_CreatesAllExpectedTables(t *testing.T) {
	db := openInMemory(t)

	for _, name := range expectedTables {
		assert.True(t, tableExists(t, db, name), "table %q should exist", name)
	}
}

func TestOpen_RecordsSchemaVersion(t *testing.T) {
	db := openInMemory(t)

	var version int
	require.NoError(t, db.QueryRow(`SELECT version FROM schema_version`).Scan(&version))
	assert.Equal(t, pokedex.SchemaVersion, version)
}

func TestOpen_IsIdempotentOnReopen(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "pokedex.sqlite")

	db1, err := pokedex.Open(ctx, path)
	require.NoError(t, err)
	require.NoError(t, db1.Close())

	db2, err := pokedex.Open(ctx, path)
	require.NoError(t, err)
	t.Cleanup(func() { _ = db2.Close() })

	var n int
	require.NoError(t, db2.QueryRow(`SELECT COUNT(*) FROM schema_version`).Scan(&n))
	assert.Equal(t, 1, n, "schema_version row should not duplicate when re-opening")
}

func TestOpen_EnforcesForeignKeys(t *testing.T) {
	db := openInMemory(t)

	// Inserting a species pointing at a non-existent generation must fail.
	_, err := db.Exec(`
		INSERT INTO species (id, slug, name, pokedex_number, generation_id)
		VALUES (1, 'test', 'Test', 1, 999)
	`)
	require.Error(t, err, "foreign key violation should be rejected")
}

// --- Constraint tests added in the Phase 1.A blocker fix pass ---

func TestPokemonTypes_RejectsDuplicateType(t *testing.T) {
	db := openInMemory(t)
	seedBaseRows(t, db)

	// Slot 1 = Fire is fine.
	_, err := db.Exec(`INSERT INTO pokemon_types (pokemon_id, type_id, slot) VALUES (1, 10, 1)`)
	require.NoError(t, err)

	// Slot 2 = Fire (the same type again) must be rejected by UNIQUE (pokemon_id, type_id).
	_, err = db.Exec(`INSERT INTO pokemon_types (pokemon_id, type_id, slot) VALUES (1, 10, 2)`)
	require.Error(t, err, "duplicate type in slots 1 and 2 should be rejected")
}

// TestForms_AllowsDuplicateFormNameWithinSpecies pins the schema v3 contract
// (2026-04-29): two forms of the same species CAN share form_name. The form
// `slug` is the unique identity. Real PokeAPI shape that breaks the old
// UNIQUE(species_id, form_name) invariant: Urshifu (species 892) has both
// `urshifu-single-strike-gmax` and `urshifu-rapid-strike-gmax` forms, both
// with form_name="gmax", on a single species. The schema previously rejected
// the second insert; v3 allows it.
func TestForms_AllowsDuplicateFormNameWithinSpecies(t *testing.T) {
	db := openInMemory(t)
	seedSpecies(t, db)

	_, err := db.Exec(`INSERT INTO forms (id, species_id, slug, form_name, is_default) VALUES (1, 1, 'urshifu-single-strike-gmax', 'gmax', 0)`)
	require.NoError(t, err)

	_, err = db.Exec(`INSERT INTO forms (id, species_id, slug, form_name, is_default) VALUES (2, 1, 'urshifu-rapid-strike-gmax', 'gmax', 0)`)
	require.NoError(t, err, "two forms with same form_name should be allowed; slug is the unique key")
}

func TestForms_RejectsMultipleDefaultsPerSpecies(t *testing.T) {
	db := openInMemory(t)
	seedSpecies(t, db)

	_, err := db.Exec(`INSERT INTO forms (id, species_id, slug, form_name, is_default) VALUES (1, 1, 'charizard', '', 1)`)
	require.NoError(t, err)

	// Different form_name, but a second default for the same species —
	// the partial unique index idx_forms_default_per_species must reject.
	_, err = db.Exec(`INSERT INTO forms (id, species_id, slug, form_name, is_default) VALUES (2, 1, 'charizard-mega-x', 'mega-x', 1)`)
	require.Error(t, err, "two default forms for one species should be rejected")
}

func TestPokemonStats_RejectsOutOfRangeBaseValue(t *testing.T) {
	db := openInMemory(t)
	seedBaseRows(t, db)

	_, err := db.Exec(`INSERT INTO pokemon_stats (pokemon_id, stat_id, base_value) VALUES (1, 1, 256)`)
	require.Error(t, err, "base_value 256 should be rejected by CHECK")

	_, err = db.Exec(`INSERT INTO pokemon_stats (pokemon_id, stat_id, base_value) VALUES (1, 1, -1)`)
	require.Error(t, err, "base_value -1 should be rejected by CHECK")
}

func TestPokemonStats_RejectsOutOfRangeEffort(t *testing.T) {
	db := openInMemory(t)
	seedBaseRows(t, db)

	_, err := db.Exec(`INSERT INTO pokemon_stats (pokemon_id, stat_id, base_value, effort) VALUES (1, 1, 100, 4)`)
	require.Error(t, err, "effort 4 should be rejected by CHECK")
}

func TestPokemonAbilities_RejectsInvalidSlot(t *testing.T) {
	db := openInMemory(t)
	seedBaseRows(t, db)
	_, err := db.Exec(`INSERT INTO abilities (id, slug, name) VALUES (100, 'blaze', 'Blaze')`)
	require.NoError(t, err)

	_, err = db.Exec(`INSERT INTO pokemon_abilities (pokemon_id, ability_id, slot) VALUES (1, 100, 4)`)
	require.Error(t, err, "ability slot 4 should be rejected by CHECK")
}

func TestPokemon_GenerationFKEnforced(t *testing.T) {
	db := openInMemory(t)
	seedSpecies(t, db)

	_, err := db.Exec(`INSERT INTO forms (id, species_id, slug, form_name, is_default) VALUES (1, 1, 'charizard', '', 1)`)
	require.NoError(t, err)

	// Pokemon row referring to a non-existent generation must fail.
	_, err = db.Exec(`
		INSERT INTO pokemon (id, species_id, form_id, slug, display_name, generation_id)
		VALUES (1, 1, 1, 'charizard', 'Charizard', 999)
	`)
	require.Error(t, err, "pokemon.generation_id FK violation should be rejected")
}

// --- v2 schema tests (Phase 1.B.1) ---

func TestSpecies_EvolvesFromSelfFKEnforced(t *testing.T) {
	db := openInMemory(t)
	seedSpecies(t, db)

	// Pointing at a non-existent species via the self-FK must fail.
	_, err := db.Exec(`
		INSERT INTO species (id, slug, name, pokedex_number, generation_id, evolves_from_species_id)
		VALUES (2, 'charmeleon', 'Charmeleon', 5, 1, 999)
	`)
	require.Error(t, err, "species.evolves_from_species_id FK violation should be rejected")
}

// --- Helpers ---

func openInMemory(t *testing.T) *sql.DB {
	t.Helper()
	db, err := pokedex.Open(context.Background(), ":memory:")
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	return db
}

// seedSpecies inserts the minimum rows needed to satisfy species/generation FKs.
func seedSpecies(t *testing.T, db *sql.DB) {
	t.Helper()
	_, err := db.Exec(`
		INSERT INTO generations (id, slug, name, region) VALUES (1, 'generation-i', 'Generation I', 'kanto');
		INSERT INTO species (id, slug, name, pokedex_number, generation_id)
			VALUES (1, 'charizard', 'Charizard', 6, 1);
	`)
	require.NoError(t, err)
}

// seedBaseRows additionally inserts a default form, the canonical pokemon row,
// the six stats, and two types — enough to anchor pokemon_*-table tests.
func seedBaseRows(t *testing.T, db *sql.DB) {
	t.Helper()
	seedSpecies(t, db)
	_, err := db.Exec(`
		INSERT INTO forms (id, species_id, slug, form_name, is_default)
			VALUES (1, 1, 'charizard', '', 1);
		INSERT INTO pokemon (id, species_id, form_id, slug, display_name, generation_id)
			VALUES (1, 1, 1, 'charizard', 'Charizard', 1);
		INSERT INTO stats (id, slug, name) VALUES
			(1, 'hp', 'HP'),
			(2, 'attack', 'Attack'),
			(3, 'defense', 'Defense'),
			(4, 'special-attack', 'Special Attack'),
			(5, 'special-defense', 'Special Defense'),
			(6, 'speed', 'Speed');
		INSERT INTO types (id, slug, name) VALUES (10, 'fire', 'Fire'), (11, 'flying', 'Flying');
	`)
	require.NoError(t, err)
}

func tableExists(t *testing.T, db *sql.DB, name string) bool {
	t.Helper()
	var got string
	err := db.QueryRow(
		`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
		name,
	).Scan(&got)
	if err == sql.ErrNoRows {
		return false
	}
	require.NoError(t, err)
	return got == name
}
