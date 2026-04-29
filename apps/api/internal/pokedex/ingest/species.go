package ingest

import (
	"context"
	"fmt"
)

// SpeciesIngester populates the `species` table from
// `data/api/v2/pokemon-species/<id>/index.json` files.
//
// Note: `species.evolves_from_species_id` is left NULL by this ingester; the
// 1.B.3 second-pass UPDATE backfills it once all species rows exist.
type SpeciesIngester struct{}

// Name implements Ingester.
func (SpeciesIngester) Name() string { return "species" }

type speciesJSON struct {
	ID              int             `json:"id"`
	Name            string          `json:"name"`
	Order           int             `json:"order"`
	IsBaby          bool            `json:"is_baby"`
	IsLegendary     bool            `json:"is_legendary"`
	IsMythical      bool            `json:"is_mythical"`
	FormsSwitchable bool            `json:"forms_switchable"`
	Color           *NameURL        `json:"color"`
	Shape           *NameURL        `json:"shape"`
	Habitat         *NameURL        `json:"habitat"`
	EvolvesFrom     *NameURL        `json:"evolves_from_species"`
	EvolutionChain  *NameURL        `json:"evolution_chain"`
	Generation      NameURL         `json:"generation"`
	Names           []LocalizedName `json:"names"`
	PokedexNumbers  []struct {
		EntryNumber int     `json:"entry_number"`
		Pokedex     NameURL `json:"pokedex"`
	} `json:"pokedex_numbers"`
}

// Ingest implements Ingester.
func (SpeciesIngester) Ingest(ctx context.Context, db DBExecutor, apiDataPath string) (IngestResult, error) {
	res := IngestResult{RowCounts: map[string]int{}}

	list, err := listResources(apiDataPath, "pokemon-species")
	if err != nil {
		return res, fmt.Errorf("list pokemon-species: %w", err)
	}

	for _, ref := range list {
		var s speciesJSON
		if err := readJSONFromURL(apiDataPath, ref.URL, &s); err != nil {
			return res, fmt.Errorf("read pokemon-species %q: %w", ref.Name, err)
		}

		genID, err := idFromURL(s.Generation.URL)
		if err != nil {
			return res, fmt.Errorf("species %d generation id: %w", s.ID, err)
		}

		// National Pokédex number, falling back to species id when no
		// national entry exists (rare; some event-only forms).
		pokedexNum := s.ID
		for _, pn := range s.PokedexNumbers {
			if pn.Pokedex.Name == "national" {
				pokedexNum = pn.EntryNumber
				break
			}
		}

		evoChainID, err := idFromOptionalURL(s.EvolutionChain)
		if err != nil {
			return res, fmt.Errorf("species %d evolution_chain_id: %w", s.ID, err)
		}

		if _, err := db.ExecContext(ctx, `
			INSERT INTO species (
				id, slug, name, pokedex_number, generation_id,
				is_legendary, is_mythical, is_baby,
				color, shape, habitat,
				evolution_chain_id, forms_switchable, pokeapi_order
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`,
			s.ID,
			s.Name,
			englishName(s.Names, titleFromSlug(s.Name)),
			pokedexNum,
			genID,
			boolToInt(s.IsLegendary),
			boolToInt(s.IsMythical),
			boolToInt(s.IsBaby),
			nameOrNil(s.Color),
			nameOrNil(s.Shape),
			nameOrNil(s.Habitat),
			evoChainID,
			boolToInt(s.FormsSwitchable),
			s.Order,
		); err != nil {
			return res, fmt.Errorf("insert species %d: %w", s.ID, err)
		}
		res.RowCounts["species"]++
	}

	return res, nil
}
