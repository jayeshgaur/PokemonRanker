# Product Manager — Re-gate Review (D-22, D-23, Phase 4.5 TS migration, Phase 1.5 tracking)

**Reviewer:** product-manager (adversarial)
**Date:** 2026-04-28
**Scope:** Tight re-gate after PL-7 resolution (D-22), subjective-tag formalization (D-23), and Phase 1.A blocker fixes. Phase 1.5 (early-shippable picker, formerly PL-2) is *not* resolved — tracking honesty is the question.

I am checking three things only:
1. D-22 (single-Vercel-deploy) and D-23 (subjective-tag cut) — does the framing match my second-look concerns?
2. Phase 4.5 — does the Anthropic-TypeScript-SDK migration soften the agent's "never quote a stat without `get_pokemon_details`" exit criterion?
3. PRIOR_ART.md and OPEN_QUESTIONS.md PL-2 — is the Phase 1.5 deferral tracked honestly, or is "deferred" being dressed up as "decided"?

This is not a re-survey. My prior research stands.

---

## 1. D-22 (single Vercel deploy) — framing check

**What landed.** D-22 is locked. It commits to a single Next.js deploy on Vercel Hobby, Next.js Route Handlers / Server Components for the runtime backend, `better-sqlite3` for Pokédex reads, TS-package engines (`packages/filter/`, `packages/ranker/`), Go restricted to the sync binary. D-7 and D-13 are explicitly marked "superseded in part." D-20 is updated to use the Anthropic TypeScript SDK. The OpenAPI codegen pipeline is dropped. The Phase 6 backend hosting question dissolves (no separate backend to host).

**Does it match my second-look concerns?** Yes, with one caveat I want to surface.

The original second-look did not directly demand Option A — it only flagged that PL-7 should be a numbered decision rather than implicit. D-22 is now a numbered decision with explicit user-priority order ("zero recurring cost, simple deploy, Go learning"), explicit rejection list (Options B, C, WASM), explicit consequences (D-7 superseded, D-13 amended, D-20 SDK swap, OpenAPI codegen dropped, dead Go HTTP scaffolding removed). That is exactly the framing rigor I asked for.

**The caveat — a new user-value risk the human may not have heard.**

> - **Observed user need.** Users want a fast, reliable picker that loads instantly and survives Reddit-front-page traffic.
> - **Current design.** Single Vercel Hobby deploy is the entire production posture. Vercel Hobby has hard limits: 100 GB bandwidth/month, 100k Edge function invocations/month, 10s function execution timeout, no commercial use. The Phase 4.5 agent is a Vercel Edge Function. A modest viral spike on a single Reddit post (Cave of Dragonflies hit r/pokemon front-page repeatedly) can push a Hobby project past the bandwidth limit; Vercel responds by *suspending* the deployment until the next month or until the user upgrades to Pro ($20/mo).
> - **Risk.** D-22's "zero recurring cost" priority creates a hard cliff under viral conditions: the site goes *offline* rather than degrading. D-18's "no paid line items except Anthropic" makes Pro-tier upgrade a *decision-violating* response to traffic. So the implicit fallback to a viral spike is "site is down for the rest of the month." That is a worse user outcome than a $20/mo Pro plan would be, and the human has not been asked to weigh "if we hit Vercel Hobby limits during a viral moment, do we (a) accept the outage, (b) violate D-18 to upgrade, or (c) eject from Vercel to a different free-tier?"
> - **Proposed alternative.** Add a one-paragraph "what happens at Vercel Hobby limits" consequence to D-22 (or to D-18). Three honest options: accept outage, allow temporary Pro upgrade as a defined exception to D-18, or have a tested Cloudflare Pages / Netlify migration path. The human picks; right now the answer is implicit and the implicit answer is "go offline."
> - **Tradeoffs.** Documenting the cliff costs a paragraph. Pre-testing a migration path costs maybe a day. Either is much cheaper than discovering the cliff during the one moment we get organic SEO traction.

This is not a blocker on D-22 as written — Option A is the right resolution given the user's stated priorities. It is a **second-order risk that the user-priority ordering surfaces**, and the human should hear it before Phase 1.B locks. D-22's `Reversibility: Medium` line gestures at this but doesn't name the cliff.

There is also a smaller concern: the Phase 4.5 chat agent runs on Vercel Edge Functions (D-22 consequences §4). Edge Functions have a 50ms CPU-time budget per invocation on Hobby. The agent's tool calls fan out to Anthropic + `better-sqlite3` reads — each tool call is well under 50ms, but a multi-turn conversation that loops `search_pokemon → get_pokemon_details → compare_pokemon` may exceed it. Worth a Phase 4.5 spike to confirm or move to Vercel Functions (Node, 10s budget) instead of Edge.

**Severity:** `[concern]` — D-22 is correctly framed; the implicit Vercel Hobby cliff is a new user-value risk that emerged from the resolution and should be named.

---

## 2. D-23 (subjective tag cut) — framing check

**What landed.** D-23 is locked. It explicitly *cuts* (not "defers") subjective design tags (cute, cool, scary, iconic, edgy, ugly) from v1. The thematic-design overlay (humanoid, quadruped, serpent, etc.) ships in 1.D. Subjective tags may return via a future ADR, ideally backed by Phase 7+ aggregate data. The rationale enumerates three reasons (bike-shedding, curation cost, aggregation is the right source). The user explicitly scoped these out ("100 tags is probably too much").

**Does it match my second-look concerns?** Yes — and this is the most direct response to my prior critique. My second-look flagged that "deferred to community-curated overlays post-Phase 7" was a cut dressed as a deferral, hidden in a YAML comment. D-23 now states the cut as a numbered decision with the user's quote in the Why section. That is exactly the honesty fix I asked for. The "ideally backed by aggregate Phase 7+ community data" framing is the cleanest of my three proposed alternatives (the "explicit cut" option), and it preserves the upgrade path.

**Does it create new user-value risks?** Yes — and this is the load-bearing question for the human.

> - **Observed user need.** RatePKMN ranks designs on nine subjective axes today. The 52,000-respondent Reddit survey ranked Pokémon as identities, not stat blocks. WolfeyVGC's three-axis scoring includes "iconic." Fans rank emotionally. This is the dimension my prior critique cited as the explicit fan-favorite axis.
> - **Current design.** D-23 cuts subjective tags from v1. Phase 4 ships with descriptive thematic filters only (humanoid, quadruped, serpent, etc.). Phase 4.5's agent partially compensates because users can ask "cute Water Pokémon" in chat, but that path requires the agent to ship correctly, the user to discover the chat, and the agent to apply subjective filtering on the fly — three things that need to all work.
> - **Risk.** Phase 4 ships and a fan tries to rank "cute Pokémon" and finds no filter for it. Their first reaction is "this is just another picker," and they bounce. The thematic tags help (round, ghost_humanoid) but they are not the vocabulary fans use. Result: D-23's cut means we are objectively *worse than RatePKMN* on the dimension RatePKMN is known for, and our compensating story (the agent) is itself a Phase 4.5 *future* deliverable.
> - **The mitigation D-23 implies but does not commit to.** D-23's "ideally backed by aggregate Phase 7+ community data" path requires Phase 7 to ship *and* the community to engage *and* aggregate data to be usable for tag derivation. That is three phases out and probabilistic. If Phase 7's traffic does not generate enough subjective-axis signal, the cut is permanent.
> - **Proposed alternative.** Either (a) explicitly couple D-23 to a Phase 4.5 agent deliverable that handles subjective queries ("cute Water Pokémon" as a chat query), making the agent the v1 substitute for subjective filtering, or (b) commit a Phase 7 entry to OPEN_QUESTIONS.md that says "evaluate at Phase 7 whether aggregate data can derive subjective tags; if not, revisit hand-curation." Right now D-23's "future ADR" is open-ended.
> - **Tradeoffs.** Option (a) increases Phase 4.5's scope by a few eval cases; option (b) is a one-line OPEN_QUESTIONS.md addition. Neither costs much. The status quo is fine if the human is consciously OK with "v1 ships without subjective filters, period."

**Severity:** `[concern]`. D-23's framing is honest now; the *consequence* — that the v1 picker is worse than RatePKMN on the most-cited fan axis — should be acknowledged in writing somewhere (D-23 Consequences, or PLAN.md Phase 4 risks). Right now D-23 implies the agent + Phase 7 will eventually fill the gap, but neither commitment is explicit.

---

## 3. Phase 4.5 TypeScript migration — does it soften the grounding exit criterion?

**What landed.** D-22's consequences §4 says: "D-20 (Phase 4.5 agent) updates: the agent uses the Anthropic TypeScript SDK, ships as a Vercel Edge Function colocated with the Next.js app. Tool surface unchanged in shape." PLAN.md Phase 4.5 is updated: deliverables now read "Anthropic TypeScript SDK integration (per D-22; runs as a Vercel Edge Function)." Tools list and Zod-validation are unchanged. **Exit criteria are unchanged**: "Eval pass-rate ≥ 95% on a curated 100-question set; agent never quotes a stat without first calling `get_pokemon_details`; per-session cost under target."

**Does the SDK migration soften the "never quote a stat without `get_pokemon_details`" exit criterion?** No, and this is good news. The exit criterion is SDK-agnostic — it is a behavioral check on the agent's outputs (does the response contain a stat that wasn't sourced from a tool call?). Whether the SDK is Go or TypeScript does not change what the eval looks for. Concretely, the eval suite's verification logic is the same in both stacks:

1. Agent returns a response.
2. Parse the response for stat-shaped strings (HP/Atk/Def/SpA/SpD/Spe values, BST sums, type effectiveness multipliers).
3. Cross-check every stat-shaped string against the agent's tool-call log for the conversation.
4. Fail if a stat appears without a corresponding `get_pokemon_details` (or `compare_pokemon`) call.

Both the Go SDK and the TypeScript SDK expose the tool-call log per turn. Both let CI inspect the conversation transcript. The grounding-discipline check survives the migration intact.

**One subtle thing the human should know.** The TypeScript SDK is in some ways *better* for this exit criterion than the Go SDK, because the Anthropic TS SDK has more mature streaming-tool-use ergonomics and richer message-shape types. So the migration arguably *strengthens* our ability to enforce the exit criterion in CI, not weakens it.

**One small drop.** PLAN.md Phase 4.5 line on "System prompt + tool definitions cached (Anthropic prompt caching) for cost" is unchanged. Worth confirming with the user that prompt caching works the same way in the TS SDK as in the Go SDK (it does — both expose `cache_control: {type: "ephemeral"}` on system blocks and tool definitions). Not a concern, just flagging.

**Severity:** `[praise]`. The exit criterion is intact and arguably better-supported by the TS SDK. No softening.

---

## 4. PRIOR_ART.md and OPEN_QUESTIONS.md PL-2 — Phase 1.5 tracking honesty

**What landed.**

PRIOR_ART.md is comprehensive and matches my second-look's "praise" verdict. The capabilities matrix, the wedge framing, and the "what we should NOT do" section all hold up. No changes needed for PL-2 visibility because PRIOR_ART.md is not the right home for the early-toy question.

OPEN_QUESTIONS.md PL-2 reads:
> **PL-2: Phase 1.5 early-shippable picker — option, not commitment.** PM proposed a "crap-but-shippable" Gen-1 picker after Phase 1.B, in parallel with 1.C–1.F, to get user signal before locking downstream architecture. Decision deferred to after Phase 1.E completes; revisit then with whatever signal we have.

**Is this honest?** Mostly. The wording "option, not commitment" is fair. "Decision deferred to after Phase 1.E completes" is the part I flagged in the second-look as a punt-dressed-as-deferral, because by Phase 1.E completion, D-3 / D-5 / D-9 are already locked and the architectural decisions the toy was meant to inform are no longer reversible. The current text neither concedes that nor pushes back on it.

The user-side framing the human got was "the assistant didn't understand Phase 1.5; the assistant has explained, awaiting decision." So the user is in the loop — this is *not* a sneak-deferral. But the OPEN_QUESTIONS.md text does not yet capture that the human has been re-pinged for a fresh call. A reader looking at OPEN_QUESTIONS.md alone would see "deferred to Phase 1.E" and not know that the conversation is currently live.

**Proposed alternative.** Update PL-2 to:
> **PL-2: Phase 1.5 early-shippable picker — under active discussion.** PM proposed a "crap-but-shippable" Gen-1 picker after Phase 1.B, in parallel with 1.C–1.F, to get user signal before locking downstream architecture (D-3, D-5, D-9). Original deferral text said "decide after Phase 1.E"; PM's second-look flagged that as a punt because by 1.E those decisions are already locked. Currently awaiting user call. Resolution: either ship the toy after 1.B (PM ask), accept the architectural lock-in (status quo), or articulate a different rationale.

That's honest about the state, the cost, and the live conversation.

**Severity:** `[concern]`. Tracking is accurate-ish but the reader has to know the conversation history to see the question is live. A two-line update fixes this.

---

## Cross-cutting: any new user-value risks the human has NOT heard?

Three.

1. **The Vercel Hobby cliff (Section 1).** Single-deploy + zero-cost + viral spike = site goes offline. Human picked the priority order; the consequence has not been named in writing. *Risk surfaced by D-22 resolution.*

2. **The "no subjective filters in v1" externality (Section 2).** D-23 frames the cut honestly but does not acknowledge in writing that the v1 picker ships objectively worse than RatePKMN on the fan-favorite axis. The implicit mitigation (agent + Phase 7) is conditional on three things lining up. *Risk surfaced by D-23 resolution.*

3. **Phase 4.5 Edge Function CPU budget.** Vercel Edge Hobby is 50ms CPU per invocation. Multi-turn agent conversations that fan out across `search_pokemon → get_pokemon_details → compare_pokemon` may bump against this. Move to Vercel Functions (Node runtime, 10s) if needed. *Risk surfaced by D-22's choice of Edge for the agent.*

None are blockers; all should be named before Phase 1.B locks so the human has heard them.

---

## Summary

| Item | Verdict | Why |
|---|---|---|
| D-22 framing | praise / concern | Right resolution, well-framed; new Vercel Hobby cliff risk + Edge Function CPU budget are not yet documented |
| D-23 framing | praise / concern | Honest now; consequence ("v1 worse than RatePKMN on fan-favorite axis") not acknowledged in writing |
| Phase 4.5 TS migration | praise | Exit criterion is SDK-agnostic; migration arguably strengthens grounding-discipline enforcement |
| PRIOR_ART.md | praise | Holds up |
| OPEN_QUESTIONS.md PL-2 | concern | Tracks the deferral but not the live conversation; minor honesty fix |

**Things to weigh before Phase 1.B locks:**
1. Document the Vercel Hobby viral-cliff scenario in D-22 or D-18 (one paragraph).
2. Acknowledge in D-23 Consequences (or PLAN.md Phase 4 risks) that v1 ships without the fan-favorite subjective axis, and either commit Phase 4.5 to handling subjective queries via chat or commit Phase 7 to revisiting the cut.
3. Update OPEN_QUESTIONS.md PL-2 to say "under active discussion" and reflect the second-look's punt critique.
4. Confirm Vercel Edge Function CPU budget is sufficient for the Phase 4.5 agent's tool fan-out, or move the agent to a Node-runtime function.

None block Phase 1.B from starting. All should be heard before Phase 1.B's scope is locked.

---

**Verdict: Approve with nits**
