package ingest

import (
	"context"
	"fmt"
	"strings"
)

// FlavorTextIngester populates the `flavor_text` table from each species'
// `flavor_text_entries[]`. PokeAPI commonly includes form-feed (\f), newline,
// and carriage-return characters mid-string (game-text wrapping artifacts);
// we normalize these to single spaces.
//
// PRIMARY KEY (species_id, language, version) means duplicate entries from
// repeated game versions are deduped via INSERT OR IGNORE.
type FlavorTextIngester struct{}

// Name implements Ingester.
func (FlavorTextIngester) Name() string { return "flavor_text" }

type flavorTextSpeciesJSON struct {
	ID                int `json:"id"`
	FlavorTextEntries []struct {
		FlavorText string  `json:"flavor_text"`
		Language   NameURL `json:"language"`
		Version    NameURL `json:"version"`
	} `json:"flavor_text_entries"`
}

var flavorTextNormalizer = strings.NewReplacer("\f", " ", "\n", " ", "\r", " ", "\u00ad", "")

// Ingest implements Ingester.
func (FlavorTextIngester) Ingest(ctx context.Context, db DBExecutor, apiDataPath string) (IngestResult, error) {
	res := IngestResult{RowCounts: map[string]int{}}

	list, err := listResources(apiDataPath, "pokemon-species")
	if err != nil {
		return res, fmt.Errorf("list pokemon-species for flavor_text: %w", err)
	}

	for _, ref := range list {
		var s flavorTextSpeciesJSON
		if err := readJSONFromURL(apiDataPath, ref.URL, &s); err != nil {
			return res, fmt.Errorf("read pokemon-species %q for flavor_text: %w", ref.Name, err)
		}

		for _, ft := range s.FlavorTextEntries {
			cleaned := strings.TrimSpace(flavorTextNormalizer.Replace(ft.FlavorText))
			// Collapse runs of whitespace introduced by the replacer.
			cleaned = strings.Join(strings.Fields(cleaned), " ")

			result, err := db.ExecContext(ctx, `
				INSERT OR IGNORE INTO flavor_text (species_id, language, version, text)
				VALUES (?, ?, ?, ?)
			`, s.ID, ft.Language.Name, ft.Version.Name, cleaned)
			if err != nil {
				return res, fmt.Errorf("insert flavor_text (species=%d, %s/%s): %w",
					s.ID, ft.Language.Name, ft.Version.Name, err)
			}
			if affected, _ := result.RowsAffected(); affected > 0 {
				res.RowCounts["flavor_text"]++
			}
		}
	}

	return res, nil
}
