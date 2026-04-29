package ingest

import (
	"context"
	"fmt"
	"strings"
)

// GenerationIngester populates the `generations` table from
// `data/api/v2/generation/<id>/index.json` files.
type GenerationIngester struct{}

// Name implements Ingester.
func (GenerationIngester) Name() string { return "generations" }

type generationJSON struct {
	ID            int             `json:"id"`
	Name          string          `json:"name"`
	MainRegion    NameURL         `json:"main_region"`
	VersionGroups []NameURL       `json:"version_groups"`
	Names         []LocalizedName `json:"names"`
}

// Ingest implements Ingester.
func (GenerationIngester) Ingest(ctx context.Context, db DBExecutor, apiDataPath string) (IngestResult, error) {
	res := IngestResult{RowCounts: map[string]int{}}

	list, err := listResources(apiDataPath, "generation")
	if err != nil {
		return res, fmt.Errorf("list generations: %w", err)
	}

	for _, ref := range list {
		var g generationJSON
		if err := readJSONFromURL(apiDataPath, ref.URL, &g); err != nil {
			return res, fmt.Errorf("read generation %q: %w", ref.Name, err)
		}

		versions := make([]string, 0, len(g.VersionGroups))
		for _, vg := range g.VersionGroups {
			versions = append(versions, vg.Name)
		}

		if _, err := db.ExecContext(ctx, `
			INSERT INTO generations (id, slug, name, region, main_versions)
			VALUES (?, ?, ?, ?, ?)
		`,
			g.ID,
			g.Name,
			englishName(g.Names, titleFromSlug(g.Name)),
			g.MainRegion.Name,
			strings.Join(versions, ","),
		); err != nil {
			return res, fmt.Errorf("insert generation %d: %w", g.ID, err)
		}
		res.RowCounts["generations"]++
	}

	return res, nil
}
