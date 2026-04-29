# Phase 1.A — Implementation Gate Summary

**Date:** 2026-04-28
**Sub-phase:** 1.A (Pokédex schema + sync skeleton)
**Aggregator:** assistant, reading the five agent reports in this directory.

## Per-agent verdicts

| Agent | Verdict | Blockers | Headline finding |
|---|---|---|---|
| `code-reviewer` | **Approve with nits** | 0 | ADR-aligned, idiomatic Go, clear phase-boundary contracts, meaningful tests. |
| `test-runner` | **Approve with nits** | 0 | 12 Go tests pass, race-clean. TS suite is a stub (S-1). |
| `schema-guardian` | **Request changes** | 3 | Schema has a generation-routing trap, missing uniqueness on `pokemon_types` and `forms`. |
| `data-sync` (beat owner) | **Request changes** | 4 | Drift-check needs `content_hash` columns now; sync_meta audit trail is thin; ingest order omits `stats`/`abilities`; concurrent-run guard missing. |
| `product-manager` (adversarial) | **Approve with nits** (Phase 1.A scope) — but raises major plan-level concerns | 0 (1.A) / 7 (plan) | Mature competitive category not acknowledged; schema is stat-heavy when fans rank by vibes; "tournament" framing is engineering-led. |

**Aggregate gate verdict: Request changes.** Two reviewers requested changes; their findings are concrete, mechanically small, and cheaper to fix now than after Phase 1.B has populated the database.

---

## Phase 1.A blockers (must address before Phase 1.B starts)

### Schema correctness (from schema-guardian)

- **B1.** `Pokemon.GenerationID` (Go) has no corresponding column on `pokemon` (SQL). Silent-drift trap: scanner picks one of `species.generation_id` / `forms.introduced_in_generation_id`, Phase 2 filter assumes the other. **Fix:** add `pokemon.generation_id INTEGER NOT NULL REFERENCES generations(id)`, populated as `COALESCE(forms.introduced_in_generation_id, species.generation_id)` at ingest.
- **B2.** `pokemon_types` PK is `(pokemon_id, slot)`; nothing prevents the same type appearing in slots 1 and 2. **Fix:** `UNIQUE (pokemon_id, type_id)`.
- **B3.** `forms` only has `slug UNIQUE`; two forms with the same `(species_id, form_name)` are permitted, and `is_default` is unconstrained (multiple defaults per species possible). **Fix:** `UNIQUE (species_id, form_name)` plus a partial unique index `CREATE UNIQUE INDEX ... ON forms(species_id) WHERE is_default = 1`.

### Sync correctness & forward-compatibility (from data-sync)

- **DS-1.** Ingestion order plan omits `stats` and `abilities` (both have FK dependencies from joins). **Fix:** revise to `generations → types → stats → abilities → moves → species → forms → pokemon → pokemon_types/stats/abilities/moves → evolution_chains → evolutions → flavor_text`. Update `bulk.go` comment block and PLAN.md.
- **DS-2.** Drift-check (Phase 1.F) needs per-row `content_hash` columns now or it ships a migration + re-sync later. **Fix:** add `content_hash TEXT NOT NULL DEFAULT ''` to `pokemon`, `species`, `forms`, `moves`, `abilities`. Document the canonicalization function so 1.F's drift-check uses the exact same hashing.
- **DS-3.** `sync_meta` audit trail is thin. **Fix:** add `schema_version`, `binary_version`, `tags_yaml_sha`, `status` (CHECK 'success'/'failed'/'partial'), `error_message`.
- **DS-4.** Concurrent runs of `pokedex-sync bulk` will silently corrupt each other (two writers to the same `.tmp`). **Fix:** acquire `flock` on `<output>.lock` for the duration of the run, OR randomize the temp suffix (`pokedex.sqlite.tmp.<pid>.<rand>`).

---

## Phase 1.A request-changes (cheap; fold into the same fix pass)

From schema-guardian:
- **R1.** Add `CHECK (base_value BETWEEN 0 AND 255)` and `CHECK (effort BETWEEN 0 AND 3)` on `pokemon_stats`.
- **R2.** Add `CHECK (slot IN (1, 2, 3))` on `pokemon_abilities`.
- **R3.** Add `CHECK (learn_method IN (...))` on `pokemon_moves` against PokeAPI's known set.
- **R4.** `Pokemon` Go struct mixes `int` (Height/Weight/BaseExperience) and `int64` (IDs). Pick one — recommend `int64` everywhere for consistency with SQLite's INTEGER and `database/sql` conventions.

---

## Disagreements between agents

**Schema-guardian vs product-manager on `pokemon.form_id UNIQUE`.**
- Schema-guardian (B-praise): "load-bearing form-identity invariant; do not relax."
- Product-manager (Critique 6): "drop UNIQUE; forecloses fusion modeling."

**Resolution:** schema-guardian is correct here. PokeAPI represents Black Kyurem, Calyrex-Ice, Necrozma-Dusk-Mane, etc. as a single `(species, form)` tuple → one `pokemon` row → one `form_id`. The "fusion" notion is about *parent-species relationships*, not about a form participating in multiple pokemon rows. If we want to model multi-parent fusions later, the right design is an additive `form_fusion_parents (form_id, parent_species_id)` join table — *not* relaxing the UNIQUE. **Keep `pokemon.form_id UNIQUE`.**

This disagreement itself is a useful data point: PM's domain breadth caught the question; schema-guardian's PokeAPI-shape knowledge resolved it. Both did their jobs.

---

## Phase 1.A nits (defer to opportunistic Phase 1.B follow-up)

- **code-reviewer N1–N5:** consistent error styles, schema-version migration TODO, slightly tighter test assertions, `:memory:` FK-PRAGMA documentation, `AUTOINCREMENT` consistency comment.
- **test-runner S-1–S-4:** web sanity test is a placeholder (replace at Phase 4 kickoff); minor test-assertion tightening.
- **schema-guardian N1–N6:** indexes for Phase 1.E query patterns (`pokemon_stats(stat_id, base_value)` covering); inline comment on the form-identity invariant; consider dropping per-row `source_commit_sha` (redundant with `sync_meta`); `flavor_text.language` enum; mixed AUTOINCREMENT style.
- **data-sync items 5–11:** add `pokemon.is_default`/`order`, several `species.*` fields (gender_rate, has_gender_differences, forms_switchable, evolves_from_species_id, order, growth_rate, etc.), `forms.form_order`/`introduced_in_version_group`, `evolutions.gender`/`time_of_day`, `moves.target`/`effect_chance`, `abilities.is_main_series`/`generation_id`, `localized_names` table, wrap ingestion in `BEGIN IMMEDIATE`/`COMMIT`.

---

## Plan-level concerns (must go through planning gate before Phase 1.B)

These are NOT Phase 1.A blockers but they affect what Phase 1.B / 1.C / 4 should look like. The PM agent is right to flag them; the user should weigh in before more code lands.

- **PL-1. Mature competitive category.** Cave of Dragonflies' favorite picker (since 2014), TierMaker (10,678+ Pokémon tier lists), RatePKMN, the 52,000-respondent "Every Pokémon is Someone's Favorite" Reddit survey, and Wolfey's "I Ranked Literally Every Pokémon" all exist. Both halves of PLAN.md §2's thesis ("toy → platform via aggregation") are taken. **Required:** a `docs/PRIOR_ART.md` and a sharper "why us, why now" paragraph in PLAN.md, before locking more sub-phase scope.
- **PL-2. Engineering-led decomposition vs early shippable.** Phase 1 has six sub-phases of invisible plumbing before any user-visible artifact. PM proposes a "crap-but-shippable" picker after 1.B, in parallel with 1.C–1.F. *Decision needed.*
- **PL-3. Headline framing: "Favorite Picker," not "Tournament Builder."** Mostly docs; schema unchanged. *Decision needed.*
- **PL-4. D-17 hot-link viability.** Cloudflare R2 free tier (10 GB / 1M ops, free egress) and Vercel image optimization are *more* zero-cost than `raw.githubusercontent.com` and avoid hotlink-throttling and Lighthouse hits. *Reconsider D-17.*
- **PL-5. Phase 8 agent is mis-sequenced.** A grounded Pokémon Q&A agent at Phase 4.5 — using the Phase 1–3 tool surface — would be the actual differentiator versus Dragonfly Cave. *Decision needed.*
- **PL-6. Aesthetic tags before Phase 1.D locks.** D-8 ("Vibes mode") is hollow without vibe-filters. Add an `aesthetic_tags` overlay (cute/cool/scary/round/humanoid/etc.) so Phase 4 ships with filters fans actually compose tournaments around.
- **PL-7. Microservices-by-stealth.** D-13 / D-7 wire up an OpenAPI codegen pipeline at solo-dev / pre-traffic stage. PM proposes Next.js reads SQLite directly via `better-sqlite3` until a second client exists. *User-Go-learning goal still satisfied via the sync binary.* Reconsider after Phase 1 finishes.

---

## Praise (for the paper trail; the agents agreed on what worked)

- **D-1 form identity** is correctly encoded by `forms.species_id` FK + `pokemon.form_id UNIQUE`. (code-reviewer, schema-guardian.)
- **Atomic-rename in `bulk.go`** is the right pattern, with stale-`.tmp` cleanup tested. (code-reviewer, schema-guardian, data-sync.)
- **`ErrNotImplemented` stubs** are an acceptable phase-boundary contract: real signatures, exported sentinel, tripwire test. (all four engineering reviewers.)
- **`PRAGMA foreign_keys = ON`** belt-and-suspenders (schema + DSN + test). (code-reviewer, schema-guardian.)
- **D-1 (form identity)** is genuinely better than what most pickers do — Dragonfly Cave bundles forms together. (PM.)
- **D-5 (URL is source of truth)** is the strongest single decision in the doc. (PM.)

---

## Aggregate verdict & action plan

**Verdict: Request changes.**

**Action plan:**

1. **Address Phase 1.A blockers (B1–B3, DS-1–DS-4) and request-changes (R1–R4) in a single fix pass.** All are mechanically small. Bump `SchemaVersion` to 2 (or rewrite schema in place since v1 has not shipped externally). Re-run the implementation gate.
2. **Hold Phase 1.B until the planning gate processes PL-1 through PL-7.** Each is either a PLAN.md amendment or a new ADR. The PM agent's role brief makes this explicit: planning gate before locking design.
3. **Defer 1.A nits (code-reviewer N1–N5, test-runner S-1–S-4, schema-guardian N1–N6, data-sync items 5–11) to opportunistic 1.B work.** Track in `docs/OPEN_QUESTIONS.md` Phase 1 section.

**The user is the final decider on action items 1 and 2.** The assistant proposes; the human accepts.
