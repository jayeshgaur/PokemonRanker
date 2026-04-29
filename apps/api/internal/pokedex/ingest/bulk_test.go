package ingest_test

import (
	"context"
	"database/sql"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	_ "modernc.org/sqlite"

	"github.com/jayesh/pokemon-ranker/api/internal/pokedex/ingest"
)

func TestRunBulk_CreatesDatabaseAndRecordsRun(t *testing.T) {
	ctx := context.Background()
	out := filepath.Join(t.TempDir(), "pokedex.sqlite")

	res, err := ingest.RunBulk(ctx, ingest.BulkOptions{OutputPath: out})
	require.NoError(t, err)

	assert.Equal(t, out, res.OutputPath)
	assert.Equal(t, "scaffold", res.APIDataCommitSHA)
	assert.Greater(t, res.Duration.Microseconds(), int64(0))

	db, err := sql.Open("sqlite", out)
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	var (
		mode string
		sha  string
	)
	require.NoError(t, db.QueryRow(
		`SELECT mode, api_data_commit_sha FROM sync_meta ORDER BY id DESC LIMIT 1`,
	).Scan(&mode, &sha))
	assert.Equal(t, "bulk", mode)
	assert.Equal(t, "scaffold", sha)

	// Pin file is NOT written for the "scaffold" placeholder.
	pinPath := filepath.Join(filepath.Dir(out), "api-data-sha")
	_, err = os.Stat(pinPath)
	assert.True(t, os.IsNotExist(err), "pin file should not exist when SHA is scaffold")
}

func TestRunBulk_RequiresOutputPath(t *testing.T) {
	_, err := ingest.RunBulk(context.Background(), ingest.BulkOptions{})
	require.Error(t, err)
}

func TestRunBulk_OverwritesExistingDatabase(t *testing.T) {
	ctx := context.Background()
	out := filepath.Join(t.TempDir(), "pokedex.sqlite")

	_, err := ingest.RunBulk(ctx, ingest.BulkOptions{OutputPath: out})
	require.NoError(t, err)

	_, err = ingest.RunBulk(ctx, ingest.BulkOptions{OutputPath: out})
	require.NoError(t, err)

	db, err := sql.Open("sqlite", out)
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	// Each bulk run overwrites the file from scratch via atomic rename, so
	// only the latest run's sync_meta row should be present.
	var count int
	require.NoError(t, db.QueryRow(`SELECT COUNT(*) FROM sync_meta`).Scan(&count))
	assert.Equal(t, 1, count, "atomic-replace bulk should leave a single sync_meta row")
}

func TestRunBulk_CleansUpStaleTempFile(t *testing.T) {
	ctx := context.Background()
	out := filepath.Join(t.TempDir(), "pokedex.sqlite")

	// Simulate a previous failed run by leaving a stale .tmp file.
	stale := out + ".tmp"
	require.NoError(t, os.WriteFile(stale, []byte("junk"), 0o600))

	_, err := ingest.RunBulk(ctx, ingest.BulkOptions{OutputPath: out})
	require.NoError(t, err)

	// The .tmp should have been consumed by the atomic rename.
	assert.NoFileExists(t, stale)
}

// --- Phase 1.B.1 git rev-parse + pin file tests ---

func TestRunBulk_FailsHardWhenAPIDataPathIsNotAGitRepo(t *testing.T) {
	// Per data-sync 1.B.1 gate review §3: when --api-data is explicitly passed,
	// failure to read the SHA via `git rev-parse HEAD` is a hard error.
	// Silent "unknown" placeholders mis-pin the SQLite and hide configuration bugs.
	ctx := context.Background()
	dir := t.TempDir()
	apiData := filepath.Join(dir, "not-a-git-repo")
	require.NoError(t, os.MkdirAll(apiData, 0o755))

	out := filepath.Join(dir, "pokedex.sqlite")
	_, err := ingest.RunBulk(ctx, ingest.BulkOptions{
		OutputPath:  out,
		APIDataPath: apiData,
	})
	require.Error(t, err, "non-git api-data path should fail when APIDataPath is set")

	// Output file should not exist (sync didn't complete).
	_, err = os.Stat(out)
	assert.True(t, os.IsNotExist(err), "no SQLite should be written when api-data SHA cannot be resolved")
}

func TestRunBulk_PicksUpRealCommitSHAAndWritesPinFile(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not available")
	}

	ctx := context.Background()
	dir := t.TempDir()
	apiData := filepath.Join(dir, "api-data")
	require.NoError(t, os.MkdirAll(apiData, 0o755))

	gitCmds := [][]string{
		{"-C", apiData, "init"},
		{"-C", apiData, "config", "user.email", "test@example.com"},
		{"-C", apiData, "config", "user.name", "Test"},
		{"-C", apiData, "config", "commit.gpgsign", "false"},
		{"-C", apiData, "commit", "--allow-empty", "-m", "init"},
	}
	for _, args := range gitCmds {
		cmd := exec.Command("git", args...)
		require.NoError(t, cmd.Run(), "git %v", args)
	}

	// Seed empty resource indices so the 1.B.2 ingesters succeed with zero rows.
	for _, resource := range []string{"generation", "type", "stat", "ability", "move", "pokemon-species", "pokemon-form", "pokemon", "evolution-chain"} {
		indexPath := filepath.Join(apiData, "data", "api", "v2", resource, "index.json")
		require.NoError(t, os.MkdirAll(filepath.Dir(indexPath), 0o755))
		require.NoError(t, os.WriteFile(indexPath, []byte(`{"results":[]}`), 0o600))
	}

	out := filepath.Join(dir, "pokedex.sqlite")
	res, err := ingest.RunBulk(ctx, ingest.BulkOptions{
		OutputPath:  out,
		APIDataPath: apiData,
	})
	require.NoError(t, err)

	// A real SHA: 40 hex chars (SHA-1) or 64 (SHA-256). Either way >= 40.
	assert.GreaterOrEqual(t, len(res.APIDataCommitSHA), 40)
	assert.NotEqual(t, "scaffold", res.APIDataCommitSHA)
	assert.NotEqual(t, "unknown", res.APIDataCommitSHA)

	// Pin file is written next to the SQLite output.
	pinPath := filepath.Join(filepath.Dir(out), "api-data-sha")
	pinContent, err := os.ReadFile(pinPath)
	require.NoError(t, err)
	assert.Contains(t, string(pinContent), res.APIDataCommitSHA)
}
