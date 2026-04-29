# Phase 4 (proper) — Implementation Gate

**Date:** 2026-04-29
**Sub-phase:** Phase 4 — Core UI MVP (full deliverables per PLAN.md §Phase 4 lines 200–231).
**Aggregator:** assistant, reading the three reports in this directory.

## Per-agent verdicts

| Agent | Initial | After blocker-fix pass | Δ |
|---|---|---|---|
| `code-reviewer` | Approve-with-fixes (B-1, B-2) | Approve-with-nits | upgraded — both blockers cleared |
| `test-runner` | Approve-with-reservation | Approve-with-reservation | maintained — UI components still untested; reservation is test-debt for follow-up |
| `ux-critic` | **Approve-with-blockers** (B-1, B-2, B-3) | **Approve** | upgraded — three blockers cleared |

**Aggregate gate verdict: Approve.** Phase 4 (proper) closes; Pokemon Ranker has its first real product surface.

## Blockers cleared in this gate-close pass

**code-reviewer B-1 — FilterSidebar draft state went stale on URL navigation.** When the user clicked a preset chip (which navigates and rewrites the filter), the local `useState(current)` draft persisted from before the navigation; pressing "Apply manual filter" then overwrote the new filter with the stale draft. Fixed with a `useEffect` that resyncs `draft` when `canonicalKey(current)` changes.

**code-reviewer B-2 — DuelCard global keyboard handler scope leak.** The handler bailed out on `<input>/<textarea>/<select>` but not `<button>`. Pressing Space on a focused sidebar chip both activated the chip AND fired `onPick("skip")`. Fixed by gating on `document.activeElement === document.body` — the global shortcuts only fire when nothing has focus.

**ux-critic B-1 — Keyboard shortcuts undiscoverable.** Added an always-visible keyboard hint banner above the duel cards (`← left wins · → right wins · space can't decide`) using semantic `<kbd>` elements with `aria-live="polite"`. Each card now carries `aria-keyshortcuts="ArrowLeft"` / `"ArrowRight"`. Per-card hint moved from "hover only" to always visible.

**ux-critic B-2 — Missing `focus-visible` rings.** Added `focus-visible:ring-2 focus-visible:ring-emerald-500/60 focus-visible:outline-none` to duel cards, sidebar chips, and the share button. Meets WCAG 2.4.7 visible-focus requirement.

**ux-critic B-3 — Share URL didn't include in-progress state.** Decision: do *not* embed run state in the URL (would be 50 KB+ for a Glicko run; D-5 says URL is for *config*, run state is in localStorage). Instead clarified the button label from "Share this picker (copy link)" to "Copy picker config link" with a hover tooltip explicitly noting that the in-progress run isn't included.

**test-runner #2 — Missing `.catch` on `clipboard.writeText`.** Added a rejection handler so a failed clipboard call surfaces a soft error ("✗ Couldn't copy — copy from address bar") rather than producing an uncaught promise rejection.

**test-runner #1 (high-leverage) — `lib/url-state.ts` had no tests.** Added `apps/web/__tests__/url-state.test.ts` with 10 cases covering parse defaults, every valid algorithm, every valid top-N, mode parsing, Next.js searchParams shape vs URLSearchParams, default-omission round-trip, and arbitrary-opts round-trip. Locks the D-5 URL contract before Phase 5 (permalinks).

## Other improvements bundled in this pass

- **D-19 vocabulary slip on `app/page.tsx`.** "Choose your tournament style" → "Choose your picker style." (D-19 reserves "tournament" for internal use only.)
- **`aria-pressed` on filter chips and tri-toggles** (code-reviewer nit).

## What landed across Phase 4 (proper)

### URL state + presentational atoms
- `apps/web/lib/types.ts` — TYPE_STYLES color table (18 official + Stellar + unknown fallback). Pre-computed text colors for legibility.
- `apps/web/lib/url-state.ts` — `DEFAULT_PICKER_OPTS`, `parsePickerOpts(searchParams)`, `pickerOptsToParams(opts, params)`. Algo + topN + mode are URL-driven; defaults omitted from the URL (D-5 round-trip parity).
- `apps/web/components/pokemon/TypeBadge.tsx` — color-coded type badge with `aria-label`.
- `apps/web/components/pokemon/StatBlock.tsx` — 6 stat bars with traffic-light colors + BST.
- `apps/web/components/pokemon/Sprite.tsx` — graceful fallback when sprite URLs are missing or 404.

### Filter sidebar
- `apps/web/components/picker/FilterSidebar.tsx` — 35 preset chips in 7 groups (per-gen, by-type, status, form-filter, curated, BST, tag-based-dimmed-when-uncurated). Manual section: gen chips, type chips, form-inclusion select (D-24 default), evolution-stage chips, tri-state legendary/mythical/baby toggles. Advanced section: BST min/max inputs, tag chips. Live eligible-count display, "Active preset" pill when a preset is selected. URL-driven via `useTransition` + `router.push`. Re-syncs draft on URL change (B-1 fix).

### Picker controls + screen
- `apps/web/components/picker/PickerControls.tsx` — algorithm `<select>` sourced from `RANKER_INFO` with comparison count hint, top-N segmented control (1/3/5/10), Vibes/Informed segmented control (D-8), audio toggle.
- `apps/web/components/picker/PickerScreen.tsx` — client wrapper holding audio toggle state in localStorage.

### Duel + results
- `apps/web/components/picker/DuelCard.tsx` — keyboard hint banner (always visible), big Sprite, TypeBadges + StatBlock + gen badge in Informed mode, sprite-only in Vibes mode, audio cry on hover (toggleable), keyboard ←/→/space scoped to body-focus. Glicko stop-early button on the progress bar. WCAG focus rings throughout.
- `apps/web/components/picker/ResultsList.tsx` — Top-N podium (gold/silver/bronze for top-3 with glow shadow on rank 1), full ranking in collapsed `<details>`, PokemonDB outbound link per item, Share button (clarified copy + error path), Glicko Keep-going button on stopped-early runs.

### Picker logic
- `apps/web/components/picker/Picker.tsx` — `createRanker(algo, candidates)` + `restoreRanker(snapshot, candidates)` for saved runs. localStorage key includes `algo` so different algorithms have parallel saved runs of the same filter. **64-cap dropped.** Soft warning above 200 with algorithm-specific advice ("switch to Glicko for stop-when-tired"). Glicko `stopEarly()` + `setTargetComparisons(done + 3n)` wired to UI buttons. Drives ResultsList both for `isDone()` (final) and `currentResult()` (early stop).

### Page + landing
- `apps/web/app/pick/page.tsx` — server component reading filter (preset slug *or* explicit fields) + `pickerOpts` from URL. Uses `applyNode(spec, pool)` so preset specs that are `FilterNode` (composed OR/NOT) work uniformly with flat `Filter` shorthands. PokedexMissing empty state.
- `apps/web/app/page.tsx` — landing with 6 preset highlights and "Start picking" CTA. D-19-compliant copy.

### Tests

- **161 TS tests pass** across 4 workspaces (filter 83, ranker 66, web 11, shared 0). Up from 150.
- New: 10 cases on `url-state.ts` (parsePickerOpts, pickerOptsToParams).

### Tooling

- `make all` green; Next.js production build clean (`/pick` 12.7 kB First Load JS over 105 kB shared); `make sync-validate` 0 issues.
- Live SQLite still 1350 pokémon, 1025 species — Phase 4 reads and renders correctly.
- `packages/ranker/src/single-elim.ts` swap statement rewritten without destructuring-with-non-null-assertion (SWC syntax error in production build).

## Forward-looking items

- **Phase 5 (permalinks & SEO)** is unblocked. URL contract locked: `?gen=…&type=…&forms=…&algo=…&top=…&mode=…&preset=…`. canonicalKey-driven; aggregation-safe.
- **Phase 1.D (tag curation, parallel)** — populating `tags.yaml` enables 5 currently-dimmed presets (starters, pseudo-legendaries, ultra-beasts, paradox, fossils). The dim-with-tooltip UI is already in place; no Phase 4 follow-up needed.
- **Phase 4-expand (test-debt cleanup)** — UI components (FilterSidebar, PickerControls, Picker, DuelCard, ResultsList) ship without component-level tests. Engine tests transitively cover the hot paths; UI testing should land before Phase 7 aggregation depends on tournament behavior. Recommended: Playwright integration tests for the full picker flow.
- **ux-critic recommendation R-1 (deferred)** — algorithm dropdown could become a 3-radio group to surface comparison hints for non-selected algos at once. Pure cosmetic; not a Phase 4 blocker.
- **ux-critic recommendation R-2 (deferred)** — type badges include accessible labels but no icons. Visual polish for a later pass.
- **ux-critic recommendation R-3 (deferred)** — preset grid groups could collapse on mobile. Acceptable as-is at the current preset count.

## State of the codebase

- TS test suite: **161 passing** (filter 83, ranker 66, web 11).
- Go test suite: unchanged.
- `make all`: green.
- `make sync-validate`: 0 issues.
- Next.js production build: clean.
- Live picker URL contract: filter (Phase 2) + algo/top/mode (Phase 4) + preset slug. Self-contained, shareable.

## Aggregate verdict

**Approve.** Pokemon Ranker has shipped its first real product surface. The user's four MVP complaints — n×n tiring, 64-cap, Charmander-vs-Charmeleon, no game aspect — are all addressed concretely. Phase 5 (permalinks & SEO) and Phase 1.D (tag curation) are unblocked.
