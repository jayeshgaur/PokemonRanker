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

		if _, err := db.ExecContext(ctx, `
			INSERT INTO forms (
				id, species_id, slug, form_name,
				is_default, is_mega, is_gmax, is_battle_only, is_regional_variant,
				pokeapi_order, pokeapi_form_order
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
			f.Order,
			f.FormOrder,
		); err != nil {
			return res, fmt.Errorf("insert form %d: %w", f.ID, err)
		}
		res.RowCounts["forms"]++
	}

	return res, nil
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
