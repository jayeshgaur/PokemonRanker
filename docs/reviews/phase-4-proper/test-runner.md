# Phase 4 (proper) — test-runner review

**Date.** 2026-04-29
**Agent.** test-runner
**Scope.** Verify the test suite from a fresh state and critique Phase 4 (UI MVP) test coverage.
**Verdict.** **Approve-with-reservation.** All three commands are green; no flakes across three back-to-back runs. The reservation is exclusively about coverage of the new UI surface: Phase 4 shipped ~900 lines of new TS across 8 components + 2 lib modules, and the only TS test in `apps/web` is still the 1-case `sanity.test.ts`. The headline contracts (filter / ranker engines) are well-tested, and they transitively exercise the *engine* hot paths the UI calls into. The UI's own logic — URL-state encoding, keyboard handlers, localStorage persistence, podium slicing, Vibes/Informed branching — is currently untested except through manual click-through. None of this rises to a blocker for declaring Phase 4 (proper) complete (the UI works, the engines under it are well-tested, the production build passes), but it is exactly the kind of gap that lets a regression land green in Phase 4.5+ when this surface starts moving.

---

## Run results

### 1. `make all`

- **Exit 0.** Wall: ~9.6 s.
- Go vet — clean.
- golangci-lint — `0 issues.`
- Go tests — `ok` for `internal/pokedex` and `internal/pokedex/ingest` (cached). No test files for `cmd/pokedex-sync` (unchanged from Phase 3).
- pnpm typecheck — 4 workspaces clean (shared, filter, ranker, web).
- pnpm lint — 4 workspaces clean. `apps/web` again emits the Next.js 16 deprecation note for `next lint` — pre-existing, not introduced this gate.
- pnpm test:
  - `packages/shared` — no test files (passWithNoTests).
  - `packages/filter` — 83 tests passed (composition 11, apply 49, presets 23). Unchanged.
  - `packages/ranker` — **66 tests passed** (mergesort 11, glicko-random 25, single-elim 16, factory 14). Up from 60 in Phase 3 — six new tests landed since the Phase 3 gate (mostly in glicko-random and single-elim, presumably absorbing the recommendations from the Phase 3 test-runner review).
  - `apps/web` — 1 test passed (`sanity.test.ts`). **Unchanged from Phase 3.**

TS total: 150 tests. Plus Go suite (cached, two packages green).

### 2. `pnpm -C apps/web build`

- **Exit 0.** Compiled in ~823 ms; static page generation clean.
- Routes:
  - `/` → static, 163 B / 105 kB First Load.
  - `/_not-found` → static, 990 B / 102 kB.
  - `/pick` → **dynamic, 12.7 kB / 118 kB First Load** (was 5.25 kB / 110 kB at the Phase 3 gate).
- The `/pick` route grew ~7.5 kB JS — consistent with the new picker components (FilterSidebar, PickerControls, DuelCard, ResultsList, PickerScreen, Picker, plus Sprite/TypeBadge/StatBlock). No code-split issues; First Load JS still under 120 kB. The `/pick` page is correctly marked `(Dynamic)` (`dynamic = "force-dynamic"` in `apps/web/app/pick/page.tsx:18`) since it reads SQLite at request time.

### 3. `make sync-validate`

- **Exit 0.** `validate: 0 issues — all checks passed`. The 16-check Pokédex validate suite is satisfied against the current SQLite snapshot.

### Flake check

Re-ran `pnpm -r test` three consecutive times (lines 1–3 of the run timeline). Each: 66 ranker / 83 filter / 1 web tests pass. Durations within ±1 ms per file. **No flake observed.**

The pre-existing reservation about `mergesort.test.ts` using `Math.random()` without a seed (logged in the Phase 3 test-runner review, item #6) is still present — not a regression introduced by Phase 4, still worth fixing opportunistically.

---

## Coverage critique — Phase 4 surface

The new UI surface has no direct unit-test coverage. Where the engines are well-tested, the UI's path through them is exercised transitively; where the UI has its own logic (URL parsing, keyboard handlers, persistence, conditional rendering, accessibility wiring), it is currently exercised only by manual click-through.

### `apps/web/lib/url-state.ts` — **highest-value gap**

Pure-function module with three exports (`parsePickerOpts`, `pickerOptsToParams`, `DEFAULT_PICKER_OPTS`). Untested. This is the most testable file in the Phase 4 batch — node-environment vitest, no React, no DOM — and it is also the file most likely to break the URL contract that D-5 ("URL is source of truth") and Phase 5 (permalinks) depend on.

**Untested paths most likely to hide a regression.**

1. **Validation against `RankerKind`.** `parsePickerOpts` reads `algo` from the query string and tests membership in `VALID_ALGOS = new Set(["merge-sort", "single-elim", "glicko-random"])` (`url-state.ts:21-25`). If a future ADR adds a fourth ranker (e.g., `"swiss"`), the set must be updated — but a stale set silently coerces the new ranker back to the default. A test that imports `RANKER_INFO` and asserts `RANKER_INFO.every(i => parsePickerOpts(new URLSearchParams("algo=" + i.kind)).algo === i.kind)` would catch this drift at test time instead of at user time.
2. **Top-N parsing edge cases.** `topRaw = "5"` → 5; `"5.7"` → `parseInt` returns 5 (allowed); `"5abc"` → 5; `""` → NaN → default; `"50"` → not in `VALID_TOP_N` → default. Currently relies on inspection. A test sweep of `["1", "3", "5", "10", "0", "-1", "100", "abc", ""]` would lock the contract.
3. **Multi-value query params.** `parsePickerOpts` accepts both `URLSearchParams` and `Record<string, string | string[]>` (Next.js `searchParams` shape). The array branch (`Array.isArray(raw) ? raw[0] : raw`) is reachable from `app/pick/page.tsx:25` if a user hand-crafts `?algo=foo&algo=bar`. Untested. A regression that flips to `raw[raw.length - 1]` would not be caught.
4. **`pickerOptsToParams` round-trip.** The function only writes non-default values. `parsePickerOpts(pickerOptsToParams(opts, new URLSearchParams())) === opts` should hold for any opts. Untested. This is the property that keeps shareable URLs canonical (no `?algo=merge-sort&top=5&mode=informed` polluting the share button output).
5. **Mode coercion.** The line `mode: modeRaw === "vibes" ? "vibes" : DEFAULT_PICKER_OPTS.mode` (`url-state.ts:51-52`) is asymmetric — it explicitly opts in to `"vibes"` but accepts anything else as `"informed"`. If the future adds a third mode (e.g., `"competitive"`), the read path silently maps it to `"informed"`. This is intentional defensive code; one test asserting the bad-input fallback would document the intent.

**Recommendation (severity: medium).** A 30-line `__tests__/url-state.test.ts` would lock the parse / serialize contract before Phase 5 (permalinks) starts shipping URL-shape changes. This is the easiest test to add in the entire Phase 4 surface and arguably the highest leverage.

### `apps/web/lib/types.ts` — `typeStyle` fallback

Trivial table lookup with one fallback branch (`typeStyle("foo") === { bg: "#888", text: "#fff", label: "foo" }`). Untested. Low risk — the Pokédex sync emits a fixed type vocabulary, so the fallback is dead code in practice. But it is a *user-visible* dead code path: if the SQLite emits a new type slug (e.g., the next-gen "stellar" did appear, listed at `types.ts:30`), the fallback decides whether the user sees a black "???" pill or the new slug name. Worth one tiny test asserting both the lookup hit and the fallback shape.

### Components — 8 files, 0 unit tests

All 8 Phase 4 components rely on behavior that is currently asserted only by manual click-through. The web workspace has no DOM testing infrastructure (`vitest.config.ts:5` sets `environment: "node"`; no `@testing-library/react`, `jsdom`, or `happy-dom` in `package.json`). Adding any UI test today is a per-PR cost: one decision (jsdom vs happy-dom + `@testing-library/react`) plus the per-test setup. None of the gaps below are blockers, but they are the regressions most likely to land silently.

#### `DuelCard.tsx` — keyboard handler is the highest-risk untested path

`DuelCard` is the "hot path" the user spends 95% of their time on. Three behaviors with no test:

1. **Keyboard handler input-element guard.** `DuelCard.tsx:33-39` skips the handler if the event target is an `HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement`. This is the only thing standing between the user typing in a future filter input and accidentally voting. A regression that drops the guard (e.g., refactor to `useReducer` and forgets) would be invisible until a user complains. **Recommendation:** one jsdom test mounting `<DuelCard>` and dispatching `keydown ArrowLeft` from inside an `<input>` — assert `onPick` was *not* called.
2. **Key-decision mapping.** `ArrowLeft → left_wins`, `ArrowRight → right_wins`, `Space → skip`. Each is a one-liner. A flipped pair (`ArrowRight → left_wins`) would not be caught.
3. **Listener cleanup.** `useEffect` returns a `removeEventListener` cleanup. If a refactor drops the cleanup, the listener leaks across remounts and the user gets multi-counted keypresses. Standard React 18 strict-mode test would catch this.
4. **Cry audio fail-silent.** `Card.playCry` (`DuelCard.tsx:106-116`) wraps `audioRef.current.play()` in `.catch(() => {})` to swallow autoplay-policy rejections and load failures. Untested. A regression that surfaces the rejection (e.g., `.catch(throw)` mistake) would crash the duel screen on any browser with strict autoplay. The fail-silent contract is load-bearing.

#### `Picker.tsx` — localStorage persistence + early-stop branching

The state-machine logic in `Picker.tsx` is the most complex untested code in Phase 4:

1. **localStorage round-trip.** `Picker.tsx:50-65` reads a saved snapshot and calls `restoreRanker`; on `restore` failure (corrupt JSON, removed Pokemon from pool), it falls back to `createRanker`. The fallback path is the user's safety net against a Pokédex sync that drops a competitor mid-run. Untested. **Recommendation:** mock `window.localStorage` and assert the fallback fires when `restoreRanker` throws.
2. **Storage-key composition.** `STORAGE_PREFIX:preset:${slug}:${algo}` vs `STORAGE_PREFIX:${canonicalKey(filter)}:${algo}` (line 41-45). A user who runs "Gen 1 Water" via the preset chip and again via the manual filter gets two separate persisted runs. This is the deliberate design (preset slug stable; manual filter canonical-key stable). A regression that uses `JSON.stringify(filter)` instead of `canonicalKey(filter)` would fragment storage by field-order. Untested.
3. **Early-stop / keep-going gating.** Lines 105-124 gate `stopEarly` and `keepGoing` to `GlickoRandomRanker`. If a future ranker exposes `stopEarly()` without being a Glicko subclass, the gate misses it. The `algo === "glicko-random"` check in `Picker.tsx:157, 176, 204` is also a parallel gate (in case `instanceof` and the algo string ever disagree). Untested.
4. **Empty-pool early return.** Line 126-132 renders a "no matches" panel when `candidates.length === 0`. Reachable from FilterSidebar combinations. Untested.
5. **High-volume banner.** Line 233-244: shown when `candidates.length > 200`. The thresholds are magic numbers; a regression that bumps to `>= 200` or `> 2000` would silently drop a user-facing warning. Untested.

#### `ResultsList.tsx` — podium slicing + share button

1. **Podium / tail split.** `ranking.ordered.slice(0, topN)` + `ranking.ordered.slice(topN)` (lines 30-31) for `topN ∈ {1, 3, 5, 10}`. A ranking of 8 with `topN=10` should show 8 in the podium and an empty tail (the `tail.length > 0` guard handles this — line 51). Untested. A regression that uses `slice(0, topN-1)` would silently lose the #N entry.
2. **Podium tone array.** `PODIUM_TONE = ["#FFD700", "#C0C0C0", "#CD7F32"]` (line 95). Indexing past 2 falls through to the `idx < 3` ternary on every styled property. A regression that drops the guard to `idx <= 3` would crash on `topN === 5` (out-of-bounds returning `undefined` for the boxShadow check). Untested but defensively coded.
3. **Pokedex DB link conditional.** Lines 135-144 / 174-183: only render if `item.pokemon.pokedexDbUrl`. Schema-guardian's contract for this field matters; any pool with one entry missing the URL should still render the row. Untested.
4. **Share button copy fail-silent.** `ShareButton.copy` (line 188-208) is gated on `navigator.clipboard` and resolves the promise into a 2-second "Copied!" toast. If `clipboard.writeText` rejects (denied permission, insecure context), the catch is *missing* — a rejected promise will surface as an unhandled rejection. **This is a small bug, not just a coverage gap.** Compare to `DuelCard.playCry` which uses `.catch(() => {})`.
5. **Server-render guard.** `typeof navigator === "undefined"` early-return (line 191) protects SSR. The component is a client component (`"use client"` at top), so SSR shouldn't hit this — but Next 15 still runs the server component pass. Untested.

#### `FilterSidebar.tsx` — preset wiring + tri-state toggle

1. **Tri-state toggle cycle.** `TriToggle.next()` cycles `undefined → true → false → undefined` (lines 422-426). One unit test would lock the cycle direction. A regression that goes `undefined → false → true → undefined` would silently invert the user's "is Legendary" filter.
2. **Preset chip dim-on-missing-tags.** `dim = p.requiresTags && !hasTags` (line 153). A preset that requires tags is rendered as a disabled, low-contrast chip. The `disabled={dim}` HTML attribute is set, but the visual contrast (`text-neutral-600` vs the active gradient) is the only signal. **Accessibility note:** the disabled chips have a `title` tooltip but no `aria-disabled` or `aria-describedby`. Screen-reader users hit a button that does nothing with no audible explanation. Logged below.
3. **`navigate()` URL composition.** `pickerOptsToParams(pickerOpts, params)` mutates the params object. If `pickerOpts` somehow becomes stale, the user navigates to a URL that strips their algo/topN/mode. Untested. The `useTransition` wrapping means a stale read here is hard to debug from logs.
4. **`applyDraft` strips preset slug.** Calling `applyDraft` with a draft that's identical to a preset's spec should arguably re-attach the preset slug (so the user's URL stays clean and the "Active preset" pill stays visible). Currently it always navigates to the explicit-fields URL. This is a UX choice, not a bug, but it is undocumented in tests. Untested.

#### `PickerControls.tsx`, `PickerScreen.tsx`, `Sprite.tsx`, `TypeBadge.tsx`, `StatBlock.tsx`

Mostly thin presentation. The interesting bits:

1. **`PickerControls.setParam` writes-or-deletes on default.** Lines 33-40 / 42-50: writing the default value strips the key from the URL — the canonical-URL invariant. Untested. This is the same canonical-URL property as `pickerOptsToParams` round-trip; one test for both would suffice.
2. **`PickerScreen` audio-on-load.** Reads `localStorage["pokemon-ranker:audio"]` once on mount (lines 27-33). If localStorage throws (Safari private mode, storage quota), the catch silently leaves audio off. Correct behavior; untested.
3. **`Sprite` error fallback.** `<img onError={() => setErrored(true)}>` swap-out. A broken sprite URL becomes a "?" placeholder. Untested. This is the user-visible signal that the Pokédex sync produced a row with a stale URL — the kind of thing schema-guardian should catch in the SQLite, but the UI's belt-and-suspenders matters.
4. **`StatBlock.statColor` thresholds.** Lines 19-25: 130 / 100 / 70 / 50 cutoffs. A regression that flips to `>` instead of `>=` would shift one bar's color at exactly each threshold. Cosmetic, but a tiny snapshot or color-table test would lock the bands.

### Accessibility-test gaps

No automated a11y testing exists in the web workspace. Phase 4 has multiple a11y-relevant choices that could regress silently:

1. **`TypeBadge` aria-label.** Line 19 sets `aria-label="${style.label} type"` — good. No test.
2. **`Sprite` no-image fallback.** Line 18 uses `aria-label="(no sprite available)"` on a `<div>` — borderline (aria-label on non-interactive non-landmark elements has spotty SR support). Untested.
3. **`StatBlock` bar bars are `aria-hidden="true"`** (line 41) but the numeric value is not visually associated with the label. Each row is a 3-column grid; SR users get "HP 80 [hidden]" — fine. Untested.
4. **`DuelCard` keyboard hints.** Each card shows "Press ←" / "Press →" visually. The `<button>` itself has no `aria-keyshortcuts`. SR users won't know about the keyboard alternative. Untested. The "Can't decide (space)" / "Tie" / "Reset run" buttons have label-only affordances.
5. **`FilterSidebar` disabled preset chips.** As noted: `disabled` HTML, no `aria-describedby` to surface the "needs tags.yaml" reason audibly. SR users tab to a button that does nothing.
6. **No focus-management around Apply / Reset.** After `applyDraft`, focus stays on the button; the new candidate count is announced via DOM mutation but not via `aria-live`. SR users may not notice that the eligible count changed.

A single Playwright + axe-core run on the `/pick` page would surface most of these. None blocks Phase 4 acceptance, but Phase 4.5 (chat agent) and Phase 5 (permalinks → SEO landing pages) both raise the a11y bar — these are cheaper to fix now than after Phase 5 expands the surface.

### Engine tests — do they transitively cover the UI's hot paths?

Mostly yes, partially no.

**Yes (transitive coverage holds).**

- `Ranker.nextDuel`, `submit`, `progress`, `isDone`, `result`, `currentResult`, `serialize` are exhaustively tested in `packages/ranker`. The UI calls into all of these without modification, so any UI test that asserts "the duel screen shows a duel after the user clicks one card" would only re-test a contract the engine already locks.
- `Filter.apply` and `parseFilter` / `toSearchParams` are exhaustively tested in `packages/filter`. The sidebar's URL writes feed into `parseFilter` on the server side, which is well-tested.

**No (the UI adds logic the engine tests can't reach).**

- **`canonicalKey(filter)` for storage-key composition.** Tested in `packages/filter`, but its specific use as a localStorage key prefix in `Picker.tsx:43` is a UI-side contract. The contract is "two URL-equivalent filters share storage." A regression in `canonicalKey` would be caught by filter tests, but a regression in *how Picker uses it* (e.g., concatenating `JSON.stringify(filter)` instead) wouldn't be.
- **Snapshot round-trip after Pokédex sync changes the pool.** `restoreRanker` is tested in `packages/ranker` for round-trip identity. The Phase-4 use case — restore from yesterday's localStorage after today's sync removed a competitor — is `restoreRanker` throwing, and `Picker.tsx:55-63` catching and falling back to a fresh ranker. This try/catch is the *user's resume-after-Pokédex-update path*, and it has zero test coverage. The engine raises the right exception; the UI's fallback is implicit-only.
- **`GlickoRandomRanker.setTargetComparisons` extension math.** `Picker.tsx:115-124` chooses `done + Math.max(5, candidates.length * 3)` as the new target. This UI-level arithmetic is undocumented and untested. If a regression makes it `done + 5` for a 200-Pokemon pool, the user clicks Keep Going and lands back on the results screen 5 comparisons later. The engine accepts whatever target it's given.

---

## Wrong-reason / unrealistic-fixture sweep

The Phase 4 surface has no fixtures yet (no UI tests). When fixtures land, the things to watch:

- **Pokemon fixtures should include both `officialArtworkUrl` and `spriteUrl`** — `Sprite.tsx:11` and the duel/results components fall back from artwork to sprite. A fixture with only one set would mask the fallback path.
- **Pokemon fixtures should include `pokedexDbUrl`** for some entries and omit it for others — both branches in `ResultsList.tsx:135` and `:174` need to be exercised.
- **Pokemon fixtures should include `cryUrl`** for the audio-enabled hover test, and at least one entry without it for the "no cry available" no-op path (`DuelCard.tsx:107`).
- **Fixtures with `displayName` containing hyphens** (e.g., `"mr-mime"`, `"ho-oh"`) should appear so the `replace(/-/g, " ")` formatting in `DuelCard.tsx:132` and `ResultsList.tsx:124, 164` is exercised.

---

## Summary of recommendations (priority-ordered)

| # | Owner | Severity | Item |
|---|-------|----------|------|
| 1 | code-reviewer / ux-critic | medium | `lib/url-state.ts` — add a 30-line vitest covering `parsePickerOpts` (validation, defaults, multi-value params) and the `pickerOptsToParams` round-trip. Highest leverage in Phase 4. |
| 2 | ux-critic | medium | `ResultsList.ShareButton.copy` is missing a `.catch` on `clipboard.writeText`. Compare to `DuelCard.playCry`'s fail-silent pattern. Small bug, not just a coverage gap. |
| 3 | ux-critic | medium | Add jsdom + `@testing-library/react` to `apps/web` and write at least: (a) `DuelCard` keyboard handler test (input-element guard + key-to-decision mapping), (b) `Picker` localStorage fallback test (corrupt snapshot → fresh ranker), (c) `FilterSidebar` TriToggle cycle test. |
| 4 | ux-critic | low | Disabled preset chips in `FilterSidebar` need `aria-disabled` and an audible reason for SR users. |
| 5 | ux-critic | low | `DuelCard` cards should expose `aria-keyshortcuts` so SR users learn the ←/→/space affordance. |
| 6 | ux-critic | low | Add focus management / `aria-live` on the eligible-count display so filter changes are announced. |
| 7 | code-reviewer | low | `lib/types.ts` `typeStyle` fallback — one tiny test (table hit + unknown-slug fallback). |
| 8 | code-reviewer | low | `PickerControls.setParam` "default-strip" behavior should be locked by test (URL canonicalization invariant). |
| 9 | ranker-mathematician (deferred) | low | Document and lock the `setTargetComparisons` extension formula (`done + max(5, n*3)`) in a Picker-level test. |
| 10 | code-reviewer (informational) | trivial | The Phase 3 `Math.random` PRNG seeding nit is still open; the Next.js 16 `next lint` deprecation is still open. Neither is a Phase 4 regression. |

---

## Verdict

**Approve-with-reservation.** Phase 4 (proper) ships green: `make all`, `pnpm -C apps/web build`, and `make sync-validate` are all clean; the production bundle is reasonable (`/pick` at 12.7 kB / 118 kB First Load); three back-to-back full runs show no flake; the engine tests under the UI are robust and grew six new cases since Phase 3. The reservation is purely about *new* coverage: the UI itself is untested, the URL-state helper is untested, and the keyboard / localStorage / share-button paths that distinguish a polished tournament UI from a working-but-fragile one are exercised only by manual click-through. Item #2 above (the missing `.catch` on `clipboard.writeText`) is a small bug, not just a coverage gap, and is worth a one-line fix in this gate's blockers-cleared pass.

None of the gaps block calling Phase 4 (proper) complete. They do define the test-debt Phase 5 will inherit; getting `lib/url-state.ts` under test before Phase 5 starts shipping URL-shape changes is the single highest-leverage follow-up.
