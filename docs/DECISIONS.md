# Architectural Decisions

> Each decision is locked. To change one, propose a replacement decision (D-N+1) and explicitly mark the old one as superseded. Do not edit historical decisions in place.

Format: **D-N — Title.** Decision. **Why.** Reasoning. **Rejected alternatives.** What we considered and turned down. **Reversibility.** How expensive a change would be.

## D-1 — Form identity: every (species, form) is a separate competitor

**Decision.** The atomic unit of a tournament is a `Pokemon` row, defined as a unique (species, form) tuple. Charmander, Charmeleon, Charizard, Mega Charizard X, Mega Charizard Y, Gigantamax Charizard are six distinct competitors. Regional variants, paradox forms, fusions (Black/White Kyurem), and battle-bond forms are all distinct competitors. Default *filters* may hide pre-evolutions or non-final forms, but the *data model* never collapses them.

**Why.** Real fan preference depends on form. Mega Charizard Y is a different favorite than Charizard. Players use pre-evolutions competitively in formats with Eviolite or Assault Vest (e.g., Rhydon). Megas may be in or out of a given generation's metagame; users must be free to include or exclude. Collapsing forms forecloses these distinctions.

**Rejected alternatives.**
- *Species-level identity, form as decoration.* Loses fidelity; cannot rank "best Mega" tournaments cleanly.
- *Final-evolution-only by default at the data layer.* Bakes a filter into the schema, hard to undo.

**Reversibility.** High cost to undo — schema change + migration. Lock confidently.

## D-2 — Tags ownership: curated `tags.yaml`, not derived

**Decision.** Categorical tags (legendary, mythical, sub-legendary, pseudo-legendary, starter, fossil, baby, ultra-beast, paradox, regional-variant, mega, gmax, fusion) live in a hand-curated `tags.yaml` checked into the repo. Sync joins this against PokeAPI data to produce `pokemon_tags`. New tags are added via PR.

**Why.** PokeAPI does not authoritatively label "pseudo-legendary" or "starter" — these are community concepts. Deriving them heuristically (e.g., BST ≥ 600 + 3-stage = pseudo) misclassifies edge cases. A curated source is auditable, version-controlled, and reviewable.

**Rejected alternatives.**
- *Heuristic derivation.* Wrong on edge cases; users complain.
- *User-defined tags.* Fragments aggregation. Centralized tags are required for the moat (D-11).

**Reversibility.** Low cost — `tags.yaml` is data, easy to edit.

## D-3 — Pluggable tournament algorithms

**Decision.** Tournament logic implements a `Ranker` interface with three v1 implementations: `SingleElim`, `MergeSortComparator`, `GlickoRandom`. The interface accepts a `Comparator` abstraction so future LLM-augmented variants (LLM-driven seeding, tiebreaking, commentary) plug in without rewrites.

**Why.** No single algorithm fits all goals. SingleElim is fast for top-1; MergeSort gives true ranking; Glicko is anytime. The user explicitly asked that this layer be flexible because some logic may be offloaded to an LLM later — the Comparator abstraction makes that drop-in.

**Rejected alternatives.**
- *Hardcode one algorithm.* Forces a rewrite when we add the second.
- *Strategy pattern with no Comparator abstraction.* Makes LLM augmentation a fork rather than an extension.

**Reversibility.** Medium — a hardcoded V1 would force a refactor. Designing pluggability now is cheap and forward-compatible.

## D-4 — Two stores: SQLite (Pokédex, read-only) + Postgres (user/aggregate data)

**Decision.** The Pokédex (species, forms, stats, tags, sprites, etc.) lives in a SQLite file built at sync time and bundled with the backend deployment artifact. User sessions, accounts, tournaments, rankings, duels, and aggregates live in hosted Postgres (Neon or Supabase).

**Why.** The two datasets have opposite profiles. Pokédex is small, static, read-only, and changes once per generation — SQLite is ideal: zero ops, file-based, version-controllable. User data is mutable, transactional, joinable for aggregation, and grows unboundedly — Postgres is required.

**Rejected alternatives.**
- *Postgres-only.* Adds operational cost for the static Pokédex with no benefit.
- *In-memory JSON for Pokédex.* Fine for a 1000-row dataset, but loses indexes and SQL ergonomics. Not enough win.
- *SQLite for both.* Doesn't scale aggregation queries; lacks proper concurrent writes.

**Reversibility.** Medium for either store individually. Lock now to avoid relitigating.

## D-5 — URL is the source of truth for tournament config

**Decision.** A tournament's filter spec and algorithm are encoded in its URL. In-progress ranker state is also URL-encodable (compact). Refreshing the page recovers state. Sharing a URL shares the full setup.

**Why.** Three downstream wins:
1. *Sharing* — paste a URL, anyone can run the same tournament.
2. *SEO* — every preset is a stable, indexable route (`/best/water-type-gen-1`).
3. *Aggregation* — every completed tournament hashes its filter spec from its own URL; rollups are trivial.

**Rejected alternatives.**
- *Server-only state with opaque IDs.* Worse SEO; harder sharing without auth.
- *Cookies for state.* Doesn't survive cross-device sharing.

**Reversibility.** High cost — URL contracts are public once shared. Lock confidently.

## D-6 — Strict validation at every IO edge

**Decision.** Schemas (Go: `go-playground/validator` and generated structs from `sqlc`; TS: Zod) validate at every IO boundary: PokeAPI fetch responses, URL params, form inputs, agent tool args, DB writes, DB reads from untrusted sources.

**Why.** The agent (Phase 8) calls the same APIs as the UI. Loose validation creates exploit surface for prompt-injected agents. Strict validation also documents the contract.

**Rejected alternatives.**
- *Validate at the UI layer only.* Backend trusts inputs; agent breaks it.
- *Trust internal callers.* Goes against agent-first design (D-10).

**Reversibility.** Low cost — easier to tighten than loosen, so add as we go is acceptable, but defaulting to strict from day 1 is cheaper.

## D-7 — Stack: Go backend + Next.js frontend

**Decision.** Go (chi router, sqlc, go-playground/validator) for backend services and the Pokédex sync binary. Next.js 15 (App Router) + TypeScript for the frontend. Postgres (Neon) and SQLite (bundled). Anthropic Go SDK for the agent layer in Phase 8, with Python escape hatch if Go's agent ecosystem proves thin. API contract: REST + OpenAPI spec generated from Go, TS client generated from spec.

**Why.** User wants to learn Go (stated preference). Go is excellent for typed, fast, deployable services. Next.js for SEO-critical landing pages and React for interactive duel UI. OpenAPI bridges the language boundary type-safely.

**Rejected alternatives.**
- *Pure Next.js (TypeScript everywhere).* Smaller footprint but doesn't serve the learn-Go goal.
- *Python (FastAPI) backend.* User is comfortable in Python but explicitly named Go as the learning target.
- *gRPC/Connect-RPC.* Type safety is great but operational complexity higher than REST + OpenAPI.

**Reversibility.** Medium. Switching backend language is expensive; switching frontend framework less so.

**Status:** Superseded in part by D-22 (2026-04-28). The Go backend HTTP API role is removed. Go remains for the sync binary (`cmd/pokedex-sync`). Runtime backend duties move to Next.js (TypeScript) per D-22.

## D-8 — Stat-visibility toggle (Informed vs Vibes mode)

**Decision.** The duel screen offers a toggle between *Informed mode* (stats, types, abilities visible) and *Vibes mode* (sprite + name only). The user picks before the tournament starts; can change mid-tournament with a confirmation that this changes the experience.

**Why.** Showing stats biases users toward objectively-strong Pokémon (Mewtwo always wins). Hiding stats makes ranking aesthetic. Both are legitimate user goals. Letting the user pick avoids us choosing a winner.

**Rejected alternatives.**
- *Always show stats.* Distorts taste rankings.
- *Never show stats.* Frustrates users who want competitive analysis.

**Reversibility.** Low cost.

## D-9 — Anonymous sessions are first-class

**Decision.** Every visitor gets a server-tracked session via cookie. Tournaments saved to the session — full history, shareable, aggregatable — without requiring an account. Sign-up triggers a session-merge flow that transfers session-tournaments to the new account.

**Why.** Login walls kill conversion. We need data from anonymous traffic to make Phase 7 aggregation work. Sessions also enable per-device anti-abuse without coupling to identity.

**Rejected alternatives.**
- *Login required to save.* Caps the aggregation funnel at signup conversion rate.
- *LocalStorage only for anonymous.* Doesn't reach the server, doesn't feed aggregates.

**Reversibility.** High cost — schema, auth flow, and aggregation logic all assume sessions exist. Lock now.

## D-10 — Agent-first architecture

**Decision.** The agent layer (Phase 8+) calls the same APIs as the UI. Tool schemas are derived from the same Go types as the REST endpoints. The agent never gets a back door; if the agent can do it, the UI can too, and vice versa. The PM agent (see [AGENTS.md](AGENTS.md)) participates in design discussions throughout, not just at Phase 8.

**Why.** The user wants the project to reflect 2026 Silicon Valley best practice — agents as core surface, not bolt-on. Reusing API contracts means the agent benefits from every UI improvement and vice versa. Avoiding back doors means agent capability ≤ user capability — important for safety and reasoning about behavior.

**Rejected alternatives.**
- *Agent as a separate stack.* Drift between UI and agent capabilities. Two systems to maintain.
- *Agent only as Phase 8 add-on with no architectural impact.* Forces refactor at Phase 8 to align contracts.

**Reversibility.** Medium — depends on how much agent code accretes before realignment.

## D-11 — Community aggregation is the long-term thesis

**Decision.** The product moat is fan-voted aggregate rankings published on filter-preset landing pages. Phase 4 ships a single-player tool, but every architectural choice from Phase 0 onward preserves the path to aggregation. Phase 7 builds the aggregation features.

**Why.** A solo ranking tool is replaceable. A continuously-updated set of fan-voted rankings is content that compounds with usage and produces SEO + virality. This is what makes the project a candidate for revenue.

**Rejected alternatives.**
- *Single-player tool, ship and stop.* No moat, no business case.
- *Aggregation from day 1.* Premature; needs traffic to be meaningful. We design for it but don't build it until we have data.

**Reversibility.** Medium. Backing out is possible but costly. Lock until disproven by traffic.

## D-12 — IP/legal: fan-use only, no Pokémon merchandise

**Decision.** The site hosts no Pokémon-owned assets except sprites loaded from public CDNs (PokeAPI, Pokémon Showdown) and short flavor text quoted under fair use. No selling of Pokémon-branded goods. No claiming endorsement by Nintendo/Game Freak/The Pokémon Company. Affiliate links to TCG retailers and Switch hardware are acceptable in Phase 10; affiliate links to "Pokémon plushies on Amazon" are not.

**Why.** Fan ranking sites have a long, peaceful precedent (Smogon, Bulbapedia, PokemonDB). The bright lines that get sites C&D'd are merch, claimed endorsement, and ROM hosting. Stay clear of all three.

**Rejected alternatives.**
- *Sell branded merch via Print-on-Demand.* Fast track to legal action.
- *Claim partnership with TPC.* Same.

**Reversibility.** N/A — these are non-negotiable.

## D-13 — Repo layout: single monorepo with pnpm workspaces + a sibling Go module

**Decision.** One repo at the project root contains:
- `apps/api/` — Go module (`github.com/jayesh/pokemon-ranker/api`), root of all backend code, with its own `go.mod`.
- `apps/web/` — Next.js + TypeScript app, name `@pokemon-ranker/web`.
- `packages/*` — TypeScript packages (created when needed; the future home of the OpenAPI-generated TS client).
- `docs/`, `.claude/agents/`, `.github/workflows/` — repo-level concerns at the top.

`pnpm-workspace.yaml` covers `apps/web` and `packages/*`. The Go module is a sibling, managed via `cd apps/api && go ...`. The top-level `Makefile` orchestrates cross-language commands.

**Why.** A monorepo keeps the contract between backend and frontend visible in one place; PRs that touch both layers stay coherent. Two separate repos would force coordinated PRs, which is overhead for a solo developer. pnpm workspaces handle the JS side cleanly without trying to swallow Go.

**Rejected alternatives.**
- *Two separate repos (api/ and web/).* More overhead for cross-cutting changes; loses the shared-types ergonomics from `packages/`.
- *Nx or Turborepo.* Adds tooling complexity for marginal gain at this scale.
- *A single `go.mod` at the root that also covers `cmd/web-something`.* Mixing languages in one Go module is confusing; pnpm is the right tool for the JS half.

**Reversibility.** Medium. Splitting later is mechanical but real work.

**Status:** Amended by D-22 (2026-04-28). Repo layout retained: `apps/api/` (Go sync binary), `apps/web/` (Next.js), `packages/*` (TS packages including filter, ranker, shared types). The `apps/api` directory name is retained for stability even though "api" is now a misnomer (consider `apps/sync` rename in a future ADR).

## D-14 — Subagent definitions live in `.claude/agents/`

**Decision.** All Claude Code subagent definitions live in `.claude/agents/<name>.md` at the repo root, with YAML frontmatter (`name`, `description`, `model`, `tools`) and a Markdown body containing the agent's role brief.

**Why.** This is Claude Code's convention. Putting the files at the repo root makes them discoverable by anyone working in the project and keeps the agent system in version control.

**Rejected alternatives.**
- *`docs/agents/` (just markdown, no harness integration).* Loses the auto-loading benefit.
- *Per-app agents (e.g., `apps/api/.claude/agents/`).* Most agents are project-wide; per-app would fragment the roster.

**Reversibility.** Low. Easy to move.

## D-15 — CI: GitHub Actions

**Decision.** Continuous integration runs on GitHub Actions. Two parallel jobs:
- **api** — `go vet`, `golangci-lint`, `go test -race`, with Go module cache.
- **web** — `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, with pnpm cache.

Both jobs run on every push to `main` and on every PR targeting `main`.

**Why.** GitHub Actions has the deepest ecosystem for both Go and Node; both `actions/setup-go@v5` and `pnpm/action-setup@v4` are first-class. Keeping CI in the repo (`.github/workflows/ci.yml`) makes the build reproducible from the source tree alone.

**Rejected alternatives.**
- *Vercel-only CI.* Covers the web app but not the Go backend.
- *Self-hosted runner.* Overkill for a hobby/early-stage project.

**Reversibility.** Low. Workflows are portable.

## D-16 — Go test framework: stdlib `testing` + `testify`

**Decision.** Go tests use the standard library `testing` package. Assertion ergonomics come from `github.com/stretchr/testify/assert` and `require`. No alternative test framework (Ginkgo, Gomega, etc.).

**Why.** stdlib `testing` is idiomatic Go. `testify` adds clean assertions without imposing a BDD style. The combination is the most common in production Go codebases and easy to read.

**Rejected alternatives.**
- *Ginkgo + Gomega.* Imposes a BDD style that isn't idiomatic in the rest of Go.
- *stdlib only, no testify.* Verbose for the common assertion patterns.

**Reversibility.** Low. Test imports are easy to refactor.

## D-17 — Hot-link sprites and cries from PokeAPI's GitHub for v1 (superseded in part by D-21)

**Decision.** Sprite and cry URLs are stored as columns on the `pokemon` row. They point upstream to PokeAPI's GitHub-hosted assets (`raw.githubusercontent.com/PokeAPI/sprites/...` and `.../cries/...`). The site does not host or proxy these assets in v1; image and audio elements load them directly from PokeAPI's GitHub.

**Why.** Self-hosting incurs storage and bandwidth costs (D-18 forbids those). PokemonDB and similar long-running fan sites use this approach without issue. The data model stores upstream URLs, so a future switch to a self-hosted CDN is a rewrite at API response time, not a schema change.

**Rejected alternatives.**
- *Bundle assets in the deployment image.* Bloats the backend by hundreds of MB; slows CI; doesn't scale.
- *Mirror to our own CDN (R2 / S3) now.* Recurring cost; premature for v1 when traffic is unknown.
- *Lazy proxy with cache.* More code and failure modes than we need today.

**Reversibility.** Low — swapping in our own CDN means rewriting URLs at API response time and seeding a bucket. Schema unchanged.

**Consequences.** We accept the rate-limit / blocking risk from `raw.githubusercontent.com`. If/when it becomes a real problem, the fix is to mirror to our own CDN — a Phase 7+ concern.

**Status:** Superseded in part by D-21 (2026-04-28). The data-model half of D-17 stands (URLs as columns on `pokemon`, sourced from PokeAPI). The production-serving half (hot-link from `raw.githubusercontent.com` directly to user browsers) is replaced by Cloudflare R2 mirroring before Phase 4 ships.

## D-18 — Zero-cost operational posture; AI API spend is the only paid line item

**Decision.** Pokemon Ranker runs on free tiers across the stack. The only paid expense is the Anthropic API key for the Phase 8+ agent layer, billed per request. Hosting (Vercel Hobby for Next.js, free-tier Go-friendly host for the API), database (Neon or Supabase free tier when Postgres comes online in Phase 6), CDN (none in v1; per D-17 we hot-link from PokeAPI), CI (GitHub Actions free for public repos), and analytics (Plausible self-hosted or PostHog free tier) all stay free.

**Why.** This is a personal project. A zero-recurring-cost constraint forces architectural simplicity, prevents lock-in, and lets the project survive indefinitely without user revenue. The user explicitly stated this constraint.

**Rejected alternatives.**
- *Pay $5–20/month for a small VPS for ergonomic ops.* Reasonable but rejected — the constraint of zero cost is a feature, not a bug.
- *Monetize early to fund hosting.* Inverts the priority. Product first; revenue is a Phase 10 concern.

**Reversibility.** Low cost to relax (just provision paid infra); higher cost to retighten if architecture has accreted to assume paid services. We design assuming free and revisit at Phase 10 if traffic warrants.

**Consequences.**
- The Go backend deployment target must fit a free tier. Open question for Phase 6: Fly.io free tier vs Oracle Cloud Free Tier vs co-hosting both apps on one VPS.
- Postgres (Phase 6) uses Neon or Supabase free tier.
- We accept the rate-limit / blocking risk of D-17 (superseded by D-21 — Cloudflare R2 free tier).
- New services are checked against this decision before being introduced.

## D-19 — Product framing: "Favorite Pokémon Picker" with tournament ranking as one of multiple modes

**Decision.** The headline product framing is **"Favorite Pokémon Picker."** Tournament-bracket vocabulary is removed from user-facing surfaces. Tournament-style mergesort comparator ranking is the *default* algorithm but is presented as one of several *picker modes* (alongside Dragonfly-Cave-style multi-select rounds, single-elim quick-rank, anytime Glicko-random). Internal documentation may use "tournament" as shorthand for "ranking session"; public copy uses "picker," "favorites," and "ranking."

**Why.** Real fan vocabulary in 2026 is "my favorite Pokémon," not "Pokémon I'd advance through a single-elim bracket." WolfeyVGC ranks declaratively; the 52,000-respondent Reddit survey is single-question; Cave of Dragonflies is a *picker*. PLAN.md's earlier "tournament builder" framing was internal-engineering convenience leaking into user copy. Reframing is mostly docs and naming; the schema and ranker abstractions don't change.

**Rejected alternatives.**
- *Keep "Tournament Builder" as the headline.* Aligns with the underlying mergesort algorithm but uses vocabulary fans don't.
- *Use both ("Pick & Tournament").* Splits brand attention; weaker SEO for either term.

**Reversibility.** Low cost to undo (rename copy + headers). Lock confidently.

**Consequences.**
- Phase 4 UI copy and route titles use "Picker" framing.
- Phase 5 per-preset landing pages title as "Best [type] Pokémon — fan-voted picker results."
- Phase 7 aggregate pages use "fan-voted favorites" language.
- Phase 4.5 agent describes itself as "your Pokémon picker assistant," not "tournament builder."
- The `Decision` enum in the ranker (D-3) is unchanged; it's an internal concept.

## D-20 — Phase 4.5: ship a Pokémon-grounded Q&A agent before Phase 5

**Decision.** Insert a Phase 4.5 sub-phase between Phase 4 (Core UI MVP) and Phase 5 (Permalinks & SEO). Phase 4.5 ships a chat agent that uses the Phase 1–3 tool surface (Pokédex query API, filter engine, ranker engine) to answer Pokémon questions and propose tournaments grounded in real data. Phase 8 is renamed "Agent v2 (aggregate-aware)" and is a *layered extension* on top of the v1 surface that ships in 4.5.

**Why.** A Pokémon-grounded LLM agent is the strongest differentiator we have versus the mature picker category (Cave of Dragonflies, TierMaker, RatePKMN — see PRIOR_ART.md). Sequencing it after aggregation (Phase 7) means the differentiator ships years late, and the user signal we'd get from agent-driven tournaments is delayed past several locked decisions that the agent might have informed. The Phase 1–3 tool surface is sufficient for Q&A and tournament proposals; aggregation is value-add, not prerequisite.

**Rejected alternatives.**
- *Wait until Phase 8 as originally planned.* Buries the headline differentiator behind aggregation work.
- *Bundle agent into Phase 4.* Risks scope creep on the first shippable; Phase 4.5 is small but discrete.
- *Skip Phase 8 entirely; Phase 4.5 is the agent forever.* Loses the aggregate-aware tools that make the agent useful for "what do other fans think?" questions.

**Reversibility.** Medium. Re-sequencing later is possible but the agent's tool surface should be designed early; Phase 4.5 is the cheapest place to learn what tools the agent actually wants.

**Consequences.**
- Anthropic API cost begins at Phase 4.5 instead of Phase 8. D-18 contemplates this; we cap per-session tokens.
- The `agent-tool-author` agent activates at Phase 4.5, not Phase 8.
- Phase 9 (Agent tournament builder) is unchanged — it builds on Phase 4.5's `propose_tournament` tool.

## D-21 — Sprite/cry assets: store upstream URL, mirror to Cloudflare R2 free tier before Phase 4 ships (supersedes D-17 in part)

**Decision.** D-17's data model stands: sprite and cry URLs are stored as columns on the `pokemon` row, sourced from PokeAPI. The supersession is the production-serving plan: **before Phase 4 (UI MVP) ships, sync time also mirrors all sprite and cry assets to a Cloudflare R2 free-tier bucket** (10 GB storage, 1M Class-A ops/month, free egress). The API response rewrites URLs to the R2 mirror. Hot-linking from `raw.githubusercontent.com` is removed from production traffic; the upstream URLs remain in the row as the source of truth that the mirror is built from.

**Why.** Hot-linking has three production risks PM identified (Critique 4 in product-manager.md):
1. **GitHub raw rate limits.** Unauth requests to `raw.githubusercontent.com` are rate-limited per IP. A modest viral spike could trip them.
2. **Hotlink hostility.** GitHub has historically thrown rate limits at side-channel hotlinking from third-party sites.
3. **Performance baseline.** `raw.githubusercontent.com` is a code CDN, not an image CDN. No `Cache-Control: immutable`, no WebP negotiation, no resizing. Each costs Lighthouse points (Phase 4 exit criterion is ≥90).

R2 free tier covers 10 GB for free, with free egress, and stays inside D-18's zero-cost posture (the Pokémon sprite set is ~50 MB).

**Rejected alternatives.**
- *Continue hot-linking (D-17 unchanged).* Accepts the three risks above for marginal simplicity. Already shown to dent Lighthouse on similar sites.
- *Mirror to Vercel Image Optimization with upstream URLs.* Vercel Hobby caps at 1,000 source images/month; we have 1,300+ Pokémon × 4 sprite variants. Cliff during normal use.
- *Mirror to a different CDN (Bunny.net, Backblaze B2).* All have free tiers; R2 is more generous and avoids Vercel image-optimization quotas.
- *Self-host on the Go backend.* Bandwidth costs blow D-18.

**Reversibility.** Medium. The data model is unchanged from D-17, so rolling back is a one-line API response change.

**Consequences.**
- A Cloudflare account is now in scope (free, no credit card required).
- Sync time gains a "mirror to R2" step; sync is not considered complete until the mirror is in sync.
- The `data-sync` agent's beat extends to include R2-mirror state.
- Phase 4 exit criteria gain "all sprites served from R2 mirror" check.
- D-17 is superseded in part; D-17's data-model decision (URLs as columns) stands.

## D-22 — Single Vercel deploy: Next.js reads SQLite directly; engines in TypeScript; Go restricted to sync (PL-7 resolution; supersedes D-7 / D-13 in part)

**Decision.** Pokemon Ranker deploys as a single Next.js application on Vercel Hobby. Frontend, backend (Next.js Route Handlers / Server Components), and the Phase 4.5 agent (Vercel Edge Function via the Anthropic TypeScript SDK) live in one deployable unit. The Pokédex SQLite is built by a Go sync binary (`apps/api/cmd/pokedex-sync`) and bundled with the Next.js app at build time; Next.js Server Components / Route Handlers read it via `better-sqlite3`. Phase 2 (filter engine) and Phase 3 (ranker engine) ship as TypeScript packages in `packages/filter/` and `packages/ranker/`. Go is restricted to the sync binary and any future offline tooling. There is no Go HTTP backend in production.

**Why.** PL-7 was the user's call between three options (full analysis at `docs/reviews/planning/PL-7-deployment-architecture.md`). The user prioritized (1) zero recurring cost, (2) simple/single deploy, (3) Go learning, in that order, with explicit "single deploy is preferred... it's up to you... just make sure it's free." Option A maximizes (1) and (2). Go learning is preserved on the substantive Phase 1.B sync work; the engines (filter, ranker) being in TypeScript trades a small amount of Go practice for a much simpler operational footprint and a single free-tier vendor (Vercel) instead of two.

**Rejected alternatives.**
- *Option B (full Go backend + OpenAPI codegen).* Heaviest Phase-0/1 setup; premature for solo-dev scale.
- *Option C (Go HTTP backend + hand-written TS types).* Best Go-learning footprint but requires two free-tier deploys (Vercel + Fly.io / Oracle Cloud). Free-tier dependence on a second provider is more fragile than committing entirely to Vercel Hobby.
- *Compile Go to WebAssembly via tinygo and run engines in-browser.* Cool but tooling immaturity, debugging cost, and no real performance argument at our dataset size.

**Reversibility.** Medium. Adding a Go backend later is straightforward — the sync binary's pokedex package can be repurposed and the deleted `apps/api/cmd/api/` scaffold can be revived from git history.

**Consequences.**
- D-7 (Stack: Go backend + Next.js) is superseded in part. Go remains for the sync binary; the runtime backend is Next.js.
- D-13 (Repo layout) is amended. The `apps/api/` directory remains as the Go sync workspace; rename to `apps/sync` deferred.
- D-10 (Agent-first architecture) holds: the agent calls the same internal API (Next.js Route Handlers) that the UI uses. Tool schemas are derived from the same TS types as the API contract. No back doors.
- D-20 (Phase 4.5 agent) updates: the agent uses the Anthropic TypeScript SDK, ships as a Vercel Edge Function colocated with the Next.js app. Tool surface unchanged in shape.
- The OpenAPI codegen pipeline (a feature of D-13's original framing) is dropped. With both halves in TypeScript, contracts are enforced by shared types in `packages/shared/`.
- `apps/api/cmd/api/` (Go HTTP server with `/healthz`) and `apps/api/internal/health/` are removed in this decision's commit. They were Phase-0 scaffolding for the old D-7 architecture.
- The Phase 6 backend hosting question (Fly.io vs Oracle Cloud) is resolved: there is no separate backend to host. Postgres for user data (Phase 6) is reached via Next.js Route Handlers using a Postgres TS client (Neon-compatible).

## D-24 — Default form-inclusion: `final-evolutions-excluding-mega`

**Decision.** The default `formInclusion` mode for the filter engine (`packages/filter/`) is `final-evolutions-excluding-mega`: each species's final evolutionary stage, **excluding** Mega Evolutions and Gigantamax forms, **including** regional variants. This is the implicit form filter when a user starts a picker without specifying a form-inclusion mode (i.e., when `Filter.formInclusion` is undefined and the legacy `Filter.includeAlternateForms` shim is also undefined).

**Why.** Real casual-fan vocabulary in 2026: "rank my favorite Pokémon" = "rank the iconic adult forms." Pre-evos are noise (the explicit MVP user complaint that triggered this fix: *"I was asked to compare Charmander vs Charmeleon"*). Megas and GMax are battle gimmicks layered on top of a favorite. Regional variants are genuinely distinct favorites in fan vocabulary (Alolan Raichu vs Kantonian Raichu) and should be included. This default minimizes "why is Charmander in here" surprise on first run.

The `OPEN_QUESTIONS.md` Phase 2 entry called this out as "probably `FinalEvolutionsExcludingMega`"; this ADR locks it so Phase 4's UI defaults, the Phase 4.5 agent's `propose_tournament` defaults, and Phase 7 aggregation rollups all align without re-litigating.

**Rejected alternatives.**
- *`default-forms-only`* (the v1 MVP behavior). Keeps Bulbasaur and Charmander in — the original bug.
- *`final-evolutions-only`*. Leaves Megas and GMax in. Power users want this; casuals don't.
- *Custom heuristic (e.g., "default forms but only the latest stage")*. Reinventable as `final-evolutions-excluding-mega` exactly — pick the named mode.

**Reversibility.** Low cost. Change `DEFAULT_FORM_INCLUSION` constant in `packages/filter/src/index.ts`. URL contract is unaffected because the default is omitted from `canonicalKey`.

**Consequences.**
- Phase 4 picker copy says something like "ranks the iconic form of each species you'd find in your party."
- Phase 4.5 agent's `propose_tournament` defaults to this when the user is unspecific.
- Phase 7 aggregation rolls up under this default for any tournament that didn't override it.
- `OPEN_QUESTIONS.md` Phase 2 entry updated: "Default form-inclusion mode" is closed (resolved here).

## D-23 — Subjective design tags (cute, cool, scary, iconic) deferred from v1

**Decision.** The thematic-design overlay added to `apps/api/data/tags.yaml` (per PL-6) is restricted to *descriptive* categorical tags — humanoid, quadruped, serpent, aquatic, avian, mecha, round, armored, ghost_humanoid, dragon_classic, etc. *Subjective* design tags (cute, cool, scary, iconic, edgy, ugly, etc.) are explicitly deferred from v1. They may be added back via a future ADR, ideally backed by aggregate Phase 7+ community data rather than hand curation.

**Why.** The user explicitly scoped these out: "general labels that are used to describe Pokémon categories... that should be fine. 100 tags is probably too much." The PM agent's second-look review flagged that deferring subjective tags via a YAML comment was insufficient — if we are cutting them, the cut should be a numbered decision so future readers see it. This ADR formalizes the cut.

Three reasons the cut is correct:
1. Subjective tags are bike-shed magnets in PR review (is Charizard "cool" or "iconic"?).
2. A small starter set (50–100 entries each, as PM originally proposed) is too much hand-curation effort at our solo-dev scale and risks low-quality output that erodes the picker's credibility.
3. The right source for subjective ranking *is* user-aggregate data (Phase 7+). Hand-curation under-scales this; aggregation over-scales it.

**Rejected alternatives.**
- *Commit to a small hand-curated set in Phase 1.D.* User declined this scope.
- *Derive subjective tags heuristically (BST → "cool", body type → "cute").* Bad PR experience; users will dispute.

**Reversibility.** High — `tags.yaml` is editable. A future ADR can re-introduce subjective tags backed by aggregate community data once Phase 7 is live.

**Consequences.**
- D-8 Vibes mode in Phase 4 ships with descriptive thematic filters only.
- The `data-sync` agent does not curate subjective tags in Phase 1.D.
- Phase 7 aggregate data may later be repurposed to derive subjective tags algorithmically — separate ADR.
