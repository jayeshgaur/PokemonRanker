// Command pokedex-sync builds the Pokédex SQLite from upstream PokeAPI data.
//
// Subcommands:
//
//	bulk          Rebuild the Pokédex SQLite from a local api-data checkout.
//	delta         Re-ingest only species changed since a given commit. (Phase 1.F)
//	drift-check   Sample-check live PokeAPI against our SQLite.            (Phase 1.F)
//
// See docs/PLAN.md Phase 1 and apps/api/internal/pokedex/ingest for the
// implementation details.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/jayesh/pokemon-ranker/api/internal/pokedex"
	"github.com/jayesh/pokemon-ranker/api/internal/pokedex/ingest"
)

const usage = `usage: pokedex-sync <command> [flags]

commands:
  bulk          Rebuild the Pokédex SQLite from a local api-data checkout
  validate      Run the post-sync data sanity-check suite against a SQLite file
  delta         Re-ingest only species changed since a given commit (Phase 1.F)
  drift-check   Sample-check live PokeAPI against our SQLite (Phase 1.F)

run 'pokedex-sync <command> -h' for command-specific flags.
`

func main() {
	if len(os.Args) < 2 {
		fmt.Fprint(os.Stderr, usage)
		os.Exit(2)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		stop := make(chan os.Signal, 1)
		signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
		<-stop
		cancel()
	}()

	cmd, args := os.Args[1], os.Args[2:]
	switch cmd {
	case "bulk":
		runBulk(ctx, args)
	case "validate":
		runValidate(ctx, args)
	case "delta":
		fmt.Fprintln(os.Stderr, "delta: not implemented (Phase 1.F)")
		os.Exit(2)
	case "drift-check":
		fmt.Fprintln(os.Stderr, "drift-check: not implemented (Phase 1.F)")
		os.Exit(2)
	case "-h", "--help", "help":
		fmt.Fprint(os.Stdout, usage)
	default:
		fmt.Fprintf(os.Stderr, "unknown command %q\n\n%s", cmd, usage)
		os.Exit(2)
	}
}

func runValidate(ctx context.Context, args []string) {
	fs := flag.NewFlagSet("validate", flag.ExitOnError)
	dbPath := fs.String("db", "data/pokedex.sqlite", "path to the Pokédex SQLite file")
	if err := fs.Parse(args); err != nil {
		os.Exit(2)
	}

	db, err := pokedex.Open(ctx, *dbPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "open %s: %v\n", *dbPath, err)
		os.Exit(1)
	}
	defer func() { _ = db.Close() }()

	issues, err := pokedex.Validate(ctx, db)
	if err != nil {
		fmt.Fprintf(os.Stderr, "validate failed: %v\n", err)
		os.Exit(1)
	}
	if len(issues) == 0 {
		fmt.Println("validate: 0 issues — all checks passed")
		return
	}
	fmt.Fprintf(os.Stderr, "validate: %d issue(s):\n", len(issues))
	for _, i := range issues {
		fmt.Fprintf(os.Stderr, "  [%s] got=%q want=%q %s\n", i.Test, i.Got, i.Want, i.Detail)
	}
	os.Exit(1)
}

func runBulk(ctx context.Context, args []string) {
	fs := flag.NewFlagSet("bulk", flag.ExitOnError)
	out := fs.String("out", "data/pokedex.sqlite", "path to write the SQLite file")
	apiData := fs.String("api-data", "", "path to a local checkout of github.com/PokeAPI/api-data")
	if err := fs.Parse(args); err != nil {
		os.Exit(2)
	}

	res, err := ingest.RunBulk(ctx, ingest.BulkOptions{
		OutputPath:  *out,
		APIDataPath: *apiData,
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "bulk sync failed: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("bulk sync complete: %s (commit=%s, %s)\n", res.OutputPath, res.APIDataCommitSHA, res.Duration)
}
