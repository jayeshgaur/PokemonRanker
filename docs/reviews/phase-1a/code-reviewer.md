# Code Review — Phase 1.A (schema + sync skeleton)

**Reviewer:** code-reviewer agent
**Scope:** Pokédex schema, `pokedex` Go package, `ingest` subpackage, `pokedex-sync` binary, `tags.yaml` skeleton, `go.mod`, `Makefile`.
**CI gates locally:** `go vet` clean, `golangci-lint run` clean (0 issues), `go test -race ./...` green (12 tests across `pokedex` + `ingest`).

## Verdict (TL;DR)

The diff is in good shape for a schema-and-skeleton sub-phase: ADR-aligned, idiomatic Go, clear phase-boundary contracts, and meaningful tests. There are no merge blockers. A handful of nits and questions are worth addressing in 1.B rather than holding 1.A.

---

## ADR compliance

### D-1 (form identity) — `[praise]`

`apps/api/internal/pokedex/schema.sql:81-96` defines `pokemon` as one row per `(species_id, form_id)`, with `form_id` carrying a `UNIQUE` constraint, and `forms.species_id` enforcing the species link (`schema.sql:65-78`). That's a clean encoding of D-1: every (species, form) is exactly one row, and `form_id UNIQUE` means a form can never be associated with two pokemon rows. The Go-side `Pokemon` struct mirrors this with explicit `SpeciesID` and `FormID` fields (`types.go:6-24`) and the doc-comment cites D-1 by name. Good.

`[question]` `schema.sql:84` — `form_id INTEGER NOT NULL ... UNIQUE` covers the invariant, but a separate explicit `UNIQUE (species_id, form_id)` would document the intent of D-1 inline (and would survive a future refactor that drops the per-column UNIQUE). Worth a one-liner addition? Not a blocker; current encoding is correct.

### D-2 (curated tags) — `[praise]`

`apps/api/data/tags.yaml` and the `tags` / `pokemon_tags` schema land cleanly. `pokemon_tags` is many-to-many (`schema.sql:215-219`) and the file header (`tags.yaml:1-19`) documents the editorial workflow and the form-qualified slug convention, both of which are exactly what D-2 calls for. The `pseudo_legendary` list is the only one populated, and it includes Baxcalibur — modern enough.

### D-4 (two-store split) — `[praise]`

This sub-phase touches only the SQLite store (`internal/pokedex`); no Postgres references leak in. The package doc (`db.go:1-9`) calls out the read-only role explicitly. Consistent with D-4.

### D-6 (validation at IO boundaries) — `[question]` / `[nit]`

Phase 1.A has *no real ingestion yet*, so there is no PokeAPI fetch or DB write of fan-supplied data to validate. The ADR is therefore not actively tested here. But the `RunBulk` API surface introduces an option struct (`ingest/bulk.go:21-28`) that should be validated when ingestion arrives. There is one very light validation today:
- `OutputPath == ""` is rejected with a plain `errors.New` (`ingest/bulk.go:46-48`). Good.
- `APIDataPath` is silently optional. From Phase 1.B onward it will be required; ensure the validation is added there, not deferred again.

`[nit]` Consider adding a `func (o BulkOptions) Validate() error` method now (returning nil-or-error against the Phase 1.A contract), so Phase 1.B has the obvious extension point. Optional; not load-bearing for this gate.

### D-13 (repo layout) — `[praise]`

Files land where the ADR says: `apps/api/internal/pokedex/...`, `apps/api/cmd/pokedex-sync/...`, `apps/api/data/tags.yaml`. `Makefile` `make sync` orchestrates from the repo root via `cd apps/api && go run ./cmd/pokedex-sync ...`. Consistent with D-13.

### D-17 (sprite/cry URLs as columns, not bundled assets) — `[praise]`

`schema.sql:81-96` carries `sprite_url`, `shiny_sprite_url`, `official_artwork_url`, `cry_url`, and `pokedex_db_url` as columns on `pokemon`. No `assets/` directory, no proxy, no bundled binary blobs. The defaults are empty strings, which is reasonable for the schema-only phase. Aligned with D-17.

### D-18 (zero-cost: pure-Go SQLite driver) — `[praise]`

`go.mod:8` brings in `modernc.org/sqlite v1.34.4` — the pure-Go driver. `db.go:16` imports it as the registered driver. No `mattn/go-sqlite3` (CGO). `go test -race ./...` runs without CGO env requirements. D-18 honored on both axes (no paid infra, no CGO toolchain demand).

---

## Idiomatic Go

### `[praise]` Error wrapping is consistent

Every error from `db.go` and `ingest/bulk.go` is wrapped with `fmt.Errorf("...: %w", err)` and includes context (path, operation). The two `errors.New` cases (`bulk.go:47`, `query.go:11,14`) are appropriate — there is nothing to wrap.

### `[praise]` Context propagation is consistent

`Open(ctx, ...)`, `RunBulk(ctx, opts)`, and the `Query` interface methods all take a `context.Context`. `cmd/pokedex-sync/main.go:40-47` wires up `os/signal` cancellation cleanly so SIGINT/SIGTERM cancels the in-flight context. That's the right shape.

### `[nit]` `recordSchemaVersion` writes on every Open

`db.go:48` calls `recordSchemaVersion` unconditionally in `Open`. The statement is `INSERT ... ON CONFLICT DO NOTHING` so it's idempotent (the test at `db_test.go:55-70` confirms this). The cost is one no-op write per process boot — negligible. But it does mean a future "read-only consumer Open" path is still writing. If you ever add a `OpenReadOnly`, that constraint will need to flip. Worth a doc-comment line on `Open` that it is *not* read-only.

### `[nit]` `Open` writes the schema on every call without checking SchemaVersion

`db.go:43-46` runs the full `schemaSQL` (all `IF NOT EXISTS`) every Open, then records `SchemaVersion`. There is no "if existing schema_version != current SchemaVersion, fail or migrate" branch. That's fine for the schema-only phase, but the comment in `schema.sql:13` ("When the schema changes, bump SchemaVersion in schema.go") implies a contract that isn't enforced. Phase 1.B or 1.F should add the version check; flag a TODO in `db.go` so it doesn't drift.

### `[question]` Why is `evolutions.id` `AUTOINCREMENT` while everything else is plain `INTEGER PRIMARY KEY`?

`schema.sql:182-191` uses `INTEGER PRIMARY KEY AUTOINCREMENT` for `evolutions.id`, and `tags.id` (`schema.sql:206-211`) too. The other tables (species, forms, pokemon, etc.) lift their id from upstream PokeAPI, so plain `INTEGER PRIMARY KEY` is right. For evolutions and tags the id is locally generated, so `AUTOINCREMENT` is defensible — but in SQLite, `INTEGER PRIMARY KEY` already generates monotonic rowids without `AUTOINCREMENT`, and `AUTOINCREMENT` adds the `sqlite_sequence` table overhead and a guarantee of *strict* monotonicity (no rowid reuse) that we likely don't need. Drop `AUTOINCREMENT` unless the strict-monotonic guarantee is intentional? Not a blocker.

### `[nit]` Errors-vs-fmt for the option-required case

`bulk.go:47` uses `errors.New("ingest.RunBulk: OutputPath is required")` while every other error in the file uses `fmt.Errorf`. The `errors.New` is fine, but if you want to wrap a sentinel for testability ("did this fail because the option was missing?"), define `ErrMissingOutputPath` next to `ErrNotImplemented` in `query.go`'s style. Either pattern is idiomatic; mixing them is the nit.

### `[praise]` Atomic-rename strategy is correct

`bulk.go:54-93` writes to `OutputPath + ".tmp"`, populates the schema and `sync_meta`, closes the DB, then `os.Rename`s into place. `os.Rename` is atomic on the same filesystem on POSIX. The error paths consistently call `os.Remove(tmp)` to avoid stranded turds. This is the right pattern; `bulk_test.go:69-82` even covers the stale-`.tmp` cleanup case.

### `[nit]` Unconditional pre-`os.Remove(tmp)` swallows errors

`bulk.go:55-56`: the comment says "Stale .tmp from a previous failed run: remove unconditionally." The `_ = os.Remove(tmp)` ignores the error, which is fine when the file is missing (ENOENT) but masks an EACCES from a permissions issue. Idiomatic alternative: `if err := os.Remove(tmp); err != nil && !errors.Is(err, fs.ErrNotExist) { return ... }`. Optional.

### `[praise]` Package docs

`db.go:1-9` (package `pokedex`) and `ingest/bulk.go:1-7` (package `ingest`) both have crisp package doc comments that point the reader at the relevant ADR and PLAN.md section. `cmd/pokedex-sync/main.go:1-10` likewise documents the subcommand structure. This is exactly what `go doc` consumers want.

---

## Test coverage

### `[praise]` The right things are tested

- `TestOpen_CreatesAllExpectedTables` (`db_test.go:39-45`) is the most valuable test in the suite: it pins down every table the schema must produce, with a comment instructing maintainers to update the list. This is the kind of test that prevents silent schema drift.
- `TestOpen_IsIdempotentOnReopen` (`db_test.go:55-70`) verifies the `ON CONFLICT DO NOTHING` semantics on `schema_version` — exactly the right invariant.
- `TestOpen_EnforcesForeignKeys` (`db_test.go:72-81`) is *important* because `modernc.org/sqlite` does not enable foreign keys by default and the DSN-PRAGMA approach (`db.go:28`) is the only reason this works. Without this test, a future refactor that drops the PRAGMA would silently regress.
- `TestRunBulk_OverwritesExistingDatabase` (`bulk_test.go:48-67`) verifies the "always exactly one sync_meta row after a fresh bulk" property — that's the contract of atomic-rename rebuilds.
- `TestRunBulk_CleansUpStaleTempFile` (`bulk_test.go:69-82`) covers the failure-recovery edge case.

### `[nit]` No test for `:memory:` DSN

`db.go:24-28` has a branch for `path == ":memory:"` (don't add `file:` prefix or PRAGMAs). The in-memory tests use `:memory:` so the path is exercised, but no test asserts that foreign keys are *also* enforced under `:memory:`. Today they aren't (the PRAGMA isn't applied). The single-line behavior difference is fine for tests, but it's a foot-gun if a future test relies on FK enforcement in-memory. Consider either:
- Applying `_pragma=foreign_keys(1)` on the `:memory:` DSN too, or
- Documenting the difference in the `Open` doc-comment.

### `[nit]` `TestSQLQuery_StubsReturnNotImplemented` is the *right* test, but slightly under-asserted

`query_test.go:17-33`: the test is well-motivated by the comment ("the migration to Phase 1.B is detectable"). It checks `errors.Is(err, ErrNotImplemented)` for all three methods. Two minor improvements:
- Assert that the returned `Pokemon` is the zero value (e.g., `assert.Equal(t, pokedex.Pokemon{}, p)`), so a Phase 1.B implementation that "returns a real value but also `ErrNotImplemented`" can't sneak past.
- Consider asserting on a non-existent slug too (`q.GetBySlug(ctx, "")`) to lock in that Phase 1.B's input handling matches.

### `[question]` No test asserts the `sync_meta` schema constraint

`schema.sql:27` constrains `mode` to `('bulk', 'delta', 'drift-check')`. The bulk path inserts `'bulk'` so it's exercised, but a malformed mode (e.g., `'snapshot'`) being rejected is *not* tested. Worth a one-liner test that `INSERT INTO sync_meta (..., mode, ...) VALUES (..., 'bogus', ...)` errors? Optional, but the cost is low and it pins the constraint.

### `[nit]` `TestRunBulk_RequiresOutputPath` does not assert error content

`bulk_test.go:43-46`: only asserts `err != nil`. Since the message is `ingest.RunBulk: OutputPath is required` (`bulk.go:47`), an `assert.ErrorContains(t, err, "OutputPath")` would pin the contract without going overboard.

### `[praise]` Test file structure

External test packages (`package pokedex_test`, `package ingest_test`) — that's the right call for these read-only public APIs. Forces tests to use only the exported surface.

---

## `ErrNotImplemented` stubs in `query.go`

### `[praise]` The phase-boundary contract is acceptable

Three reasons:

1. **The interface is meaningful.** `Query.GetByID`, `GetBySlug`, `List` are real method signatures with real `context.Context` plumbing. Phase 1.B fills in bodies, not shapes.
2. **The sentinel is exported and sentinel-compatible.** `errors.Is(err, ErrNotImplemented)` works (`query_test.go:26-32`), so callers can branch on it.
3. **The test ensures the migration is observable.** When Phase 1.B replaces the bodies, `TestSQLQuery_StubsReturnNotImplemented` will fail loudly — exactly the right tripwire.

This is **not** sloppy. The pattern that *would* be sloppy is panicking, returning `nil, nil`, or returning a fabricated value — none of those are happening here.

### `[question]` Is `Query` the right shape?

The interface as committed has only `GetByID`, `GetBySlug`, `List`. The Phase 1 PLAN.md text mentions `GetPokemon(id)`, `Search(filter Filter)`, `GetByTag(tag)`. `Search` and `GetByTag` are missing here. Are they coming in 1.B/1.E, or is `List` standing in temporarily? Either way, document the Phase 1.E surface in `query.go` so a future reader knows the interface is intentionally incomplete in 1.A. (This is a documentation question, not a blocker.)

### `[nit]` Stub doc-comments could state the contract

`query.go:36-54` has `Phase 1.A: not implemented; sub-phase 1.B fills this in once data is ingested.` That's good. Make all three stubs use the *same* phrasing — `GetBySlug` and `List` truncate to `Phase 1.A: not implemented.`, which is fine but inconsistent.

---

## Documentation

### `[praise]` Package-level docs

`db.go:1-9` (`pokedex`) and `ingest/bulk.go:1-7` (`ingest`) both have proper package docs that name their role and cite the ADRs. `cmd/pokedex-sync/main.go:1-10` documents the CLI subcommands. `schema.sql:1-13` documents the file's purpose, ADR linkage, and the SchemaVersion-bump expectation.

### `[praise]` Exported-symbol docs

Every exported type and function carries a `// Name does X.` style doc-comment: `Pokemon`, `Stats.BST`, `Open`, `Query`, `SQLQuery`, `NewSQLQuery`, `BulkOptions`, `BulkResult`, `RunBulk`, `ErrNotImplemented`, `ErrNotFound`, `SchemaVersion`. Idiomatic for `go doc`.

### `[nit]` `commitSHAOrPlaceholder` is unexported; no doc-comment expectation, but it has one anyway — good. The placeholder string `"scaffold"` is asserted against in tests. Worth a `const` for readability? Not load-bearing.

### `[nit]` `tags.yaml` description for `pseudo_legendary` says "BST 600" — minor

`tags.yaml:38` reads `BST 600, three-stage, late evolution`. The community-canonical phrasing is "BST exactly 600" (so Slaking and others above 600 don't qualify). Strictly speaking the current members list is correct, but a tightening of the description is cheap. Out of scope of code review; flag for `data-sync` agent.

---

## Spirit-of-the-change summary

This is a careful, well-tested *foundation* sub-phase. The implementation explicitly draws the line between scaffolding and ingestion, enforces that line in code (`ErrNotImplemented`) and in tests (the `Phase 1.A: not implemented` test), and lays down the schema with enough fidelity that Phase 1.B becomes pure data-flow plumbing. ADR alignment is clean. Idiomatic Go throughout. The phase-boundary contract — exported interfaces with stubbed bodies — is an honest, reviewable artifact, not vapor.

The handful of nits (consistent error styles, schema-version migration TODO, slightly tighter test assertions, `:memory:` PRAGMA branch documentation) are appropriate for a follow-up commit during 1.B rather than a blocker for 1.A. None of them threaten the contract Phase 1.B will consume.

**Verdict: Approve with nits**
