package ingest

import (
	"context"
	"fmt"
)

// PokemonIngester populates the `pokemon` table from
// `data/api/v2/pokemon/<id>/index.json` files. The competitor unit (D-1).
//
// generation_id is currently sourced from species.generation_id (the
// pokemon's species's debut generation). Future enhancement: use
// COALESCE(forms.introduced_in_generation_id, species.generation_id) once
// forms tracks introduction generation.
type PokemonIngester struct{}

// Name implements Ingester.
func (PokemonIngester) Name() string { return "pokemon" }

type pokemonJSON struct {
	ID             int       `json:"id"`
	Name           string    `json:"name"`
	Order          int       `json:"order"`
	IsDefault      bool      `json:"is_default"`
	Height         int       `json:"height"`
	Weight         int       `json:"weight"`
	BaseExperience int       `json:"base_experience"`
	Species        NameURL   `json:"species"`
	Forms          []NameURL `json:"forms"`
	Sprites        struct {
		FrontDefault string `json:"front_default"`
		FrontShiny   string `json:"front_shiny"`
		Other        struct {
			OfficialArtwork struct {
				FrontDefault string `json:"front_default"`
			} `json:"official-artwork"`
		} `json:"other"`
	} `json:"sprites"`
	Cries struct {
		Latest string `json:"latest"`
	} `json:"cries"`
}

// Ingest implements Ingester.
func (PokemonIngester) Ingest(ctx context.Context, db DBExecutor, apiDataPath string) (IngestResult, error) {
	res := IngestResult{RowCounts: map[string]int{}}

	list, err := listResources(apiDataPath, "pokemon")
	if err != nil {
		return res, fmt.Errorf("list pokemon: %w", err)
	}

	for _, ref := range list {
		var p pokemonJSON
		if err := readJSONFromURL(apiDataPath, ref.URL, &p); err != nil {
			return res, fmt.Errorf("read pokemon %q: %w", ref.Name, err)
		}

		speciesID, err := idFromURL(p.Species.URL)
		if err != nil {
			return res, fmt.Errorf("pokemon %d species id: %w", p.ID, err)
		}

		formID, formNote, err := pickFormID(apiDataPath, p)
		if err != nil {
			return res, fmt.Errorf("pokemon %d: %w", p.ID, err)
		}
		if formNote != "" {
			res.Notes = append(res.Notes, formNote)
		}

		// Look up generation_id and species slug from the species table.
		var (
			generationID int64
			speciesSlug  string
		)
		if err := db.QueryRowContext(ctx,
			`SELECT generation_id, slug FROM species WHERE id = ?`, speciesID,
		).Scan(&generationID, &speciesSlug); err != nil {
			return res, fmt.Errorf("lookup species %d for pokemon %d: %w", speciesID, p.ID, err)
		}

		pokemonDBURL := "https://pokemondb.net/pokedex/" + speciesSlug
		officialArtwork := p.Sprites.Other.OfficialArtwork.FrontDefault

		if _, err := db.ExecContext(ctx, `
			INSERT INTO pokemon (
				id, species_id, form_id, slug, display_name,
				generation_id, is_default, pokeapi_order,
				height_dm, weight_hg, base_experience,
				sprite_url, shiny_sprite_url, official_artwork_url,
				cry_url, pokedex_db_url
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`,
			p.ID,
			speciesID,
			formID,
			p.Name,
			titleFromSlug(p.Name),
			generationID,
			boolToInt(p.IsDefault),
			p.Order,
			p.Height,
			p.Weight,
			p.BaseExperience,
			p.Sprites.FrontDefault,
			p.Sprites.FrontShiny,
			officialArtwork,
			p.Cries.Latest,
			pokemonDBURL,
		); err != nil {
			return res, fmt.Errorf("insert pokemon %d: %w", p.ID, err)
		}
		res.RowCounts["pokemon"]++
	}

	return res, nil
}

// pickFormID picks the correct form for this pokemon entity. Most pokemon
// entities have exactly one form, in which case that's the answer. When a
// pokemon entity has multiple forms (e.g., Xerneas's [active, neutral]), we
// pick the one whose form.is_default matches pokemon.is_default — the
// species-default pokemon's species-default form, or a non-default
// pokemon's non-default form. If nothing matches, fall back to Forms[0]
// and emit a Note. (data-sync 1.B gate review §B — was deferred to 1.F;
// surfaced for real on 2026-04-29 by the validate check #16
// `pokemon_is_default_matches_form_is_default` failing on Xerneas.)
func pickFormID(apiDataPath string, p pokemonJSON) (int64, string, error) {
	if len(p.Forms) == 0 {
		return 0, "", fmt.Errorf("pokemon %d (%s) has no forms", p.ID, p.Name)
	}
	if len(p.Forms) == 1 {
		id, err := idFromURL(p.Forms[0].URL)
		return id, "", err
	}
	for _, f := range p.Forms {
		var fj struct {
			IsDefault bool `json:"is_default"`
		}
		if err := readJSONFromURL(apiDataPath, f.URL, &fj); err != nil {
			return 0, "", fmt.Errorf("read form %s: %w", f.Name, err)
		}
		if fj.IsDefault == p.IsDefault {
			id, err := idFromURL(f.URL)
			if err != nil {
				return 0, "", err
			}
			return id, "", nil
		}
	}
	id, err := idFromURL(p.Forms[0].URL)
	if err != nil {
		return 0, "", err
	}
	note := fmt.Sprintf("pokemon %d (%s): no form's is_default matches pokemon.is_default=%v across %d forms; fell back to Forms[0]=%s", p.ID, p.Name, p.IsDefault, len(p.Forms), p.Forms[0].Name)
	return id, note, nil
}
