# Phase 2 (proper) — Implementation Gate

**Date:** 2026-04-29
**Sub-phase:** Phase 2 — Filter engine (full deliverables per PLAN.md §Phase 2 lines 154–173).
**Aggregator:** assistant, reading the three reports in this directory.

## Per-agent verdicts

| Agent | Initial verdict | After blocker-fix pass | Δ |
|---|---|---|---|
| `code-reviewer` | Approve-with-nits | Approve-with-nits | maintained — 7 nits, none blocking, items 1/3/4 noted as Phase-7-readiness follow-ups |
| `test-runner` | Approve-with-reservation | Approve-with-reservation | maintained — coverage gap on `apps/web/lib/pokedex.ts` flagged for Phase 3 prep |
| `product-manager` | **APPROVE WITH BLOCKERS** (B-1…B-4) | **Approve** | upgraded — all 4 blockers cleared in this gate-close pass |

**Aggregate gate verdict: Approve.** Phase 2 (proper) closes; Phase 3 (proper — three rankers) may begin.

## Blockers cleared in this gate-close pass

**B-1 — Lock D-24 (default form-inclusion).** Locked in `docs/DECISIONS.md` as **D-24 — Default form-inclusion: `final-evolutions-excluding-mega`**. `OPEN_QUESTIONS.md` Phase 2 L51 marked resolved.

**B-2 — Add 3 missing presets.** Added:
- `kanto-electric` (closes "you forgot Pikachu's type" gap; bonus `kanto-psychic` for parity with the Mewtwo-tier mascots).
- `eeveelutions` — modeled via a new `slugs?: string[]` primitive in `Filter` (curated allowlist), so the preset works **without** Phase 1.D tag curation. Eight Eeveelutions hardcoded as exact slug match.
- `starters-final` — uses existing `starter` tag plus `formInclusion: "final-evolutions-excluding-mega"` to surface the canonical "best final-form starter" question.

Total presets: **35** (was 31). Plus rename `bst-600-club` → `bst-600-679` to fix the misleading name (PM cosmetic A).

**B-3 — Fix `canonicalKey` collision classes.** Rewrote `canonicalKey` in `packages/filter/src/index.ts` to be a true equivalence-class hash:
- (A) `tagMode` is dropped when `tagSlugs.length ≤ 1`.
- (B) `evolutionStages = {first, middle, final}` (any order, deduped) collapses to undefined.
- (C) Open BST range (`bstMin ≤ 0` and `bstMax ≥ 720`) collapses; same for per-stat thresholds outside `[0, 255]`.
- Bonus: list-field inputs (`generationIds`, `typeSlugs`, `tagSlugs`, `slugs`) are now deduped before serialization (covers code-reviewer nit #1, addresses Phase 7 collision risk).

Six new vitest cases added to `apply.test.ts`'s "canonicalKey collision normalizations" suite.

**B-4 — Close NOT-in-v1-UI question.** `OPEN_QUESTIONS.md` Phase 2 entry rewritten: NOT is engine-only in v1 picker UI; engine + agent (Phase 4.5) use it freely; revisit if a user complains. Documented as a deliberate non-decision per PM's framing.

## What landed across Phase 2 (proper)

### Engine

- **Pokemon shape extension** (`packages/shared/src/index.ts`): `evolutionStage`, `isMega`, `isGmax`, `isBattleOnly`, `isRegionalVariant`, `isLegendary`, `isMythical`, `isBaby`. Mirrors columns the Phase 1.B ingester already populates.
- **Filter primitives** (per PLAN.md §Phase 2): `generationIds`, `typeSlugs`, `tagSlugs` + `tagMode`, `slugs` (PM B-2 addition), `formInclusion` (8 modes), `evolutionStages`, `bstMin`/`bstMax`, `statThresholds`, `isLegendary`/`isMythical`/`isBaby`, deprecated `includeAlternateForms` shim.
- **Composition AST** (`packages/filter/src/composition.ts`): `FilterNode = leaf | and | or | not`. `applyNode` accepts either a `Filter` shorthand or a `FilterNode` (auto-wraps leaves). De Morgan property test pinned.
- **Preset library** (`packages/filter/src/presets.ts`): **35 presets** across 8 categories (per-gen 9, kanto-mono-type 5, status 4, form-inclusion 5, type 3, BST 2, curated 2, tag-based 5).
- **URL round-trip** (`canonicalKey`, `toSearchParams`, `parseFilter`): every Filter field round-trips. canonicalKey collisions in tagMode / evolutionStages / open BST ranges / open stat thresholds explicitly normalized for Phase 7 rollups.

### Web

- **`apps/web/lib/pokedex.ts`**: now joins `pokemon`/`forms`/`species` and pre-computes `evolutionStage` from the species evolution graph (`computeEvolutionStages` over `evolves_from_species_id`). Single SQLite read populates all 8 new Pokemon fields.

### Tests

- **95 TS tests pass** across 4 workspaces (filter 83, ranker 11, web 1, shared 0). Up from 25 in MVP slice.
- **Filter coverage**: 49 apply tests + 11 composition tests + 23 preset tests.
- **`make all` green**, `make sync-validate` 0 issues, Next.js production build 0 errors.

### Decisions / Open Questions

- **D-24 locked.** Default form-inclusion `final-evolutions-excluding-mega`.
- **OPEN_QUESTIONS.md Phase 2** — both items resolved (NOT-in-UI as non-decision, default form-inclusion as D-24). The "Filter UI: chip-based or form-based" question remains open as a Phase 4 concern.

## Forward-looking items handed to Phase 3 / Phase 4 / Phase 1.D

- **Phase 3 lead** (rankers proper): Phase 2 contract `apply(filter, pool) → Pokemon[]` is stable. Three rankers (`SingleElim`, `MergeSortComparator` (already shipped), `GlickoRandom`) plug into the same downstream interface. The 64-cap on Picker.tsx is Phase 4's concern.
- **Phase 4 lead** (UI proper): use `requiresTags: true` flag on tag-dependent presets to render them dimmed-with-tooltip until 1.D lands. Algorithm dropdown owns the ranker choice. Form-inclusion radio + BST slider + stat sliders + evolution-stage multi-select are all unblocked by the engine.
- **Phase 1.D** (tag curation, parallel/optional): `eeveelution` and `single_stage` tags would let Phase 4 use tag-based presets instead of curated slug lists. Adding these is mechanical — both are derivable from the species/evolution graph at sync time, no subjective curation, no D-23 conflict.
- **Phase 7 forward note**: aggregation MUST re-compute `canonicalKey(spec)` from the resolved Filter — the preset slug is NOT the rollup key. Documented inline in `canonicalKey`'s docstring.

## State of the codebase

- TS test suite: **95 passing** (filter 83, ranker 11, web 1).
- Go test suite: unchanged — Phase 2 didn't touch the sync binary.
- `make all`: green.
- Next.js production build: clean, `/pick` server-rendered on demand.
- Live SQLite: 1350 pokémon, 1025 species, 8100 stats, 96 Megas, 34 GMaxes, 53 regional variants, 19 babies, 120 legendary rows. Phase 2 reads and filters correctly against real data (smoke-checked).

## Aggregate verdict

**Approve.** Phase 2 (proper) closes; Phase 3 (three rankers + algorithm dropdown wiring) may begin.
