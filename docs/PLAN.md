# Pokemon Ranker — Master Plan

> Source of truth for what we are building, why, and in what order. Update this file when phase scope changes. Do not let it drift.

## 1. Vision

A community-driven **Favorite Pokémon Picker**. Fans configure filters, rank their top-N through interactive comparisons, and feed aggregate fan-voted leaderboards segmented by filter combination. Tournament-style mergesort comparator is the headline ranking algorithm; other modes (Dragonfly-Cave-style multi-select rounds, single-elim quick-rank, anytime Glicko) plug into the same picker UI through the `Comparator` interface (see D-3).

The product is two things at once:
- **For the individual user:** an entertaining tool to discover and share their favorites.
- **For the audience at large:** a continuously-updated set of fan-voted "favorite X" rankings — content that compounds in value as more users participate.

We are entering a mature category. See [PRIOR_ART.md](PRIOR_ART.md) for the landscape (Cave of Dragonflies, TierMaker, RatePKMN, the 52,000-respondent Reddit survey, WolfeyVGC). Our wedge is **(a)** a Pokémon-grounded Q&A agent that doesn't hallucinate (D-20, Phase 4.5); **(b)** URL-addressable per-filter aggregates, not per-template (D-5, D-11); **(c)** every (species, form) is a distinct competitor including pre-evolutions and Megas (D-1); **(d)** multiple ranking algorithms behind a single picker UI (D-3).

## 2. Product thesis (the moat)

A single-player picker is a commodity (see [PRIOR_ART.md](PRIOR_ART.md)). The same picker with **public, filter-segmented aggregation** is a more defensible position — but TierMaker and RatePKMN already aggregate, so aggregation *alone* isn't the moat. Our wedge is the combination in §1: a Pokémon-grounded LLM agent (D-20) + URL-addressable per-filter aggregates (D-5) + form-specific competitors (D-1) + pluggable rankers (D-3).

Implication: every architectural choice should preserve the path from individual ranking sessions → aggregate rankings, even when we are not yet building the aggregation. Concretely:
- URLs encode picker configs (so they are addressable, shareable, and aggregatable by config).
- Sessions are first-class so anonymous traffic still feeds aggregates.
- Schema is normalized so rollups are cheap.
- Tags are curated centrally so users don't fragment categories.

## 3. Stack

| Layer | Choice | Rationale |
|---|---|---|
| Backend services | **Go** (chi router) | User wants to learn Go; Go is excellent for typed, fast, deployable services. |
| Database (Pokédex, read-only) | **SQLite**, file bundled with the backend image at build time | Static data, ~5–10 MB, no server needed. |
| Database (user/session/aggregate) | **Postgres** (Neon or Supabase) | Aggregations, joins, transactional writes. |
| Frontend | **Next.js 15 (App Router) + TypeScript** | SSR for SEO landing pages; React for interactivity; tight Vercel ecosystem. |
| UI | Tailwind + shadcn/ui | Fast, accessible, consistent. |
| State | Zustand (client) + TanStack Query (server) | Light, well-understood. |
| Validation | go-playground/validator (Go), Zod (TS) | Strict IO boundaries. |
| API contract | REST + OpenAPI spec generated from Go (`huma` or `swaggo`), TS client generated from spec | Cross-language type safety. |
| Agent SDK | Anthropic Go SDK (default); fallback to Python service if Go agent ecosystem proves thin in Phase 8 | Keeps stack consistent unless evidence pushes us off. |
| Testing | Go: stdlib `testing` + `testify`; TS: Vitest + Playwright | Standard. |
| Hosting | Vercel (frontend) + Fly.io or Railway (backend) + Neon (Postgres) | All have free tiers; Go-friendly. |

Locked in [DECISIONS.md](DECISIONS.md) D-7. Any change to the stack requires updating that decision.

## 4. Cross-cutting principles

These apply across every phase. Add to this list rather than hide them in a single phase.

- **Validate at every IO edge.** PokeAPI fetch, URL params, agent tool args, DB writes/reads. Schemas are the system's contract.
- **Pure-function cores.** The filter engine and ranker engine are pure logic. UI and persistence wrap them but never leak into them.
- **URL is the source of truth for tournament config.** Refresh recovers state. Sharing works for free. Aggregation rolls up by config hash.
- **No Pokémon merchandise.** IP fair-use posture: rankings, opinions, cross-references. No selling anything that uses Nintendo/Game Freak imagery.
- **Accessibility is not a Phase 10 concern.** Keyboard voting, ARIA roles, color-blind-safe type indicators ship in Phase 4.
- **Deferred i18n.** Schema supports multilingual names from day 1 (PokeAPI provides them). UI is English-only until Phase 7+.
- **Anti-abuse at write boundaries.** Rate limit, per-session caps, minimum tournament length to count toward aggregates. Build when traffic exists; design now.

## 5. Phase plan

Each phase has a **shippable artifact** and an **interface contract** that the next phase consumes. We do not move on until the contract is stable.

### Phase 0 — Foundations *(complete 2026-04-28)*

**Goal.** Lock architectural decisions, scaffold the repo, set up agents and ADRs. No user-facing output.

**Status.** ✅ Complete. `make install` + `make all` green. Web typecheck + lint clean. CI workflow updated for golangci-lint v2.

(Note: the original Phase 0 deliverable also included a Go HTTP server scaffold (`apps/api/cmd/api/`, `internal/health`, `make api` target). That scaffold was removed in the Phase 1.A blocker fix pass per D-22's "single Vercel deploy" decision. The runtime backend now lives in Next.js; Go is restricted to the sync binary.)

**Deliverables.**
- ✅ `docs/PLAN.md`, `docs/DECISIONS.md`, `docs/AGENTS.md`, `docs/GLOSSARY.md`, `docs/OPEN_QUESTIONS.md`.
- ✅ Go module (`apps/api`) bootstrapped. (The chi-router `/healthz` endpoint shipped in this phase was removed in the Phase 1.A blocker fix pass per D-22.)
- ✅ Next.js 15 app (`apps/web`) bootstrapped with Tailwind, ESLint, Vitest, and a Phase 0 landing page.
- ✅ Monorepo via pnpm workspaces (`pnpm-workspace.yaml`, root `package.json`, `Makefile` for cross-language orchestration).
- ✅ CI workflow (`.github/workflows/ci.yml`) with two parallel jobs: api (vet, lint, test) and web (typecheck, lint, test, build).
- ✅ All 8 subagent definitions in `.claude/agents/`.
- ✅ ADR template (`docs/adr/template.md`); the 12 originally-locked decisions remain in `DECISIONS.md` as the index. New decisions can be split into `docs/adr/D-N-slug.md` files going forward.
- ✅ `apps/api/data/tags.yaml` skeleton with all canonical group names (members empty, to be filled by `data-sync` agent in Phase 1).
- ✅ Four additional decisions locked: D-13 (repo layout), D-14 (agent location), D-15 (CI), D-16 (Go test framework).

**Interface to next phase.** A repo where `make install` succeeds, `make all` (typecheck + lint + test) is green, `make sync` produces a valid SQLite, and `make web` boots.

**Exit criteria.**
- `make install` completes cleanly.
- `make all` is green locally and on CI.
- `make sync` produces a valid Pokédex SQLite.
- `make web` boots, the landing page renders.

**Risks.** Bikeshedding on directory layout. Mitigation: layout is now committed via D-13; refactor in Phase 1 if we hit friction.

### Phase 1 — Data layer

Sub-phases (refined 2026-04-28 via planning gate):
- **1.A** — schema + sync skeleton (✅ complete)
- **1.B.1** — schema v2 expansion + sync infrastructure (api-data clone, `git rev-parse HEAD`, `Ingester` interface, fixture-based pipeline test, `make sync-inspect`, `.api-data-sha` pin)
- **1.B.2** — constants + core graph ingest (generations, types, stats, abilities, moves, species, forms, pokemon — merged from earlier 1.B.2 + 1.B.3 per PM scope-trim)
- **1.B.3** — joins + evolutions + flavor text (pokemon_types/stats/abilities/moves, evolution_chains, evolutions, `species.evolves_from_species_id` second pass, flavor_text). Wrap full ingestion in `BEGIN IMMEDIATE` / `COMMIT`.
- **1.B.4** — query API + validation suite + implementation gate (replace `ErrNotImplemented` stubs; ~20 hand-checked filter cases; binary-deterministic + human-readable text-dump snapshot)
- **1.D** — tag curation (parallel; can run anytime ingestion is stable). Includes the thematic-design overlay per PL-6.
- **1.F** — refresh tooling (`delta` and `drift-check` modes for the sync binary).

The original 1.C (sprite/cry URLs + flavor text) and 1.E (query API + validation) sub-phases are consumed: sprite/cry URLs are columns populated in 1.B.2; flavor text is in 1.B.3; query API + validation are in 1.B.4.

**Sub-phase 1.D scope expansion (2026-04-28, per PL-6).** In addition to curating member lists for the classification tags (legendary, mythical, sub-legendary, pseudo-legendary, starter, fossil, baby, ultra-beast, paradox, regional-variant, mega, gmax, fusion), 1.D also curates a **thematic-design overlay** (humanoid / quadruped / serpent / aquatic / mecha / round / armored / etc.). These are descriptive, not subjective — D-8's Vibes-mode filters need real filter chips, not just a stat-hide toggle. Subjective tags (cute / cool / scary) are deferred per D-23.

**Sub-phase 1.A status (complete 2026-04-28; re-gate verdict Approve at `docs/reviews/phase-1a/_summary-regate.md`):**
- ✅ `internal/pokedex/schema.sql` — full schema for 19 tables (`schema_version`, `sync_meta`, `generations`, `species`, `forms`, `pokemon`, `types`, `pokemon_types`, `stats`, `pokemon_stats`, `abilities`, `pokemon_abilities`, `moves`, `pokemon_moves`, `evolution_chains`, `evolutions`, `flavor_text`, `tags`, `pokemon_tags`).
- ✅ `internal/pokedex/db.go` — `Open(ctx, path)` opens SQLite via `modernc.org/sqlite` (pure Go, no CGO) and applies the schema idempotently.
- ✅ `internal/pokedex/types.go` — `Pokemon` struct (the competitor unit), `Stats` with `BST()` method.
- ✅ `internal/pokedex/query.go` — `Query` interface; `SQLQuery` stubs returning `ErrNotImplemented` (filled in Phase 1.B).
- ✅ `internal/pokedex/ingest/bulk.go` — `RunBulk` writes to a `.tmp` sibling and atomically renames; records `sync_meta` provenance row.
- ✅ `cmd/pokedex-sync/main.go` — CLI with `bulk`, `delta` (stub), `drift-check` (stub) subcommands.
- ✅ `make sync` produces a valid SQLite file in 30ms.
- ✅ Tests cover: schema applies, all tables exist, schema_version recorded, idempotent on reopen, foreign keys enforced, bulk creates DB, output path required, overwrite leaves single sync_meta row, stale `.tmp` cleaned up. Total: 12 Go tests in `pokedex` and `pokedex/ingest`.
- ✅ `golangci-lint` clean, `go vet` clean.

**Goal.** A trusted, queryable Pokédex. No UI. No filters yet — just raw data.

**Inputs.** Locked competitor identity (every species+form is its own row, see D-1).

**Deliverables.**
- `cmd/pokedex-sync` Go binary that pulls from PokeAPI (using its bulk dump where possible) and emits a SQLite file.
- Normalized schema: `species`, `forms`, `pokemon` (= species + form, the **competitor unit**), `types`, `pokemon_types`, `stats`, `pokemon_stats`, `abilities`, `pokemon_abilities`, `moves`, `pokemon_moves`, `evolutions`, `flavor_text`, `sprites`, `cries`, `generations`.
- `tags.yaml` editorial overlay: legendary, mythical, sub-legendary, pseudo-legendary, starter, fossil, baby, ultra-beast, paradox, regional-variant, mega, gmax, fusion. Loaded at sync time, joined into a `pokemon_tags` table.
- Validation: every Pokémon has expected fields; every tag points to a valid pokemon_id; stat sums match published BSTs for a sample.
- Snapshot test of full dataset (so we detect surprise changes when re-syncing).
- Go package `pokedex/` exposing typed query functions: `GetPokemon(id)`, `Search(filter Filter)`, `GetByTag(tag)`.

**Interface to next phase.** `pokedex.Query` interface returning `[]Pokemon` for any filter. Stable type definitions in Go and (later) generated for TS.

**Exit criteria.** 20 hand-checked filter cases return correct results. Full snapshot test green.

**Risks.**
- PokeAPI bulk dump may lag the live API — accept; we re-sync manually.
- Tag curation effort; mitigation: ship with the obvious tags, expand via the `data-sync` agent over time.

**Complexity.** Medium. ~3–5 sessions of focused work.

### Phases 2 + 3 + 4 — Accelerated MVP slice (set 2026-04-29)

**Status (2026-04-29).** Code-complete; `make all` green; production build clean. Awaiting manual UX sanity check by the user, after which the batched implementation gate (3 agents) fires.

**What landed:**
- `packages/shared/` — canonical `Pokemon` + `Stats` types + `bst()` helper. Mirrors the SQLite Pokédex schema row shape.
- `packages/filter/` — `Filter { generationIds?, typeSlugs?, tagSlugs?, includeAlternateForms? }`, pure `apply()`, `eligibleCount()`, URL `parseFilter` / `toSearchParams` round-trip, `canonicalKey` (Phase 7 aggregation hook). 13 vitest cases (matrix of fields, alt-form gating, AND-across-fields, OR-within-field, URL round-trip).
- `packages/ranker/` — `Ranker` interface (`nextDuel` / `submit` / `progress` / `result` / `serialize` / `isDone`), `Decision` enum, `MergeSortComparator` impl with bottom-up merge sort, fully JSON-serializable mid-flight state, `MergeSortComparator.deserialize(snapshot, pool)` round-trip. 11 vitest cases including 32-trial property test on randomized total orders, n=8 worst-case comparison upper bound check, and serialize/deserialize round-trip both mid-flight and at completion.
- `apps/web/lib/pokedex.ts` — `better-sqlite3` reader (Node runtime, server-only). Returns `{ pool: Pokemon[]; facets: { generations, types, tags } }` with single-load caching. Graceful empty fallback when DB missing.
- `apps/web/app/pick/page.tsx` — Server Component: reads URL `searchParams`, parses Filter, queries SQLite, renders `<FilterSidebar>` + `<Picker>`. Renders a "run `make sync-from-clone`" empty-state if the SQLite isn't built yet.
- `apps/web/components/picker/{Picker,FilterSidebar,DuelCard,ResultsList}.tsx` — client components. localStorage state keyed by `canonicalKey(filter)` so different filters keep independent runs and refresh resumes mid-tournament. `MAX_FOR_PICKER = 64` cap for MVP UX (refine-filter prompt above that). Keyboard ←/→/space shortcuts. PokemonDB outbound link on every result row.
- `apps/web/app/page.tsx` — landing page now has Start picking + Gen 1 + Gen 1 starters preset links.

**Skipped for MVP (still on the plan):** NOT/AND/OR filter composition, BST range / stat thresholds, evolution stage, form-inclusion modes (only the simple toggle ships), SingleElim & GlickoRandom rankers, LLM-augmented Comparator hooks, permalinks/SEO landing pages, accounts/sessions, aggregation, agent. All retained in the full Phase 2/3/4 sections below as the destination.

**Prerequisite for the UI to actually be usable.** The user must run `make sync-from-clone` once on their machine (~557 MB one-time clone of `PokeAPI/api-data`) so `apps/api/data/pokedex.sqlite` is populated. Until then the picker shows the friendly empty-state.

---

**Execution mode.** Per user direction (token-cost concern + want a clickable UI sooner), Phases 2, 3, and 4 are executed as a **single combined "MVP-first" slice** with reduced feature surface per phase. **No throwaway code** — every file shipped here is production code that gets extended in follow-on expansion phases. Just compressed sequencing.

**MVP slice exit:** the user can run a Pokémon ranking on his own machine end-to-end — clone api-data → sync → open `make web` → pick favorites pairwise → see top-N. One filter preset, one ranker algorithm, one screen. Production-quality.

**MVP scope per package:**

- **`packages/filter/`** (Phase 2 minimal): `Filter` type with `gen`, `type`, `tags`. Apply function `(Filter, Pokemon[]) → Pokemon[]`. Fixture tests. *Skipped for MVP:* NOT/AND/OR composition, BST range, stat thresholds, evolution stage, form-inclusion modes — these land in Phase 2-expand.
- **`packages/ranker/`** (Phase 3 minimal): `Ranker` interface (NextDuel / Submit / Progress / Result), one implementation: `MergeSortComparator`, resumable state (JSON serialize). Property tests. *Skipped for MVP:* SingleElim, GlickoRandom, LLM-augmented Comparator hooks — Phase 3-expand.
- **`apps/web/`** (Phase 4 minimal): a `/pick` route that renders FilterSidebar + DuelCard + ResultsList. State in localStorage. Reads SQLite via `better-sqlite3` per D-22. *Skipped for MVP:* permalinks/SEO landing pages (Phase 5), accounts/sessions (Phase 6), aggregation (Phase 7), agent (Phase 4.5/8) — all unchanged, just deferred until after the MVP is clickable.

**One batched gate at end of MVP slice** — code-reviewer + test-runner + beat-owner (3 agents per the gate-cost discipline).

**Prerequisite for UI to actually be usable.** The user must run `make sync-from-clone` once on their machine (~557 MB one-time clone of `PokeAPI/api-data`) so `apps/api/data/pokedex.sqlite` is populated. Until then the picker UI shows no Pokémon. The MVP code itself is testable on synthetic fixtures.

The full-scope versions of Phase 2, Phase 3, Phase 4 below are the eventual end state — read them as the *destination*; the MVP slice is the first commit toward each.

### Phase 2 (proper) — Filter engine — ✅ Complete (2026-04-29)

**Status.** Code-complete; batched implementation gate (code-reviewer + test-runner + product-manager) closed Approve. Gate paper trail: `docs/reviews/phase-2-proper/_summary.md`. PM blockers B-1 through B-4 cleared in the gate-close pass.

**What landed:** 7 filter primitives + AND/OR/NOT composition AST + 35 named presets + URL round-trip with collision-safe `canonicalKey` for Phase 7 aggregation. Default form-inclusion locked as **D-24** (`final-evolutions-excluding-mega`). 95 TS tests pass.

**Phase 3 (proper) starts next:** SingleElim + GlickoRandom alongside the existing MergeSort. Algorithm dropdown wiring is Phase 4.

---

### Phase 2 — Filter engine (original spec, retained for reference)

**Goal.** Compose filters that reduce the Pokédex to a tournament-eligible competitor list.

**Inputs.** Phase 1 query API.

**Deliverables.**
- Filter primitive types (Go): `TypeFilter`, `GenerationFilter`, `TagFilter`, `BSTRangeFilter`, `StatThresholdFilter`, `EvolutionStageFilter`, `FormInclusionFilter`.
- Composable: AND, OR, NOT (NOT is supported in the engine even if not in v1 UI).
- Preset filter library: 20+ named presets covering the YouTube-top-10 archetypes (Gen 1 only, Starters, Pseudo-Legendaries, Megas-only, Fully-evolved-only, etc.).
- Live count: given a filter, return the eligible competitor count.
- Pure-function: `Apply(filter Filter, pokedex Pokedex) []Pokemon`.

**Interface to next phase.** `Filter` is serializable to/from a URL-safe string. `Apply` takes a Filter and returns the list passed to the ranker.

**Exit criteria.** Each preset returns a sane list. Property tests for composition operators. Round-trip serialization preserves Filter equality.

**Risks.** Form-inclusion semantics are subtle (D-1). Mitigation: explicit `FormInclusionFilter` with options `AllForms | FinalEvolutionsOnly | FinalEvolutionsExcludingMega | OnlyMegas | OnlyParadox | Custom`. Defaults conservative.

**Complexity.** Small–Medium.

### Phase 3 (proper) — Ranking engine — ✅ Complete (2026-04-29)

**Status.** Code-complete; batched implementation gate (code-reviewer + test-runner + ranker-mathematician) closed Approve. Gate paper trail: `docs/reviews/phase-3-proper/_summary.md`. Mathematician blockers B-1 (BYE-distribution bias) and B-2 (loser-rank tie-break) cleared in the gate-close pass.

**What landed:** three rankers behind one `Ranker` interface — `MergeSortComparator` (true ranking, ~n·log n), `SingleElimRanker` (n-1 comparisons, deterministic-shuffle bracket, top-1 + matches-won-tiebroken partial ranking), `GlickoRandomRanker` (anytime Glicko-1 with RD²-weighted pair selection, stopEarly()/setTargetComparisons(), currentResult() for live display). Plus `Comparator` interface (D-3 LLM hook), `runRanker(ranker, comparator)` runner, `createRanker(kind, pool)` + `restoreRanker(snapshot, pool)` factories, `RANKER_INFO[]` metadata for Phase 4's algorithm dropdown.

150 TS tests pass (filter 83, ranker 66, web 1). Glicko-1 math verified against Glickman 1995 by the ranker-mathematician.

**Phase 4 (proper) starts next:** UI — algorithm dropdown, full filter sidebar with all 7 primitives + 35 presets, Vibes/Informed mode toggle (D-8), audio cry on hover, top-N podium configurable to 1/3/5/10, share button. **Drop the 64-cap.**

---

### Phase 3 — Ranking engine (headless) — original spec, retained for reference

**Goal.** Headless tournament logic, fully testable without UI.

**Inputs.** A list of competitors from Phase 2.

**Deliverables.**
- Strategy interface: `Ranker` exposes `NextDuel() (a, b Pokemon)`, `Submit(winner Pokemon, decision Decision)`, `Progress() (done, total int)`, `Result() Ranking`.
- `Decision` enum: `LeftWins | RightWins | Draw | Skip`.
- Implementations:
  - `SingleElim` — fastest, top-1 only.
  - `MergeSortComparator` — true ranking, ~n log n comparisons.
  - `GlickoRandom` — anytime algorithm, user can stop early.
- Resumable state: every Ranker is serializable to a compact bytes blob (so it round-trips through URL or DB).
- LLM-augmentation hooks (D-3): a `Comparator` interface the Ranker accepts, with a default `UserComparator`. We can later plug `LLMSuggestionComparator` for tiebreakers, `LLMSeedingComparator` for initial bracket order, etc.
- Property tests: for any total order over n items, MergeSortComparator produces it within the expected comparison count.

**Interface to next phase.** UI calls `NextDuel`/`Submit` and re-renders. UI never reaches into Ranker internals.

**Exit criteria.** All three rankers pass simulation tests. Serialize/deserialize round-trip preserves state.

**Risks.** Tie semantics in MergeSort — design choice; default: draws break toward earlier-seen, with a flag to flip.

**Complexity.** Medium. Math here matters; route through the `ranker-mathematician` agent for review.

### Phase 4 (proper) — Core UI — ✅ Complete (2026-04-29)

**Status.** Code-complete; batched implementation gate (code-reviewer + test-runner + ux-critic) closed Approve. Gate paper trail: `docs/reviews/phase-4-proper/_summary.md`. Two code-reviewer blockers + three ux-critic blockers + one test-runner finding cleared in the gate-close pass.

**What landed:** full filter sidebar (7 primitives, 35 presets in 7 groups, default form-inclusion = D-24), picker controls (algorithm dropdown sourced from `RANKER_INFO`, top-N 1/3/5/10, Vibes/Informed toggle per D-8, audio cry toggle), polished DuelCard (TypeBadges, StatBlock, audio cry on hover, keyboard ←/→/space with always-visible hint banner, focus-visible rings), gold/silver/bronze podium ResultsList with Share button, localStorage persistence keyed by `canonicalKey + algo`. **64-cap dropped**, soft warning above 200 with algo-specific advice. Glicko stopEarly + keep-going wired.

161 TS tests pass (filter 83, ranker 66, web 11). Next.js production build clean (`/pick` 12.7 kB).

**User MVP complaints — verified addressed:**
- ✅ "1300 comparisons / n×n tiring" → SingleElim (n-1) + Glicko (anytime, stop whenever) algorithms in dropdown.
- ✅ "Limit of 64 is sad" → Cap dropped; soft warning at 200+ with switcher advice.
- ✅ "Charmander vs Charmeleon" → D-24 default form-inclusion = `final-evolutions-excluding-mega`.
- ✅ "No game aspect" → Vibes/Informed mode (D-8), audio cry on hover, podium with gold/silver/bronze, keyboard shortcuts with visible hints.

**Phase 5 (permalinks & SEO) starts next.**

---

### Phase 4 — Core UI MVP (first shippable) — original spec, retained for reference

**Goal.** A user can run a filtered tournament end-to-end. Single-player, anonymous, localStorage-only.

**Inputs.** Phases 1–3 are stable.

**Deliverables.**
- Filter sidebar: presets + custom builder (tag chips, type checkboxes, gen multi-select, BST slider, stat threshold sliders, form-inclusion radio).
- Eligible-count live display.
- "Start ranking" button with an algorithm dropdown (default: MergeSort comparator). Per D-19, user-facing copy reads "Start ranking" / "Start picking your favorites," not "Start tournament."
- Duel screen:
  - Two cards side by side, click to vote.
  - Card shows sprite (animated where available), name, types (icons + accessible labels), gen badge, BST.
  - "Stat visibility" toggle (Informed/Vibes mode, D-8).
  - Audio: cry plays on hover (toggleable).
  - "I can't decide" → Draw (where ranker supports it) or random advance (where it doesn't).
  - Keyboard: ←/→ to vote, Space for indecision.
  - Progress bar.
- Result screen:
  - Top-N podium (configurable: 1, 3, 5, 10).
  - Full ranked list with details.
  - Per-Pokémon link to `pokemondb.net/pokedex/{name}`.
  - Share button: copies URL with encoded tournament + ranking.
- LocalStorage persistence: in-progress tournament resumes on refresh.

**Interface to next phase.** Tournament URL = filter spec + algo + (optional) ranking blob.

**Exit criteria.** I can run a Gen 1 Water tournament, refresh mid-way, resume, and see top-5 with PokemonDB links. Lighthouse > 90 across categories.

**Risks.** Mobile UX for the duel screen; mitigation: design mobile-first.

**Complexity.** Large. The frontend is most of the surface area.

### Phase 4.5 — Pokémon-grounded Q&A agent (per D-20)

**Goal.** Ship a Pokémon-grounded chat agent that answers questions and proposes tournaments using the Phase 1–3 tool surface, before aggregation work begins.

**Inputs.** Phases 1–3 stable; Phase 4 UI deployed.

**Deliverables.**
- Anthropic TypeScript SDK integration (per D-22; runs as a Vercel Edge Function colocated with the Next.js app).
- Tools, all Zod-schema-validated:
  - `search_pokemon(filter) → Pokemon[]`
  - `get_pokemon_details(id) → PokemonDetail`
  - `compare_pokemon(a_id, b_id) → Comparison`
  - `propose_tournament(natural_language) → FilterSpec`
- Streaming chat UI on the picker page (bottom-right, scoped to Pokémon questions).
- System prompt + tool definitions cached (Anthropic prompt caching) for cost.
- Eval suite: 100+ Pokémon questions with expected behavior; CI fails if eval pass-rate drops below threshold.
- Per-session token cap (D-18 cost control).

**Interface to next phase.** Tool surface is stable; Phase 8 layers aggregate-ranking tools on top of it.

**Exit criteria.** Eval pass-rate ≥ 95% on a curated 100-question set; agent never quotes a stat without first calling `get_pokemon_details`; per-session cost under target.

**Risks.** API cost growing with traffic. Mitigation: token cap + degradation message at cap.

**Complexity.** Medium.

### Phase 5 — Permalinks & SEO scaffolding

**Goal.** Every tournament is shareable; every preset is an SEO landing page.

**Inputs.** Phase 4 URLs.

**Deliverables.**
- Compact URL encoding for tournament + ranking. `/r/{shortid}` resolves to a server-rendered share card.
- Open Graph image generation per ranking (Vercel `@vercel/og` or Go-side generation).
- Static landing page per preset filter (`/best/water-type-gen-1`) — Phase 5 ships *empty* leaderboard areas; Phase 7 fills them.
- Sitemap generation.
- Per-Pokémon pages (`/pokemon/{slug}`) — basic info now, aggregate stats in Phase 7.

**Interface to next phase.** Stable URL/route structure that Phase 6 (auth) and Phase 7 (aggregation) extend without breaking links.

**Exit criteria.** Sharing a tournament on Twitter/Reddit produces a clean preview card. Sitemap submitted to Google.

**Risks.** SEO indexing takes weeks — start now even though aggregation isn't ready.

**Complexity.** Medium.

### Phase 6 — Sessions, accounts, history

**Goal.** Anonymous sessions and authenticated accounts; persisted tournament history.

**Inputs.** Backend service exists (move from localStorage-only to server-stored).

**Deliverables.**
- Auth provider integration (Clerk or Supabase Auth — decide here).
- Anonymous session: cookie-based, server-tracked. Tournaments saved to session even without login.
- Account merge flow: when a session-user signs up, their session-tournaments transfer to the new account.
- User profile page (`/u/{username}`): public list of public rankings, private/unlisted toggles per ranking.
- Tournament history per user.
- Schema (Postgres):
  - `sessions(id, created_at, user_agent, last_seen_at)`
  - `users(id, ...)` linked optionally to a session
  - `tournaments(id, session_id, user_id NULL, filter_spec, algo, status, created_at, completed_at, visibility)`
  - `rankings(tournament_id, position, pokemon_id)` — denormalized for fast aggregate joins
  - `duels(tournament_id, ord, left_id, right_id, decision)` — full audit log

**Interface to next phase.** Phase 7 reads `rankings` and `tournaments.filter_spec` to compute aggregates.

**Exit criteria.** Login → run tournament → see in history → share publicly → visit own profile. Anonymous → run tournament → sign up → tournament shows in account.

**Risks.** Session-merge bugs eat trust; mitigation: extensive tests.

**Complexity.** Large.

### Phase 7 — Aggregation & community (the moat)

**Goal.** Aggregate fan-voted rankings on filter-preset landing pages.

**Inputs.** Phase 6 schema with hundreds-to-thousands of completed tournaments.

**Deliverables.**
- Aggregation pipeline: nightly (or hourly, when scale demands) materialized views over `rankings` grouped by `filter_spec` hash.
- Trust scoring: weight each ranking by tournament length, completion, anti-abuse flags.
- Per-preset landing page (`/best/{slug}`) shows fan-voted top-N + "run this tournament yourself" CTA.
- Per-Pokémon page extended: "Pikachu's average rank in Gen 1 tournaments: 4.2 (n=812)".
- Trending tournaments dashboard.
- Anti-abuse: per-session rate limit, minimum duels-completed, basic bot detection.

**Interface to next phase.** Aggregate APIs that the agent (Phase 8) can call: `GetAggregateRanking(filter)`.

**Exit criteria.** Any preset page shows real aggregate data. SEO traffic begins. Anti-abuse passes a load test with simulated abuse patterns.

**Risks.** Aggregation gaming once visibility matters. Plan; build defenses iteratively.

**Complexity.** Large.

### Phase 8 — Agent v2 (aggregate-aware)

**Goal.** Extend the Phase 4.5 Q&A agent with aggregate-ranking tools that depend on Phase 7's community data. The base Q&A agent ships in Phase 4.5; Phase 8 layers on tools the agent could not have used until aggregation existed.

**Inputs.** Phase 4.5 agent shipped; Phase 7 aggregation tables populated.

**Deliverables.**
- New aggregate-aware tools added to the Phase 4.5 surface:
  - `get_aggregate_ranking(filter) → Ranking`
  - `get_trending_filters(window) → []FilterSpec`
  - `get_user_history(session_or_user) → []Tournament` (only with explicit consent)
- Updated eval suite covering aggregate questions (e.g. "what do most fans think the best Water Gen 3 Pokémon is?").
- Privacy review: agent never returns another user's data; consent is gated on session/account.

**Interface to next phase.** Phase 9 extends the tool surface with `propose_tournament` enhancements that consider aggregate signals (e.g. "tournaments fans tend to enjoy").

**Exit criteria.** Eval pass rate maintained or improved over Phase 4.5; agent correctly cites aggregate sample sizes ("based on 812 completed Gen 1 tournaments"); no privacy regressions in red-team review.

**Risks.** Cost growth as conversational sessions get longer. Mitigation: per-session token cap carried over from Phase 4.5.

**Complexity.** Medium.

### Phase 9 — Agent advanced features

**Goal.** Build on the Phase 4.5 Q&A agent and Phase 8 aggregate-aware tools to ship advanced agent integrations. The basic `propose_tournament` tool already ships in Phase 4.5; Phase 9 is where the *richer* agent capabilities land.

**Inputs.** Phase 4.5 (Q&A agent) and Phase 8 (aggregate-aware tools) shipped.

**Deliverables.**
- **LLM-augmented Comparator** (D-3 reserved this hook). Optional mid-ranking assistant: agent suggests picks during a session with reasoning, never overriding the user's vote (property-tested invariant).
- **Aggregate-aware seeding.** Agent seeds the MergeSort bracket using Phase 7 aggregate data so similar Pokémon don't duel early (e.g., not Charizard vs Charmeleon in round one).
- **Commentary mode** (opt-in). Agent narrates why two Pokémon are interesting matchups; per-session token cap.
- **Refined natural-language ranking generation.** Phase 4.5's `propose_tournament` gets aggregate-aware variants ("a ranking of fans' top 20 dragons that look angry").

**Interface to next phase.** None for Phase 10; this is feature development.

**Exit criteria.** LLM-augmented Comparator passes property tests for "never overrides user vote." Commentary mode stays under per-session cost budget. 20 natural-language prompts produce 20 valid, non-empty rankings.

**Risks.** Commentary cost can spiral if not opt-in. Mitigation: opt-in only; per-session cap.

**Complexity.** Medium.

### Phase 10 — Monetization & growth

**Goal.** Convert traffic into revenue without compromising IP posture.

**Inputs.** Real Phase 7 traffic.

**Deliverables.**
- Affiliate links to Pokémon TCG retailers, gaming hardware (Switch, Pokémon games) — never Pokémon-branded merchandise.
- Creator partnerships: Wolfie and similar publish "official" curated brackets on the platform with their attribution.
- Patreon: private tournaments, custom tags, agent priority, ad-free.
- Newsletter: monthly fan-voted top 10s.
- A/B framework: experiments live behind a feature-flag service.

**Risks.** IP overreach. Mitigation: legal review of any monetization that touches Pokémon imagery directly.

**Complexity.** Medium. Mostly business work, less technical.

## 6. Open questions

See [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md) for items deferred to specific phases.

## 7. What we explicitly defer

- Mobile native apps. Web is enough; PWA later if traffic demands.
- Multiplayer real-time tournaments. Async sharing is enough.
- ROM/sprite hosting. We link to PokemonDB; we do not host their assets.
- Full evolution chain visualization in v1. Phase 5+ if useful.
- A "build your own custom tag set" feature for users. Single source of truth for tags from `tags.yaml`; users pick, don't define.

## 8. What we explicitly reject

- Single-elimination as the default ranker (it's offered, but MergeSort is the headline algorithm).
- Hand-rolled auth. Use a provider.
- A Python-everywhere stack. Python is allowed *only* if Go's agent ecosystem proves thin.
- Implementation work that runs ahead of the plan. New work goes through this document first.
