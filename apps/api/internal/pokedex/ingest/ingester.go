package ingest

import (
	"context"
	"database/sql"
)

// IngestResult is what an Ingester returns. Per data-sync agent's 1.B.1 gate
// review: a single int row-count is ambiguous for ingesters that touch multiple
// tables (evolution_chains/evolutions, species' second-pass evolves_from
// UPDATE, etc.); a map keyed by table name preserves provenance, and a Notes
// slice gives ingesters a non-fatal-warning surface (for `\f` substitutions,
// null fallbacks, retconned-typing fallbacks, etc.) without inventing logging.
type IngestResult struct {
	// RowCounts maps table name → number of rows written.
	RowCounts map[string]int

	// Notes are non-fatal warnings the bulk pipeline aggregates into
	// sync_meta.error_message (or its successor) for diagnostic traceability.
	Notes []string
}

// Ingester is the contract for a per-entity ingestion step. Each implementation
// reads from a local PokeAPI/api-data checkout and writes rows to one or more
// related tables.
//
// The bulk pipeline runs ingesters in FK-dependency order under one
// BEGIN IMMEDIATE / COMMIT transaction (the caller owns that transaction).
type Ingester interface {
	// Name is a human-readable identifier for logging and metrics.
	Name() string

	// Ingest reads from apiDataPath and writes to db. The caller has already
	// opened the transaction; ingesters MUST NOT BEGIN/COMMIT inside.
	Ingest(ctx context.Context, db DBExecutor, apiDataPath string) (IngestResult, error)
}

// DBExecutor is the subset of *sql.DB and *sql.Tx that ingesters need.
// Accepting an interface lets the bulk pipeline wrap all ingesters in one
// transaction without each ingester having to know whether it has a db
// handle or a tx handle.
//
// PrepareContext is part of the contract because the largest ingester
// (pokemon_moves, ~50-100k rows) is dramatically faster with prepared
// statements than ad-hoc Exec calls.
type DBExecutor interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
	PrepareContext(ctx context.Context, query string) (*sql.Stmt, error)
}
