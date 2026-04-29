# Phase 1.A — Implementation gate (re-run)

**Date:** 2026-04-28 (same day as the original gate; blocker-fix pass landed in-between).
**Sub-phase:** 1.A — Pokédex schema + sync skeleton.
**Aggregator:** assistant, reading the five re-gate reports in this directory.

## Per-agent verdicts (re-gate)

| Agent | Original verdict | Re-gate verdict | Δ |
|---|---|---|---|
| `code-reviewer` | Approve with nits | **Approve with nits** | maintained; new nits are doc-only (stale README/PLAN refs) |
| `test-runner` | Approve with nits | **Approve** | upgraded; coverage 34.5% → 45.7%, ingest 60.0% → 64.7% |
| `schema-guardian` | Request changes (3 blockers) | **Approve** | upgraded; all blockers and request-changes resolved |
| `data-sync` (beat owner) | Request changes (4 blockers) | **Approve with nits** | upgraded; one fixable nit (missing OPEN_QUESTIONS entries — fixed in this pass) |
| `product-manager` (adversarial) | Approve with nits (Phase 1.A) | **Approve with nits** | maintained; surfaces 3 forward-looking risks |

**Aggregate gate verdict: Approve.** Phase 1.A is officially complete; Phase 1.B may begin.

## What changed since the original gate

### Blockers resolved

- **B1.** `pokemon.generation_id` column added with FK to `generations` and dedicated index. Backed in Go via `Pokemon.GenerationID int64`.
- **B2.** `pokemon_types` got `UNIQUE (pokemon_id, type_id)`.
- **B3.** `forms` got `UNIQUE (species_id, form_name)` plus a partial unique index `idx_forms_default_per_species` enforcing at-most-one default per species.
- **DS-1.** `bulk.go` ingest-order comment updated to include stats / abilities / moves before joins, with the second-pass note for `species.evolves_from_species_id`. PLAN.md also updated.
- **DS-2.** `content_hash TEXT NOT NULL DEFAULT ''` added to `pokemon`, `species`, `forms`, `moves`, `abilities`. Phase 1.F drift-check no longer requires a migration.
- **DS-3.** `sync_meta` expanded with `schema_version`, `binary_version`, `tags_yaml_sha`, `status` (CHECK 'success'/'failed'/'partial'), `error_message`.
- **DS-4.** `gofrs/flock` integrated into `ingest/bulk.go`; lock acquired on `<output>.lock` before `.tmp` work, released via defer on every return path.

### Request-changes resolved

- **R1.** CHECK on `pokemon_stats.base_value BETWEEN 0 AND 255` and `effort BETWEEN 0 AND 3`.
- **R2.** CHECK on `pokemon_abilities.slot IN (1, 2, 3)`.
- **R3.** Index added on `pokemon_moves.learn_method` (chosen over CHECK to avoid maintaining the enum list).
- **R4.** `Pokemon.HeightDecimeters`, `WeightHectograms`, `BaseExperience` widened to `int64` for consistency with SQLite INTEGER.

### Forward-looking changes alongside the blocker fix

- **D-22 (PL-7 Option A).** Single Vercel deploy; Go restricted to sync binary. `apps/api/cmd/api/` and `apps/api/internal/health/` deleted. PLAN.md Phase 4.5 updated to use the Anthropic TypeScript SDK.
- **D-23.** Subjective design tags (cute / cool / scary / iconic) explicitly cut from v1, formalized as a numbered ADR rather than a YAML comment.
- **D-7, D-13, D-17** annotated with status notes pointing at their supersedersOriginal gate's nits (~6 items from code-reviewer, ~4 from test-runner, ~6 from schema-guardian, ~7 from data-sync) are tracked in `docs/OPEN_QUESTIONS.md` Phase 1.B section so 1.B picks them up cheaply.

### Re-gate nits addressed in this pass

- **code-reviewer nit (stale docs).** `README.md` Phase 0 status line and `docs/PLAN.md` Phase 0 status / deliverables / interface / exit-criteria — all references to `/healthz` and `make api` removed; D-22 supersession noted in-place.
- **data-sync nit (missing OPEN_QUESTIONS entries).** §1.1–§1.6 PokeAPI field additions filed under Phase 1.B in `docs/OPEN_QUESTIONS.md` with explicit list of columns to add per table.

## Re-gate nits NOT addressed (deferred opportunistic)

- **test-runner S-5/S-6.** Flock-contention error path not directly tested; CHECK tests only assert one boundary each (e.g., `effort > 3` is tested, `effort < 0` is not). Both non-blocking; address opportunistically in Phase 1.B work.
- **schema-guardian.** `SchemaVersion` is still `1` despite the schema change. Defensible because Phase 1.A has not shipped externally — but document the "we rewrote v1 in place" decision somewhere if challenged. Non-blocking.

## Forward-looking risks raised by `product-manager` (no Phase 1.A action; track for future gates)

- **Vercel Hobby viral cliff.** Free tier offline-rather-than-degrade behavior under traffic spikes. Plan: Phase 7 onward, monitor and consider Pro/affordable host if traffic hits the cliff.
- **D-23 ships v1 objectively worse than RatePKMN on the subjective-rating axis** without an explicit mitigation. Plan: Phase 7 community-data-driven subjective tags ADR.
- **Vercel Edge Function 50 ms CPU budget** may be tight for multi-turn agent fan-out at Phase 4.5. Plan: monitor agent latency at Phase 4.5; switch to Vercel Serverless Functions (longer budget) if needed.

These are tracked for future planning gates, not Phase 1.A action.

## Aggregate verdict

**Approve.** Phase 1.A is complete. Phase 1.B may begin once the human signals.

## What's queued for Phase 1.B

1. Bulk ingestion of all entities in the FK-correct order documented in `bulk.go`.
2. Schema additions queued in `OPEN_QUESTIONS.md` (PokeAPI fields, `localized_names` table, BEGIN IMMEDIATE wrapping).
3. Replace `commitSHAOrPlaceholder` with a real `git -C <api-data> rev-parse HEAD`.
4. Replace `Query` interface stubs (`ErrNotImplemented`) with real implementations as ingestion lands the data.
5. Tag curation moves into Phase 1.D as planned (no scope creep here).

## Open items NOT for Phase 1.B

- **PL-2 / Phase 1.5 toy-picker decision.** Awaiting human input. The user said "you can call it later." Default behavior: Phase 1.B starts; if the human picks Phase 1.5 mid-1.B, we branch.
