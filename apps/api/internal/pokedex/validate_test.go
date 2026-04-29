package pokedex_test

import (
	"context"
	"database/sql"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/jayesh/pokemon-ranker/api/internal/pokedex"
)

// TestValidate_EmptyDB exercises every check on an empty database. Most
// checks produce issues (e.g., 0 pokemon < 1300 lower bound; pseudo-legendaries
// don't exist). The point is to verify that the suite reports issues rather
// than silently passing — which was the 1.B gate blocker (code-reviewer B-1).
func TestValidate_EmptyDB(t *testing.T) {
	db := openValidateTestDB(t)

	issues, err := pokedex.Validate(context.Background(), db)
	require.NoError(t, err, "validate should not return an error even when checks fail")

	// On an empty DB, the total-count check, all 10 pseudo-legendary checks,
	// the form-count checks for charizard/mewtwo/necrozma, the BST/HP canaries,
	// and the species-default check should all fail. Loose lower bound:
	assert.GreaterOrEqual(t, len(issues), 14,
		"empty DB should produce at least 14 issues (got %d)", len(issues))

	// Make sure the total-count check specifically is present.
	var foundTotalIssue bool
	for _, i := range issues {
		if i.Test == "total_pokemon_in_band" {
			foundTotalIssue = true
			assert.Equal(t, "0", i.Got)
			break
		}
	}
	assert.True(t, foundTotalIssue, "total_pokemon_in_band issue must be reported")
}

// TestValidate_IssueDetailsArePropagated ensures the helper preserves
// per-issue Got / Want / Test fields so `pokedex-sync validate` output is
// actionable.
func TestValidate_IssueDetailsArePropagated(t *testing.T) {
	db := openValidateTestDB(t)

	issues, err := pokedex.Validate(context.Background(), db)
	require.NoError(t, err)

	for _, i := range issues {
		assert.NotEmpty(t, i.Test, "every issue must have a Test name")
		assert.NotEmpty(t, i.Want, "every issue must have a Want value")
		assert.NotEmpty(t, i.Got, "every issue must have a Got value")
	}
}

// TestValidate_HappyPath_PartialFixture seeds enough of the canonical species
// to satisfy the structural checks (count band, types, stats, abilities) and
// confirms validate reports the *remaining* issues correctly. We don't pretend
// to seed 1300 pokemon — instead we assert which checks fail vs pass on the
// fixture so future code changes that break a check are caught.
func TestValidate_HappyPath_PartialFixture(t *testing.T) {
	db := openValidateTestDB(t)
	seedValidateFixture(t, db)

	issues, err := pokedex.Validate(context.Background(), db)
	require.NoError(t, err)

	// Build a quick set of test names that failed.
	failed := map[string]bool{}
	for _, i := range issues {
		failed[i.Test] = true
	}

	// With a single Charizard seeded:
	// - structural per-row checks (types, stats, abilities) should PASS.
	assert.False(t, failed["every_pokemon_has_1_or_2_types"], "types check should pass on fixture")
	assert.False(t, failed["every_pokemon_has_6_stats"], "stats check should pass on fixture")
	assert.False(t, failed["every_pokemon_has_1_to_3_abilities"], "abilities check should pass on fixture")
	// - default-consistency checks should PASS (we set both is_defaults to 1).
	assert.False(t, failed["pokemon_is_default_matches_form_is_default"], "default-consistency check should pass")
	// - count-band check should still FAIL (1 pokemon < 1300).
	assert.True(t, failed["total_pokemon_in_band"], "count-band check should fail on a 1-pokemon fixture")
	// - the 10 pseudo-legendary existence checks should still FAIL (we only seeded charizard).
	assert.True(t, failed["pseudo_legendary_exists:dragonite"], "pseudo-legendary check should fail")
}

// openValidateTestDB returns a fresh in-memory SQLite with the schema applied.
func openValidateTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := pokedex.Open(context.Background(), ":memory:")
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	return db
}

// seedValidateFixture inserts a minimal Charizard with all the per-row data
// (types, stats, abilities) so structural checks pass.
func seedValidateFixture(t *testing.T, db *sql.DB) {
	t.Helper()
	_, err := db.Exec(`
		INSERT INTO generations (id, slug, name, region) VALUES (1, 'generation-i', 'Generation I', 'kanto');
		INSERT INTO species (id, slug, name, pokedex_number, generation_id) VALUES (6, 'charizard', 'Charizard', 6, 1);
		INSERT INTO forms (id, species_id, slug, form_name, is_default) VALUES (6, 6, 'charizard', '', 1);
		INSERT INTO pokemon (id, species_id, form_id, slug, display_name, generation_id, is_default)
			VALUES (6, 6, 6, 'charizard', 'Charizard', 1, 1);
		INSERT INTO types (id, slug, name) VALUES (3, 'flying', 'Flying'), (10, 'fire', 'Fire');
		INSERT INTO pokemon_types (pokemon_id, type_id, slot) VALUES (6, 10, 1), (6, 3, 2);
		INSERT INTO stats (id, slug, name) VALUES
			(1, 'hp', 'HP'), (2, 'attack', 'Attack'), (3, 'defense', 'Defense'),
			(4, 'special-attack', 'Special Attack'), (5, 'special-defense', 'Special Defense'),
			(6, 'speed', 'Speed');
		INSERT INTO pokemon_stats (pokemon_id, stat_id, base_value) VALUES
			(6, 1, 78), (6, 2, 84), (6, 3, 78),
			(6, 4, 109), (6, 5, 85), (6, 6, 100);
		INSERT INTO abilities (id, slug, name) VALUES (66, 'blaze', 'Blaze');
		INSERT INTO pokemon_abilities (pokemon_id, ability_id, slot) VALUES (6, 66, 1);
	`)
	require.NoError(t, err)
}
