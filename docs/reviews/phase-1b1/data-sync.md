# Phase 1.B.1 — data-sync beat-owner review (sub-phase gate)

**Reviewer.** `data-sync` subagent (Phase 1 beat owner).
**Scope.** Validate the sync infrastructure committed in 1.B.1 — `Ingester` interface (`internal/pokedex/ingest/ingester.go`), `commitSHAOrPlaceholder` shell-out and pin file (`internal/pokedex/ingest/bulk.go`), Makefile UX (`api-data-pull`, `sync-from-clone`, `sync-inspect`), schema v2 (`internal/pokedex/schema.sql`) — for fitness against the 13 ingesters that will land in 1.B.2 / 1.B.3.
**Date.** 2026-04-28.
**Inputs read.**
- `apps/api/internal/pokedex/ingest/ingester.go`, `bulk.go`, `bulk_test.go`
- `apps/api/internal/pokedex/schema.sql`, `schema.go`
- `apps/api/cmd/pokedex-sync/main.go`
- `Makefile`, `.gitignore`
- Prior reviews: `docs/reviews/phase-1a/data-sync.md`, `docs/reviews/phase-1a/data-sync-regate.md`, `docs/reviews/planning/_phase-1b-scope-data-sync.md`

The 1.B.1 commit is in good shape and clears the runway for 1.B.2 ingest work. Items 1–3 below are minor and can be folded into 1.B.2 itself; items 4–6 are deferrable but worth queuing now while the design is fresh.

---

## 1. `Ingester` interface shape

```go
type Ingester interface {
    Name() string
    Ingest(ctx context.Context, db DBExecutor, apiDataPath string) (int, error)
}
```

**Will this work for all 13 planned ingesters (generations, types, stats, abilities, moves, species, forms, pokemon, pokemon_types, pokemon_stats, pokemon_abilities, pokemon_moves, evolution_chains, evolutions, flavor_text)?** Yes for the simple shape. Three concerns worth raising before 1.B.2 begins:

### 1.1 Single `int` return is too coarse for the join ingesters

Most ingesters write to one table and the row count is unambiguous. But several write to multiple related tables in one logical step (the data-sync regate's `bulk.go` ordering even bundles them):

- **`ingestEvolutionChains`** writes to both `evolution_chains` and `evolutions` (the chain-walk emits both — splitting them would mean walking the recursive `chain` JSON twice).
- **`ingestSpecies`** does a *first pass* with `evolves_from_species_id = NULL`, and a *second pass* `UPDATE` after evolutions land. Reporting "rows written" in the second pass is meaningless (it's an UPDATE, not an INSERT).
- **`ingestPokemon`** if it also populates `pokemon_types` from form-level types in the same loop (a real possibility since the form-types fallback logic, regate §4.2, is awkward to do in a separate ingester) writes two tables.
- **`record_counts_json`** in `sync_meta` is meant to be **per-table**, not per-ingester (`schema.sql:33`). A single int can't feed it directly.

**Recommendation.** Change the return type to a small struct:

```go
type IngestResult struct {
    RowCounts map[string]int // keyed by table name; "" key for the "primary" table
    Notes     []string       // optional warnings (e.g., "12 forms had null types; fell back to pokemon types")
}

func (i Ingester) Ingest(ctx, db, apiDataPath) (IngestResult, error)
```

The bulk pipeline then unions all `RowCounts` maps into a single `record_counts_json` blob keyed by table. This is also what the 1.B.4 validation gate (the 20-case suite from `_phase-1b-scope-data-sync.md` §3) will want when it asserts row counts per table.

If the IngestResult struct feels heavy, an alternative is to keep `int` but have it represent "count of upstream-source records consumed" and track per-table SQLite row counts separately by `SELECT count(*)` after the transaction commits. That is actually fine and simpler — but then **document explicitly that the `int` is "upstream records consumed", not "DB rows written"**, because the two diverge for ingesters that explode one upstream record into N rows (every species emits 6–11 flavor_text rows per language; every pokemon emits 6 stat rows, 1–3 ability rows, 1–2 type rows). Right now the contract is ambiguous.

### 1.2 No place to surface non-fatal warnings

Several edge cases in `_phase-1b-scope-data-sync.md` §4 produce **expected** warnings during ingest:

- "12 forms had null `form-level types`; fell back to `pokemon.types`" (§4.2).
- "342 species have `habitat=NULL` (Gen 6+ deprecation)" (§4.1).
- "187 forms had `is_mega=false` in PokeAPI but slug-suffix matched; corrected to `is_mega=true`" (§4.3).
- "94 flavor_text entries had `\f` form-feeds normalized" (§4.4).

These are not validation failures, but data-sync's role rule is "Surface any non-additive change for human review." The interface needs *some* way for an ingester to say "I did the right thing but the input was weird." Today the only options are `log.Printf` (which gets lost) or an error (which aborts the sync). The `Notes` field on `IngestResult` is the cheap fix; an alternative is a `Warnings []Warning` channel the bulk runner aggregates into the `sync_meta.error_message` column when status='partial'.

### 1.3 No `Validate(ctx, db) error` hook

Each ingester has a small set of post-conditions that are cheap to check inline (e.g., `ingestPokemon` knows that every pokemon must have 1–2 types; `ingestSpecies` knows that every species must have a non-null `pokedex_number`). Right now the design pushes all validation into the 1.B.4 gate, which is fine for the comprehensive suite but means a contributor who breaks `ingestPokemon` will not learn until the gate runs.

**Recommendation (defer to 1.B.4 if it complicates 1.B.2).** Optional second method on the interface:

```go
type Validator interface {
    Validate(ctx context.Context, db DBExecutor) error
}
```

Implemented opt-in via a type assertion in the bulk runner. Good ingesters do `if v, ok := i.(Validator); ok { v.Validate(...) }` after each step. Catches dropped rows immediately.

**Verdict on §1.** Single-`int` return works if we explicitly define it as "upstream records consumed" and lean on `SELECT count(*)` for per-table row counts in `sync_meta`. Better: switch to an `IngestResult` struct with a `RowCounts map[string]int` and a `Notes []string` field. Either way, **decide before 1.B.2 starts** so the 13 ingesters all use the same shape.

---

## 2. `DBExecutor` interface

```go
type DBExecutor interface {
    ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
    QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
    QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}
```

**Does this cover the planned ingesters?** Almost. Two gaps:

### 2.1 No prepared-statement support

Every ingester is going to do bulk inserts. `pokemon_moves` alone is ~50k–100k rows (every Pokémon × every move-it-can-learn × every learn_method × every generation). At 100k rows, the per-call query-parse overhead of `ExecContext(insertSQL, args...)` is non-trivial — easily an order of magnitude slower than `stmt.ExecContext(args...)` with a prepared statement.

**The `*sql.Tx.PrepareContext` and `*sql.DB.PrepareContext` methods both exist.** Adding them to `DBExecutor` is one line:

```go
PrepareContext(ctx context.Context, query string) (*sql.Stmt, error)
```

This unlocks the standard "prepare once, exec N times in a loop" pattern that every ingester will want. The cost of *not* having it: ingesters either accept the perf hit or do `tx.PrepareContext` directly via a type assertion — which defeats the abstraction.

**Recommendation: add `PrepareContext` to `DBExecutor` in 1.B.2's first commit.**

### 2.2 Surface the deferred-FK toggle

The regate (`bulk.go:62` step 11) calls for `PRAGMA defer_foreign_keys=ON` for the duration of the ingest transaction so the `evolves_from_species_id` self-FK doesn't depend on insertion order. This is a one-time PRAGMA the bulk runner sets *outside* any individual ingester; it's not a `DBExecutor` concern. But the `DBExecutor` interface as specified does support it (it's just an `ExecContext("PRAGMA defer_foreign_keys=ON")`). Confirming this works inside a transaction-wrapped `*sql.Tx` is worth a one-line test in 1.B.2 — SQLite's PRAGMA semantics are subtle.

### 2.3 No transaction-scope verification at the type level

Today an ingester *could* receive a `*sql.DB` and bypass the bulk runner's transaction by calling `db.BeginTx`. The interface doesn't prevent that. Comment in `ingester.go:18-19` already documents the rule ("MUST NOT BEGIN/COMMIT inside"), and the bulk runner controls what gets passed in. Type-level enforcement would require a stricter interface (no `BeginTx`-returning method, which is fine since `DBExecutor` doesn't have it). Current design is correct — the doc comment is doing the right work.

**Verdict on §2.** The three methods cover the read/write surface. **Add `PrepareContext`** before 1.B.2 starts; the alternative is every ingester taking a perf hit on bulk inserts.

---

## 3. `commitSHAOrPlaceholder` shell-out

```go
cmd := exec.CommandContext(ctx, "git", "-C", apiDataPath, "rev-parse", "HEAD")
out, err := cmd.Output()
if err != nil { return "unknown" }
return strings.TrimSpace(string(out))
```

**Reasonable?** Yes. Minor concerns:

### 3.1 Encoding

`git rev-parse HEAD` outputs a 40-char SHA-1 (or 64-char SHA-256 if the user has set `extensions.objectFormat=sha256` in their git config — vanishingly rare for a clone of `PokeAPI/api-data`, which uses SHA-1). Both are pure ASCII; UTF-8 vs. byte-string is a non-issue. `strings.TrimSpace` correctly drops the trailing newline. Fine.

### 3.2 Error swallowing

`cmd.Output()` returns `*exec.ExitError` for non-zero exits, which carries `Stderr`. Today we discard it and return `"unknown"`. For the 1.B.1 scope (where no api-data path is the common case), that's correct. But once 1.B.2 ships and a contributor is expected to *have* a checkout, the most likely failure modes are:

- `git: command not found` (PATH issue) → `*exec.Error`.
- "fatal: not a git repository" (path exists but isn't a clone) → exit status 128, stderr explains.
- "fatal: ambiguous argument 'HEAD'" (empty repo) → exit status 128.

Returning `"unknown"` for all three loses the diagnostic info. **Recommendation for 1.B.2:** when the user explicitly passed `--api-data <path>` (i.e., apiDataPath != ""), a git failure should be a *hard error*, not a placeholder. The current shape silently produces an "unknown"-pinned SQLite, which is worse than failing fast. Concretely:

```go
if apiDataPath == "" {
    return "scaffold", nil
}
cmd := exec.CommandContext(ctx, "git", "-C", apiDataPath, "rev-parse", "HEAD")
out, err := cmd.Output()
if err != nil {
    return "", fmt.Errorf("git rev-parse in %s: %w (stderr: %s)", apiDataPath, err, stderrOf(err))
}
return strings.TrimSpace(string(out)), nil
```

The `bulk_test.go:92-110` "non-git api-data path" test would change to assert the error rather than the "unknown" string. That's correct behavior — a user pointing `--api-data` at a non-repo has misconfigured the sync, and silent fallback hides the bug.

### 3.3 Security

Shelling out to `git` is fine. The arguments (`-C`, `<path>`, `rev-parse`, `HEAD`) are all literal except `<path>`, which is the user-provided `--api-data` flag. `exec.CommandContext` does *not* invoke a shell, so there's no shell-injection risk. The `<path>` arg gets passed to `git -C` directly; even a malicious path like `--upload-pack=evil` is treated as a directory name (and would fail with a "not a directory" error). **No security concerns.**

The one thing worth noting: `git rev-parse HEAD` will succeed even for a repo with detached HEAD pointing at a non-master commit. That's actually the *desired* behavior — we want to record whatever the user actually has checked out, not what `master` points at. Document this behavior so a contributor running `make sync-from-clone` doesn't get confused if their api-data clone is in a weird state.

### 3.4 `ctx` cancellation

`exec.CommandContext` correctly kills the git subprocess if `ctx` cancels. The bulk runner sets up the SIGINT handler in `main.go:42-47`. Good.

**Verdict on §3.** Implementation is correct. **Switch from "swallow git errors as 'unknown'" to "return the error if `apiDataPath` was explicitly provided"**; that's the only behavioral change worth making before 1.B.2.

---

## 4. Pin file pattern — should we add a "pin-and-checkout" mode?

**Today's shape (1.B.1):** `bulk.go:138-143` writes `<output_dir>/api-data-sha` after a successful sync, containing the resolved SHA. `make sync-inspect` reads it for display. **Nothing reads the pin file as input** to a sync — it's purely informational.

**Should we add a "pin-and-checkout" mode where sync respects an existing pin?** Yes, but not in 1.B.1 — defer to 1.B.2 or 1.F. Here's why and how.

### 4.1 The use cases

Three workflows benefit from a pin-respecting sync:

- **CI reproducibility.** A contributor opens a PR. The PR's diff includes a change to `tags.yaml` (or `schema.sql`, or any ingester). The CI run *should* re-sync against the same `api-data` SHA the previous CI run used, so the snapshot diff (data-sync rule "Snapshot diff between sync runs") reflects only the contributor's changes — not upstream PokeAPI churn happening in parallel. Without pin-respect, the CI run uses whatever `master` happens to point at; the snapshot diff conflates contributor changes with upstream changes.
- **Release branches.** When we cut a release of pokemon-ranker, we want to fix the dataset to a specific upstream SHA so the release is reproducible. Today the only way is a manual `git checkout <sha>` in the api-data clone — easy to forget.
- **1.F drift-check vs. 1.F delta.** Drift-check wants "live API vs. our SQLite at its pinned SHA"; delta wants "re-ingest only species changed between our pinned SHA and HEAD." Both modes need the pinned SHA as *input*.

### 4.2 The shape

```sh
# Currently committed: api-data-sha contains "abc123..."
# 1.F mode: respect the pin
make sync                  # sync against whatever api-data has checked out
make sync-pinned           # checkout the SHA from api-data-sha, then sync
make sync APIDATA_SHA=def456  # checkout def456, sync, update pin to def456
```

In Go terms, `BulkOptions` grows a `RespectPin bool` flag (or, cleaner, `PinnedSHA string` — empty means "use HEAD"). The bulk runner, when `PinnedSHA != ""`, runs `git -C <api-data-path> checkout <sha>` before the existing `rev-parse HEAD`.

### 4.3 The risk

`git checkout` mutates the user's clone. If the user has uncommitted changes in their api-data working tree (unlikely — it's an upstream mirror, but possible if they're hand-patching) the checkout fails or worse. Mitigations:

- Refuse if the working tree is dirty (`git status --porcelain` non-empty).
- Refuse if the clone isn't a known clone of `PokeAPI/api-data` (check the `origin` remote URL).
- Document loudly that `--respect-pin` mode mutates the clone.

### 4.4 Recommendation

**1.B.1 commit is correct as-is — pin-write only, no read.** Add pin-respect as part of 1.F (delta + drift-check), where it's actually needed. *Don't* tack it onto 1.B.2; 1.B.2's job is the 13 ingesters, not new sync modes. File this in `OPEN_QUESTIONS.md` as a Phase 1.F starter so it's not lost.

One thing 1.B.2 *should* do: verify the pin file is still committed correctly across the new ingester writes. The `_summary.md` from 1.A and the `.gitignore` already say "api-data-sha is committed" — confirm in 1.B.2's first PR that the pin survives the larger ingest runs (it will, but worth eyeballing).

**Verdict on §4.** Pin file as informational-only is the right 1.B.1 stance. Pin-and-checkout mode is a 1.F feature, not 1.B.2. File in OPEN_QUESTIONS.md.

---

## 5. Makefile UX — should `sync` auto-pull?

**Today's shape:**

- `make sync` — runs the bulk binary. Caller passes `APIDATA=<path>` if they have a clone; otherwise the binary runs in scaffold mode.
- `make sync-from-clone` — `api-data-pull` then `sync` with `--api-data data/api-data` baked in.
- `make api-data-pull` — clone or `git fetch` the api-data repo into `apps/api/data/api-data`.
- `make sync-inspect` — display row counts + sync_meta + pin SHA from the existing SQLite.

**Should `make sync` auto-pull if api-data is missing?** **No.** Three reasons:

### 5.1 Network behavior should be explicit

`make sync` is the developer's tight loop. They run it when iterating on a tag rule, a query, an ingester. The expected runtime is "however long the bulk run takes" — currently milliseconds (1.B.1), eventually 1–5 minutes (1.B.4). Slipping a 17-second `git fetch` into that loop on the *first* run, silently, is a UX foot-gun. The first invocation suddenly takes 30 seconds longer than the second; the developer thinks the binary regressed.

The current design — explicit `make sync-from-clone` for the one-shot path and explicit `make api-data-pull` for the network step — is the right ergonomics. The developer who wants the chained behavior types `make sync-from-clone`; the developer who wants the cached behavior types `make sync APIDATA=...`. Both intents are clean.

### 5.2 `make sync-from-clone` already does the right thing

`sync-from-clone` chains pull + sync with the right path baked in. The `_phase-1b-scope-data-sync.md` §5.1 review recommended `FRESH=1` as the refresh trigger; the committed shape uses a *separate target name* instead. **Both are valid; the named-target approach is arguably clearer** (no environment-variable surprise) and matches the existing Makefile's idiom.

One tweak worth making in 1.B.2: rename `sync-from-clone` to `sync-fresh` or document explicitly that it's the "I want a fresh upstream pull" target. The current name "sync-from-clone" is ambiguous — it sounds like it might mean "sync from an existing clone" (i.e., the cached path) rather than "pull the clone fresh and sync." Trivial; flag for 1.B.2.

### 5.3 Cache location

The 1.A scope review (`_phase-1b-scope-data-sync.md` §5.1) recommended `${XDG_CACHE_HOME:-$HOME/.cache}/pokeapi-api-data` rather than `apps/api/data/api-data`. The committed Makefile uses the in-repo path. **This is fine for the v1 dev experience** — the `.gitignore` excludes `apps/api/data/api-data/`, and a single in-repo location is easier to reason about than an XDG path. The 557 MB lives in the project tree but doesn't pollute git. The XDG move can happen later if multi-project sharing becomes a thing; not worth the complexity now. **Stay with the in-repo path.**

### 5.4 `sync-inspect` ergonomics

The committed `sync-inspect` target is excellent — row counts, sync_meta, pin SHA, sample pokemon, all on one screen. One nit: it shells out to `sqlite3` repeatedly in a loop (one process per table for row counts). For 19 tables that's 19 process spawns. On a fast machine this is unobservable; on a slow VM it's ~2 seconds. If we ever notice, the fix is one `sqlite3` invocation that emits all counts via a UNION. Don't fix now; flag if it bites.

**Verdict on §5.** Don't auto-pull. The current three-target shape (sync / sync-from-clone / sync-inspect) is the right ergonomics. Optional rename of `sync-from-clone` → `sync-fresh` for clarity, but this is taste, not blocker.

---

## 6. PokeAPI surprises that 1.B.1 doesn't yet support

The full list lives in `_phase-1b-scope-data-sync.md` §4. Walking through what 1.B.1's framework *can* and *cannot* support today:

### 6.1 Already supported by the schema or pipeline

- **Cosmetic-form inflation (Pikachu's 17+ rows, Squawkabilly's 4 plumage forms, Tatsugiri's 3, Maushold's 2).** The schema's `(species_id, form_name)` UNIQUE accommodates them. The `Ingester` interface doesn't care how many rows a form-loop emits. **Supported.**
- **Special characters in display names (Farfetch'd, Type: Null, Mr. Mime, Porygon2, Nidoran♀/♂).** SQLite's TEXT is UTF-8; the Go side uses `string`; the bulk pipeline doesn't transform names. **Supported.**
- **Null fields (move.power, move.accuracy, species.color, species.habitat, base_experience).** Schema columns are correctly nullable where they need to be (`moves.power INTEGER`, `species.color TEXT`, etc.). **Supported.** The ingester just needs to coalesce JSON `null` to SQL `NULL` correctly — that's a 1.B.2 implementation detail, not a framework gap.
- **Retconned typings via `past_types`.** The 1.A review explicitly punted this: "current typing only in 1.B; capture past_types in a future column if a Gen-specific filter is requested." Schema doesn't have a `pokemon_past_types` table. **Correctly out of 1.B scope.** Document in `OPEN_QUESTIONS.md` so it doesn't get rediscovered later.
- **Paradox-as-species (Iron Hands, Roaring Moon, Walking Wake, etc.).** Schema treats them as species, not forms — which matches PokeAPI's representation. **Supported by the schema.** The ingester just needs to not get cute and try to attach them to Hariyama / Salamence; that's an ingester-level discipline, not a framework gap.
- **Form-level types differ from pokemon-level types (Aegislash, regional variants).** The schema's `pokemon_types` table is keyed on `pokemon_id`, and pokemon rows are `(species, form)` tuples. **Supported.** The ingester needs the fallback logic (form types if non-empty, else pokemon types); that's a 1.B.2 implementation note. The `IngestResult.Notes` field (§1.2 above) is where the "12 forms had null types; fell back" warning belongs.
- **Unreliable `is_mega` / `is_gmax` flags.** The 1.A review recommends populating from slug suffix, not from PokeAPI's flags. Schema has `forms.is_mega`, `forms.is_gmax`. **Supported by schema; ingester-level discipline required.**

### 6.2 Things 1.B.1's framework *doesn't yet support*

Three real gaps for 1.B.2 to address:

#### 6.2.1 Multi-row updates after first-pass insert (`evolves_from_species_id`)

The 1.A regate prescribed a second pass: insert species with `evolves_from_species_id = NULL`, ingest evolutions, then `UPDATE species SET evolves_from_species_id = ? WHERE id = ?`. The current `Ingester` interface returns "rows written" — but the second pass is updates, not inserts. Either:

- Make the second pass a separate ingester (e.g., `ingestSpeciesEvolvesFrom`) whose row count is "rows updated" — change the doc comment on `Ingest` to say "records modified" rather than "rows written," and live with the ambiguity, or
- The `IngestResult.RowCounts` map (§1.1) keyed by table name accommodates this naturally — `{"species": 0}` for the second pass means "no inserts," and the actual update count goes in a separate field if we care.

Either is fine; the *interface decision* needs to be made before 1.B.2 starts. **Flag for 1.B.2.**

#### 6.2.2 Logging form-feed substitutions in flavor_text

Per §4.4 of the scope review, `\f` in flavor text needs normalization to spaces, with a count surfaced. Today there's no `Notes []string` channel and no logging convention. The ingester would have to `fmt.Fprintf(os.Stderr, ...)`, which the bulk runner doesn't capture. **Add `IngestResult.Notes` (§1.2 above) to fix this** — or commit to a structured-logger convention (`slog.Default()`) the bulk runner installs and the ingesters use. Either way, the framework needs a story.

#### 6.2.3 The `\f` decision itself isn't documented

Beyond the framework gap, the *decision* "normalize `\f` to space, log the count" lives in `_phase-1b-scope-data-sync.md` but not in any code comment or `DECISIONS.md` entry. When the 1.B.2 ingester author writes `ingestFlavorText`, they need to know this. **Flag for 1.B.2:** add a comment on `flavor_text` in `schema.sql` or a section in the ingester's package doc.

### 6.3 Things 1.B.1 may have over-supported

The schema has `forms.introduced_in_version_group` *deferred* (commented out at line 84). This was a 1.A review recommendation. The 1.B.1 commit dropped it per PM planning gate. **Watch for 1.B.2 needing it for the GMax-vs-other-battle-only disambiguation:** GMax forms are introduced in `sword-shield`, distinguishing them from Mega (X/Y or OR/AS) and Mimikyu-Busted (sun/moon). Without this column, the ingester relies on slug suffix only — which is fine in practice (`-gmax` is unambiguous) but loses the version-group fact. Not a blocker; flag if a future filter wants it.

### 6.4 The 1.B.4 validation gate

The 20 cases from `_phase-1b-scope-data-sync.md` §3 are the right shape and can be exercised against this framework. Two of them (cases 1 "Charizard has exactly 6 rows" and 6 "total pokemon row count 1300–1600") will catch any framework-level bug where the ingester returns the wrong count or the bulk runner mis-aggregates `record_counts_json`. Including these in the 1.B.4 gate is critical.

**Verdict on §6.** Schema and pipeline support all but two PokeAPI surprises framework-side: (a) second-pass updates need an interface story, (b) non-fatal warnings need a surface (`Notes []string` or structured logging). Both are 1.B.2 design decisions, not 1.B.1 blockers.

---

## 7. Action items for 1.B.2

In priority order:

1. **Decide the `Ingest` return shape.** Either explicitly document `int` as "upstream records consumed" and use `SELECT count(*)` for `record_counts_json`, or switch to `IngestResult{ RowCounts map[string]int; Notes []string }`. **Pick one before the first ingester lands** — changing this mid-1.B.2 is a 13-file refactor.
2. **Add `PrepareContext` to `DBExecutor`.** One line. Unlocks bulk-insert performance for `pokemon_moves` and friends.
3. **Tighten `commitSHAOrPlaceholder` error handling.** When the user explicitly passes `--api-data`, a git failure should be a hard error, not a silent "unknown" pin. Update `bulk_test.go:92-110` accordingly.
4. **Document `\f` flavor-text normalization** as a comment on `flavor_text` in `schema.sql` (or in the `ingestFlavorText` package doc).
5. **Optional rename:** `sync-from-clone` → `sync-fresh` in the Makefile for clarity. Taste, not blocker.
6. **File in `OPEN_QUESTIONS.md`:**
   - "Pin-and-checkout sync mode" as a 1.F starter (§4 above).
   - "`forms.introduced_in_version_group` reconsideration" as a 1.B.4-or-later starter (§6.3 above).
   - "`pokemon_past_types` table" as a future feature (§6.1 above).

---

**Verdict: Approve. Sub-phase gate clears for 1.B.2.**
