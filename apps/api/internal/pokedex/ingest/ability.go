package ingest

import (
	"context"
	"fmt"
)

// AbilityIngester populates the `abilities` table from
// `data/api/v2/ability/<id>/index.json` files.
type AbilityIngester struct{}

// Name implements Ingester.
func (AbilityIngester) Name() string { return "abilities" }

type abilityJSON struct {
	ID            int             `json:"id"`
	Name          string          `json:"name"`
	IsMainSeries  bool            `json:"is_main_series"`
	Names         []LocalizedName `json:"names"`
	EffectEntries []EffectEntry   `json:"effect_entries"`
}

// Ingest implements Ingester.
func (AbilityIngester) Ingest(ctx context.Context, db DBExecutor, apiDataPath string) (IngestResult, error) {
	res := IngestResult{RowCounts: map[string]int{}}

	list, err := listResources(apiDataPath, "ability")
	if err != nil {
		return res, fmt.Errorf("list abilities: %w", err)
	}

	for _, ref := range list {
		var a abilityJSON
		if err := readJSONFromURL(apiDataPath, ref.URL, &a); err != nil {
			return res, fmt.Errorf("read ability %q: %w", ref.Name, err)
		}

		short, long := englishEffect(a.EffectEntries)

		if _, err := db.ExecContext(ctx, `
			INSERT INTO abilities (id, slug, name, short_effect, effect, is_main_series)
			VALUES (?, ?, ?, ?, ?, ?)
		`,
			a.ID,
			a.Name,
			englishName(a.Names, titleFromSlug(a.Name)),
			short,
			long,
			boolToInt(a.IsMainSeries),
		); err != nil {
			return res, fmt.Errorf("insert ability %d: %w", a.ID, err)
		}
		res.RowCounts["abilities"]++
	}

	return res, nil
}
