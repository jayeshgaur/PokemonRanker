package ingest

import (
	"context"
	"fmt"
)

// PokemonJoinsIngester reads each pokemon entity JSON and writes the four
// join tables in one pass: pokemon_types, pokemon_stats, pokemon_abilities,
// pokemon_moves. Reading each pokemon file once (instead of four times) is
// significant — pokemon_moves alone can reach ~50–100 k rows.
type PokemonJoinsIngester struct{}

// Name implements Ingester.
func (PokemonJoinsIngester) Name() string { return "pokemon-joins" }

type pokemonJoinsJSON struct {
	ID    int `json:"id"`
	Types []struct {
		Slot int     `json:"slot"`
		Type NameURL `json:"type"`
	} `json:"types"`
	Stats []struct {
		BaseStat int     `json:"base_stat"`
		Effort   int     `json:"effort"`
		Stat     NameURL `json:"stat"`
	} `json:"stats"`
	Abilities []struct {
		Slot     int     `json:"slot"`
		IsHidden bool    `json:"is_hidden"`
		Ability  NameURL `json:"ability"`
	} `json:"abilities"`
	Moves []struct {
		Move                NameURL `json:"move"`
		VersionGroupDetails []struct {
			LevelLearnedAt  int     `json:"level_learned_at"`
			VersionGroup    NameURL `json:"version_group"`
			MoveLearnMethod NameURL `json:"move_learn_method"`
		} `json:"version_group_details"`
	} `json:"moves"`
}

// Ingest implements Ingester.
func (PokemonJoinsIngester) Ingest(ctx context.Context, db DBExecutor, apiDataPath string) (IngestResult, error) {
	res := IngestResult{RowCounts: map[string]int{}}

	list, err := listResources(apiDataPath, "pokemon")
	if err != nil {
		return res, fmt.Errorf("list pokemon for joins: %w", err)
	}

	// Prepared statements pay off here: pokemon_moves alone reaches ~50–100 k
	// rows in a real PokéDex; ad-hoc Exec is an order of magnitude slower.
	movesStmt, err := db.PrepareContext(ctx, `
		INSERT OR IGNORE INTO pokemon_moves (
			pokemon_id, move_id, learn_method, learn_level, generation_id
		) VALUES (?, ?, ?, ?, ?)
	`)
	if err != nil {
		return res, fmt.Errorf("prepare pokemon_moves stmt: %w", err)
	}
	defer func() { _ = movesStmt.Close() }()

	for _, ref := range list {
		var p pokemonJoinsJSON
		if err := readJSONFromURL(apiDataPath, ref.URL, &p); err != nil {
			return res, fmt.Errorf("read pokemon %q for joins: %w", ref.Name, err)
		}

		// pokemon_types
		for _, t := range p.Types {
			typeID, err := idFromURL(t.Type.URL)
			if err != nil {
				return res, fmt.Errorf("pokemon %d type id: %w", p.ID, err)
			}
			if _, err := db.ExecContext(ctx, `
				INSERT INTO pokemon_types (pokemon_id, type_id, slot) VALUES (?, ?, ?)
			`, p.ID, typeID, t.Slot); err != nil {
				return res, fmt.Errorf("insert pokemon_types (%d,%d,%d): %w", p.ID, typeID, t.Slot, err)
			}
			res.RowCounts["pokemon_types"]++
		}

		// pokemon_stats
		for _, s := range p.Stats {
			statID, err := idFromURL(s.Stat.URL)
			if err != nil {
				return res, fmt.Errorf("pokemon %d stat id: %w", p.ID, err)
			}
			if _, err := db.ExecContext(ctx, `
				INSERT INTO pokemon_stats (pokemon_id, stat_id, base_value, effort) VALUES (?, ?, ?, ?)
			`, p.ID, statID, s.BaseStat, s.Effort); err != nil {
				return res, fmt.Errorf("insert pokemon_stats (%d,%d): %w", p.ID, statID, err)
			}
			res.RowCounts["pokemon_stats"]++
		}

		// pokemon_abilities
		for _, a := range p.Abilities {
			abilityID, err := idFromURL(a.Ability.URL)
			if err != nil {
				return res, fmt.Errorf("pokemon %d ability id: %w", p.ID, err)
			}
			if _, err := db.ExecContext(ctx, `
				INSERT INTO pokemon_abilities (pokemon_id, ability_id, slot, is_hidden)
				VALUES (?, ?, ?, ?)
			`, p.ID, abilityID, a.Slot, boolToInt(a.IsHidden)); err != nil {
				return res, fmt.Errorf("insert pokemon_abilities (%d,%d): %w", p.ID, abilityID, err)
			}
			res.RowCounts["pokemon_abilities"]++
		}

		// pokemon_moves: dedupe (pokemon_id, move_id, learn_method, generation_id)
		// across version groups within the same generation. INSERT OR IGNORE wins
		// the dedupe on the PK; the surviving learn_level is whichever was inserted
		// first (acceptable for v1; documented in 1.B.3 design).
		for _, m := range p.Moves {
			moveID, err := idFromURL(m.Move.URL)
			if err != nil {
				return res, fmt.Errorf("pokemon %d move id: %w", p.ID, err)
			}
			for _, vgd := range m.VersionGroupDetails {
				genID, ok := VersionGroupGeneration[vgd.VersionGroup.Name]
				if !ok {
					res.Notes = append(res.Notes, fmt.Sprintf(
						"unknown version_group %q on pokemon %d move %d (skipped)",
						vgd.VersionGroup.Name, p.ID, moveID,
					))
					continue
				}
				var levelLearnedAt any
				if vgd.LevelLearnedAt > 0 {
					levelLearnedAt = vgd.LevelLearnedAt
				}
				result, err := movesStmt.ExecContext(ctx,
					p.ID, moveID, vgd.MoveLearnMethod.Name, levelLearnedAt, genID,
				)
				if err != nil {
					return res, fmt.Errorf("insert pokemon_moves (%d,%d,%s,%d): %w",
						p.ID, moveID, vgd.MoveLearnMethod.Name, genID, err)
				}
				if affected, _ := result.RowsAffected(); affected > 0 {
					res.RowCounts["pokemon_moves"]++
				}
			}
		}
	}

	return res, nil
}
