package ingest

import (
	"context"
	"fmt"
)

// TypeIngester populates the `types` table from
// `data/api/v2/type/<id>/index.json` files.
type TypeIngester struct{}

// Name implements Ingester.
func (TypeIngester) Name() string { return "types" }

type typeJSON struct {
	ID    int             `json:"id"`
	Name  string          `json:"name"`
	Names []LocalizedName `json:"names"`
}

// Ingest implements Ingester.
func (TypeIngester) Ingest(ctx context.Context, db DBExecutor, apiDataPath string) (IngestResult, error) {
	res := IngestResult{RowCounts: map[string]int{}}

	list, err := listResources(apiDataPath, "type")
	if err != nil {
		return res, fmt.Errorf("list types: %w", err)
	}

	for _, ref := range list {
		var t typeJSON
		if err := readJSONFromURL(apiDataPath, ref.URL, &t); err != nil {
			return res, fmt.Errorf("read type %q: %w", ref.Name, err)
		}

		if _, err := db.ExecContext(ctx, `
			INSERT INTO types (id, slug, name) VALUES (?, ?, ?)
		`,
			t.ID,
			t.Name,
			englishName(t.Names, titleFromSlug(t.Name)),
		); err != nil {
			return res, fmt.Errorf("insert type %d: %w", t.ID, err)
		}
		res.RowCounts["types"]++
	}

	return res, nil
}
