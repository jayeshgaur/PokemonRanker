package ingest

import (
	"context"
	"fmt"
)

// MoveIngester populates the `moves` table from
// `data/api/v2/move/<id>/index.json` files.
type MoveIngester struct{}

// Name implements Ingester.
func (MoveIngester) Name() string { return "moves" }

type moveJSON struct {
	ID            int             `json:"id"`
	Name          string          `json:"name"`
	Type          NameURL         `json:"type"`
	DamageClass   NameURL         `json:"damage_class"`
	Power         *int            `json:"power"`
	Accuracy      *int            `json:"accuracy"`
	PP            *int            `json:"pp"`
	Priority      int             `json:"priority"`
	Target        NameURL         `json:"target"`
	Names         []LocalizedName `json:"names"`
	EffectEntries []EffectEntry   `json:"effect_entries"`
}

// Ingest implements Ingester.
func (MoveIngester) Ingest(ctx context.Context, db DBExecutor, apiDataPath string) (IngestResult, error) {
	res := IngestResult{RowCounts: map[string]int{}}

	list, err := listResources(apiDataPath, "move")
	if err != nil {
		return res, fmt.Errorf("list moves: %w", err)
	}

	for _, ref := range list {
		var m moveJSON
		if err := readJSONFromURL(apiDataPath, ref.URL, &m); err != nil {
			return res, fmt.Errorf("read move %q: %w", ref.Name, err)
		}

		var typeID any // nil → NULL in SQLite
		if m.Type.URL != "" {
			tid, err := idFromURL(m.Type.URL)
			if err != nil {
				return res, fmt.Errorf("move %d type id: %w", m.ID, err)
			}
			typeID = tid
		}

		short, long := englishEffect(m.EffectEntries)

		if _, err := db.ExecContext(ctx, `
			INSERT INTO moves (
				id, slug, name, type_id, damage_class,
				power, accuracy, pp, priority, target,
				short_effect, effect
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`,
			m.ID,
			m.Name,
			englishName(m.Names, titleFromSlug(m.Name)),
			typeID,
			m.DamageClass.Name,
			m.Power, m.Accuracy, m.PP,
			m.Priority,
			m.Target.Name,
			short, long,
		); err != nil {
			return res, fmt.Errorf("insert move %d: %w", m.ID, err)
		}
		res.RowCounts["moves"]++
	}

	return res, nil
}
