package pokedex

import (
	"context"
	"database/sql"
	"fmt"
)

// ValidationIssue describes a single failure from Validate.
type ValidationIssue struct {
	Test   string
	Got    string
	Want   string
	Detail string
}

// Validate runs the post-sync sanity-check suite against a populated Pokédex.
// Returns the list of issues; an empty slice means every check passed.
//
// The 14 checks here are the data-sync agent's recommendations from the 1.B
// scope review. They are designed to catch the most realistic ingest bugs:
// row-count drift, FK orphans, multi-type / form-identity invariants, and
// known canary values. Run via `pokedex-sync validate` after a real bulk sync.
func Validate(ctx context.Context, db *sql.DB) ([]ValidationIssue, error) {
	var issues []ValidationIssue

	// Helpers that propagate scan errors. Silent error-swallowing was a 1.B
	// gate blocker (code-reviewer B-1) — checks 8–14 used `_ = ...Scan(&x)`
	// which let SQL failures masquerade as `x == 0` passes.
	count := func(query string, args ...any) (int, error) {
		var n int
		err := db.QueryRowContext(ctx, query, args...).Scan(&n)
		return n, err
	}
	check := func(test, want, got string, ok bool, detail string) {
		if !ok {
			issues = append(issues, ValidationIssue{Test: test, Got: got, Want: want, Detail: detail})
		}
	}

	// 1. Total pokemon count is in a sane band.
	total, err := count(`SELECT COUNT(*) FROM pokemon`)
	if err != nil {
		return nil, fmt.Errorf("count pokemon: %w", err)
	}
	check("total_pokemon_in_band", "1300..1700", fmt.Sprint(total), total >= 1300 && total <= 1700, "")

	// 2. Every pokemon has 1 or 2 types.
	typeOutliers, err := count(`
		SELECT COUNT(*) FROM (
			SELECT pokemon_id, COUNT(*) AS c FROM pokemon_types
			GROUP BY pokemon_id HAVING c NOT IN (1, 2)
		)
	`)
	if err != nil {
		return nil, fmt.Errorf("count type outliers: %w", err)
	}
	check("every_pokemon_has_1_or_2_types", "0", fmt.Sprint(typeOutliers), typeOutliers == 0, "")

	// 3. Every pokemon has exactly 6 stats.
	statOutliers, err := count(`
		SELECT COUNT(*) FROM (
			SELECT pokemon_id, COUNT(*) AS c FROM pokemon_stats
			GROUP BY pokemon_id HAVING c <> 6
		)
	`)
	if err != nil {
		return nil, fmt.Errorf("count stat outliers: %w", err)
	}
	check("every_pokemon_has_6_stats", "0", fmt.Sprint(statOutliers), statOutliers == 0, "")

	// 4. Every pokemon has 1–3 abilities.
	abilityOutliers, err := count(`
		SELECT COUNT(*) FROM (
			SELECT pokemon_id, COUNT(*) AS c FROM pokemon_abilities
			GROUP BY pokemon_id HAVING c NOT BETWEEN 1 AND 3
		)
	`)
	if err != nil {
		return nil, fmt.Errorf("count ability outliers: %w", err)
	}
	check("every_pokemon_has_1_to_3_abilities", "0", fmt.Sprint(abilityOutliers), abilityOutliers == 0, "")

	// 5. Charizard has at least 4 forms (default, mega-x, mega-y, gmax).
	// Earlier threshold was >=6, a mental-model error: Charmander and
	// Charmeleon are separate species, not forms of Charizard.
	charizardForms, err := count(`SELECT COUNT(*) FROM pokemon p JOIN species sp ON p.species_id = sp.id WHERE sp.slug = ?`, "charizard")
	if err != nil {
		return nil, fmt.Errorf("count charizard forms: %w", err)
	}
	check("charizard_has_>=4_forms", ">=4", fmt.Sprint(charizardForms), charizardForms >= 4, "")

	// 6. Mewtwo has at least 3 forms.
	mewtwoForms, err := count(`SELECT COUNT(*) FROM pokemon p JOIN species sp ON p.species_id = sp.id WHERE sp.slug = ?`, "mewtwo")
	if err != nil {
		return nil, fmt.Errorf("count mewtwo forms: %w", err)
	}
	check("mewtwo_has_>=3_forms", ">=3", fmt.Sprint(mewtwoForms), mewtwoForms >= 3, "")

	// 7. Necrozma has at least 4 forms.
	necrozmaForms, err := count(`SELECT COUNT(*) FROM pokemon p JOIN species sp ON p.species_id = sp.id WHERE sp.slug = ?`, "necrozma")
	if err != nil {
		return nil, fmt.Errorf("count necrozma forms: %w", err)
	}
	check("necrozma_has_>=4_forms", ">=4", fmt.Sprint(necrozmaForms), necrozmaForms >= 4, "")

	// 8. The 10 pseudo-legendaries from tags.yaml all exist as species.
	pseudoLegendaries := []string{
		"dragonite", "tyranitar", "salamence", "metagross", "garchomp",
		"hydreigon", "goodra", "kommo-o", "dragapult", "baxcalibur",
	}
	for _, slug := range pseudoLegendaries {
		exists, err := count(`SELECT COUNT(*) FROM species WHERE slug = ?`, slug)
		if err != nil {
			return nil, fmt.Errorf("check pseudo-legendary %s: %w", slug, err)
		}
		check("pseudo_legendary_exists:"+slug, "1", fmt.Sprint(exists), exists == 1, "")
	}

	// 9. Mewtwo's BST = 680 (Gen 1 canonical value).
	mewtwoBST, err := count(`
		SELECT COALESCE(SUM(ps.base_value), 0) FROM pokemon p
		JOIN species sp ON p.species_id = sp.id
		JOIN pokemon_stats ps ON ps.pokemon_id = p.id
		WHERE sp.slug = 'mewtwo' AND p.is_default = 1
	`)
	if err != nil {
		return nil, fmt.Errorf("compute mewtwo BST: %w", err)
	}
	check("mewtwo_default_bst_is_680", "680", fmt.Sprint(mewtwoBST), mewtwoBST == 680, "")

	// 10. Blissey HP = 255 (game maximum). Wrapped in COALESCE/sub-query so an
	// empty result set yields 0 rather than sql.ErrNoRows.
	blisseyHP, err := count(`
		SELECT COALESCE((
			SELECT ps.base_value FROM pokemon p
			JOIN species sp ON p.species_id = sp.id
			JOIN pokemon_stats ps ON ps.pokemon_id = p.id
			JOIN stats s ON ps.stat_id = s.id
			WHERE sp.slug = 'blissey' AND s.slug = 'hp' AND p.is_default = 1
		), 0)
	`)
	if err != nil {
		return nil, fmt.Errorf("compute blissey HP: %w", err)
	}
	check("blissey_hp_is_255", "255", fmt.Sprint(blisseyHP), blisseyHP == 255, "")

	// 11. Every pokemon has a non-empty slug.
	emptySlugs, err := count(`SELECT COUNT(*) FROM pokemon WHERE slug = '' OR slug IS NULL`)
	if err != nil {
		return nil, fmt.Errorf("count empty slugs: %w", err)
	}
	check("no_empty_pokemon_slugs", "0", fmt.Sprint(emptySlugs), emptySlugs == 0, "")

	// 12. Every pokemon has a non-null generation_id.
	nullGens, err := count(`SELECT COUNT(*) FROM pokemon WHERE generation_id IS NULL`)
	if err != nil {
		return nil, fmt.Errorf("count null generations: %w", err)
	}
	check("no_null_generation_ids", "0", fmt.Sprint(nullGens), nullGens == 0, "")

	// 13. Every species has a positive pokedex_number.
	badPokedex, err := count(`SELECT COUNT(*) FROM species WHERE pokedex_number IS NULL OR pokedex_number <= 0`)
	if err != nil {
		return nil, fmt.Errorf("count bad pokedex_number: %w", err)
	}
	check("species_pokedex_number_positive", "0", fmt.Sprint(badPokedex), badPokedex == 0, "")

	// 14. Every default pokemon's generation matches its species' generation.
	genMismatch, err := count(`
		SELECT COUNT(*) FROM pokemon p
		JOIN species sp ON p.species_id = sp.id
		WHERE p.is_default = 1 AND p.generation_id <> sp.generation_id
	`)
	if err != nil {
		return nil, fmt.Errorf("count gen mismatches: %w", err)
	}
	check("default_pokemon_generation_matches_species", "0", fmt.Sprint(genMismatch), genMismatch == 0, "")

	// 15. Exactly one is_default form per species (partial unique index already
	// enforces ≤1; this asserts ≥1 too, catching the species-with-zero-defaults case).
	speciesWithoutDefault, err := count(`
		SELECT COUNT(*) FROM species sp
		WHERE NOT EXISTS (SELECT 1 FROM forms f WHERE f.species_id = sp.id AND f.is_default = 1)
	`)
	if err != nil {
		return nil, fmt.Errorf("count species-without-default: %w", err)
	}
	check("every_species_has_exactly_one_default_form", "0", fmt.Sprint(speciesWithoutDefault), speciesWithoutDefault == 0, "")

	// 16. (data-sync §F) `pokemon.is_default == forms.is_default` per (species, form).
	defaultMismatch, err := count(`
		SELECT COUNT(*) FROM pokemon p
		JOIN forms f ON p.form_id = f.id
		WHERE p.is_default <> f.is_default
	`)
	if err != nil {
		return nil, fmt.Errorf("count default mismatches: %w", err)
	}
	check("pokemon_is_default_matches_form_is_default", "0", fmt.Sprint(defaultMismatch), defaultMismatch == 0, "")

	return issues, nil
}
