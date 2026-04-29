# Code-reviewer review — Phase 4 (proper)

**Verdict.** **Approve with fixes.** No locked-decision violations. `make all`, `pnpm typecheck`, `pnpm lint`, all 150 TS tests, and `next build` are green. The picker is end-to-end functional. Two correctness issues warrant blocker tags (one state-staleness bug in `FilterSidebar`, one keyboard-handler scope leak in `DuelCard`); the rest is recommendations.

Tags: `[blocker]` · `[nit]` · `[praise]` · `[question]`.

## Spirit of the change

Phase 4 (proper) lands a clean separation of concerns: filter state in the URL (D-5), algorithm/topN/display mode also URL-encoded in a deliberately-separate `pickerOpts` namespace (correct — those aren't eligibility), and ranker state in `localStorage` keyed by preset-slug-or-canonicalKey + algo. The `Pokemon` rendering primitives (`TypeBadge`, `StatBlock`, `Sprite`) are small, reusable, and untouched by ranker concerns. `RANKER_INFO` drives the dropdown so a new algorithm is one constant away from being a UI option (D-3). The 64-cap drop with the algo-specific high-volume banner is a good UX answer to the user's "1300 comparisons is too tiring" complaint — soft warn, don't block. Glicko stop-early + keep-going are wired symmetrically. **[praise]** for `pickerOptsToParams` only emitting non-default params: that keeps the canonical URL short and aligned with `canonicalKey`'s "default values are absent" rule.

## ADR compliance

- D-1 (form identity): Pokemon shape unchanged. ✓
- D-3 (pluggable rankers): Picker uses `createRanker` / `restoreRanker` factories — never reaches into ranker internals. ✓
- D-5 (URL is source of truth): filter + algo + topN + mode all URL-encoded; refresh recovers state via the URL + `localStorage` ranker blob. ✓
- D-8 (Vibes/Informed): toggle present, persisted in URL (not localStorage — correct, it's part of the shared picker config). ✓
- D-19 ("picker," not "tournament"): page header is **"Favorite Pokémon Picker"**; CTA is "Start picking →"; results header is "Your ranking." Body text on `/` does say *"choose your tournament style"* — see [nit] below. Mostly compliant.
- D-22 (Next.js reads SQLite directly): `pick/page.tsx` uses `runtime = "nodejs"` and `dynamic = "force-dynamic"` correctly; `loadPokedex` is `"server-only"`. ✓
- D-24 (default form-inclusion = `final-evolutions-excluding-mega`): `FilterSidebar`'s select defaults to this when `draft.formInclusion` is undefined; `FORM_OPTIONS[0]` is the default (labeled "default"). ✓

## Blockers

### B-1 [blocker] FilterSidebar `draft` state goes stale on URL navigation

`FilterSidebar.tsx:70` initializes `const [draft, setDraft] = useState<Filter>(current);` from props, then never resyncs. Concrete failure mode:

1. User loads `/pick`, `draft` initializes to `{}`.
2. User toggles "gen-2" chip → `draft.generationIds = [2]` (local only — not yet navigated).
3. User clicks the **"Gen 1 favorites"** preset chip → `applyPreset("gen-1")` navigates to `?preset=gen-1`. Server re-renders, parent passes `current = {}` (preset path uses `filterForUI = {}` for composed presets, or the preset's flat spec for flat presets). **`draft` still holds `{ generationIds: [2] }`.**
4. User clicks **"Apply manual filter"** thinking they're refining the preset → pushes `?gen=2`, blowing away the preset, with the *stale* draft from step 2.

The same failure happens whenever the URL changes externally (browser back/forward, a preset highlight click on the home page that lands on `/pick?preset=gen-1`, etc.).

**Fix.** Resync `draft` to `current` whenever `current` changes (or, more conservatively, whenever the canonical key of `current` changes), e.g.:

```ts
const currentKey = canonicalKey(current);
useEffect(() => {
  setDraft(current);
}, [currentKey]);
```

Either flavor is fine; the key-based variant avoids re-rendering when the parent passes a structurally-equal-but-different-reference Filter.

### B-2 [blocker] DuelCard keyboard handler fires while sidebar buttons have focus

`DuelCard.tsx:33` ignores keys when `e.target` is `INPUT`/`TEXTAREA`/`SELECT` but **not** `BUTTON`. The sidebar has dozens of focusable `<button>`s (preset chips, type chips, gen chips, tri-toggles, advanced toggle). If the user tabs into the sidebar and presses Space (the natural way to activate a button via keyboard), Space both:

1. Activates the focused button (browser default), AND
2. Fires `e.preventDefault(); onPick("skip")` because the keydown bubbled to `window`.

Net effect: tabbing through the sidebar with Space silently skips duels. Same risk for ←/→ if any custom focusable elements steal arrow keys (none today, but the surface is broad).

**Fix.** Either narrow to "fire only when no focused element / focus is on document body":

```ts
if (document.activeElement && document.activeElement !== document.body) return;
```

or scope the listener to the duel container via a `ref` + `tabIndex={-1}` (preferred — it makes the keyboard contract explicit and survives future focusable elements added anywhere on the page).

This is also the right place to add `aria-keyshortcuts="ArrowLeft ArrowRight Space"` on the duel container so the shortcut is announced.

## Nits / recommendations

### N-1 [nit] Toggle/chip buttons lack `aria-pressed`

`FilterSidebar`'s preset/gen/type/tag/stage chips, `TriToggle`, `PickerControls`'s top-N and Display-mode chips, and the audio button all use color to convey on/off. Screen readers get no signal. Add `aria-pressed={active}` to each toggle button. Cheap; large a11y win. Same applies to the `details/summary` "Full ranking" disclosure (already accessible — that's fine).

### N-2 [nit] No `aria-live` on the duel transition

When the user submits a decision, the duel changes silently for screen-reader users — no announcement of the new pair. Wrap the duel area in `<div role="region" aria-live="polite" aria-label="Current duel">`, or place a visually-hidden `aria-live` region announcing "Now comparing Charizard vs Blastoise. Comparison N of M."

### N-3 [nit] D-19 vocabulary slip on `app/page.tsx`

Landing page body text reads *"Filter the field, choose your tournament style, and share your top."* D-19 reserves "tournament" for internal use only. Suggest *"choose your picking style"* or *"choose your ranking style."* Same ADR also recommends "ranking session," not "tournament," wherever possible.

### N-4 [nit] Sprite component issues `<img>` with `loading="lazy"` but no width/height

`Sprite.tsx` uses raw `<img>` (CLS-prone) and lazy-loads. The DuelCard hands it `className="h-48 w-48"` which gives layout, but the official-artwork URL won't be available immediately — there's a brief shifted layout while the URL resolves. Consider either:
- Preserving the sized box explicitly (`<img width={192} height={192} />`).
- Using `next/image` with `unoptimized` (since Vercel image optimization is off-limits per D-21 capacity discussion). The Lighthouse Phase-4 exit criterion is ≥90 — CLS regressions hurt.

(Not a blocker because the surrounding flex container has fixed height in practice.)

### N-5 [nit] Duel keyboard handler captures Space before browser default

`e.preventDefault()` on Space is intentional (to avoid scrolling the page) — good. But for users on screen readers, hitting Space on a focused card-button ALSO submits the duel, which doubles up: card-button's Space click fires `onPick("left_wins")` AND the global handler fires `onPick("skip")`. Same root as B-2. Fix is the same.

### N-6 [nit] `storageKey` collision risk between presets and equivalent manual filters

`Picker.tsx:41` keys local saves on `preset:gen-1` if a preset is active, otherwise on `canonicalKey(filter)`. Two URLs that resolve to the *same* eligibility set (e.g., `?preset=gen-1` and `?gen=1`) will have **different** localStorage entries. Resuming via the manual URL won't see the preset's progress and vice versa. Acceptable today (it's local cache, not a moat-affecting key) but worth a comment so a future reader knows. Phase 7 aggregation already correctly recomputes `canonicalKey` (per the comment in `filter/index.ts:447`).

### N-7 [nit] `Picker.tsx`'s useEffect dep on `candidates` re-runs the ranker on every navigation

Because `pick/page.tsx` is `force-dynamic` and `applyNode` returns a fresh array each render, `candidates` is a new reference per navigation. The useEffect at `Picker.tsx:50` re-runs every navigation, calling `restoreRanker` from localStorage. Functionally correct (state survives via the blob) but a small perf cost. If profiling later shows this matters, gate on `storageKey + candidates.length` or memoize candidates upstream.

### N-8 [nit] PickerControls' top-N / Display-mode / Audio buttons don't disable on `pending`

The `<select>` for algorithm gets `disabled={pending}` but the chip buttons don't. Rapid clicking queues router transitions. Not a correctness issue (last write wins) but inconsistent with the dropdown.

### N-9 [nit] `single-elim.ts` swap pattern

`packages/ranker/src/single-elim.ts:294-297` — the temp-swap (`const tmp = out[i]!; out[i] = out[j]!; out[j] = tmp;`) reads cleanly and matches the SWC compatibility ask. **[praise]** for documenting *why* (Phase 4 commit summary mentions "SWC syntax error"). Worth a one-line comment in the file too — drive-by readers won't know why we're not using destructuring here.

### N-10 [question] Why is the duel button's name announced via `<h3>` rather than `aria-label` on the button?

`DuelCard.tsx:119` — the `<button>` wraps a sprite `<img>` (alt = displayName), an `<h3>` (displayName again), types, gen, and stats. Screen readers will read all of that as the button's accessible name, which is verbose. An explicit `aria-label={pokemon.displayName}` on the button would be cleaner. Not blocking.

### N-11 [praise] HighVolumeBanner copy is genuinely helpful

`Picker.tsx:233-244` gives an algo-specific suggestion when N > 200 ("Switch to Anytime ratings (Glicko)…"). This is the kind of in-context teaching that keeps users from rage-quitting on a 1024-Pokémon mergesort. Good UX writing.

### N-12 [praise] `pickerOpts`/`Filter` namespace separation

Keeping algo/topN/mode out of `Filter` is the right call — those don't affect eligibility, so they don't enter `canonicalKey`, which keeps Phase 7 aggregation buckets clean. Future-proof.

## Tests

- TS suite: 150 passing (filter 83 + ranker 66 + web 1). ✓
- Build: `/pick` route is 12.7 kB First-Load JS, 118 kB total. ✓
- No new tests for the Phase-4 UI components themselves. **[question]** Is component-level testing in scope for Phase 4, or deferred to a Phase-4 polish iteration? At minimum, a few integration tests for `parsePickerOpts` round-trip and `pickerOptsToParams` would be cheap and catch URL-contract regressions early.

## Scope

The diff stays inside Phase 4 (proper) — UI assembly, rendering primitives, URL state for picker concerns, and one cross-cutting fix to `single-elim.ts` for SWC compat. No accidental schema or ranker math changes. ✓

## Summary

Approve subject to **B-1** (FilterSidebar draft staleness) and **B-2** (keyboard handler scope) being fixed before this is called Phase-4-complete. Both are small, isolated, and well-defined. After those, the nits are quality-of-life items the user can triage at leisure (most are accessibility cleanups that pay off in Phase 4.5 and beyond).
