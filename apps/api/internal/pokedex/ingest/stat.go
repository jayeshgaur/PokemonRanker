package ingest

import (
	"context"
	"fmt"
)

// StatIngester populates the `stats` table from
// `data/api/v2/stat/<id>/index.json` files.
type StatIngester struct{}

// Name implements Ingester.
func (StatIngester) Name() string { return "stats" }

type statJSON struct {
	ID    int             `json:"id"`
	Name  string          `json:"name"`
	Names []LocalizedName `json:"names"`
}

// Ingest implements Ingester.
func (StatIngester) Ingest(ctx context.Context, db DBExecutor, apiDataPath string) (IngestResult, error) {
	res := IngestResult{RowCounts: map[string]int{}}

	list, err := listResources(apiDataPath, "stat")
	if err != nil {
		return res, fmt.Errorf("list stats: %w", err)
	}

	for _, ref := range list {
		var s statJSON
		if err := readJSONFromURL(apiDataPath, ref.URL, &s); err != nil {
			return res, fmt.Errorf("read stat %q: %w", ref.Name, err)
		}

		if _, err := db.ExecContext(ctx, `
			INSERT INTO stats (id, slug, name) VALUES (?, ?, ?)
		`,
			s.ID,
			s.Name,
			englishName(s.Names, titleFromSlug(s.Name)),
		); err != nil {
			return res, fmt.Errorf("insert stat %d: %w", s.ID, err)
		}
		res.RowCounts["stats"]++
	}

	return res, nil
}
