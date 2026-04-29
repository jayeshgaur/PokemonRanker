// Package pokedex is the read-only data layer for the Pokémon dataset.
//
// The package owns the SQLite schema (see schema.sql), the strongly-typed
// query API consumed by the rest of the application, and the sync subpackage
// that rebuilds the database from upstream PokeAPI data.
//
// See docs/PLAN.md Phase 1 and docs/DECISIONS.md D-1, D-4 for the design.
package pokedex

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	_ "modernc.org/sqlite" // pure-Go SQLite driver registered as "sqlite".
)

// Open returns a *sql.DB connected to a SQLite database at path, with the
// Pokédex schema applied idempotently. Pass ":memory:" for an in-memory
// database (used in tests).
//
// Callers own the returned *sql.DB and are responsible for closing it.
func Open(ctx context.Context, path string) (*sql.DB, error) {
	dsn := path
	if path != ":memory:" {
		// modernc.org/sqlite supports per-connection PRAGMAs via DSN params.
		dsn = "file:" + path + "?_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)"
	}

	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite at %q: %w", path, err)
	}

	pingCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := db.PingContext(pingCtx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("ping sqlite at %q: %w", path, err)
	}

	if _, err := db.ExecContext(ctx, schemaSQL); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("apply schema: %w", err)
	}

	if err := recordSchemaVersion(ctx, db); err != nil {
		_ = db.Close()
		return nil, err
	}

	return db, nil
}

func recordSchemaVersion(ctx context.Context, db *sql.DB) error {
	const stmt = `
		INSERT INTO schema_version (version, applied_at)
		VALUES (?, ?)
		ON CONFLICT (version) DO NOTHING
	`
	_, err := db.ExecContext(ctx, stmt, SchemaVersion, time.Now().UTC().Format(time.RFC3339))
	if err != nil {
		return fmt.Errorf("record schema version %d: %w", SchemaVersion, err)
	}
	return nil
}
