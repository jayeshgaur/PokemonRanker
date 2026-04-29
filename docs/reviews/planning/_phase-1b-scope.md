# Phase 1.B Scope — Product-Manager Review

**Reviewer.** `product-manager` subagent (adversarial / pro-user counterweight).
**Date.** 2026-04-28.
**Frame.** Planning gate. v1 success criterion is "works for me as a POC," per user's PL-2 rejection. Phase 1.5 toy-picker validation is explicitly off the table until the architectural plan is finished. **Goal of this review: flag over- and under-engineering of Phase 1.B given that criterion.** Not a re-litigation of the broader plan.
**Inputs read.**
- `docs/PLAN.md` Phase 1 section
- `docs/OPEN_QUESTIONS.md` Phase 1.B starter list
- `docs/DECISIONS.md` (D-1, D-2, D-11, D-22, D-23 in particular)
- `docs/reviews/planning/_phase-1b-scope-data-sync.md` (beat-owner review of the same proposal)

I'm intentionally **not** repeating data-sync's structural fixes (move abilities/moves to 1.B.2 constants bucket; assign `flavor_text` and `pokemon_tags` to explicit sub-phases; clone caching strategy; the 20 specific validation cases). Those are correct and I endorse them. This review focuses on the user-criterion question only.

---

## 1. Is the 5-sub-phase decomposition right for "works-for-me-POC" scale?

### 1.1 Observed user need

The user does not need a shippable v1 yet. The user needs:
- (a) a Pokédex they can run filter queries against locally (because Phases 2/3/4 all read from it);
- (b) confidence the data is intact enough that a future bug they hit at the UI layer is not a Phase 1 silent corruption;
- (c) momentum — five sub-phases of solo-dev work feels long when the headline outcome is "you have a SQLite file."

### 1.2 Current design

Five sub-phases (1.B.1 schema + sync infra → 1.B.2 constants → 1.B.3 core graph → 1.B.4 joins/evolutions → 1.B.5 query API + 20-case validation).

### 1.3 Risk: over-decomposition for a solo-dev fixture

Five sub-phases for what is, materially, "ingest a static dataset and test it" risks ceremony. I see two healthy merges:

- **Merge 1.B.2 + 1.B.3.** Constants (generations, types, stats, abilities, moves) and the core graph (species, forms, pokemon) are five small ingesters and three small ingesters respectively. The FK ordering between them (data-sync §1.1 makes this clear) means they'd be reviewed together anyway. Splitting them into two sub-phases creates a planning-review gate between two related ingesters with no UI artifact in between. Merge to `1.B.2 — single-resource ingesters`.
- **Keep 1.B.4 separate** because joins + evolutions + the second-pass `evolves_from_species_id` UPDATE are the genuinely tricky part where bugs hide (random-branch evolutions, Eevee's 8 outgoing edges, Wurmple's two destinations). This is the sub-phase that earns its own gate.

That gives a 4-sub-phase decomposition (1.B.1 schema/infra → 1.B.2 single-resource ingesters → 1.B.3 joins+evolutions+second-pass+flavor_text → 1.B.4 query API + validation), which I think serves the "works for me POC" pace better.

### 1.4 Proposed alternative

Collapse to 4 sub-phases as above. Renumber data-sync's "move abilities and moves to constants" fix into the merged 1.B.2.

### 1.5 Tradeoffs

- Slight loss of granular reviewability between constants and core graph.
- Solo-dev session boundary is less clean (the merged 1.B.2 is a longer session).
- Mitigation: the work inside the merged sub-phase is sequential and FK-determined, so reviewability is mostly preserved by the order of commits within the sub-phase.

**Verdict on Q1:** Five is one more than necessary. Recommend merging 1.B.2 and 1.B.3 into a single "single-resource ingesters" sub-phase. The 1.B.1 schema/infra split, the 1.B.4 (joins) split, and the 1.B.5 (validation) split all earn their own gate.

---

## 2. Is anything in scope that the user-criterion makes unnecessary?

### 2.1 The 20-case hand-checked validation suite — keep it

I want to push back on the framing that "no toy-picker validation step → maybe trim the 20-case suite." Those are different artifacts.

- The toy picker (PL-2) validates **the product** with users.
- The 20-case suite validates **the data**.

Phase 1's whole reason for being is that Phases 2/3/4 trust the data. If Charizard's Mega-X is missing, the bug surfaces in Phase 4 after weeks of UI work, and the user has to context-switch back into ingest code with no toolchain warm. **The 20-case suite is the cheapest insurance against that scenario, and the user's "works for me" criterion makes it *more* important, not less,** because there is no Phase 1.5 user feedback loop to catch the corruption symptomatically.

Specifically the cases that catch D-1 violations (data-sync §3.1: Charizard has 6 forms, Mewtwo has 3, Pikachu ≥17, Aegislash 2 with `forms_switchable=1`, Necrozma 4) are core thesis insurance. D-1 is the most expensive decision to back out, and these checks cost <1 hour to write.

**Verdict: keep all 20.** No gold-plating.

### 2.2 The `localized_names` table — defer

This is the one item I think is engineering completionism for the user-criterion. The plan says "Empty in 1.B; populated when needed" — meaning we add the table now and never write to it.

- Adding an empty table costs ~3 lines of SQL.
- But it implies a contract (resource_kind, resource_id, language, name) that's untested for years.
- The user's "works for me" criterion is in English. The cross-cutting principle ("Schema supports multilingual names from day 1") is a v1 *eventual* constraint, not a Phase 1.B blocker.

**Risk:** when i18n actually arrives (cross-cutting trigger says: when non-English traffic crosses 10%), the empty table's shape will likely be wrong because we never validated it against real ingest. Building the table now is therefore not even insurance — it's a cosmetic checkbox.

**Proposed alternative:** drop `localized_names` from 1.B.1. Re-add when there is a real need. Keep the *PokeAPI ingest* code structured so a future `localized_names` populate-pass is mechanical (easy because PokeAPI returns `names: [{language, name}]` as a uniform array on every resource).

**Tradeoff:** if the user disagrees and wants the structural placeholder for documentation reasons, the cost is trivial — keep it. This is a soft recommendation, not a structural objection.

### 2.3 The `forms_overrides.yaml` open question — defer or kill

`OPEN_QUESTIONS.md` line 25 keeps "Form coverage gaps... ignore, or hand-fill via a `forms_overrides.yaml`?" open through 1.B. For the POC criterion: **default to ignore in 1.B.** The user-facing risk of missing a Totem form is approximately zero for a personal POC. If an override file becomes necessary it can ship in Phase 1.D alongside `tags.yaml` curation. Don't let this open question block 1.B exit.

### 2.4 The `Ingester` interface — minor under-justification, but keep

A `type Ingester interface { Ingest(ctx, db) error }` plus a fixture-based pipeline test sounds like ceremony, but at the solo-dev scale of 8+ ingesters (generations, types, stats, abilities, moves, species, forms, pokemon, then joins) it actually pays its own freight by making the second-pass evolves_from update fit the same shape and by giving the test harness a uniform mocking surface. **Keep it.** The fixture-based pipeline test is the cheap version of "would I notice if my pipeline regressed?" — it costs less than the 20-case suite and catches a different class of bug (wiring/order vs data-correctness).

---

## 3. Is anything missing that would make 1.B brittle later — given no toy-picker validation?

### 3.1 Observed user need

When the user starts Phase 2 (filter engine) or Phase 4 (UI), they will be writing SQL queries against this Pokédex. Without the Phase 1.5 toy picker, **the first time the user actually touches the data interactively is in Phase 2 or later.** That widens the time-to-bug-discovery for any silent ingest failure.

### 3.2 Risks I see that the current 1.B plan does not cover

#### (a) No "spot-check the file by hand" affordance.

After ingest, the user needs a one-command way to eyeball the data. Right now the plan has 20 unit tests (which will pass or fail) and a snapshot test (which will only diff after the *second* sync). What it doesn't have is a 30-second sanity check the user can run mid-development.

**Proposed alternative:** ship a `make sync-inspect` (or `cmd/pokedex-sync inspect`) that prints a one-screen summary: total rows per table, BST distribution histogram, top-20 species by form count, count of species with `evolves_from_species_id IS NULL`, count of pokemon with sprite_url empty. **Cost:** ~2 hours. **Value:** the user can run this after every sync iteration in 1.B.2/1.B.3/1.B.4 and notice a regression *immediately*, not at the validation gate. Without the toy-picker feedback loop, this is the cheapest substitute for "did my changes break anything visible."

#### (b) No commitment to "ingestion is reproducible from a fixed SHA."

Data-sync's review is good on the SHA-pinning rule (§5.4), but the user-criterion adds urgency: when the user comes back to this code in two months, they will run `make sync` and get *different data than they had before* if the upstream has updated. That looks like a regression even if it isn't. **Proposed alternative:** add a `PINNED_API_DATA_SHA` constant (or `apps/api/data/api-data-pin.txt`) the user explicitly bumps. `make sync` reads that pin by default; `make sync-fresh` updates it. Snapshot test is meaningful only when the pin is meaningful.

#### (c) Snapshot test format matters for solo-dev review.

Current plan: "Snapshot test of full dataset (so we detect surprise changes when re-syncing)." For a solo dev with no second reviewer, the diff format determines whether a real regression gets eyeballed or rubber-stamped. **Proposed alternative:** the snapshot is a *sorted, human-readable* dump (one row per pokemon: `id|slug|species_id|generation_id|type1|type2|hp|atk|def|spa|spd|spe|bst`). When the diff is +Iron Crown / -Iron Crown noise vs structural changes, the user can tell at a glance. Avoid checked-in JSON or sqlite-binary blobs. **Cost:** 30 minutes. Keeps the snapshot test from being a noise generator that gets rubber-stamped.

### 3.3 Tradeoffs

- (a) and (b) are pure additions to 1.B scope. Each is small but real.
- (c) is a constraint on an already-planned artifact, so cost is rounding error.

**Net:** I'd add (a) `make sync-inspect`, (b) explicit api-data SHA pin, and (c) the human-readable snapshot format constraint. None individually rises to "1.B is broken without this," but together they are the cheap substitutes for the user-validation-loop that was rejected.

---

## 4. §1.1–§1.6 schema additions — engineering completionism vs. real user value

Going field-by-field. POC criterion = "would the user, running this for themselves, ever exercise this column or notice its absence?"

### 4.1 Real user value (keep)

- **`pokemon.is_default`, `pokemon.order`** — `is_default` is needed for the "show base form first in dropdowns" UI affordance and for the tag-propagation rule (data-sync §3.2 case 9). Real value. `order` is PokeAPI's display ordering and matches how every fan dex sorts. Keep both.
- **`species.evolves_from_species_id`** — needed for evolution-chain rendering in any UI that shows lineage (Phase 5+ per Pokémon page, but also useful for the agent's "tell me about Charizard's evolution line" answer in Phase 4.5). High value, low cost. Keep.
- **`forms.form_order`** — used to sort forms within a species deterministically. Without it, Mega-X vs Mega-Y ordering is undefined. Keep.
- **`evolutions.gender`, `evolutions.time_of_day`** — Eevee → Espeon (day) vs Umbreon (night) is the canonical case fans expect to be representable. If we don't capture this, the agent can't accurately answer "how do I get Espeon?" in Phase 4.5. Keep.
- **`abilities.is_main_series`** — disambiguates competitive abilities from event-only / Mystery Dungeon abilities. Without it, ability filters in Phase 2 will surface noise. Keep.
- **`moves.target`** — needed if the agent ever reasons about "which moves hit all opponents" or for any "show me Pokémon that learn AoE moves" filter. Reasonable value at low cost. Keep.

### 4.2 Smells like completionism (consider deferring)

- **`species.gender_rate`, `species.has_gender_differences`, `species.forms_switchable`** — `forms_switchable` is real (Aegislash blade/shield, validated in data-sync §3.1 case 4). `gender_rate` and `has_gender_differences` are filters approximately zero ranker users will exercise. The user-criterion does not justify them. **Recommendation:** keep `forms_switchable` (used by validation), defer `gender_rate` and `has_gender_differences` until a feature requests them.
- **`species.growth_rate`, `species.base_happiness`, `species.capture_rate`, `species.hatch_counter`** — these are *gameplay* fields (used in catching mechanics, breeding, leveling). They have **zero** value for a *favorite-Pokémon picker*. The user is not building Pokédex Showdown; they are building a ranker. **Recommendation: defer all four.** This is the clearest case of engineering completionism in the §1.1–§1.6 list. If a future agent eval question demands one of these, add it then; the cost of `ALTER TABLE ... ADD COLUMN ... DEFAULT NULL` on a static SQLite is approximately zero.
- **`forms.introduced_in_version_group`** — the "in which game did this form first appear" lookup. Real value if a future filter is "Pokémon introduced in Gen 7 USUM updates," but the ranker's existing `generations` table already covers the 90% case. **Recommendation:** defer; add when a filter explicitly demands it.
- **`moves.effect_chance`** — the percentage chance a secondary effect triggers (e.g., Body Slam paralyzes 30%). Useful for VGC competitive filters. Useless for a favorites picker. **Recommendation:** defer.
- **`abilities.generation_id`** — used for "abilities introduced in Gen N" filters. Edge case for a favorites picker. **Recommendation:** defer.

### 4.3 Net recommendation

Of the 16 column adds, **roughly 8 land in 1.B.1 because they serve POC user value** (is_default, order, evolves_from_species_id, forms_switchable, form_order, evolutions.gender, evolutions.time_of_day, abilities.is_main_series, moves.target — that's 9, by data-sync's accidentally-correct-by-completion list). The other 7 (gender_rate, has_gender_differences, growth_rate, base_happiness, capture_rate, hatch_counter, introduced_in_version_group, effect_chance, abilities.generation_id) are gameplay completionism for a project that is not a gameplay tool.

**This is the single biggest scope-trim available in 1.B.** Each deferred column is one less ingest mapping to write, one less validation case to consider, one less PokeAPI null-handling decision. Trimming them now is consistent with "works for me POC" and reversible later (every one of them is a NULLABLE add).

### 4.4 Tradeoffs

- Trimming risks "we'll regret it when the agent in Phase 4.5 wants to answer breeding questions." Mitigation: the agent's Phase 4.5 eval set (D-20) does not include breeding questions; they're Pokémon-meta questions. If a future eval demands a column, add it — cost is one ALTER + one ingester field.
- Keeping the trimmed columns risks zero-value scope creep that compounds.

**Verdict on Q4:** Trim 7 columns. Keep 9. The trim is the highest-leverage scope cut available in this 1.B planning gate.

---

## 5. Where data-sync's review needs a counter-argument

Data-sync's review is technically excellent and I agree with all of its structural recommendations. Two areas where I want to push back gently *not on its correctness but on its scope-control*:

### 5.1 Counter-argument: "all 16 columns + localized_names land in 1.B.1" is engineering completionism

Data-sync's §2.1 says all 16 columns land in 1.B.1 because they're cheap-now / expensive-later. **My §4.3 above disagrees.** The cheap-now / expensive-later argument is correct *for columns that will eventually be populated*. For columns that may never be exercised by a favorites picker (gender_rate, hatch_counter, growth_rate, etc.), the eventual ALTER is a tail risk that may never materialize. Cheap-now is real cost too — schema review surface, validation surface, ingest field-mapping surface. The user-criterion ("works for me POC") shifts the tradeoff toward "defer until justified by a feature."

**Reconciliation:** 9 columns in 1.B.1 (per §4.3); 7 deferred. data-sync's "cheap-now" argument applies to the kept set; to the deferred set, the cost is real and the value is hypothetical.

### 5.2 Counter-argument: 20 validation cases is the right number, not too few

Data-sync's review is conservative-correct in proposing 20 cases. I want to push the *opposite* way and call out that the **PM's instinct earlier in the conversation might be to trim them as gold-plating** in light of the no-toy-picker decision. **That instinct is wrong.** §2.1 of this review argues why. Data-sync's 20-case list is well-justified and lands as written.

### 5.3 No counter-argument needed on clone management

Data-sync's §5 (XDG_CACHE_HOME, FRESH=1, GitHub Actions cache keyed on commit SHA) is a clean recommendation that needs no PM friction.

---

## 6. The thing I worry about most for the POC user-criterion

**The user comes back to this code in 2 months, runs `make sync`, gets a different SQLite, runs the validation suite, and 3 cases fail because PokeAPI added Gen 9 paradox forms or shifted Tatsugiri's form_order.** The POC criterion plus "no Phase 1.5 user-validation" means the user has to debug this *cold*. Mitigations:

- (a) the PINNED_API_DATA_SHA from §3.2(b) — the user explicitly bumps, so the sync isn't surprising.
- (b) the human-readable snapshot from §3.2(c) — a regression diff is eyeballable.
- (c) the `make sync-inspect` from §3.2(a) — top-line counts visible at a glance.

These three together are the substitute for the toy-picker user-feedback loop the user rejected. They're cheap. Not landing them is the load-bearing risk in this plan.

---

## 7. Summary of recommendations (for the user to accept/modify/reject)

| # | Recommendation | Cost | Confidence |
|---|---|---|---|
| 1 | Merge 1.B.2 (constants) and 1.B.3 (core graph) into one sub-phase. 4 sub-phases total. | Zero (just a planning relabel) | Medium-high |
| 2 | Trim 7 columns from §1.1–§1.6 (gender_rate, has_gender_differences, growth_rate, base_happiness, capture_rate, hatch_counter, introduced_in_version_group, effect_chance, abilities.generation_id). Keep the other 9. | Negative (less work) | High |
| 3 | Defer the empty `localized_names` table from 1.B.1 to "when needed." | Negative | Medium |
| 4 | Add `make sync-inspect` for one-screen sanity check. | ~2 hours | High |
| 5 | Add explicit `api-data` SHA pin file + `make sync-fresh` to bump it. | ~1 hour | High |
| 6 | Snapshot test format: sorted human-readable text dump, not JSON or binary. | Constraint, no marginal cost | High |
| 7 | Keep all 20 hand-checked validation cases. The no-toy-picker decision makes them more important, not less. | (already planned) | High |
| 8 | Keep the `forms_overrides.yaml` open question deferred to 1.D. Default to "ignore Totem/event-only gaps" in 1.B. | (already implicit) | Medium |
| 9 | Adopt all of data-sync's structural fixes (constants bucket includes abilities/moves; flavor_text in 1.B.4; pokemon_tags in 1.D; clone management with XDG_CACHE_HOME + actions/cache; 20 validation cases as listed). | (already endorsed) | High |

---

**Verdict: Approve with scope-trim and three mitigations.** The 1.B sub-phasing should merge constants + core graph (#1). The §1.1–§1.6 schema-add list should drop 7 gameplay-completionism columns (#2). Three small additions — `sync-inspect`, SHA pin, human-readable snapshot — are the cheapest available substitutes for the toy-picker user-feedback loop the user rejected (#4, #5, #6). The 20-case validation suite is not gold-plating; it's load-bearing for the "works for me POC" criterion. Final call belongs to the user.
