# Planning gate — PL-7: deployment architecture & OpenAPI codegen

**Status:** Awaiting human decision.
**Origin:** `product-manager` agent, Critique 7 in `docs/reviews/phase-1a/product-manager.md`.
**Date:** 2026-04-28.

## The question

The PM agent argues that D-13 (Go backend + Next.js frontend, OpenAPI-generated TS client) is "microservices-by-stealth" — three runtimes (Go, Node, Anthropic) plus a generated-client tax at solo-dev / pre-traffic stage.

The PM proposes: Next.js for the public site + Go binary for the *sync job* (offline, produces a SQLite blob shipped with the Next.js app). The web app reads SQLite directly via `better-sqlite3`. No HTTP API. No OpenAPI codegen. Single deploy on Vercel Hobby.

## What this preserves and what it costs

| Goal | PM's Option A | Current plan (Option B) | Compromise (Option C) |
|---|---|---|---|
| User learns Go (D-7) | Sync binary only | Backend + sync | Backend + sync |
| Zero recurring cost (D-18) | Single Vercel deploy | Vercel + free Go host | Vercel + free Go host |
| Single-deploy ergonomics | Yes | No | No |
| Filter engine in Go | TypeScript | Go | Go |
| Ranker engine in Go | TypeScript | Go | Go |
| OpenAPI codegen pipeline | None | Phase 0 onward | Deferred to Phase 4.5 |
| Hand-written TS types | No (codegen) | No (codegen) | Yes, until Phase 4.5 |
| Phase 4.5 agent integration | Adds backend | Already has it | Already has it |

The user previously stated: *"I would prefer Go because I want to learn... I would prefer if we used Go as well."* (D-7 lock context.) Option A moves filter/ranker out of Go and into TS — that's the main cost.

## Three options

### Option A — Accept PM's proposal in full

Next.js reads SQLite via `better-sqlite3`. Filter and ranker engines become TS packages. Go is sync-binary-only.

- **Pro.** Simplest deploy. Single-runtime hot path. Lowest ops burden.
- **Pro.** True "single deployer" instinct from your earlier message satisfied.
- **Con.** You learn ~10% as much Go (sync binary only; engines are in TS).
- **Con.** Phase 4.5 agent requires adding tool-calling backend then; re-architecture is larger later.
- **Con.** The Anthropic Go SDK is the more polished agent surface; falling back to Python or moving to TS for agent costs ergonomics.

### Option B — Reject; keep current plan in full

Go HTTP API serves filter + ranker. OpenAPI codegen produces TS types from day one. Two deploys (Vercel + Fly.io free tier).

- **Pro.** You learn Go on the engines (the interesting code, not just ETL).
- **Pro.** Phase 4.5 agent integrates trivially via the existing tool surface.
- **Con.** Two-runtime hot path.
- **Con.** OpenAPI codegen pipeline at solo-dev stage is heavyweight and adds setup time before the engines ship.
- **Con.** Two deploys to manage (still both free-tier).

### Option C — Compromise (assistant's recommendation)

Keep Go HTTP backend serving filter + ranker engines. **Defer** OpenAPI codegen until Phase 4.5 (when there's a second client — the agent). Until then, hand-write TS types in `packages/shared/`. ~10 endpoints' worth of types is small; a generator pipeline isn't justified yet. The `schema-guardian` agent's beat already includes "DB / Go / TS / Zod consistency" — it polices manual sync just as it would policed generated sync.

- **Pro.** Preserves D-7 (Go for learning) on engines.
- **Pro.** Eliminates ~60% of D-13's Phase-0/1 integration scaffolding.
- **Pro.** Two deploys but both free-tier.
- **Pro.** Phase 4.5 adds the codegen *when there's an actual second client to justify it.*
- **Con.** Manual TS types means manual sync — risk of drift. Mitigation: schema-guardian gate.
- **Con.** Phase 4.5 has to add the codegen pipeline anyway; some "work saved" is just deferred.

## Assistant's recommendation

**Option C.** Smallest deviation from your stated learning goal while honoring PM's "no premature scaffolding" critique.

If accepted, the changes are:

1. **New ADR D-22:** "OpenAPI codegen deferred to Phase 4.5; until then, hand-written TS types in `packages/shared/`."
2. **Amend D-7 / D-13** with a status note pointing at D-22.
3. **No Phase 1 scope change.** Phase 1.B can proceed without re-architecture.

If you prefer A (true single-deploy, Go-as-sync-only) or B (full codegen now), say so and I'll commit accordingly.

## Decision recorded here

> Decision: _____ (A / B / C)
> Date: _____
> Rationale: _____
