# Phase 1.B.1 — Implementation gate

**Date:** 2026-04-29 (work landed on 2026-04-28).
**Sub-phase:** 1.B.1 — Schema v2 expansion + sync infrastructure.
**Aggregator:** assistant, reading the five reports in this directory.

## Per-agent verdicts

| Agent | Verdict | Key finding |
|---|---|---|
| `code-reviewer` | **Approve with nits** | ADRs honored; one doc-comment drift (schema.sql / schema.go incorrectly claimed v2 introduces `localized_names`) — fixed in this gate-close pass. |
| `test-runner` | **Approve** | 20 Go tests, race-clean × 2 runs. Coverage 45.7% → 51.5%; ingest 64.7% → 73.3%; `commitSHAOrPlaceholder` (now `resolveCommitSHA`) 100%. Git-fixture test ran without skipping. |
| `schema-guardian` | **Approve** | Schema v2 is coherent; 11 new columns sensibly typed; self-FK indexed; PM trim is safe (no load-bearing constraint dropped). One doc drift (same as code-reviewer's). Two ingest invariants flagged for 1.B.2: `pokeapi_order != 0` post-condition; `pokemon.is_default == forms.is_default` consistency. |
| `data-sync` (beat owner) | **Approve** | Five 1.B.2 prep items: redefine `Ingester` to return `IngestResult{RowCounts, Notes}` instead of int (13-file refactor risk if delayed); add `PrepareContext` to `DBExecutor`; hard-error on git failure when APIDataPath is set; pin-and-checkout deferred to 1.F; Makefile shape OK. |
| `product-manager` | **Approve** | All three POC mitigations honored (`make sync-inspect`, `.api-data-sha` pin file committed, text-dump deferred to 1.B.4 at the work site). Schema-trim framing in OPEN_QUESTIONS is honest. |

**Aggregate verdict: Approve.** Phase 1.B.1 complete.

## What was incorporated in this gate-close pass

Three of data-sync's five items were folded in immediately to avoid a 13-file refactor in 1.B.2:

1. **`Ingester` interface** redesigned to return `IngestResult { RowCounts map[string]int; Notes []string }`. Multi-table ingesters can now report per-table counts; non-fatal warnings have a surface (no logger required).
2. **`DBExecutor`** gained `PrepareContext` (data-sync §2 — `pokemon_moves` is ~50–100k rows; prepared statements are an order of magnitude faster).
3. **`commitSHAOrPlaceholder` → `resolveCommitSHA`** now hard-errors when APIDataPath is set but `git rev-parse HEAD` fails. Test renamed `TestRunBulk_HandlesNonGitAPIDataPath` → `TestRunBulk_FailsHardWhenAPIDataPathIsNotAGitRepo` to assert the new contract. The "scaffold" placeholder for empty APIDataPath is preserved.

Plus the doc-comment drift fix (code-reviewer + schema-guardian both flagged the v2 history claiming `localized_names`).

## Forward-looking items handed to 1.B.2 / 1.F

- **1.B.2 ingest invariants** (schema-guardian): each ingester for `pokemon` must verify `is_default` matches the corresponding form's `is_default`; each ingester writing `pokeapi_order` should refuse to write 0 unless PokeAPI itself reports 0.
- **Pin-and-checkout mode** (data-sync): the `api-data-sha` pin file is currently write-only. 1.F should add a "respect existing pin" mode for CI reproducibility and release pinning. Tracked in OPEN_QUESTIONS.md.
- **Non-fatal-warning aggregation** (data-sync): `IngestResult.Notes` is now defined; bulk pipeline should aggregate notes into `sync_meta.error_message` (or its successor) for diagnostic traceability. Tracked for 1.B.3.
- **Optional rename** `sync-from-clone` → `sync-fresh` (data-sync §5): purely stylistic; deferred.

## What 1.B.2 starts with

- Schema v2 in place (19 tables, all the columns 1.B.2 ingesters need).
- `Ingester` interface and `DBExecutor` interface stable.
- `git rev-parse HEAD` working; pin file written on success.
- `make api-data-pull` ready; `make sync-from-clone` runs the full chain.
- `make sync-inspect` ready to show row counts as ingestion lands.

## Ready for 1.B.2

The next sub-phase implements ingesters for: generations, types, stats, abilities, moves, species, forms, pokemon. End-state: `SELECT COUNT(*) FROM pokemon` returns ~1300+ rows.
