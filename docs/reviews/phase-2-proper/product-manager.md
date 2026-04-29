# Phase 2 (proper) — product-manager review

**Date.** 2026-04-28
**Scope.** User-facing decisions encoded in `packages/filter/src/{index,composition,presets}.ts`, the new `Filter` shape, the 31-preset library, the URL/canonicalKey scheme, and the open questions tagged Phase 2 in `OPEN_QUESTIONS.md`.
**Mode.** Adversarial. The prior MVP slice was over-truncated and the user explicitly complained about UX gaps that the implementation gate failed to surface. I will not undershoot a second time.
**Verdict.** **APPROVE WITH BLOCKERS.** The shape is right and the URL contract is sound. But the preset list has gaps that real fans will notice immediately, and two open questions need to be locked in this gate, not punted to Phase 4.

---

## TL;DR for the human

- Lock `final-evolutions-excluding-mega` as the default form-inclusion as **D-24**. The `OPEN_QUESTIONS.md` "probably" should not survive into Phase 4 — Phase 4's UI defaults depend on it being settled.
- The 31-preset list is broadly the right shape but has **four real gaps** I would fix before the gate closes (Eeveelutions, single-stage-only, all-starters-final-only, mono-type-per-gen for at minimum Gen 1 fire/water/grass/electric). Two cosmetic problems too (`bst-600-club` is mis-named, `kanto-fire/water/grass` excludes Electric — that's the lightning rod for "you forgot Pikachu types").
- Do **not** expose `NOT` in the v1 picker UI. The engine has it; that is sufficient for power users via URL editing and for the agent. Adding it to chips will hurt the "casual fan in 30 seconds" funnel.
- The URL scheme is good enough for Phase 7 aggregation **except for one collision case** I document below — fix before Phase 6 ships, not urgent for Phase 4.
- Phase 3 is unblocked. Filter → competitor list → ranker chain is clean.

---

## Question 1 — Are the 31 presets the right 31?

### Observed user need

I checked three signal sources before opining (per agent role-brief): r/pokemon top-of-all-time tier-list threads, PokemonDB's own filter chips on `pokemondb.net/pokedex/national`, and the structure of the 52,000-respondent Reddit favorite-Pokémon survey called out in PRIOR_ART.md. What casual fans repeatedly ask for, in roughly this order:

1. **Per-generation favorites** (✅ shipped — 9 presets)
2. **Per-type favorites, mono-type** ("best Fire-type ever", "best Water-type") (⚠️ shipped only as `dragons / ghosts / psychics` and `kanto-fire/water/grass` — see gap A below)
3. **Starter favorites, final-evolution-only** ("best final-form starter") (⚠️ partial — `starters` ships with all stages; the casual ask is for final-stage)
4. **Eeveelutions** ("which Eevee is your favorite?") (❌ missing — gap B)
5. **Pseudo-legendary tier** (✅ shipped)
6. **Legendary / Mythical** (✅ shipped)
7. **Mega-only** (✅ shipped)
8. **Single-stage standalones** ("best non-evolving Pokémon" — Lapras, Tauros, Aerodactyl, Skarmory, Druddigon, etc.) (❌ missing — gap C)
9. **600+ BST club** (✅ shipped — `bst-600-club` and `high-bst`, but the naming is wrong — see cosmetic A)
10. **Casual easy-mode** ("just Gen 1 final evolutions, ~50 Pokémon") (✅ effectively shipped via `gen-1` × default form inclusion = ~80 rows. Adequate.)

### Current design

31 presets across 7 categories: per-gen (9), Kanto type (3), status (4), form-inclusion (5), type (3), BST (2), tag (5).

### Risks

**Gap A — mono-type-per-gen is under-served.** "Best Gen 1 Electric type" is the canonical "where's Pikachu's family" tournament. We ship Fire/Water/Grass for Kanto only. Two failure modes:

1. A fan looking for "best Gen 1 Electric" sees Fire/Water/Grass and concludes the site forgot Electric exists. That's the headline complaint the MVP gate missed: surfaces that look like they were truncated mid-thought *erode trust faster than missing entire features*. A user who sees "Kanto Fire" + "Kanto Water" + "Kanto Grass" expects parity, not three of seventeen types.
2. The 9 generations × 3 types Kanto pattern says "we'll get to per-gen-per-type later" — but PHASE 4 is the UI phase and there is no plan to expand presets there. So this is the moment.

**Gap B — Eeveelutions.** This is *the* iconic Pokémon comparison. Every fan has an Eevee opinion. The current preset list has zero way to summon "the eight Eeveelutions." A user who wants to rank Eeveelutions has to know `vaporeon, jolteon, flareon, espeon, umbreon, leafeon, glaceon, sylveon` and either type them in or NOT have a UI path. This is by far the most-requested ranking in fan communities and we have no preset for it.

**Gap C — Single-stage finals.** "Lapras, Tauros, Snorlax, Aerodactyl, Mewtwo, Mew, Skarmory, Druddigon, …" — single-stage Pokémon are a real fan category (people compare them as "the standalone tier"). Schema supports this trivially: `evolutionStage === "final"` AND no parent. Worth one preset.

**Gap D — All-starters-final-only.** `starters` preset is `tagSlugs: ["starter"]` + `default-forms-only` form mode. That returns Bulbasaur AND Ivysaur AND Venusaur (all three stages). The casual ask is "the 27 final-form starters" (Venusaur, Charizard, Blastoise, …). Right now you get 81 rows. Add a `starters-final-only` preset.

**Cosmetic A — `bst-600-club` mis-named.** The preset slug says "600 BST Club" but the description says "≥ 600, < 680" — this is *not* the 600 BST Club. The 600 BST Club is exactly the pseudo-legendary tier (BST = 600 by tradition). We already have `pseudo-legendaries` for that. The current preset is "non-legendary high BST," which is interesting but the name lies. Either rename to `bst-600-679` / "Strong non-legendaries (600–679 BST)" or replace it with `bst-exactly-600` for the pseudo-shaped competitors.

**Cosmetic B — `kanto-fire/water/grass` excludes Electric.** See gap A.

**Cosmetic C — `requiresTags: true` presets render but produce 0 results until 1.D.** This is fine in code but in UI (Phase 4) those presets need a clear "tag data not loaded yet — run `make sync-from-clone`" tooltip or they will appear broken to the user.

### Proposed alternative

Add **5 presets**, rename **2**, total goes from 31 to 36:

```ts
// New typed-per-gen-1 (closes gap A)
{ slug: "kanto-electric", spec: { generationIds: [1], typeSlugs: ["electric"] } },
{ slug: "kanto-psychic",  spec: { generationIds: [1], typeSlugs: ["psychic"] } },
// (decide whether to also add ground/rock/normal/fighting; my call: stop at
//  the four "iconic-elemental-mascot" types — fire/water/grass/electric. If
//  the ask grows we generate per-gen-per-type at compile time later.)

// Eeveelutions (closes gap B). Best modeled as a tag, not a slug list —
// requires a new `eeveelution` tag in tags.yaml, populated in 1.D.
{ slug: "eeveelutions", spec: { tagSlugs: ["eeveelution"] }, requiresTags: true },

// Single-stage finals (closes gap C)
{ slug: "single-stage",
  spec: { evolutionStages: ["final"], formInclusion: "default-forms-only", /* and tag exclusion of pre-evos */ } },
// Note: this needs a small data-model assist — currently `evolutionStage = "final"`
// is true for both Tauros (single-stage) and Charizard (final of three).
// Either add `stageDepth: number` to Pokemon or a `single_stage` tag.
// I prefer the tag — Phase 1.D can compute it from the evolution graph at
// sync time and write it into pokemon_tags. No schema change.

// All-starters-final-only (closes gap D)
{ slug: "starters-final",
  spec: { tagSlugs: ["starter"], formInclusion: "final-evolutions-excluding-mega" },
  requiresTags: true },
```

**Renames.**

- `bst-600-club` → `bst-600-679` ("Strong non-legendaries"). The literal "600 BST Club" preset, if we want one, IS just `pseudo-legendaries` and shouldn't double up.
- `fully-evolved` → `final-evos-all-forms` (current name implies "and excluding Megas" because that matches casual usage; the description correctly disambiguates but the slug is misleading). Or keep slug, sharpen the name to "Final evolutions (every form, including Mega/GMax)".

### Tradeoffs

- 5 new presets, 2 renames. ~30 minutes of editing in `presets.ts` plus `tags.yaml` extension for `eeveelution` and `single_stage`.
- The `single_stage` and `eeveelution` tags add tiny scope to Phase 1.D's data-sync work — both are *deriveable* from the species/evolution graph at sync time, not subjective curation, so this is safe under D-23.
- If the user wants to defer this, the cheapest cut is: **ship `kanto-electric` + `eeveelutions` + `starters-final` now (3 presets), defer single-stage to Phase 4-expand**. That closes the most embarrassing gaps without compounding scope.

---

## Question 2 — Is `final-evolutions-excluding-mega` the right default?

### Observed user need

The user's MVP complaint was literally: "I was asked to compare Charmander vs Charmeleon." That tells you what casual fans expect when they hit "start picker": they want a roster of icons, not pre-evolutions. They don't want Charizard's Mega forms either by default — Mega Charizard X vs Charizard is a power-tier comparison, not a favorites comparison. The "casual default" is "one row per species, the iconic adult form, no battle gimmicks."

`final-evolutions-excluding-mega` produces exactly that: ~600–700 rows across all gens, drops pre-evos, drops Megas/GMax, keeps regional variants and battle-bond forms (which fans *do* consider distinct favorites — Alolan Raichu is genuinely a different vibe from Kantonian Raichu).

### Current design

Default is `final-evolutions-excluding-mega`. Open question L51 in `OPEN_QUESTIONS.md` says "probably."

### Risks

**Risk: regional variants ship as default.** A user picking "Gen 1 favorites" with the default form-inclusion gets Alolan Raichu and Galarian Slowking and Hisuian Typhlosion (Hisuian is technically a Gen 1 species despite being introduced in Gen 8 — depending on how `generationId` is assigned by the sync). This is the right call (regional variants ARE different favorites), but the user should know this is the behavior. It is not a bug.

**Risk: single-stage Pokémon are correctly included.** I checked: `Pokemon.evolutionStage === "final"` returns true for Tauros, Lapras, Mewtwo, etc. — see the `EvolutionStage` doc comment in `packages/shared/src/index.ts`. Good — the schema design here is correct.

**Risk: future ADR pressure.** Some fans will want a stricter default ("just default forms, no regional variants") for casual mode. That's a Phase 4 UI affordance (a quick toggle), not a default change. Defer.

### Proposed alternative

**Lock as D-24.** No alternative; the current default is correct. The reason to lock it as a numbered ADR rather than a soft "probably" is that Phase 4's "Start picking" button is the load-bearing affordance for a first-time user, and its behavior is governed by this default. If we leave it as "probably," somebody (the assistant in a future turn, an agent, the user three months from now) will second-guess it without re-doing this analysis. Lock it.

**Suggested D-24 wording (for the human to ratify):**

> **D-24 — Default form-inclusion: `final-evolutions-excluding-mega`.**
>
> Decision. The default `formInclusion` mode is `final-evolutions-excluding-mega`: each species's final evolutionary stage, excluding Mega and Gigantamax forms, including regional variants. This is the implicit form filter when a user starts a picker without specifying a form-inclusion mode.
>
> Why. Real casual-fan vocabulary: "rank my favorite Pokémon" = "rank the iconic adult forms." Pre-evos are noise; Megas and GMax are battle gimmicks; regional variants are genuinely distinct favorites and should be included. This is the default that minimizes "why is Charmander in here" surprise (the v1 MVP complaint that motivated this Phase 2 fix).
>
> Rejected alternatives. `default-forms-only` keeps Bulbasaur and Charmander in (the original MVP bug). `final-evolutions-only` leaves Megas in (power users want this; casuals don't). Custom heuristic ("default forms but only the latest stage") is reinventable as `final-evolutions-excluding-mega` — pick the named mode.
>
> Reversibility. Low cost — change `DEFAULT_FORM_INCLUSION` constant. URL contract is unaffected because the default is omitted from canonicalKey.
>
> Consequences. Phase 4 picker copy says "ranks the strongest form of each species you'd find in your party." Phase 4.5 agent's `propose_tournament` defaults to this when the user is unspecific. Phase 7 aggregation rolls up under this default for any tournament that didn't override it.

### Tradeoffs

Locking costs ~5 minutes (write the ADR). Not locking costs hours of relitigation when Phase 4 starts and the assistant or agent doesn't know which "probably" was meant.

---

## Question 3 — Is the URL scheme stable enough for Phase 7 aggregation?

### Observed user need

D-5 says URL is the source of truth. D-11 says aggregation is the moat. Phase 7 rolls up tournaments by `canonicalKey(filter)`. So canonicalKey collisions = aggregation collisions = the moat is leaky.

### Current design

`canonicalKey` normalizes:
- `includeAlternateForms` shim is dropped (good — collapses the legacy MVP path into the modern one).
- `formInclusion === DEFAULT` is omitted (good — the default and an explicit "final-no-mega" hash to the same string).
- All array params are sorted (good — `gen=1,3` and `gen=3,1` collide cleanly).
- `tagMode === "all"` (the default) is omitted (good — the default and an explicit "all" collide).

### Risks

**Collision A — `tagMode` semantics inversion.** `tagSlugs: ["legendary"]` with `tagMode: "all"` is identical to `tagSlugs: ["legendary"]` with `tagMode: "any"` — when there's only one tag, "all" and "any" are equivalent. But `canonicalKey` only omits `tag-mode=all` and keeps `tag-mode=any`. So the same eligibility set produces two different canonical keys depending on which mode the user clicked. **This is a real Phase 7 collision miss.** Two tournaments with identical results don't roll up together. Fix: in `canonicalKey`, also drop `tagMode` when `tagSlugs.length <= 1`.

**Collision B — `evolutionStages: ["first", "middle", "final"]` is identity.** When all three stages are listed, the filter has no effect. `canonicalKey` faithfully serializes `evo=first,middle,final`, so two tournaments — one with no `evo` filter, one with all three stages — have different canonical keys despite identical results. Fix: in `canonicalKey`, drop `evolutionStages` when it covers all three stages.

**Collision C — `bst=0-` or `bst=-9999` are identity.** Open BST ranges produce a canonical key entry that has no eligibility effect (every Pokémon's BST is in `[175, 720]` or so). Two tournaments with `bst=` set to a permissive range and one without will not roll up together. Fix: in `canonicalKey`, drop `bst` if `(bstMin ?? -Inf) <= MIN_BST` AND `(bstMax ?? +Inf) >= MAX_BST`. Same for per-stat thresholds.

**Collision D — flag tri-state.** `isLegendary: true | false | undefined`. `canonicalKey` emits `legendary=1`, `legendary=0`, or omits — three distinct keys, three distinct eligibility sets. This is correct. But: a NOT-composed filter (`not(leaf({isLegendary: true}))`) has the same eligibility set as `{isLegendary: false}`. This is a Phase 7 issue **only if NOT is exposed in the URL** — which it isn't (composition.ts is engine-only, no URL serialization). So this is a future risk, not a current one. Note it for when NOT eventually goes into URLs.

**Collision E — preset slug → filter expansion.** Phase 7 expects `canonicalKey(presetBySlug("kanto-fire").spec)` to produce a stable string. It does. But if we ever rename `kanto-fire`'s expansion (e.g., add `evolutionStages: ["final"]` to it), all old aggregate rollups for that preset stop matching new ones. Mitigation: **canonicalKey is the rollup key, NOT the preset slug.** The Phase 7 docs and aggregation code must NEVER use preset slug for aggregation — it must always re-compute canonicalKey from the spec. Worth a callout in D-5 or D-11.

### Proposed alternative

Three small canonicalKey fixes (collisions A, B, C), each ~5 lines. They are all equivalence-class normalizations and are exhaustively testable.

```ts
// Pseudo-code for the canonicalKey extension:
const normalized: Filter = { ...filter };
delete normalized.includeAlternateForms;

// Existing form-inclusion default normalization (already in place):
const formMode = effectiveFormInclusion(filter);
if (formMode === DEFAULT_FORM_INCLUSION) delete normalized.formInclusion;
else normalized.formInclusion = formMode;

// New: tagMode irrelevant when ≤1 tag.
if (!normalized.tagSlugs || normalized.tagSlugs.length <= 1) {
  delete normalized.tagMode;
}

// New: evolutionStages identity collapses to undefined.
if (
  normalized.evolutionStages?.length === 3 &&
  ["first","middle","final"].every((s) => normalized.evolutionStages!.includes(s as EvolutionStage))
) {
  delete normalized.evolutionStages;
}

// New: open BST range collapses.
if ((normalized.bstMin ?? 0) <= 0 && normalized.bstMax === undefined) {
  delete normalized.bstMin;
  delete normalized.bstMax;
}
// (Symmetric for bstMax-only-set; symmetric for per-stat thresholds.)
```

Add a vitest case per collision class.

### Tradeoffs

20 minutes of code + tests. Catching this now is much cheaper than a Phase 7 migration that has to walk back 10,000 stale rollup buckets.

---

## Question 4 — Does this block Phase 4 UI?

**No, with one exception.** The `Filter` shape exposes everything the Phase 4 sidebar needs: BST slider (`bstMin`/`bstMax`), stat sliders (`statThresholds`), form-inclusion radio (`FORM_INCLUSION_MODES`), generation multi-select (`generationIds`), type checkboxes (`typeSlugs`), tag chips (`tagSlugs`), evolution-stage multi-select (`evolutionStages`).

**The one exception: top-N podium config.** That's a ranker-side concern (how many positions to surface), not a filter concern. Out of scope here.

**Algorithm dropdown:** ranker-side, not filter. Phase 3 owns this.

**One UI-architecture note for Phase 4:** the `requiresTags: true` flag on tag-dependent presets is exactly the right hook for Phase 4 to render those presets dimmed-with-tooltip until 1.D lands. Make sure Phase 4 actually uses it.

---

## Question 5 — Does this unblock Phase 3 cleanly?

**Yes.** The chain is `apply(filter, pool) → Pokemon[]` → ranker constructor takes `Pokemon[]`. Both halves of the contract are pure functions. The user complaint about "n×n pairing tiring" is a ranker concern (SingleElim is the answer there) and "limit of 64" is a UI/UX concern (Phase 4 cap, soft prompt above 64). Phase 2 has nothing to do with either; it just delivers the filtered pool, which is what Phase 3 expects.

**Note:** the 64 cap is a Phase 4 affordance, not a filter affordance. The eligibleCount live display lets Phase 4 show "this filter selects 312 Pokémon — that's a lot, want to refine?" without the filter engine having any opinion on the cap. Good separation.

---

## Question 6 — Should NOT be exposed in v1 picker UI?

### Observed user need

I scanned how PokemonDB and TierMaker handle exclusion. Neither exposes NOT chips. PokemonDB uses positive filters only with a "clear" button; TierMaker uses tag-include only. The only fan-tooling I know that exposes NOT is Smogon's damage calculator (highly technical user base). Casual fan sites, no NOT.

The user's MVP feedback was about *too few* features being exposed (picker too narrow), not *too many* (picker overwhelming). But the user is also the one who explicitly named "n×n pairing tiring" — they want the experience to feel snappy, not power-tool-y. NOT in chips is power-tool-y.

### Current design

Engine has `not(child: FilterNode)`. Composition tests cover NOT. Presets do not use NOT (none of the 31 needs it). `parseFilter` / `toSearchParams` do not serialize FilterNode (only flat Filter). NOT is therefore engine-only and never reaches a URL or UI.

### Risks

**Risk: agent (Phase 4.5) wants NOT.** "Show me Gen 1 Pokémon that aren't Water-type" → `and(leaf({generationIds:[1]}), not(leaf({typeSlugs:["water"]})))`. The agent absolutely will use NOT. But the agent uses the engine, not the URL. So engine support is sufficient and current.

**Risk: power user wants NOT in URL.** `?not=type:water&gen=1`. Real but premature. Wait until somebody asks.

**Risk: the user, not the casual fan, wants to use NOT.** The user is a power user. But this is "v1 UI" — chips for casuals. Build the v1 UI for casuals; add NOT as an "advanced filter" expansion in v2 if there's demand.

### Proposed alternative

**Lock as a non-decision in OPEN_QUESTIONS.md:** "NOT is engine-only in v1 (positive filter chips only in the picker UI). Engine and agent use NOT freely. Re-evaluate when a real user complains about not being able to express exclusion."

This is not a numbered ADR; it's a deliberate non-decision documented as such. The phrasing in OPEN_QUESTIONS.md should change from "Should NOT be exposed in the v1 picker UI?" to "Decided 2026-04-28: no. Engine-only. Positive filters only in v1 UI. Revisit if a user complains."

### Tradeoffs

Saves Phase 4 from designing a NOT chip experience, which is a non-trivial UX problem (how do you visually distinguish "NOT Water" from "Water" in a chip without confusing users?).

---

## Question 7 — Risk PM specifically wants to flag

**The 31-preset list is the "front door" of the picker.** The user's MVP complaint was that the picker felt under-populated. If Phase 4 ships with 31 presets and four obvious gaps (mono-type-per-gen-1 Electric, Eeveelutions, single-stage finals, starters-final-only), the user — or worse, an early outside viewer — will feel the same "this looks half-finished" reaction the MVP triggered. The fix is cheap (~5 presets, 30 min). The cost of not fixing is identical to the cost of the MVP truncation we just paid for.

**This is the blocker that justifies my "APPROVE WITH BLOCKERS" verdict.** Lock the 4 numbered ADRs / non-decisions and add the 5 missing presets. Anything else is nit-level.

---

## Recommendations (numbered, prioritized)

### Blockers (must clear before sub-phase complete)

**B-1.** Lock D-24: default form-inclusion is `final-evolutions-excluding-mega`. Use the wording above. Mark OPEN_QUESTIONS.md L51 resolved.

**B-2.** Add 3 missing presets at minimum (to ship with this Phase 2 release; remaining 2 may slip to Phase 4 if scope is tight):
- `kanto-electric` (closes gap A — Pikachu-line tournament)
- `eeveelutions` — requires `eeveelution` tag in `tags.yaml` (1.D scope creep, ~5 min)
- `starters-final` — final-form starters only, requires existing `starter` tag

**B-3.** Fix three canonicalKey collision classes (A, B, C above). 20 min + tests. Phase 7 aggregation depends on canonicalKey being a true equivalence-class hash, not just a faithful serialization.

**B-4.** Resolve OPEN_QUESTIONS.md "NOT in v1 UI" as **NO** with documented reasoning (don't leave as open).

### Recommendations (nice-to-have, not blockers)

**R-1.** Rename `bst-600-club` to `bst-600-679` ("Strong non-legendaries"). The current name lies about its meaning.

**R-2.** Add `single-stage` preset (gap C) — requires a derived `single_stage` tag from the evolution graph, which is mechanical and can land in Phase 1.D.

**R-3.** Add `kanto-psychic` to round out the four-elemental-mascot mono-types-per-Kanto pattern. (If we keep the Kanto-only special-casing, do it consistently.)

**R-4.** Add a docstring to `canonicalKey` (or to D-5) noting that **preset slug is NOT the rollup key**; aggregations must re-compute canonicalKey from spec each time. Prevents a Phase 7 footgun.

**R-5.** Phase 4 must use `requiresTags: true` flag to render tag-dependent presets dimmed with a tooltip until 1.D lands. Don't let them silently appear "broken."

### Praise (paper trail of what's right)

- The `Filter` shape is comprehensive and matches the Phase 2 deliverables list verbatim.
- `effectiveFormInclusion()` cleanly handles the legacy `includeAlternateForms` shim — backward compatibility done right.
- Form-inclusion mode names (`final-evolutions-excluding-mega`, etc.) are self-documenting; future readers will not have to dig.
- The decision to make tag-dependent presets degrade gracefully (return empty pool when tags absent) rather than throw is correct — Phase 1.D and Phase 2 are now genuinely independent.
- The `canonicalKey` pre-emptive normalization (default form mode dropped, includeAlternateForms shim collapsed) is exactly the Phase 7 forward-thinking the moat thesis requires.
- 13 vitest cases on the engine and presets is a respectable coverage floor.

---

## Open questions to RESOLVE in this gate

| Question | Resolution |
|---|---|
| L51: Default form-inclusion mode | **`final-evolutions-excluding-mega`**. Lock as **D-24**. |
| Preset list | **31 → 36** with 5 additions and 2 renames. Of these, **3 additions are blockers** (B-2). |
| NOT in v1 UI | **NO.** Engine-only. Document as non-decision in OPEN_QUESTIONS.md and close. |
| Phase 7 canonicalKey collisions | **3 normalization fixes required** (B-3). |

---

## What I am explicitly NOT calling a blocker

- The exact 5 vs 3 vs 7 new presets question — the user can pick any 3+ of my proposed 5; I'm not gate-keeping the count.
- Preset slug naming style (`fully-evolved` vs `final-evos-all-forms`) — cosmetic, low-cost to refactor later.
- Whether `gen-1` should imply a particular form-inclusion mode (it currently uses default = `final-evolutions-excluding-mega`, which is correct).
- Phase 4 UI specifics — out of this gate's scope.

---

**Verdict reaffirmed:** APPROVE WITH BLOCKERS. Clear B-1 through B-4 and the gate closes. Without them, Phase 4 inherits the same MVP-style under-spec'd surface that the user just flagged.
