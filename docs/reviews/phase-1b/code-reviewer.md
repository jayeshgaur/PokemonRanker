# code-reviewer — Phase 1.B (cumulative gate)

**Scope.** All four sub-phases 1.B.1 → 1.B.4, batched per the user's 2026-04-29 directive.
Files reviewed:

- `apps/api/internal/pokedex/{schema.sql,schema.go,db.go,types.go,types_test.go,query.go,query_test.go,db_test.go,validate.go}`
- `apps/api/internal/pokedex/ingest/{ingester.go,bulk.go,bulk_test.go,helpers.go,ingesters_test.go}`
- 12 ingesters: `generation.go`, `pokemon_type.go`, `stat.go`, `ability.go`, `move.go`, `species.go`, `form.go`, `pokemon.go`, `pokemon_joins.go`, `evolution.go`, `flavor_text.go`, `evolves_from.go`
- `apps/api/cmd/pokedex-sync/main.go`
- `Makefile`, `apps/api/.golangci.yml`

**Pre-merge gates.**

- `make all`: PASS (vet clean, golangci-lint v2 reports 0 issues, web typecheck/lint/test green, Go tests green).
- `go test ./... -count=1` from `apps/api`: PASS (`pokedex` 1.88s, `pokedex/ingest` 2.71s).

---

## Verdict

**Approve with one [blocker] and a small set of [nit]s.** The 1.B chain is broadly excellent: schema-v2 trim respects the planning gate; ingesters are short, focused, FK-correct, fully covered by per-ingester fixture tests; transactional orchestration is right; the query API is clean; the `Ingester`/`DBExecutor` abstractions are well-motivated. I am calling one issue a blocker because it silently neuters validation; the rest are nits. None of the ADRs are violated.

---

## Blockers

### B-1 [blocker] `validate.go` swallows scan errors via `_ =`, silently passing checks 8–14

`apps/api/internal/pokedex/validate.go:90-138` — checks 8 through 14 use the pattern:

```go
_ = db.QueryRowContext(ctx, `…`).Scan(&x)
check("…", "…", fmt.Sprint(x), x == expected, "")
```

This is the wrong shape for a validation suite. If the SQL fails (typo, schema rename, missing column, FK rebuild surprise), `x` keeps its zero value and the check just compares zero to expected. Three of the seven affected checks (`mewtwo_default_bst_is_680`, `blissey_hp_is_255`, `pseudo_legendary_exists:<slug>`) want `x == 1 / 680 / 255`; if the query errors, those compare 0 to the expected — fail correctly by accident — but the operator never sees *why* (typo or real mismatch). Worse: checks 11, 12, 13, 14 want `x == 0`. If the SQL errors, x stays 0 and the check **silently passes** — masking a regression.

**Fix.** Either propagate the scan error up the way checks 1–4 already do (`if err := …; err != nil { return nil, fmt.Errorf(…) }`), or accumulate it as a `ValidationIssue` with `Detail: err.Error()`. Don't `_ =` it.

This is a small diff (~30 lines) and the pattern is already established at the top of the function.

---

## Nits / questions

### N-1 [nit] `EvolutionIngester.Raw` field is dead

`apps/api/internal/pokedex/ingest/evolution.go:42` — `evolutionDetailJSON.Raw map[string]any \`json:"-"\`` is declared but never populated or read. The raw-tree walk uses a separate `readEvolutionChainRaw` call (line 78) and indexes the parallel `[]any` shape directly. The field is leftover from a different design. Drop it.

### N-2 [nit] `EvolutionIngester` re-reads each chain file once

`apps/api/internal/pokedex/ingest/evolution.go:78-81` — the comment correctly notes this is cheap (~500 files), but a single pass that takes both the typed view and the raw map from one read is mechanically cleaner: `json.Unmarshal` once into both a typed struct (with `json.RawMessage` for `evolution_details`) and a `map[string]any`. Not load-bearing; flag for follow-up if the sync ever needs a P50 < 100 ms goal.

### N-3 [nit] Parallel index walk is order-dependent

`apps/api/internal/pokedex/ingest/evolution.go:101-119` — the typed `node.EvolvesTo[i]` and raw `rawChildren[i].evolution_details[j]` are correlated by index, with a `if i < len(rawChildren)` guard. JSON arrays are ordered and `encoding/json` preserves array order, so this is safe **today**. If the typed and raw structs ever diverge (e.g., a filter is applied to the typed struct but not the raw), the indices silently desynchronize. Add an in-line comment that the two views *must* be unmarshalled from the same blob in the same pass to preserve index correspondence — or fold them into one pass per N-2.

### N-4 [nit] `pokemon.display_name` for non-default forms

`apps/api/internal/pokedex/ingest/pokemon.go:99` — `titleFromSlug("charizard-mega-x")` produces "Charizard-mega-x", not "Charizard (Mega X)" or "Mega Charizard X". Cosmetic for v1, but it's user-visible eventually (Phase 4). Defer to Phase 1.D / Phase 4 — file an issue.

### N-5 [nit] `pokedex_db_url` always uses species slug

`apps/api/internal/pokedex/ingest/pokemon.go:83` — Mega and Gigantamax forms link to `pokemondb.net/pokedex/charizard`, which is correct (PokemonDB lists forms inline on the species page). Consider documenting this in the column comment in `schema.sql` so a future reader doesn't expect a per-form URL.

### N-6 [nit] `pokemon_moves` first-write-wins on `learn_level`

`apps/api/internal/pokedex/ingest/pokemon_joins.go:130-163` — the comment correctly documents that `INSERT OR IGNORE` keeps whichever `learn_level` showed up first when multiple version_groups in the same generation collide. PokeAPI orders version groups within a generation chronologically, so the level from the *earliest* game in the generation wins (fine for v1). This deserves a Phase 1.F follow-up: after the ingest pipeline matures, consider `INSERT … ON CONFLICT … DO UPDATE` with a `MIN(learn_level)` semantic so legacy-corrected level data doesn't get lost. Not blocking.

### N-7 [nit] `versionGroupGeneration` map should be exhaustive-checked

`apps/api/internal/pokedex/ingest/pokemon_joins.go:46-58` — a missed mapping is logged as a Note and the row is skipped. Good. Two Gen-9 DLCs are present (`the-teal-mask`, `the-indigo-disk`); future Gen-10 will require an edit here. Consider a unit test that asserts the map covers every version_group present in the test fixture (and a pre-1.B follow-up: a sanity check during ingest that emits a Note if more than X% of moves are skipped due to unknown version groups, not just per-row noise).

### N-8 [nit] `helpers.go` `idFromOptionalURL` returns `(any, error)` mixing typed-nil and value

`apps/api/internal/pokedex/ingest/helpers.go:167-176` — returning `(any, error)` is necessary for the `nil → NULL` pattern, but it's worth a short doc explaining why we don't return `(*int64, error)` (the SQL driver's `nil any` triggers NULL; `(*int64)(nil)` does not). The current comment is correct but terse. Minor.

### N-9 [nit] `flavorTextNormalizer` doesn't catch all PokeAPI quirks

`apps/api/internal/pokedex/ingest/flavor_text.go:30` — handles `\f \n \r \u00ad`. PokeAPI also occasionally emits `\u2014` em-dashes mid-word and the gender symbols `♀ ♂`. None are *bugs* (UTF-8 in TEXT works), but the `strings.Fields` collapse pass is safe. Acceptable for v1; document the choice.

### N-10 [nit] `Validate` total count band 1300–1700 has no upper-headroom comment

`apps/api/internal/pokedex/validate.go:38` — comment says "covers Gen 1–9 + forms," but Gen 9 + DLC1 + DLC2 leaves ~50 rows of headroom before the upper bound. When Gen 10 lands the cap will trip. Add: "*Bump on Gen 10 introduction.*" Trivial.

### N-11 [nit] `cmd/pokedex-sync/main.go` `signal.Notify` goroutine never exits

`apps/api/cmd/pokedex-sync/main.go:44-49` — the signal-watch goroutine blocks on `<-stop` forever; when `main` returns naturally the goroutine is GC'd at process exit. Not a leak in practice for a CLI binary, but `signal.Stop(stop)` is the idiomatic cleanup pair. Sub-nit.

### N-12 [praise] `Ingester` / `DBExecutor` abstraction

`apps/api/internal/pokedex/ingest/ingester.go` — the `DBExecutor` interface is exactly the right minimal surface (`Exec/Query/QueryRow/Prepare`), and the comment explaining why `PrepareContext` is in the contract (the 50–100k pokemon_moves rows) is excellent — concrete, traceable, and the kind of comment that ages well. Same for `IngestResult.RowCounts` documenting the multi-table return as a deliberate choice over an int. This is the kind of in-line decision-log that the agent system rewards.

### N-13 [praise] FK-correct ordering plus second-pass UPDATE for self-FK

`apps/api/internal/pokedex/ingest/bulk.go:54-69` and `evolves_from.go` — the species self-FK is exactly the kind of thing that would otherwise force a `DEFERRED` constraint or a topological sort. The clean two-pass approach (`SpeciesIngester` writes NULL, `EvolvesFromBackfillIngester` UPDATEs) is the right call and is explicitly documented in both ingesters. Good.

### N-14 [praise] Validation suite is the right shape

14 checks are a good v1 set: row-count band, FK invariants, multi-form invariants on canary species, BST canaries, schema-NOT-NULL safety nets. The data-sync agent's recommendations are well-translated into SQL.

### N-15 [praise] Atomic-rename + advisory-lock + tx-wrapped ingest

The bulk pipeline correctness sequence is right: file lock → tmp file open → BEGIN → ingest → record sync_meta → COMMIT → close → atomic rename. Failure paths all roll back the tx and remove the tmp. Pin file written *under* the lock (after rename, but before lock release) is correct.

---

## ADR compliance

| ADR | Status | Note |
|---|---|---|
| **D-1** form identity | ✅ | `pokemon` row = (species, form); D-1 cited in `schema.sql:7-10` and `types.go:3-5`. `is_default` flag, partial unique index `idx_forms_default_per_species`, and `UNIQUE pokemon.form_id` together preserve identity. |
| **D-3** pluggable ranker | n/a | No ranker code in 1.B. |
| **D-6** validation at IO edges | ✅ for ingest input shapes (typed structs unmarshal each PokeAPI JSON; FK constraints catch downstream errors); ⚠ the `Validate` suite **silently swallows** scan errors (B-1). |
| **D-22** single deploy, Go restricted to sync | ✅ | All Go code lives under `apps/api/cmd/pokedex-sync` or `apps/api/internal/pokedex`. No HTTP server, no runtime backend. The `pokedex.Query` interface is consumed by tests only; in production the Next.js side will read SQLite via `better-sqlite3`. |
| Schema v2 trim | ✅ | Deferred fields (`gender_rate`, `growth_rate`, `capture_rate`, `hatch_counter`, `introduced_in_version_group`, `effect_chance`, `abilities.generation_id`, `localized_names` table) are absent from `schema.sql` and the trim is documented in both `schema.sql:14-18` and `schema.go:11-17`. |

---

## Idiomatic Go

- **Error wrapping.** Every site I checked uses `fmt.Errorf("…: %w", err)`. Consistent. ✅
- **Context propagation.** Every DB / file / exec call takes a `context.Context`. ✅
- **Interface design.** `Ingester`, `DBExecutor`, `Query`, `scanner` (query.go internal) are all minimal and well-motivated. ✅
- **Package organization.** `internal/pokedex` (read API + types + schema) vs `internal/pokedex/ingest` (write pipeline) is a clean split. The ingest package owns its JSON DTOs. ✅
- **Naming.** All exported symbols documented; unexported helpers (`titleFromSlug`, `boolToInt`, `nameOrNil`) are discoverable. ✅
- **Test framework.** `testify/assert` + `require` per D-16. ✅

## Hidden-defect sweep

- **SQL injection.** All SQL is constant strings with `?` placeholders. No `Sprintf` into queries anywhere. ✅
- **Goroutine leaks.** Only one goroutine in the codebase: the signal-watcher in `cmd/pokedex-sync/main.go`. Lives the lifetime of the process; not a leak. (See N-11 for the nit.)
- **FK violations at write time.** `defaultIngesters()` order is FK-correct. The species → species self-FK is split into two passes. The `evolution_chains` insert precedes any `evolutions` row (because `EvolutionIngester` does both in one pass and inserts the chain first). ✅
- **Missing cleanup paths.** `RunBulk` has a `cleanupOnError` closure called on every failure path. `defer rows.Close()` everywhere; `defer movesStmt.Close()` in `pokemon_joins`. ✅
- **Overflow / sign conversion.** PokeAPI IDs are int → stored in int64 columns and Go int64 vars. `Stats` uses Go `int` (platform-dependent 32 / 64), but values are 0–255 by CHECK; safe. `pokeapi_order` etc. are int → int64; safe. `Height`, `Weight`, `BaseExperience` written as int into int64 columns; safe. ✅
- **Race conditions.** Ingest is single-threaded inside one tx. No goroutines fan out work. The `flock` advisory lock prevents concurrent process invocations. ✅
- **Early-cancel semantics.** `ctx` is plumbed everywhere; if the operator hits Ctrl-C, the `signal.Notify` goroutine cancels, every `db.*Context` returns ctx.Err(), the tx rolls back via the deferred `cleanupOnError`. ✅

## Test coverage assessment

- 12 ingesters → 11 explicit `TestXxx_Ingest` tests in `ingesters_test.go` (`MoveIngester`, `GenerationIngester`, `TypeIngester`, `StatIngester`, `AbilityIngester`, `SpeciesIngester`, `FormIngester`, `PokemonIngester`, `PokemonJoinsIngester` — covers types/stats/abilities/moves in one fixture, `EvolutionIngester`, `FlavorTextIngester`, `EvolvesFromBackfillIngester`). 12/12 covered. ✅
- `bulk_test.go` covers: scaffold mode, missing OutputPath, overwrite leaves single sync_meta, stale .tmp cleanup, hard-error when `--api-data` is set but invalid, real `git rev-parse` + pin file write. ✅
- Query API: GetByID happy path + NotFound, GetBySlug happy + NotFound, List. Decoration of types/stats/tags exercised. ✅
- Schema constraints: 19 tables exist, schema_version recorded, idempotent reopen, FK enforcement, slot/effort CHECK constraints, partial unique index, species self-FK enforcement. ✅
- **Gap.** `Validate(ctx, db)` itself has no unit test. A small in-memory test that seeds known-good data → expects 0 issues, then injects each canary failure (e.g. wipe a species, drop a Mewtwo stat) → expects exactly that issue, would be a worthy follow-up. Not blocking; flag for Phase 1.D/F.

---

## Documentation

- Package docs present: `pokedex` (`db.go:1-8`), `ingest` (`bulk.go:1-13`), `cmd/pokedex-sync` (`main.go:1-11`). ✅
- Every exported symbol has a doc comment (verified by skim). ✅
- Non-obvious choices commented inline:
  - `versionGroupGeneration` map (`pokemon_joins.go:43-46`) — explains the perf rationale.
  - `INSERT OR IGNORE` on `pokemon_moves` (`pokemon_joins.go:130-133`) — documents first-wins semantics.
  - Two-pass `evolves_from_species_id` — documented in both `species.go:11-13` and `evolves_from.go:9-13`.
  - `resolveCommitSHA` hard-error — documented in the function's doc comment.
  - `flavorTextNormalizer` — explains the `\f \n \r` substitutions.
- Schema-v2 deferred fields documented in both `schema.sql:14-18` and `schema.go:11-17`, with cross-reference to OPEN_QUESTIONS.md.

---

## Summary

The 1.B chain ships a complete, transactional, FK-correct ingestion pipeline plus a clean read API and a useful validation suite, with strong fixture-based test coverage and excellent in-line documentation of design choices. The only blocker is a defensive-coding lapse in the validation function itself: seven of fourteen checks discard `Scan` errors with `_ =`, which can silently mask regressions in the very tool meant to catch them. Fix that, ship the rest. Nothing else here is load-bearing; the nits are honest follow-ups for Phase 1.D / 1.F.

**Verdict — approve with one blocker (B-1).**
