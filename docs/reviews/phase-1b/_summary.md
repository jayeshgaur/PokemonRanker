# Phase 1.B — Final Implementation Gate

**Date:** 2026-04-29
**Sub-phase:** 1.B (cumulative — single batched gate per user directive 2026-04-29)
**Aggregator:** assistant, reading the five reports in this directory.

## Per-agent verdicts

| Agent | Initial verdict | After blocker-fix pass | Δ |
|---|---|---|---|
| `code-reviewer` | Approve with **one blocker** | Approve with nits | upgraded — B-1 (silent error swallowing in validate.go) fixed |
| `test-runner` | Approve with reservation | Approve | upgraded — S-7 (`validate_test.go`) added |
| `schema-guardian` | **Approve** | Approve | three non-blocking residuals carried forward |
| `data-sync` (beat) | **HOLD** (critical blocker §A) | Approve | upgraded — §A (FormIngester `is_default` semantics) fixed; §F (default-consistency check) added to validate suite |
| `product-manager` | Approve with noted drift | Approve with noted drift | maintained |

**Aggregate gate verdict: Approve.** Phase 1.B is complete; Phase 2 may begin.

## Critical blocker discovered AND fixed

**data-sync §A** caught a real production bug that would have crashed `make sync-from-clone` against real api-data:

`FormIngester` was writing `forms.is_default` directly from PokeAPI's `is_default` flag on the form JSON. But that flag means "default form *of this pokemon entity*", not "default form *of this species*". For species like Necrozma (Dusk-Mane / Dawn-Wings / Ultra each have their own pokemon entity, each with its own is_default form), three different forms would end up with `is_default = 1` for the same species. The schema's partial unique index `idx_forms_default_per_species WHERE is_default = 1` would reject the second insert and abort the entire bulk sync. Same explosion was waiting for Mimikyu, Toxtricity, Urshifu, Calyrex, Ogerpon.

**Fix:** `FormIngester` now ANDs the form's `is_default` with the parent pokemon's `is_default`. A form is the species-default form only if it is *its pokemon's* default AND that pokemon is the species's default. New helper `lookupPokemonForForm` returns both species_id and the pokemon's is_default flag in one read.

## Other fixes incorporated in this gate-close pass

- **code-reviewer B-1.** `validate.go` checks 8–14 used `_ = db.QueryRowContext(...).Scan(&x)` — silently swallowing scan errors. A SQL failure would leave `x == 0` and let the test "pass". Refactored to a `count(query, args...) (int, error)` helper that always propagates errors.
- **test-runner S-7.** New `validate_test.go` covers the validate suite: empty-DB issue accumulation, issue-detail propagation, and partial-fixture happy-path with selective check assertions.
- **data-sync §F (default-consistency).** Added validate check #16: `pokemon.is_default == forms.is_default` per (pokemon, form) pair.

## What landed across 1.B

### 1.B.1 — Schema v2 + sync infrastructure
- Schema v2 (PM-trimmed): 11 column additions + idx_species_evolves_from. Deferred completionism columns (gender_rate family, growth_rate, capture_rate, hatch_counter, introduced_in_version_group, effect_chance, abilities.generation_id, localized_names) tracked in OPEN_QUESTIONS.
- `Ingester` interface returning `IngestResult{RowCounts, Notes}` (per data-sync gate critique — supports multi-table ingesters and non-fatal warnings without inventing logging).
- `DBExecutor` interface with `PrepareContext` (per data-sync — pokemon_moves needs prepared statements at scale).
- `gofrs/flock` concurrent-run guard.
- `resolveCommitSHA` shells out to `git rev-parse HEAD`; **hard-error** when APIDataPath is set but invalid (per data-sync §3).
- `api-data-sha` pin file written on successful sync; committed (not gitignored) for reproducibility.
- `make api-data-pull`, `make sync-from-clone`, `make sync-inspect` targets.

### 1.B.2 + 1.B.3 — 12 ingesters in FK-correct order

Constants & core graph:
1. GenerationIngester
2. TypeIngester
3. StatIngester
4. AbilityIngester (is_main_series captured)
5. MoveIngester (target captured; effect_chance deferred)
6. SpeciesIngester (defers evolves_from to second pass; pokedex_number from "national" with id fallback)
7. FormIngester (looks up species via pokemon JSON; is_gmax derived from slug suffix; is_regional_variant from form_name; is_species_default = form.is_default ∧ pokemon.is_default — per the §A fix)
8. PokemonIngester (joins species for generation_id and pokemondb_url)

Joins, evolutions, flavor_text:
9. PokemonJoinsIngester (single pass writes pokemon_types/stats/abilities/moves; prepared statement for pokemon_moves; hardcoded versionGroupGeneration map; INSERT OR IGNORE on PK)
10. EvolutionIngester (recursive tree walk; full evolution_detail preserved as conditions_json)
11. FlavorTextIngester (\f / \n / \r / soft-hyphen normalized to spaces; INSERT OR IGNORE)
12. EvolvesFromBackfillIngester (second-pass UPDATE)

Orchestration in `bulk.go`: BeginTx → per-ingester run inside one transaction → aggregate IngestResult into sync_meta.record_counts_json and error_message → Commit → atomic rename → pin file write.

### 1.B.4 — Query API + validation
- `SQLQuery.GetByID`, `GetBySlug`, `List` replacing the `ErrNotImplemented` stubs. Decorate Pokemon with Types (slot-ordered), Stats (typed struct), Tags (alphabetical). `ErrNotFound` for missing rows.
- `pokedex.Validate(ctx, db) ([]ValidationIssue, error)` with **16 checks** (was 14; +1 for "every species has exactly one default form", +1 for the §F default-consistency invariant).
- `pokedex-sync validate --db <path>` CLI subcommand. `make sync-validate` Makefile target.

## Forward-looking items handed to Phase 2 / 1.F (no 1.B action)

- **Phase 2 lead:** `EvolutionStageFilter` will need `EvolvesFromSpeciesID` exposed on the `Pokemon` Go struct (PM Critique 3). Add at the start of Phase 2.
- **PM text-dump deferral.** A deterministic plaintext snapshot for cross-sync PR diffing (PM's third 1.B mitigation) was *not* implemented. The 16-check validate suite is *not* a substitute (it's self-consistency on one DB; not a diff across syncs). Tracked for **Phase 1.F**.
- **PM critique on validate semantics.** `pokemon_tags` correctness is not currently checked. A regression that drops the pseudo-legendary tag from one of the 10 species would not be caught — the existence check confirms species exist, not that tags are attached. Add `pokemon_tags`-aware checks alongside Phase 1.D's tag-curation work.
- **data-sync §B (multi-form pokemon).** PokemonIngester silently takes `Forms[0]`. If PokeAPI ships a pokemon with >1 form entry, the second form is dropped silently. Replace with a hard-error or a Note in 1.F.
- **data-sync §D (EvolvesFromBackfill FK).** If the parent species somehow doesn't exist, the UPDATE fails with FK violation. Soft-skip + Note recommended. Track for 1.F.
- **data-sync (`pokedex_number` fallback).** SpeciesIngester falls back to species id when no national pokedex entry exists. For 10000-block alt-form species this yields a five-digit pokedex_number. Add a warn+continue path in 1.F.
- **schema-guardian (residuals).** `forms.introduced_in_generation_id` is a dead column (no ingester writes it). Either drop in a future schema cleanup or populate from form's version_group → generation lookup.
- **PM (CLI surface).** `pokedex-sync validate` is a separate command; PM suggested wiring into `RunBulk` as a post-step. Opportunistic.

## State of the codebase

- 34 Go top-level tests + 3 BST subtests = 37 assertions, all pass with `-race -count=2`.
- Coverage: total **62.0%** (up from 51.5%); ingest **72.3%** (held vs 73.3% on 4× more statements).
- `make sync` (scaffold) + `make sync-inspect` work end-to-end.
- `make sync-from-clone` is wired (will pull ~557 MB of api-data on first run; defers the integration test against real data to the user's machine).
- TS suite unchanged at 1 placeholder (Phase 4 will replace).

## Aggregate verdict

**Approve.** Phase 1.B closes; Phase 2 (filter engine) may begin.
