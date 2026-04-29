package ingest

import (
	"context"
	"fmt"
)

// EvolvesFromBackfillIngester walks each species' `evolves_from_species`
// reference and writes the parent species id back to species.evolves_from_species_id.
// Runs *after* SpeciesIngester so all FK targets exist (per the second-pass
// note in PLAN.md Phase 1.B).
//
// Reports row count under "species_evolves_from_updated".
type EvolvesFromBackfillIngester struct{}

// Name implements Ingester.
func (EvolvesFromBackfillIngester) Name() string { return "species-evolves-from-backfill" }

type evolvesFromSpeciesJSON struct {
	ID                 int      `json:"id"`
	EvolvesFromSpecies *NameURL `json:"evolves_from_species"`
}

// Ingest implements Ingester.
func (EvolvesFromBackfillIngester) Ingest(ctx context.Context, db DBExecutor, apiDataPath string) (IngestResult, error) {
	res := IngestResult{RowCounts: map[string]int{}}

	list, err := listResources(apiDataPath, "pokemon-species")
	if err != nil {
		return res, fmt.Errorf("list pokemon-species for evolves_from: %w", err)
	}

	for _, ref := range list {
		var s evolvesFromSpeciesJSON
		if err := readJSONFromURL(apiDataPath, ref.URL, &s); err != nil {
			return res, fmt.Errorf("read pokemon-species %q: %w", ref.Name, err)
		}

		if s.EvolvesFromSpecies == nil || s.EvolvesFromSpecies.URL == "" {
			continue
		}

		parentID, err := idFromURL(s.EvolvesFromSpecies.URL)
		if err != nil {
			return res, fmt.Errorf("species %d evolves_from id: %w", s.ID, err)
		}

		if _, err := db.ExecContext(ctx, `
			UPDATE species SET evolves_from_species_id = ? WHERE id = ?
		`, parentID, s.ID); err != nil {
			return res, fmt.Errorf("update species %d evolves_from to %d: %w", s.ID, parentID, err)
		}
		res.RowCounts["species_evolves_from_updated"]++
	}

	return res, nil
}
