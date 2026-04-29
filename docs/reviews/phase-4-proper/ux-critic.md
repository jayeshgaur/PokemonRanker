# ux-critic — Phase 4 (proper)

**Verdict:** Approve-with-blockers.

The four user complaints all land architecturally. Two real accessibility regressions and one share-URL gap need fixing before "ship". Several mobile-layout and microcopy nits are recommended improvements, not blockers.

## Pass/fail on the four user complaints

1. **"1300 comparisons / n×n is tiring"** — Pass. `PickerControls.tsx:54-69` gives three algorithms with live `comparisonsHint(n)` text, and Glicko has a "Stop & show ranking" affordance in the progress bar (`DuelCard.tsx:178-187`). For 1300 candidates Glicko is one click away. Single-elim's `n−1` is shown next to the name in the dropdown context.
2. **"Limit of 64 is sad"** — Pass. The 64-cap is gone; the soft warning at >200 (`Picker.tsx:233-244`) is well-pitched per algorithm and stays informational, not blocking.
3. **"Charmander vs Charmeleon"** — Pass. `FilterSidebar.tsx:42-43` and `applyNode` defaulting at the engine level mean a fresh `/pick` shows only final evos excluding Mega/GMax (D-24). The form-inclusion select labels the default explicitly.
4. **"No game aspect"** — Pass on substance. Vibes/Informed toggle is present (`PickerControls.tsx:91-116`), `←/→/space` keyboard works (`DuelCard.tsx:32-57`), audio-on-hover is one click in (`PickerScreen.tsx:35-43`), and the podium has gold/silver/bronze with a glow on first (`ResultsList.tsx:88-148`). Feels like a game.

## Blockers

**B-1 — `←` and `→` arrow keys do not announce themselves to screen readers, and the duel cards are `<button>` elements with no `aria-keyshortcuts`.** The visual hint "Press ←" only exists on hover (`DuelCard.tsx:155-157`). Add `aria-keyshortcuts="ArrowLeft"` / `"ArrowRight"` to each card button and an `aria-label` like "Pick Pikachu (left arrow)". Also the hint text disappears unless mouse-hovered — a touch user on iPad will never know the keys exist. Move the "← / →" hint to be persistently visible (small monospace below the name) or render it only at `lg:` breakpoints.

**B-2 — Keyboard focus on the duel cards is invisible.** The cards have `hover:` state styles but no `focus-visible:` ring. Tab into the duel screen and you cannot tell which card is focused. WCAG 2.4.7. Add `focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950` to the `Card` button (`DuelCard.tsx:128`). Same fix needed on every chip / preset button in `FilterSidebar.tsx` and `PickerControls.tsx`.

**B-3 — Share URL is not self-contained when a Glicko run was stopped early or a merge-sort partial is shown.** `ShareButton.copy()` (`ResultsList.tsx:188-209`) copies `window.location.href`, which encodes the *filter* and *picker opts* but not the in-progress ranker state. A user who stopped Glicko at 47 comparisons and shares the link gets a recipient who starts a fresh run. D-5 says URL is the source of truth and ranker state is URL-encodable. Either: (a) on share, append a compact `?state=<base64>` of `ranker.serialize()`, or (b) explicitly relabel the button "Share this picker setup (results not included)" so users know what they're sharing. Today's copy claims more than it delivers.

**B-4 — Type badges fail color-blind test.** `TypeBadge` (`pokemon/TypeBadge.tsx:8-23`) uses background color + text label — but the text is the type *name only*. For a deuteranope, `Fire (red)` and `Fighting (orange)` and `Psychic (pink)` are visually similar. The text label rescues the comprehension, but the *aesthetic* badges look identical when stacked. The `ux-critic.md` rule "color is never the sole carrier of meaning" is technically met (label is there), but a small type icon (a flame, a fist, a swirl) per type would lift this from "passes WCAG" to "feels right". Recommendation, not a hard blocker — call this Nit-with-prejudice if you'd rather defer.

## Nits

- **Algorithm dropdown is a native `<select>` with one short hint line.** The hint only appears below the dropdown for the *currently-selected* algo; the user has no way to compare the three before picking. A radio group with all three names + comparison counts visible at once would be more discoverable, especially because the algorithm choice is the headline Phase 4 feature. (`PickerControls.tsx:54-70`)
- **35 presets in the sidebar grid is dense.** `PRESET_GROUPS` (FilterSidebar.tsx:32-40) has 7 groups, but at 280px sidebar width on `lg:` they wrap unpredictably. Consider a collapsible per-group `<details>` with the most-used groups (Per-Generation, By Type) open by default. The "Tag-based (needs tags.yaml)" group dimming is well-done; keep that pattern.
- **Mobile breakpoint coverage is thin.** The codebase only uses `lg:` and one `sm:` (homepage). `/pick` collapses to single column below `lg`, but FilterSidebar at full width on a 375px phone is a wall of chips. Consider hiding the sidebar behind a "Filters" disclosure on `<lg` breakpoints. The `DuelCard` itself goes single-column at `<sm` — that's correct.
- **Vibes-mode microcopy "Vibes mode — pick on looks alone."** appears under each card. Once you've read it twice you stop reading. Move it to a single banner above the duel grid in vibes mode.
- **Audio toggle uses emoji 🔊 / 🔇.** Functional but inconsistent with the rest of the app's no-emoji vibe. Consider a labeled toggle ("Cry on hover: On / Off"). Trivial.
- **`<details>` for full-ranking tail is correct, but the summary "Full ranking (positions 4–N)" hardcodes 4.** It's `topN + 1`. Verified: `ResultsList.tsx:54` does this right — withdrawn nit.
- **`lg:` is reasonable for desktop-vs-mobile, but the Picker grid `sm:grid-cols-2` (DuelCard.tsx:62) means at 640–1023px (tablet) you get the duel side-by-side but the FilterSidebar above it.** That's the right call.
- **Empty state is one line: "No Pokémon match this filter. Try a different preset on the left."** (`Picker.tsx:128-131`) Solid. Consider linking to the most-permissive preset.
- **localStorage-disabled path:** every `try/catch` swallows silently — correct behavior. The user gets a working in-memory run with no persistence. No SSR crash. Good.

## Praise

- The `Sprite` fallback (`Sprite.tsx:11-22`) — error-state with a "?" badge instead of broken-image icon. Small detail, ships polish.
- The `B-1` (sidebar draft sync) and `B-2` (Space-key double-fire guard) fixes from the prior code-reviewer pass are visible in the comments — the inline rationale (`FilterSidebar.tsx:75-85`, `DuelCard.tsx:34-43`) makes the code self-explaining.
- The "Stop & show ranking" + "Keep going (refine)" pair for Glicko (`Picker.tsx:115-124`, `ResultsList.tsx:67-75`) closes the loop on user complaint #1 elegantly. The `setTargetComparisons(done + 5×n)` heuristic is sensible.
- Podium tone (`#FFD700` / `#C0C0C0` / `#CD7F32`) + first-place gold glow is the right amount of celebration without being garish.
- `RANKER_INFO[].comparisonsHint(n)` per-algorithm copy is excellent — it's exactly what a user choosing between algos needs, with no jargon.
