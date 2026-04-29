package ingest

import (
	"context"
	"encoding/json"
	"fmt"
)

// EvolutionIngester populates `evolution_chains` and `evolutions` from
// `data/api/v2/evolution-chain/<id>/index.json`. It walks each chain's nested
// tree and emits one `evolutions` row per (parent → child) edge × evolution
// detail (some edges have multiple alternative triggers).
//
// The root species in the chain has no parent; only edges produce evolutions
// rows. The full evolution_detail object is preserved as JSON in
// `conditions_json` for fields beyond the dedicated columns.
type EvolutionIngester struct{}

// Name implements Ingester.
func (EvolutionIngester) Name() string { return "evolutions" }

type evolutionChainJSON struct {
	ID              int               `json:"id"`
	BabyTriggerItem *NameURL          `json:"baby_trigger_item"`
	Chain           evolutionNodeJSON `json:"chain"`
}

type evolutionNodeJSON struct {
	Species          NameURL               `json:"species"`
	EvolutionDetails []evolutionDetailJSON `json:"evolution_details"`
	EvolvesTo        []evolutionNodeJSON   `json:"evolves_to"`
}

type evolutionDetailJSON struct {
	MinLevel  *int     `json:"min_level"`
	Item      *NameURL `json:"item"`
	Trigger   NameURL  `json:"trigger"`
	Gender    *int     `json:"gender"`
	TimeOfDay string   `json:"time_of_day"`
	// All other fields (min_happiness, location, known_move, etc.) round-trip
	// through conditions_json via the raw map below.
	Raw map[string]any `json:"-"`
}

// Ingest implements Ingester.
func (EvolutionIngester) Ingest(ctx context.Context, db DBExecutor, apiDataPath string) (IngestResult, error) {
	res := IngestResult{RowCounts: map[string]int{}}

	list, err := listResources(apiDataPath, "evolution-chain")
	if err != nil {
		return res, fmt.Errorf("list evolution-chain: %w", err)
	}

	for _, ref := range list {
		var ec evolutionChainJSON
		if err := readJSONFromURL(apiDataPath, ref.URL, &ec); err != nil {
			return res, fmt.Errorf("read evolution-chain %q: %w", ref.Name, err)
		}

		var babyTriggerItem any
		if ec.BabyTriggerItem != nil {
			babyTriggerItem = ec.BabyTriggerItem.Name
		}
		if _, err := db.ExecContext(ctx, `
			INSERT INTO evolution_chains (id, baby_trigger_item) VALUES (?, ?)
		`, ec.ID, babyTriggerItem); err != nil {
			return res, fmt.Errorf("insert evolution_chain %d: %w", ec.ID, err)
		}
		res.RowCounts["evolution_chains"]++

		rootSpeciesID, err := idFromURL(ec.Chain.Species.URL)
		if err != nil {
			return res, fmt.Errorf("evolution-chain %d root species id: %w", ec.ID, err)
		}

		// Re-read the raw chain to capture each evolution_detail's full JSON
		// for conditions_json. (We do this once per chain; cheap.)
		raw, err := readEvolutionChainRaw(apiDataPath, ref.URL)
		if err != nil {
			return res, fmt.Errorf("re-read evolution-chain %d for raw details: %w", ec.ID, err)
		}

		if err := walkEvolutionChain(ctx, db, int64(ec.ID), rootSpeciesID, ec.Chain, raw, &res); err != nil {
			return res, err
		}
	}

	return res, nil
}

// walkEvolutionChain inserts one evolutions row per (parent → child) edge.
func walkEvolutionChain(
	ctx context.Context, db DBExecutor,
	chainID, parentSpeciesID int64,
	node evolutionNodeJSON,
	rawNode map[string]any,
	res *IngestResult,
) error {
	rawChildren, _ := rawNode["evolves_to"].([]any)

	for i, child := range node.EvolvesTo {
		childSpeciesID, err := idFromURL(child.Species.URL)
		if err != nil {
			return fmt.Errorf("evolution chain %d child species id: %w", chainID, err)
		}

		var rawChild map[string]any
		if i < len(rawChildren) {
			rawChild, _ = rawChildren[i].(map[string]any)
		}
		rawDetails, _ := rawChild["evolution_details"].([]any)

		for j, det := range child.EvolutionDetails {
			conditionsJSON := []byte("{}")
			if j < len(rawDetails) {
				if encoded, err := json.Marshal(rawDetails[j]); err == nil {
					conditionsJSON = encoded
				}
			}
			var item any
			if det.Item != nil {
				item = det.Item.Name
			}
			var minLevel any
			if det.MinLevel != nil {
				minLevel = *det.MinLevel
			}
			var gender any
			if det.Gender != nil {
				gender = *det.Gender
			}
			if _, err := db.ExecContext(ctx, `
				INSERT INTO evolutions (
					chain_id, from_species_id, to_species_id,
					trigger, min_level, item, gender, time_of_day, conditions_json
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			`,
				chainID, parentSpeciesID, childSpeciesID,
				det.Trigger.Name, minLevel, item, gender, det.TimeOfDay,
				string(conditionsJSON),
			); err != nil {
				return fmt.Errorf("insert evolution (chain=%d, %d→%d): %w",
					chainID, parentSpeciesID, childSpeciesID, err)
			}
			res.RowCounts["evolutions"]++
		}

		if err := walkEvolutionChain(ctx, db, chainID, childSpeciesID, child, rawChild, res); err != nil {
			return err
		}
	}
	return nil
}

// readEvolutionChainRaw returns the raw JSON-decoded chain (as map[string]any)
// so we can preserve evolution_detail fields beyond the typed columns.
func readEvolutionChainRaw(apiDataPath, url string) (map[string]any, error) {
	var raw struct {
		Chain map[string]any `json:"chain"`
	}
	if err := readJSONFromURL(apiDataPath, url, &raw); err != nil {
		return nil, err
	}
	return raw.Chain, nil
}
