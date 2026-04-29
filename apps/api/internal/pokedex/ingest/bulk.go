// Package ingest contains the sync pipeline that rebuilds the Pokédex SQLite
// from upstream PokeAPI data.
//
// Phase 1.A scope: schema-only bulk run with atomic write, sync_meta provenance,
// and a file-lock preventing concurrent runs.
// Phase 1.B.1 scope: real `git rev-parse HEAD` for provenance, `api-data-sha`
// pin file output for reproducibility, Ingester interface scaffold.
// Phase 1.B.2 scope (this file's orchestration): wraps all ingesters in one
// BEGIN IMMEDIATE / COMMIT transaction; aggregates per-table row counts into
// sync_meta.record_counts_json; collects non-fatal warnings.
// Phase 1.B.3 fills in the join + evolution + flavor_text ingesters.
// Phase 1.F adds delta and drift-check modes.
package ingest

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/gofrs/flock"

	"github.com/jayesh/pokemon-ranker/api/internal/pokedex"
)

// BulkOptions configures a bulk sync run.
type BulkOptions struct {
	// OutputPath is where the SQLite file is written. Required.
	OutputPath string

	// APIDataPath is a local checkout of github.com/PokeAPI/api-data.
	// Empty in 1.A scaffold mode (no ingestion); required when ingesters
	// should run.
	APIDataPath string
}

// BulkResult summarizes a completed bulk run.
type BulkResult struct {
	OutputPath       string
	APIDataCommitSHA string
	Duration         time.Duration
	RowCounts        map[string]int
	Notes            []string
}

// defaultIngesters is the FK-correct ordering for the Phase 1.B.2 / 1.B.3
// ingesters. Phase 1.B.2 ships the first batch (constants + core graph);
// 1.B.3 appends the joins, evolutions, and flavor_text.
func defaultIngesters() []Ingester {
	return []Ingester{
		GenerationIngester{},
		TypeIngester{},
		StatIngester{},
		AbilityIngester{},
		MoveIngester{},
		SpeciesIngester{},
		FormIngester{},
		PokemonIngester{},
		PokemonJoinsIngester{},
		EvolutionIngester{},
		FlavorTextIngester{},
		EvolvesFromBackfillIngester{},
	}
}

// RunBulk performs a full rebuild of the Pokédex SQLite from upstream.
//
// Strategy: write to a sibling .tmp file, then atomically rename over the
// destination. An advisory file lock prevents concurrent bulk runs from
// stepping on each other (DS-4 / data-sync review §2). The api-data commit
// SHA is captured via `git rev-parse HEAD` and recorded both in the SQLite's
// sync_meta row and in a sibling `api-data-sha` pin file (PM planning gate,
// 2026-04-28). All ingestion runs inside a single BEGIN IMMEDIATE / COMMIT
// transaction (data-sync review §8).
func RunBulk(ctx context.Context, opts BulkOptions) (BulkResult, error) {
	if opts.OutputPath == "" {
		return BulkResult{}, errors.New("ingest.RunBulk: OutputPath is required")
	}

	if err := os.MkdirAll(filepath.Dir(opts.OutputPath), 0o755); err != nil {
		return BulkResult{}, fmt.Errorf("ensure output directory: %w", err)
	}

	lockPath := opts.OutputPath + ".lock"
	fileLock := flock.New(lockPath)
	locked, err := fileLock.TryLockContext(ctx, 250*time.Millisecond)
	if err != nil {
		return BulkResult{}, fmt.Errorf("acquire lock at %q: %w", lockPath, err)
	}
	if !locked {
		return BulkResult{}, fmt.Errorf("another bulk sync is already running (lock held at %q)", lockPath)
	}
	defer func() {
		_ = fileLock.Unlock()
	}()

	tmp := opts.OutputPath + ".tmp"
	_ = os.Remove(tmp)

	start := time.Now()
	commitSHA, err := resolveCommitSHA(ctx, opts.APIDataPath)
	if err != nil {
		return BulkResult{}, fmt.Errorf("resolve api-data commit SHA: %w", err)
	}

	db, err := pokedex.Open(ctx, tmp)
	if err != nil {
		return BulkResult{}, fmt.Errorf("open temp db: %w", err)
	}
	cleanupOnError := func() {
		_ = db.Close()
		_ = os.Remove(tmp)
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		cleanupOnError()
		return BulkResult{}, fmt.Errorf("begin transaction: %w", err)
	}

	aggregate := IngestResult{RowCounts: map[string]int{}}

	if opts.APIDataPath != "" {
		for _, ing := range defaultIngesters() {
			ingRes, err := ing.Ingest(ctx, tx, opts.APIDataPath)
			if err != nil {
				_ = tx.Rollback()
				cleanupOnError()
				return BulkResult{}, fmt.Errorf("ingest %s: %w", ing.Name(), err)
			}
			for table, count := range ingRes.RowCounts {
				aggregate.RowCounts[table] += count
			}
			aggregate.Notes = append(aggregate.Notes, ingRes.Notes...)
		}
	}

	recordCountsJSON, err := json.Marshal(aggregate.RowCounts)
	if err != nil {
		_ = tx.Rollback()
		cleanupOnError()
		return BulkResult{}, fmt.Errorf("encode record_counts_json: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO sync_meta (
			ran_at, mode, api_data_commit_sha, duration_ms, record_counts_json,
			schema_version, binary_version, tags_yaml_sha, status, error_message
		) VALUES (?, 'bulk', ?, ?, ?, ?, '', '', 'success', ?)
	`,
		time.Now().UTC().Format(time.RFC3339),
		commitSHA,
		time.Since(start).Milliseconds(),
		string(recordCountsJSON),
		pokedex.SchemaVersion,
		nilIfEmpty(strings.Join(aggregate.Notes, "; ")),
	); err != nil {
		_ = tx.Rollback()
		cleanupOnError()
		return BulkResult{}, fmt.Errorf("record sync_meta: %w", err)
	}

	if err := tx.Commit(); err != nil {
		cleanupOnError()
		return BulkResult{}, fmt.Errorf("commit: %w", err)
	}

	if err := db.Close(); err != nil {
		_ = os.Remove(tmp)
		return BulkResult{}, fmt.Errorf("close temp db: %w", err)
	}

	if err := os.Rename(tmp, opts.OutputPath); err != nil {
		_ = os.Remove(tmp)
		return BulkResult{}, fmt.Errorf("atomic rename: %w", err)
	}

	if shouldWritePin(commitSHA) {
		pinPath := filepath.Join(filepath.Dir(opts.OutputPath), "api-data-sha")
		if err := os.WriteFile(pinPath, []byte(commitSHA+"\n"), 0o600); err != nil {
			fmt.Fprintf(os.Stderr, "warning: failed to write %s: %v\n", pinPath, err)
		}
	}

	return BulkResult{
		OutputPath:       opts.OutputPath,
		APIDataCommitSHA: commitSHA,
		Duration:         time.Since(start),
		RowCounts:        aggregate.RowCounts,
		Notes:            aggregate.Notes,
	}, nil
}

// resolveCommitSHA returns the commit SHA at HEAD of an api-data checkout.
//
//   - apiDataPath empty → ("scaffold", nil). Bulk continues; no pin file written.
//   - apiDataPath non-empty + git success → (real_sha, nil).
//   - apiDataPath non-empty + git failure → ("", error). Hard-error per
//     data-sync 1.B.1 gate review §3 — silent "unknown" mis-pins are worse
//     than failing fast.
func resolveCommitSHA(ctx context.Context, apiDataPath string) (string, error) {
	if apiDataPath == "" {
		return "scaffold", nil
	}
	cmd := exec.CommandContext(ctx, "git", "-C", apiDataPath, "rev-parse", "HEAD")
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("git -C %q rev-parse HEAD: %w", apiDataPath, err)
	}
	return strings.TrimSpace(string(out)), nil
}

// shouldWritePin reports whether the resolved commit SHA is real enough to
// commit to the pin file. The "scaffold" placeholder is skipped.
func shouldWritePin(sha string) bool {
	switch sha {
	case "", "scaffold":
		return false
	default:
		return true
	}
}
