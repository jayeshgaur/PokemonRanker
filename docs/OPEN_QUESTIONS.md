# Open Questions

> Items not yet decided. Each is tagged to the phase where it must be resolved. When a question is answered, move it from here into [DECISIONS.md](DECISIONS.md) as a numbered decision.

## Phase 0

Resolved in Phase 0 scaffold (see DECISIONS.md):
- ~~Repo layout~~ → D-13 (monorepo with `apps/api`, `apps/web`, `packages/*`).
- ~~Agent definitions location~~ → D-14 (`.claude/agents/`).
- ~~CI provider~~ → D-15 (GitHub Actions).
- ~~Go test framework~~ → D-16 (stdlib `testing` + `testify`).

Still open:
- **Agent SDK choice for the agent layer.** Go SDK from day 1, or Python service from day 1? Default is Go-first; revisit at Phase 8.

## Phase 1

Resolved at sub-phase 1.A kickoff:
- ~~Sync source of truth~~ → `PokeAPI/api-data` GitHub dump for bulk; live API only for `drift-check`. Locked in plan.
- ~~Sprite hosting~~ → D-17 (hot-link).
- ~~Cry hosting~~ → D-17 (hot-link).
- ~~`tags.yaml` initial content~~ → assistant drafts via the `data-sync` agent; user reviewed; ambiguous cases looped in case-by-case.

Still open:
- **Form coverage gaps.** Some PokeAPI form data is incomplete (e.g., older Totem forms, some event-only forms). Decide during 1.B: ignore, or hand-fill via a `forms_overrides.yaml`?

**Phase 1.B schema additions** (filed 2026-04-28 from `data-sync` Phase 1.A review §1.1–§1.6; refined by PM planning gate):

**Landed in schema v2 (Phase 1.B.1):**
- `pokemon.is_default`, `pokemon.pokeapi_order`
- `species.evolves_from_species_id` (self-FK), `species.forms_switchable`, `species.pokeapi_order`
- `forms.pokeapi_order`, `forms.pokeapi_form_order`
- `evolutions.gender`, `evolutions.time_of_day`
- `abilities.is_main_series`
- `moves.target`
- Wrap full ingestion in a single `BEGIN IMMEDIATE` / `COMMIT` (1.B.3 task).

**Deferred until a feature demands them** (PM planning-gate decision 2026-04-28: dead columns are noise; with no migration cost in our rebuild model, "cheap-now" doesn't outweigh "what is this for?"):
- `species.gender_rate`, `species.has_gender_differences`, `species.growth_rate`, `species.base_happiness`, `species.capture_rate`, `species.hatch_counter`
- `forms.introduced_in_version_group`
- `moves.effect_chance`
- `abilities.generation_id`
- `localized_names` table (re-introduce when non-English traffic crosses ~10% of total).

When any of the above is added back, do it as a one-line schema edit + re-sync (no migration; the schema is rebuilt every bulk run).

## Phase 2

- **Filter UI: chip-based or form-based.** Chips are trendy and fast; forms are explicit and accessible. Probably chips with a "details" expander. *(Phase 4 UI concern; deferred.)*
- ~~**Should NOT (negation) be exposed in the v1 UI?**~~ → **Resolved 2026-04-29 (Phase 2 implementation gate, product-manager agent): NO.** Engine supports `not()` in `packages/filter/src/composition.ts` and the agent (Phase 4.5) can use it freely. The picker UI exposes positive filter chips only — casual sites (PokemonDB, TierMaker) don't expose NOT either, and adding a NOT chip introduces a non-trivial UX problem (visually distinguishing "NOT Water" from "Water" without confusing users). Revisit if a real user complains about not being able to express exclusion via the URL.
- ~~**Default form-inclusion mode.**~~ → **Resolved 2026-04-29 as D-24: `final-evolutions-excluding-mega`.**

## Phase 3

- **Tie-breaking in MergeSortComparator.** When the user picks Skip/Draw, default behavior: earlier-seen wins (deterministic), or random? Tradeoff: reproducibility vs fairness.
- **Glicko parameters.** Default rating, RD, volatility. Off-the-shelf defaults are fine but document them.
- **How long can a tournament be before we throttle?** A 200-Pokémon MergeSort tournament is ~1500 duels. UX broken. Hard cap or soft warning?

## Phase 4

- **Mobile vs desktop priority.** Mobile-first for a fun-content site is correct. Confirm and design accordingly.
- **Result-screen "share" — which platforms?** Twitter/X, Reddit, link-copy at minimum. TikTok-friendly image card?
- **Stat-visibility default.** Vibes or Informed? Probably Vibes (less daunting), but the agent might disagree once it surveys users.
- **Animated vs static sprites.** Animated is delightful but heavier. Probably static by default, animated on hover.

## Phase 5

- **Short-link format.** `/r/abc123` (alphanumeric) vs human-readable slugs. Short wins for SMS sharing.
- **OG image generation: server-side at request time, or pre-rendered at completion time?** Probably at completion, cached on a CDN.
- **Per-Pokémon page URL: `/pokemon/{id}` or `/pokemon/{slug}`?** Slug for SEO.
- **Sitemap update cadence.** Daily? Hourly?

## Phase 6

- **Auth provider: Clerk vs Supabase Auth vs Auth0 vs roll-our-own with Lucia.** Clerk has the best UX; Supabase pairs naturally with Postgres; Lucia is most flexible. All have free tiers compatible with D-18.
- **Username policies.** Reserved names (admin, api, root), uniqueness, case sensitivity, change-frequency limits.
- **Privacy defaults.** New tournaments default to public, unlisted, or private? Probably unlisted (reachable by URL but not indexed) — a middle ground.
- **Free-tier Go backend deployment target.** Fly.io free tier (limited but real), Oracle Cloud Free Tier (always-free VM, more generous but more setup), or co-host both apps on a single Oracle VM. Ties to D-18.

## Phase 7

- **Aggregate cadence.** Real-time (expensive), nightly (default), or on-demand (cached)?
- **Trust scoring algorithm.** Weight by tournament length? By account age? Devise to resist gaming.
- **Per-Pokémon "average rank" — how to handle limited samples?** Show only when n > some threshold; below threshold, say "not enough data."
- **Anti-abuse policy.** Per-IP, per-session, per-account caps. Bot detection (Cloudflare Turnstile?).

## Phase 8

- **Go agent SDK vs Python service.** Decide based on Go SDK maturity at Phase 8 time.
- **Eval threshold.** What pass rate gates merging an agent change? Suggest 95% on a curated 100-question set; tighten over time.
- **System prompt iteration.** Where does it live? Versioned in `prompts/system.md`?
- **In-scope topics.** Just Pokémon? Pokémon competitive meta? Card game? Anime? Default: Pokémon games + species + competitive. Out: anime canon, card game (until we add tools).
- **Privacy: can the agent read user history?** Only with consent and only the user's own. Never another user's.

## Phase 9

- **Cost cap per session.** Agent narrating every duel could cost real money. Set a token cap per session and degrade gracefully.
- **Should agent suggestions ever influence the ranker outcome?** No — vote is always user truth (D-3). But suggestions can influence seeding/order.
- **How does the agent surface "the user might want X"?** Suggested-tournament cards on the homepage? In-chat?

## Phase 10

- **Affiliate partners.** Specifics depend on regional availability. TCGPlayer for cards (US-friendly); Amazon for hardware.
- **Patreon tier structure.** $3 / $7 / $15 ladder, or different.
- **Newsletter platform.** Substack vs self-hosted vs Buttondown.
- **Creator partnership terms.** Revenue share? Attribution-only? Need a draft framework before reaching out to anyone.

## Cross-cutting

- **i18n trigger.** When do we add languages? Probably when non-English traffic crosses 10% of total.
- **Mobile PWA.** When? Likely Phase 5 or 6.
- **Analytics.** Plausible (privacy-first) vs PostHog (richer, includes feature flags). Lean Plausible early.
- **Error monitoring.** Sentry, default.
- **Feature flags.** Needed by Phase 10. Probably PostHog or self-hosted.

## Plan-level (added 2026-04-28 from PM second-pass review)

- ~~**PL-2: Phase 1.5 early-shippable picker.**~~ → **Rejected** (2026-04-28) by user. Reasoning (user's words): "I do not want to spend time and tokens pushing a V0. This project, we can worry about users later, after we have done with all these plans, because it's also about myself. I want to build a website which works for me just as a proof of concept." V1 launch criteria: "works for me as a POC," not "user-validated." Future sub-phases plan accordingly — no scoped-for-user-feedback work until the architectural plan is finished.
- ~~**PL-7: Deployment architecture & OpenAPI codegen.**~~ → Resolved (2026-04-28) as **Option A** in D-22. Single Vercel deploy; Next.js reads SQLite via `better-sqlite3`; filter + ranker engines as TS packages; Go restricted to the sync binary.
