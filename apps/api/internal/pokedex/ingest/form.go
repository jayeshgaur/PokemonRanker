package ingest

import (
	"context"
	"fmt"
	"strings"
)

// FormIngester populates the `forms` table from
// `data/api/v2/pokemon-form/<id>/index.json` files.
//
// Looks up species_id by reading the form's `pokemon` entity JSON and
// extracting `pokemon.species.url`. is_gmax is derived from the slug
// suffix `-gmax` (PokeAPI does not expose it as a top-level field).
// is_regional_variant is derived from form_name ∈ {alola, galar, hisui, paldea}.
type FormIngester struct{}

// Name implements Ingester.
func (FormIngester) Name() string { return "forms" }

type formJSON struct {
	ID           int             `json:"id"`
	Name         string          `json:"name"`
	FormName     string          `json:"form_name"`
	FormOrder    int             `json:"form_order"`
	Order        int             `json:"order"`
	IsDefault    bool            `json:"is_default"`
	IsBattleOnly bool            `json:"is_battle_only"`
	IsMega       bool            `json:"is_mega"`
	Names        []LocalizedName `json:"names"`
	Pokemon      NameURL         `json:"pokemon"`
	// VersionGroup carries the games where the form first/most-recently
	// appears. For non-default forms (Megas, regional variants, GMax,
	// battle-bond, …) this maps cleanly to the introduction generation
	// (e.g. arcanine-hisui's version_group = "legends-arceus" → Gen 8).
	// For default forms it tracks the latest game the sprite was updated
	// in, so we ignore it for those and fall back to species's debut
	// generation. This is the fix for "Hisuian Arcanine appeared under
	// Gen 1 filter" reported 2026-04-29.
	VersionGroup NameURL `json:"version_group"`
}

// regionalFormNames are the PokeAPI form_name values that mark a regional variant.
var regionalFormNames = map[string]bool{
	"alola": true, "galar": true, "hisui": true, "paldea": true,
}

// Ingest implements Ingester.
func (FormIngester) Ingest(ctx context.Context, db DBExecutor, apiDataPath string) (IngestResult, error) {
	res := IngestResult{RowCounts: map[string]int{}}

	list, err := listResources(apiDataPath, "pokemon-form")
	if err != nil {
		return res, fmt.Errorf("list pokemon-form: %w", err)
	}

	for _, ref := range list {
		var f formJSON
		if err := readJSONFromURL(apiDataPath, ref.URL, &f); err != nil {
			return res, fmt.Errorf("read pokemon-form %q: %w", ref.Name, err)
		}

		// Read the form's pokemon entity for both species lookup AND the species-
		// default flag. PokeAPI's `is_default` on a form means "default form of
		// this pokemon entity", not "default form of this species". For species
		// like Necrozma (Dusk-Mane / Dawn-Wings / Ultra are separate pokemon
		// entities), three forms would all be is_default=1 and trip the partial
		// unique index. Solution: a form is the species-default form only if
		// the form is its pokemon's default AND that pokemon is the species's
		// default. (data-sync 1.B gate review §A.)
		speciesID, pokemonIsDefault, err := lookupPokemonForForm(apiDataPath, f.Pokemon.URL)
		if err != nil {
			return res, fmt.Errorf("form %d pokemon lookup: %w", f.ID, err)
		}

		isGmax := strings.HasSuffix(f.Name, "-gmax")
		isRegional := regionalFormNames[f.FormName]
		isSpeciesDefault := f.IsDefault && pokemonIsDefault

		// Resolve form's introduction generation. For non-default forms
		// (regional variants, Megas, GMax, battle-bond, …) the form's
		// version_group is the introduction; we map that to a generation.
		// Default forms inherit their species's debut gen (handled via
		// COALESCE in PokemonIngester) so we leave the column NULL here.
		introGen, hasIntroGen := formIntroductionGen(f, isSpeciesDefault)

		if _, err := db.ExecContext(ctx, `
			INSERT INTO forms (
				id, species_id, slug, form_name,
				is_default, is_mega, is_gmax, is_battle_only, is_regional_variant,
				introduced_in_generation_id,
				pokeapi_order, pokeapi_form_order
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`,
			f.ID,
			speciesID,
			f.Name,
			f.FormName,
			boolToInt(isSpeciesDefault),
			boolToInt(f.IsMega),
			boolToInt(isGmax),
			boolToInt(f.IsBattleOnly),
			boolToInt(isRegional),
			nullableInt64(introGen, hasIntroGen),
			f.Order,
			f.FormOrder,
		); err != nil {
			return res, fmt.Errorf("insert form %d: %w", f.ID, err)
		}
		res.RowCounts["forms"]++
	}

	return res, nil
}

// formIntroductionGen returns the form's introduction generation, or
// (0, false) when we don't have one to write.
//
//   - Default forms (the species's canonical (species, form) row): we leave
//     this NULL so PokemonIngester's COALESCE falls back to the species's
//     debut generation. The form's `version_group` for default forms tracks
//     latest-sprite-update, not introduction, so it's the wrong source.
//   - Non-default forms (Mega/GMax/regional/battle-bond/…): the form's
//     `version_group` IS the introduction, mapped via VersionGroupGeneration.
//   - Unknown version_group: return (0, false). The caller writes NULL and
//     falls back to species. We don't loud-fail here because PokeAPI ships
//     pre-release / fan-fic version groups occasionally; missing the gen
//     just means the form inherits its species's debut gen, which is the
//     same conservative behavior we had before this fix.
func formIntroductionGen(f formJSON, isSpeciesDefault bool) (int64, bool) {
	if isSpeciesDefault {
		return 0, false
	}
	if f.VersionGroup.Name == "" {
		return 0, false
	}
	gen, ok := VersionGroupGeneration[f.VersionGroup.Name]
	if !ok {
		return 0, false
	}
	return gen, true
}

// nullableInt64 returns the value as `any(int64)` when ok, else untyped nil
// so the SQL driver writes NULL.
func nullableInt64(v int64, ok bool) any {
	if !ok {
		return nil
	}
	return v
}

// lookupPokemonForForm reads a pokemon entity JSON and returns:
//
//   - speciesID: the species this pokemon belongs to (form.species_id).
//   - pokemonIsDefault: whether this pokemon is the species-default
//     (used by FormIngester to AND with form.is_default and avoid the
//     "multiple defaults per species" partial-unique-index trap on
//     species like Necrozma where multiple alt-form pokemon entities
//     each have an is_default=true form).
func lookupPokemonForForm(apiDataPath, pokemonURL string) (int64, bool, error) {
	var pkmn struct {
		Species   NameURL `json:"species"`
		IsDefault bool    `json:"is_default"`
	}
	if err := readJSONFromURL(apiDataPath, pokemonURL, &pkmn); err != nil {
		return 0, false, fmt.Errorf("read pokemon for form: %w", err)
	}
	id, err := idFromURL(pkmn.Species.URL)
	if err != nil {
		return 0, false, err
	}
	return id, pkmn.IsDefault, nil
}
