# Code Review — Phase 1.B.1 (schema expansion + sync infrastructure)

**Reviewer:** code-reviewer agent
**Scope:** Diff since the Phase 1.A re-gate. Schema v1 → v2 (`apps/api/internal/pokedex/schema.sql`, `schema.go`, `types.go`, `db_test.go`); new `Ingester` / `DBExecutor` interface (`apps/api/internal/pokedex/ingest/ingester.go`); real `git rev-parse HEAD` and pin-file write in `bulk.go`; two new bulk tests; `Makefile` (`api-data-pull`, `sync-inspect`, `sync`/`sync-from-clone`); `.gitignore` notes.
**Local CI gates:** `go vet ./...` clean. `golangci-lint run` reports `0 issues`. `go test -race -count=1 ./...` green — `pokedex` (13 tests, including the new `TestSpecies_EvolvesFromSelfFKEnforced`) and `ingest` (6 tests, +2 new). The `git rev-parse` test runs (git is on the path); the non-git path test exercises the `unknown` branch.

## Verdict (TL;DR)

The diff is a clean implementation of the Phase 1.B.1 scope: additive-only schema growth, an `Ingester`/`DBExecutor` shape that will host 1.B.2 ingestion without further redesign, and a non-injectable `git rev-parse` shell-out. The only blocker-class observation is a documentation correctness one — `SchemaVersion`'s history comment claims this version "introduces the `localized_names` table" but that table was deliberately deferred at the planning gate and is not in the schema. Fix the comment in this commit before merge; everything else is `[nit]` / `[question]` follow-up.

---

## ADR alignment

### D-1 (form identity) — `[praise]`

The schema additions strengthen rather than weaken D-1. `pokemon.is_default` makes the canonical form for a species explicit at the row level, which complements `pokemon.form_id UNIQUE` and `forms` partial-unique-on-`is_default`. The composite invariant — exactly one default form per species, exactly one Pokemon row per (species, form) — is now expressible across both tables. `species.evolves_from_species_id` (`schema.sql:70`) is a *species*-level edge, not a form-level edge, which is correct: D-1 says forms are distinct competitors, but evolution is a species relationship in PokeAPI. Compliant.

### D-22 (single deploy: Go is sync-only) — `[praise]`

Every change is on the sync side. No HTTP server is reintroduced. `apps/api/cmd/` still contains only `pokedex-sync/`. The `Ingester` interface and `RunBulk` continue to be invoked exclusively by the CLI binary, not by any runtime backend. The `Makefile` adds `api-data-pull`, `sync-inspect`, `sync-from-clone` — all of which are sync-time tooling. The only new runtime-ish artifact is the sibling `api-data-sha` pin file written next to the SQLite at sync time, and that is a build-artifact, not a request-path output. D-22 holds.

### D-6 (validation at IO edges) — `[praise]` / `[question]`

`commitSHAOrPlaceholder` reads external command output (`git rev-parse HEAD`) and uses the result as a string written to two locations: the SQLite `sync_meta.api_data_commit_sha` column and a sibling `api-data-sha` file. The output is `strings.TrimSpace`'d, no further validation is performed. Three observations:

1. `[praise]` Failure to invoke `git` is treated as a soft failure: the function returns `"unknown"` rather than propagating an error. Combined with `shouldWritePin`'s rejection of `"unknown"`, this means a corrupt/missing api-data path produces a placeholder row and *no* pin file — exactly the right contract for a non-fatal provenance miss.
2. `[question]` The trimmed output is written verbatim. A real `git rev-parse HEAD` produces 40 hex chars (SHA-1) or 64 hex chars (SHA-256), but the function does not assert that. If a future Git wrapper script (or a `core.symref`-style configuration) caused unexpected stdout, the bogus value would land in the DB and the pin file. Cheap mitigation: a `regexp.MustCompile(\`^[0-9a-f]{40,64}$\`).MatchString(out)` gate in `commitSHAOrPlaceholder` that returns `"unknown"` on mismatch. Not a blocker — `git rev-parse HEAD` against a real repo is a stable contract — but it would honor the spirit of D-6 where this function reads from an external IO source.
3. `[nit]` `shouldWritePin`'s allowlist-via-blocklist (`""`, `"scaffold"`, `"unknown"`) is defensive but could become an ack: pair it with the regexp suggestion above and the function reduces to "is this a real SHA?" — which is what the call site actually wants.

For Phase 1.B.1's stated scope (provenance-on-best-effort), the current shape is acceptable. The hardening above is a 1.B.4 (final gate) follow-up.

### D-2, D-4, D-13, D-17/D-21, D-18 — re-checked, all still aligned

D-13 layout unchanged (sync work all under `apps/api/...`). D-4 holds (only the SQLite store is touched). D-17/D-21 holds (sprite/cry remain URL columns — unchanged). D-18 holds (no new paid surface; the `gofrs/flock` dep is unchanged; pure-Go).

---

## `commitSHAOrPlaceholder` — shell-out review

`apps/api/internal/pokedex/ingest/bulk.go:155-165`:

```go
func commitSHAOrPlaceholder(ctx context.Context, apiDataPath string) string {
    if apiDataPath == "" {
        return "scaffold"
    }
    cmd := exec.CommandContext(ctx, "git", "-C", apiDataPath, "rev-parse", "HEAD")
    out, err := cmd.Output()
    if err != nil {
        return "unknown"
    }
    return strings.TrimSpace(string(out))
}
```

### `[praise]` No injection vector

`exec.CommandContext` with positional args (not `sh -c`) means `apiDataPath` is passed as a single argument to `git -C`. Even a value of `"; rm -rf /"` becomes a literal directory argument that `git` rejects with `fatal: cannot change to '...'`. There is no shell interposition. The CLI flag `--api-data` is therefore safe even if a future caller forgets to sanitize. This is the correct way to invoke a subprocess in Go; switching to `exec.Command("sh", "-c", ...)` would be the only way to introduce injection here, and the diff does not.

### `[praise]` Context propagation

`exec.CommandContext(ctx, ...)` honors cancellation: if the parent `RunBulk` context is cancelled mid-`git`, the subprocess is killed. SIGINT/SIGTERM handling in `cmd/pokedex-sync/main.go` therefore propagates correctly all the way to the subprocess.

### `[question]` `cmd.Output()` discards stderr

Failure mode `error` is returned without surfacing `git`'s stderr to the user. In the most common debug case ("I pointed `--api-data` at the wrong directory"), the user sees the SQLite committed with `api_data_commit_sha = 'unknown'` and no warning about *why* git failed. A one-liner improvement:

```go
out, err := cmd.Output()
if err != nil {
    var exitErr *exec.ExitError
    if errors.As(err, &exitErr) && len(exitErr.Stderr) > 0 {
        fmt.Fprintf(os.Stderr, "warning: git rev-parse failed: %s\n", bytes.TrimSpace(exitErr.Stderr))
    }
    return "unknown"
}
```

Tracks the same "best-effort with stderr warning" pattern used for the pin file at `bulk.go:140-142`. Optional; non-blocking.

### `[nit]` "scaffold" / "unknown" magic strings

Both placeholders appear in three places (the function itself, `shouldWritePin`, and the test). Promoting them to `const` would tighten the contract and make the test's `assert.Equal(t, "scaffold", res.APIDataCommitSHA)` self-documenting. Could also expose a typed value (e.g., `var ErrCommitSHAUnknown = errors.New("...")`) but that is overkill for an internal placeholder.

---

## Pin-file write — review

`apps/api/internal/pokedex/ingest/bulk.go:138-143`:

```go
if shouldWritePin(commitSHA) {
    pinPath := filepath.Join(filepath.Dir(opts.OutputPath), "api-data-sha")
    if err := os.WriteFile(pinPath, []byte(commitSHA+"\n"), 0o600); err != nil {
        fmt.Fprintf(os.Stderr, "warning: failed to write %s: %v\n", pinPath, err)
    }
}
```

### `[praise]` Best-effort failure handling is right for the contract

The PM planning gate's framing is that the pin file is a *reproducibility convenience*, not load-bearing. A failure on the pin-write should not roll back the SQLite (which has already been atomically renamed and is the source of truth). A stderr warning is the standard Go approach for "non-fatal but observable" issues. Correct.

### `[praise]` Mode `0o600`

The pin file is information that doesn't need to be world-readable. `0o600` is consistent with the security-conscious posture of writing test API keys / commit SHAs.

### `[question]` Pin-file is written *after* atomic rename — is that the right ordering?

If the atomic rename succeeds and the pin write fails, the SQLite is the new source of truth and the pin file is stale (or absent). If a process were watching `api-data-sha` to discover when to re-trigger downstream work, that consumer would get the previous SHA and miss the latest sync. Today there is no such consumer (the `make sync-inspect` target reads the pin file lazily, no watchers), so this is fine. Worth a one-line comment in `bulk.go` noting the pin-file ordering is "informational only; SQLite is the contract." Optional.

### `[nit]` Trailing newline

`commitSHA+"\n"` is good — it makes `cat data/api-data-sha` print cleanly and matches the common Unix convention that text files end in a newline.

### `[question]` Pin-file path collisions with a literal `--out api-data-sha`

If a user runs `pokedex-sync bulk --out api-data-sha` (silly, but legal), the pin file would *be* the SQLite output's parent's `api-data-sha`, which would now collide with the SQLite. This is theoretical — nobody does that — but documenting "pin file writes to `<dir>/api-data-sha`" in the `BulkOptions` struct doc-comment would prevent the foot-gun. Optional.

---

## `Ingester` / `DBExecutor` interface — shape review

`apps/api/internal/pokedex/ingest/ingester.go`. No production users yet (Phase 1.B.2 is the consumer); the interface is shape-only.

### `[praise]` `DBExecutor` is the right abstraction for Tx vs DB

`*sql.DB` and `*sql.Tx` both implement `ExecContext`, `QueryContext`, and `QueryRowContext` natively. The `DBExecutor` interface is exactly the intersection — neither a superset nor a subset. An ingester written against this interface can be wired up:

- under one `BEGIN IMMEDIATE` in production by passing the `*sql.Tx`, or
- without a transaction in tests / smoke runs by passing the `*sql.DB`,

without changing the ingester body. That's the pattern the doc-comment promises ("the bulk pipeline can wrap all ingesters in one transaction without each ingester having to know whether it has a db handle or a tx handle"), and the interface delivers it.

### `[question]` Should `BeginTx` be in `DBExecutor`?

It would be tempting to add `BeginTx` so ingesters could nest savepoints. *Don't.* Today the contract is "the caller owns the transaction; ingesters MUST NOT BEGIN/COMMIT inside" — that's the right rule for a single-transaction bulk write. If a future ingester needs savepoints, that should be a deliberate API change with a separate review. The current minimal shape is correct.

### `[question]` `Ingester.Ingest` returns `(int, error)` — int is rows-written?

The doc-comment says "Returns the number of rows written." Two minor concerns:

1. For multi-table ingesters (e.g., `ingestPokemon` will write to `pokemon`, `pokemon_types`, `pokemon_stats`, `pokemon_abilities`), is `int` the row count of the *primary* table or the *sum* of all rows? The comment doesn't say. If the call-site uses this for `record_counts_json`, the semantics matter.
2. `int` vs `int64`: PokeAPI is small (1300 pokemon, ~400 species, etc.) so `int` is fine, but `record_counts_json` will probably be keyed by table name with int64 values to match the rest of the schema's int64 ids. Consider `int64` for parity. Optional.

The right time to pin this contract is when 1.B.2 lands the first concrete `Ingester` and the `RunBulk` orchestration calls into it. For now, the interface is *shape*-only and not yet load-bearing.

### `[praise]` `Name() string` for logging and metrics

A simple `Name() string` is standard Go for pluggable steps that need observability. Keeps the interface minimal. Good.

### `[nit]` `Ingester` has no implementations yet — interface segregation in advance is fine if it lands soon

`Ingester` and `DBExecutor` are exported but unused in this commit. Go would normally flag this as dead code; here it is deliberately the scaffold Phase 1.B.2 will implement against. Acceptable because (a) the bulk.go package doc-comment names this scope explicitly, and (b) 1.B.2 is the immediate next sub-phase. A `var _ Ingester = (*nullIngester)(nil)` placeholder somewhere would lock in the shape (and would let the test suite type-check it), but that's gold-plating for a one-week interval before the real implementation.

---

## Schema v1 → v2 — additive growth

### `[praise]` Additions match the planning-gate-trimmed scope exactly

Cross-checking the planning gate's trimmed list against the schema:

- `pokemon.is_default INTEGER NOT NULL DEFAULT 0` — `schema.sql:115`. ✓
- `pokemon.pokeapi_order INTEGER NOT NULL DEFAULT 0` — `schema.sql:116`. ✓
- `species.evolves_from_species_id INTEGER REFERENCES species(id)` — `schema.sql:70`, indexed at `:79`. ✓
- `species.forms_switchable INTEGER NOT NULL DEFAULT 0` — `schema.sql:71`. ✓
- `species.pokeapi_order INTEGER NOT NULL DEFAULT 0` — `schema.sql:72`. ✓
- `forms.pokeapi_order INTEGER NOT NULL DEFAULT 0` — `schema.sql:96`. ✓
- `forms.pokeapi_form_order INTEGER NOT NULL DEFAULT 0` — `schema.sql:97`. ✓
- `evolutions.gender INTEGER` — `schema.sql:233`. ✓
- `evolutions.time_of_day TEXT NOT NULL DEFAULT ''` — `schema.sql:234`. ✓
- `abilities.is_main_series INTEGER NOT NULL DEFAULT 0` — `schema.sql:175`. ✓
- `moves.target TEXT NOT NULL DEFAULT ''` — `schema.sql:200`. ✓

All eleven adds present, correctly defaulted, no removals. The `evolves_from_species_id` self-FK is correctly nullable (some species like Charmander have no predecessor). The supporting index `idx_species_evolves_from` is present and named consistently with the rest of the file. Solid.

### `[blocker]` `schema.go` history comment is wrong about `localized_names`

`apps/api/internal/pokedex/schema.go:13`:

```go
//   - v2 (Phase 1.B.1): adds §1.1–§1.6 PokeAPI fields per data-sync agent's review;
//     introduces the `localized_names` table for future i18n.
```

The `localized_names` table was *deliberately deferred* at the PM planning gate (see `schema.sql:250-251`: "(localized_names table deferred per planning gate, 2026-04-28; will be added when i18n traffic actually warrants. Tracked in OPEN_QUESTIONS.md.)"). The history comment in `schema.go` claims the opposite. A future reader doing version archaeology will be misled, and a reader doing `go doc` on `pokedex.SchemaVersion` will see a contradiction with the schema.

This is a documentation correctness issue, not a code-correctness one. Easy fix; should land in this commit before merge:

```go
//   - v2 (Phase 1.B.1): adds the §1.1–§1.6 PokeAPI fields surfaced by the data-sync
//     agent's review (pokemon.is_default/pokeapi_order, species.evolves_from_species_id
//     + forms_switchable + pokeapi_order, forms.pokeapi_order/_form_order,
//     evolutions.gender + time_of_day, abilities.is_main_series, moves.target).
//     The `localized_names` table is deferred per the PM planning gate (2026-04-28).
```

### `[praise]` `species.evolves_from_species_id` self-FK is FK-tested

`db_test.go:169-179` (`TestSpecies_EvolvesFromSelfFKEnforced`) inserts a species pointing at a non-existent predecessor and asserts the FK is rejected. The test seeds via `seedSpecies` (so a real `species.id = 1` exists), then attempts to insert a second species with `evolves_from_species_id = 999`. That hits the FK violation cleanly without ambiguity. Correct.

### `[nit]` `evolutions.gender INTEGER` semantics

PokeAPI uses `gender` as an integer code (1 = female-only, 2 = male-only, 3 = either; from the `evolution-trigger` schema). The column is correctly typed `INTEGER` and nullable (most evolution edges have no gender constraint). A column comment naming the codes would help future readers, but SQLite doesn't support inline column comments — the `schema.sql` file-level comments are doing that job. Acceptable.

### `[question]` `forms.pokeapi_order` vs `forms.pokeapi_form_order`

PokeAPI emits two ordering signals on a form: the *Pokemon-level* order (used for sorting alongside other Pokemon) and the *form-specific* order (used to sort forms within a species). The schema captures both. Worth a one-line comment distinguishing them in `schema.sql` so the 1.B.2 ingester knows which to put where; today the names are just suggestive. Optional.

### `[praise]` Removed-tests audit

The diff removes two tests that were covering deferred features. From the planning-gate trim list, those would be the deferred `localized_names` and the deferred `species.gender_rate` / similar. The removal is correct — the feature is gone, the test should go too — and `expectedTables` in `db_test.go:17-37` does not list `localized_names`, which matches the actual schema. Consistent.

---

## Test coverage review

### `[praise]` `TestRunBulk_HandlesNonGitAPIDataPath` is substantive

The test creates a non-git directory, points `RunBulk` at it, and asserts:
1. `RunBulk` returns success (best-effort SHA capture should not fail the run).
2. The result's `APIDataCommitSHA` is `"unknown"`.
3. The pin file is *not* written (because `shouldWritePin("unknown") = false`).

That's the full contract for the failure path. The earlier `TestRunBulk_CreatesDatabaseAndRecordsRun` was strengthened in this same commit to also assert the pin file is absent for `"scaffold"`. Together the two cases (no path → "scaffold", non-git path → "unknown") cover both placeholder branches and the corresponding pin-file omission. Solid.

### `[praise]` `TestRunBulk_PicksUpRealCommitSHAAndWritesPinFile` is substantive — and correctly skips when git is missing

The test creates a real git repo, makes an empty commit, and runs `RunBulk` against it. Then it asserts:
1. The returned SHA is at least 40 chars (covering both SHA-1 and SHA-256 hashes, which is forward-looking — git is migrating).
2. The SHA is neither `"scaffold"` nor `"unknown"` (proving the real branch fired).
3. The pin file exists and contains the SHA.

The `t.Skip("git not available")` at the top is the right call: CI without git would otherwise produce a confusing failure. The test setup is a little verbose (5 git invocations to bootstrap a repo), but each is needed and `commit.gpgsign=false` is the right defensive setting for a CI environment. Solid.

### `[question]` Should there be a test for the pin-file write *failure* path?

`bulk.go:140` writes the pin file with `os.WriteFile`. A failure mode (parent directory read-only, disk full) currently emits a stderr warning but lets `RunBulk` return success. There is no test for "pin write fails → RunBulk still succeeds." Easy to add:

```go
// Make the output directory read-only after the SQLite is renamed but
// before the pin write — verify RunBulk returns success and writes a
// stderr warning.
```

Practically annoying to set up (you'd have to chmod after rename, which means a hook in `RunBulk`). Optional; the failure mode is rare and the contract is right. Defer to 1.B.4.

### `[praise]` `TestSpecies_EvolvesFromSelfFKEnforced` is the right shape

Surgical (one constraint, one assertion), uses the `seedSpecies` helper (no test setup duplication), runs against `:memory:`. Consistent with the constraint-test pattern from the Phase 1.A re-gate. Good.

### `[nit]` No test for the new `is_default` / `pokeapi_order` columns

Both columns default to non-null values, so existing tests still pass without updating. A trivial test could insert a row and read back to verify the round-trip. Cost: one extra test. Value: catches the case where a future schema rewrite drops the column without anyone noticing because no SELECT exercises it. Optional; the `expectedTables` check pins the *table* set but not column-level shape.

### `[question]` `seedSpecies` uses a `pokedex_number` of `6` (Charizard)

Unrelated to this diff, but the new `TestSpecies_EvolvesFromSelfFKEnforced` inserts species id 2 (`charmeleon`) with `pokedex_number = 5` against the existing seed of species id 1 (`charizard`, `pokedex_number = 6`). That's slug- and dex-number-correct but inverted from the actual evolution direction (Charmeleon evolves *into* Charizard, not from). The test doesn't actually exercise the evolution semantics — it only tests the FK — so the inversion is irrelevant. Mention as `[question]` only because a casual reader might find it confusing. Optional.

---

## `Makefile` — review

### `[praise]` `api-data-pull` is shallow + idempotent

`--depth 1 --branch master --single-branch` keeps the clone small (~557 MB per the comment, which matches the actual `PokeAPI/api-data` working set). The "if .git exists, fetch + reset" branch makes the target idempotent — running it twice is fine. The `git reset --hard origin/master` call is destructive in the sense that it will overwrite local changes in `apps/api/data/api-data/`, but that directory is gitignored and is meant to be a pure cache. Correct.

### `[praise]` `sync-inspect` is a one-screen status

The output structure (row counts → latest sync_meta row → sample pokemon → pin file) is exactly what an operator wants for "did the last sync work?" The `for tbl in $$(sqlite3 ... SELECT name FROM sqlite_master ...)` pattern is portable across shell variants and doesn't hardcode the table list. Robust against schema growth (future tables auto-appear in the row-count section).

### `[nit]` `sync-inspect` doesn't display schema_version

The latest `sync_meta` SELECT lists `id, ran_at, mode, api_data_commit_sha, duration_ms, status` but *not* `schema_version`. Since the row carries it now (per Phase 1.A regate), surfacing it would help an operator catch a stale-binary-vs-fresh-schema mismatch. One-liner — add `, schema_version` to the SELECT. Optional.

### `[question]` `sync` target's APIDATA env-var handling

`make sync APIDATA=path/to/api-data` works via the `$(if $(APIDATA),--api-data $(APIDATA))` construct. If `APIDATA` is empty, the flag is omitted and `pokedex-sync bulk` runs in scaffold mode. That's the right behavior. Worth documenting in the help text — currently the help text says "Pass APIDATA=path or run `make sync-from-clone` once 1.B.2 lands," which is good but could clarify that the empty case produces a scaffold-only SQLite. Optional.

### `[praise]` `sync-from-clone` chains `api-data-pull` first

A new contributor running `make sync-from-clone` gets the api-data clone *and* the sync in one command. That's the right ergonomic for the 1.B.2 onboarding. The chaining via Make's prerequisite system (not a sub-shell) means a clone failure aborts the whole thing cleanly.

---

## `.gitignore` — review

### `[praise]` `api-data-sha` is committed by design

The new comment at `.gitignore:44` ("api-data-sha is committed (pin file for reproducibility per PM planning gate, 2026-04-28)") explains the *why* of an absence — i.e., why `api-data-sha` is *not* in the ignore list. That's exactly the kind of comment that prevents a future "let's clean up the gitignore" PR from accidentally adding it back to the ignore list and breaking reproducibility. Good.

### `[nit]` `apps/api/data/pokedex.sqlite` and `.tmp` / `-journal` / `.lock` already gitignored

All four are listed. The `.lock` entry is from the Phase 1.A re-gate; nothing new here. Consistent.

---

## Documentation review

### `[blocker]` `schema.go` `SchemaVersion` history comment

(Covered above.) Fix in this commit before merge.

### `[praise]` `bulk.go` package doc-comment names every Phase 1.B sub-phase

The package doc at `bulk.go:1-11` lays out which sub-phase touches which capability:

> Phase 1.A scope: schema-only bulk run with atomic write, ...
> Phase 1.B.1 scope (this file): real `git rev-parse HEAD` for provenance, ...
> Phase 1.B.2 fills in actual ingestion of species, forms, pokemon, etc.
> Phase 1.F adds delta and drift-check modes.

This is the right level of phase-boundary documentation: a reader can place any code they encounter in the right sub-phase without consulting `PLAN.md`. Doc-comment density is appropriate — not too verbose.

### `[praise]` `RunBulk` doc-comment includes the 12-step ingest plan

`bulk.go:45-70` lists the ingest order Phase 1.B.2 will hook in. That's exactly the right place — co-located with the orchestration code. When 1.B.2 lands, removing the comment and replacing it with actual calls will be a single-file diff and reviewable. Good.

### `[praise]` `Ingester` and `DBExecutor` are documented

Both interfaces have full doc-comments explaining their contract (Ingester transactions, DBExecutor as the Tx/DB intersection). Idiomatic for `go doc`.

### `[nit]` `ingester.go` is a one-file, two-types subpackage shard

Personal preference: I'd inline `Ingester` and `DBExecutor` into `bulk.go` until there are concrete `Ingester` implementations to share the file with. With only one consumer (`bulk.go`) and zero implementations, the indirection costs more than it pays. But two-files-per-package is also fine, and 1.B.2 will populate `ingester.go` (or sibling files) with implementations. Defer to author preference.

### `[praise]` `commitSHAOrPlaceholder` and `shouldWritePin` are documented

Both unexported helpers have doc-comments. `shouldWritePin` is a one-liner that exists exactly to make `RunBulk`'s `if` readable. That's a good extraction; the alternative (`if commitSHA != "" && commitSHA != "scaffold" && commitSHA != "unknown"`) would be uglier.

---

## Spirit-of-the-change summary

This is a focused 1.B.1 sub-phase: schema growth that stays additive, sync-time provenance that's correct without being elaborate, and an ingester scaffold that 1.B.2 can drop concrete implementations into without re-architecture. ADR alignment is clean: D-22 holds (no runtime backend introduced); D-1 is reinforced by `pokemon.is_default`; D-6 is honored in spirit by the placeholder-fallthrough on git failure (with a small `[question]` about not regex-validating the SHA shape).

The shell-out is non-injectable. The pin-file write is best-effort with stderr warning, which is the right contract for non-load-bearing reproducibility metadata. The new tests are substantive — the `git`-skip pattern is the right portability move. The `Makefile` changes are operational ergonomics, not behavior changes. The `.gitignore` comment is a nice touch.

The one fix this gate requires is the `SchemaVersion` history comment in `schema.go`, which currently misstates that v2 introduces `localized_names` (it doesn't — that table was deferred). A four-line edit. Land this in the same commit; the rest of the diff is approve-with-nits.

**Verdict: Approve with nits (one comment-only blocker: fix `SchemaVersion` history doc in `schema.go`)**
