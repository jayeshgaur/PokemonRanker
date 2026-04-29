# Pokemon Ranker

A community-driven Pokémon ranking platform. Users configure filters (type, generation, legendary/starter/pseudo-legendary, stat thresholds, form inclusion, etc.) and rank their top-N via interactive pairwise tournaments. Aggregate user rankings produce fan-voted "best X" leaderboards on per-filter landing pages.

## Status

Phase 0 scaffolded. Repo, agents, CI, and tooling are in place; no feature code yet.

## Quick start

```sh
# Install dependencies (JS deps + Go module tidy)
make install

# Run the Next.js dev server on :3000 (the deployable per D-22)
make web

# Build the Pokédex SQLite (Go sync binary)
make sync

# Run all checks
make all
```

See the `Makefile` for the full target list (`make help`).

## Deploying to Vercel (free)

Per D-22 the app is a single Vercel Hobby deploy — no recurring cost.

1. **Push the deploy artifact.** The Pokédex SQLite at `apps/web/data/pokedex.sqlite` is what the Next.js serverless function reads. Refresh it whenever you re-sync:
   ```sh
   make sync-from-clone   # pull latest PokeAPI data + rebuild SQLite
   make publish-db        # copy into apps/web/data/
   git add apps/web/data/pokedex.sqlite && git commit && git push
   ```

2. **First-time Vercel setup.** At [vercel.com](https://vercel.com):
   - Sign in with GitHub.
   - **Add New → Project** → import `PokemonRanker`.
   - **Root Directory:** `apps/web` (Vercel will auto-detect Next.js + pnpm workspaces).
   - **Framework Preset:** Next.js (auto-detected).
   - **Build Command, Install Command, Output Directory:** leave defaults.
   - **Environment variables:** none needed for v1.
   - Click **Deploy**.

3. **Subsequent deploys** auto-fire on every push to `main`.

The /pick route is server-rendered on demand (SQLite read at request time, ~50 ms cold). Sprites and cries hot-link from `raw.githubusercontent.com` so Vercel's bandwidth budget isn't touched. Phase 4.5 will add an Anthropic API key as the first paid line item; v1 stays $0.

## Documents

Read these in order:

1. [docs/PLAN.md](docs/PLAN.md) — Master plan: product thesis + all phases (0–10) with goals, deliverables, interfaces, exit criteria, and risks.
2. [docs/DECISIONS.md](docs/DECISIONS.md) — Locked architectural decisions and the reasoning behind each.
3. [docs/AGENTS.md](docs/AGENTS.md) — Subagent system: roster, roles, triggers, and rules.
4. [docs/GLOSSARY.md](docs/GLOSSARY.md) — Domain terminology used throughout the codebase.
5. [docs/OPEN_QUESTIONS.md](docs/OPEN_QUESTIONS.md) — Decisions deferred to future phases.

## High-level summary

- **Stack:** Go backend + Next.js (TypeScript) frontend, SQLite for read-only Pokédex, Postgres for user/session/aggregate data, Anthropic SDK for the agent layer.
- **Core feature:** Filter-driven pairwise tournament with multiple ranking algorithms (merge-sort comparator, single-elimination, Glicko-random).
- **Long-term moat:** Community aggregation — every per-user tournament feeds aggregate fan-voted rankings on filter-preset landing pages. Drives SEO, sharing, and creator partnerships.
- **AI:** Agent-first architecture. Phase 8 ships a Q&A agent; Phase 9 ships an agent that drafts tournaments from natural language. Comparator interface allows LLM augmentation (seeding, tiebreaking, commentary) without rewrites.

## Phase status

| Phase | Title | Status |
|---|---|---|
| 0 | Foundations | ✅ **Complete** — repo, agents, CI, ADRs all in place |
| 1.A | Data layer — schema + sync skeleton | ✅ **Complete** — implementation gate Approve, 2026-04-28 |
| 1.B.1 | Data layer — schema v2 + sync infrastructure | ✅ **Complete** — implementation gate Approve, 2026-04-29 |
| 1.B (full) | Data layer — 12 ingesters + query API + validation | ✅ **Complete** — batched final gate Approve, 2026-04-29 |
| 1 | Data layer | Complete (1.B closed 2026-04-29) |
| 2+3+4 | MVP slice (filter + ranker + /pick) | Superseded by per-phase rebuild |
| 2 (proper) | Filter engine | ✅ **Complete (2026-04-29)** — 7 primitives + AND/OR/NOT + 35 presets + collision-safe canonicalKey |
| 3 (proper) | Ranking engine | ✅ **Complete (2026-04-29)** — MergeSort + SingleElim + Glicko + Comparator hook (D-3) |
| 4 (proper) | Core UI | ✅ **Complete (2026-04-29)** — full sidebar (35 presets), 3-algo dropdown, podium, Vibes mode, share |
| 5 | Permalinks & SEO | Not started |
| 6 | Sessions, accounts, history | Not started |
| 7 | Aggregation & community | Not started |
| 8 | Agent v1 (Q&A) | Not started |
| 9 | Agent tournament builder | Not started |
| 10 | Monetization & growth | Not started |
