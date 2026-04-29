# Phase 1.A — data-sync re-gate review

**Reviewer.** `data-sync` subagent (Phase 1 beat owner).
**Scope.** Re-gate of the four blockers from `docs/reviews/phase-1a/data-sync.md` §9 after the fix pass.
**Date.** 2026-04-28.
**Inputs read.**
- `apps/api/internal/pokedex/schema.sql`
- `apps/api/internal/pokedex/ingest/bulk.go`
- `docs/PLAN.md` (Phase 1 section)
- `docs/OPEN_QUESTIONS.md` (Phase 1 section)
- Prior review at `docs/reviews/phase-1a/data-sync.md`
- Aggregate gate at `docs/reviews/phase-1a/_summary.md`

---

## DS-1 — Ingest ordering (`bulk.go` comment block)

**Original ask.** Comment block in `bulk.go` must list `stats` and `abilities` before the joins phase, `moves` before `pokemon_moves`, and a second-pass note for `species.evolves_from_species_id`.

**Verified at `bulk.go:46-62`.** The comment block reads:

```
1.  ingestGenerations
2.  ingestTypes
3.  ingestStats     (needed before pokemon_stats joins)
4.  ingestAbilities (needed before pokemon_abilities joins)
5.  ingestMoves     (needed before pokemon_moves joins)
6.  ingestSpecies
7.  ingestForms
8.  ingestPokemon
9.  ingestPokemonTypes / ingestPokemonStats / ingestPokemonAbilities / ingestPokemonMoves
10. ingestEvolutionChains, ingestEvolutions
11. (second pass) populate species.evolves_from_species_id
12. ingestFlavorText
```

This matches the ordering recommended in §3 of the prior review exactly. Stats, abilities, moves are seeded before the join tables that FK to them; the second-pass note for `species.evolves_from_species_id` is present. The accompanying note that ingestion will run inside a single `BEGIN IMMEDIATE`/`COMMIT` transaction (item 11 from the strongly-recommended list) is also captured at `bulk.go:61-62`.

**Status: resolved.**

One sub-note: `docs/PLAN.md` §5's Phase 1 deliverable list (line 109) still reads "joins" implicitly — it does not enumerate the ingest order. The `bulk.go` comment is the authoritative ordering and it is correct; the PLAN.md text is high-level and does not contradict it. Not a defect.

---

## DS-2 — `content_hash` columns

**Original ask.** Add `content_hash TEXT NOT NULL DEFAULT ''` on `pokemon`, `species`, `forms`, `moves`, `abilities`.

**Verified.**

- `schema.sql:64` — `species.content_hash TEXT NOT NULL DEFAULT ''` ✅
- `schema.sql:85` — `forms.content_hash TEXT NOT NULL DEFAULT ''` ✅
- `schema.sql:114` — `pokemon.content_hash TEXT NOT NULL DEFAULT ''` ✅
- `schema.sql:167` — `abilities.content_hash TEXT NOT NULL DEFAULT ''` ✅
- `schema.sql:194` — `moves.content_hash TEXT NOT NULL DEFAULT ''` ✅

All five columns are present with the agreed type and default. Phase 1.F drift-check can populate these at ingest time without an `ALTER TABLE` migration.

**Status: resolved.**

Forward-looking note (not a regression): the canonicalization function used to compute these hashes still needs to be designed in 1.B (key ordering, exclusion of `learned_by_pokemon`-style backrefs, exclusion of upstream timestamps). Capturing here so 1.B picks it up.

---

## DS-3 — `sync_meta` audit trail

**Original ask.** Add `schema_version`, `binary_version`, `tags_yaml_sha`, `status` (with `CHECK (status IN ('success','failed','partial'))`), and `error_message` columns to `sync_meta`.

**Verified at `schema.sql:25-37`.**

```sql
CREATE TABLE IF NOT EXISTS sync_meta (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ran_at TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('bulk', 'delta', 'drift-check')),
  api_data_commit_sha TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  record_counts_json TEXT NOT NULL DEFAULT '{}',
  schema_version INTEGER NOT NULL DEFAULT 1,
  binary_version TEXT NOT NULL DEFAULT '',
  tags_yaml_sha TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'failed', 'partial')),
  error_message TEXT
);
```

All five columns present, `status` carries the agreed CHECK constraint, comment at `schema.sql:24` even cross-references "DS-3". The `INSERT INTO sync_meta` in `bulk.go:102-112` writes `schema_version`, `binary_version`, `tags_yaml_sha`, and `status` (binary_version and tags_yaml_sha empty for now, which is honest for 1.A — they will be populated in 1.B once the binary stamp and tags loader exist).

**Status: resolved.**

`[concern]` (non-blocking, queue for 1.B): the prior review §7 recommended inserting the `sync_meta` row at the *start* of the run with `status='running'` so that failed/crashed runs leave a forensic record. The current code inserts only on success path (after ingestion would complete in 1.B). This is consistent with the prior review's own caveat ("the .tmp DB rename loses the failure record anyway, document the choice"), but it should be revisited when 1.B adds real ingest steps with real failure modes. Flag for the 1.B implementation gate, not a 1.A regression — the 1.A code path has no failure mode between schema apply and the `INSERT`.

---

## DS-4 — Concurrent-run guard

**Original ask.** Integrate `gofrs/flock`; acquire/release exclusive lock on `<OutputPath>.lock` for the duration of the run.

**Verified.**

- Import at `bulk.go:18`: `"github.com/gofrs/flock"` ✅
- Lock acquired before any temp-DB work at `bulk.go:73-82`:
  ```go
  lockPath := opts.OutputPath + ".lock"
  fileLock := flock.New(lockPath)
  locked, err := fileLock.TryLockContext(ctx, 250*time.Millisecond)
  if err != nil {
      return BulkResult{}, fmt.Errorf("acquire lock at %q: %w", lockPath, err)
  }
  if !locked {
      return BulkResult{}, fmt.Errorf("another bulk sync is already running (lock held at %q)", lockPath)
  }
  ```
- Released via `defer` at `bulk.go:83-85`:
  ```go
  defer func() {
      _ = fileLock.Unlock()
  }()
  ```

Release-on-all-paths analysis: the `defer` runs on every function exit (success rename, db-open error, sync_meta insert error, db-close error, rename error). Distinct lock-vs-tmp lifecycles are correct: the lock is acquired *before* the `os.Remove(tmp)` cleanup at `bulk.go:89`, so a stale `.tmp` from a previous run cannot be removed by a process that does not hold the lock. The 250 ms `TryLockContext` poll interval is sane — fast enough that two concurrent invocations resolve quickly, slow enough not to spin.

Edge cases handled:
- Two concurrent processes: second blocks/fails fast with a clear error message naming the lock path.
- Crash mid-run: OS releases the `flock(2)` advisory lock when the FD closes; the next run acquires successfully and removes the stale `.tmp`. Correct.
- `ctx` cancelled while waiting: `TryLockContext` returns the cancellation error; lock is never acquired so no release is needed (and `flock.Unlock()` on an unheld lock returns an error which we discard via `_ =`). Correct.

**Status: resolved.**

Minor observations (not blockers):
- The lock file (`pokedex.sqlite.lock`) is never removed. That's standard `flock` practice (file persists; lock is on the FD, not the file content) and matches the package's idiomatic use. No action needed.
- `go.mod` and `go.sum` should now pin `github.com/gofrs/flock`. Not in scope to verify here, but if the project builds and tests pass, it's already vendored.

---

## §1 schema gaps (items 5–11) — tracked correctly for Phase 1.B?

**Original ask.** The strongly-recommended items 5–11 from §9 of the prior review (the §1.1–§1.6 schema additions: `pokemon.is_default`/`order`, `species.gender_rate`/`has_gender_differences`/`forms_switchable`/`evolves_from_species_id`/`order`/etc., `forms.form_order`/`introduced_in_version_group`, `evolutions.gender`/`time_of_day`, `moves.target`/`effect_chance`, `abilities.is_main_series`/`generation_id`, `localized_names` table, ingestion in `BEGIN IMMEDIATE`/`COMMIT`) need to be at least *filed* as 1.B starter work, per the verdict text: "I would withdraw the 'request changes' verdict to 'approve with nits' if items 1–4 are resolved and items 5–11 are at least filed as 1.B starter work."

**Aggregate gate's instruction.** `_summary.md:102` explicitly directs: "Defer 1.A nits (code-reviewer N1–N5, test-runner S-1–S-4, schema-guardian N1–N6, **data-sync items 5–11**) to opportunistic 1.B work. **Track in `docs/OPEN_QUESTIONS.md` Phase 1 section.**" (Emphasis added.)

**What I actually find.**

1. **`docs/OPEN_QUESTIONS.md` Phase 1 section (lines 17–26).** Lists three resolved items (sync source, sprite hosting, cry hosting, tags.yaml content) plus *one* still-open item — "Form coverage gaps" — which is the Phase 1.B `forms_overrides.yaml` question, unrelated to the schema-gap action list. **The strongly-recommended schema additions are not mentioned.**

2. **`docs/PLAN.md` Phase 1 section (lines 86–124).** Phase 1.A status block (lines 92–101) summarizes what was committed. The Phase 1 deliverables (lines 107–115) list the table set but do not enumerate the §1.1–§1.6 columns. There is no "schema additions queued for 1.B" sub-list anywhere.

3. **No `docs/reviews/phase-1a/_summary.md` reference in either file.** The aggregate gate's defer instruction is not followed up.

4. **No tracker file (`docs/TODOs.md`, `docs/PHASE-1B-PREREQS.md`, etc.) exists for these.**

The fix pass closed the four blockers but did **not** carry through on the aggregate gate's tracking directive for items 5–11.

**Severity.** This is itself a `[concern]` per the framing in this re-gate's prompt. It is not a hard blocker for 1.A's gate — the four blockers are the gate's load-bearing items — but it materially weakens the *withdrawal* condition in the prior verdict ("I would withdraw to 'approve with nits' if items 1–4 are resolved **and items 5–11 are at least filed as 1.B starter work**"). One half of that conjunction is unmet.

**Required fix (small, mechanical).** Add a new sub-section to `docs/OPEN_QUESTIONS.md` Phase 1, e.g.:

```markdown
Phase 1.B starter work (deferred Phase 1.A nits, per docs/reviews/phase-1a/_summary.md):
- **Schema additions before bulk ingest writes data:**
  - `pokemon.is_default INTEGER NOT NULL DEFAULT 0`, `pokemon.order INTEGER NOT NULL DEFAULT 0`
  - `species.gender_rate INTEGER`, `species.has_gender_differences INTEGER NOT NULL DEFAULT 0`,
    `species.forms_switchable INTEGER NOT NULL DEFAULT 0`, `species.evolves_from_species_id
    INTEGER REFERENCES species(id)`, `species.order INTEGER`,
    `species.growth_rate TEXT`, `species.base_happiness INTEGER`, `species.capture_rate INTEGER`,
    `species.hatch_counter INTEGER`
  - `forms.form_order INTEGER`, `forms.introduced_in_version_group TEXT`
  - `evolutions.gender INTEGER`, `evolutions.time_of_day TEXT`
  - `moves.target TEXT`, `moves.effect_chance INTEGER`
  - `abilities.is_main_series INTEGER`, `abilities.generation_id INTEGER REFERENCES generations(id)`
  - new `localized_names` table (empty in 1.B; populated post-Phase 7)
- **Ingestion transactionality:** wrap all 1.B ingest steps in a single
  `BEGIN IMMEDIATE` / `COMMIT` in the .tmp DB.
- **Other deferred 1.A nits:** code-reviewer N1–N5, test-runner S-1–S-4, schema-guardian N1–N6.
```

Filing these in `OPEN_QUESTIONS.md` (the location the aggregate gate specified) is a one-edit fix and is the cheapest way to discharge the gate condition.

`docs/PLAN.md` Phase 1 prose is fine as-is — the OPEN_QUESTIONS.md entry is the canonical tracker per `_summary.md:102`.

---

## Summary table

| ID | Description | Status |
|---|---|---|
| DS-1 | Ingest ordering (stats/abilities/moves before joins; second-pass evolves_from) | ✅ Resolved (`bulk.go:46-62`) |
| DS-2 | `content_hash` columns on pokemon/species/forms/moves/abilities | ✅ Resolved (`schema.sql:64,85,114,167,194`) |
| DS-3 | `sync_meta` audit-trail columns + status CHECK | ✅ Resolved (`schema.sql:25-37`) |
| DS-4 | `gofrs/flock` concurrent-run guard | ✅ Resolved (`bulk.go:18,73-85`) |
| §1 5–11 | Schema gaps queued for 1.B in OPEN_QUESTIONS.md | ❌ Not tracked anywhere — `[concern]` |

---

## Verdict: Approve with nits

The four DS blockers are addressed cleanly and exactly as specified. The "queue items 5–11 in OPEN_QUESTIONS.md" follow-through from the aggregate gate is the one outstanding item; it is mechanical (a single edit to one file) and does not block the 1.A gate, but the project should land it before declaring 1.A formally closed so the 1.B agent has the work list at the canonical location the aggregate gate named.
