# Phase 1.B Prerequisites — Second-Look Review

**Reviewer:** product-manager (adversarial)
**Date:** 2026-04-28
**Scope:** Focused second-look on the assistant's amendments to PL-1 through PL-6 from the original Phase 1.A review (`docs/reviews/phase-1a/product-manager.md`). PL-7 is being surfaced separately to the human and is not assessed here beyond noting that it is correctly tracked.

I am checking one question only: **did the assistant's resolutions adequately address my original critique, or did they soften / drop / under-weight anything?** My prior research stands; I am not re-surveying the field.

---

## PL-1 (prior art and the wedge)

**What was committed.** A new `docs/PRIOR_ART.md` enumerates Cave of Dragonflies, the commodity-tier pickers, TierMaker, RatePKMN, the 52,000-respondent Reddit survey, and WolfeyVGC, with a capabilities matrix and an explicit "what we should NOT do" section. PLAN.md §1 (Vision) was rewritten to acknowledge "We are entering a mature category," reference PRIOR_ART.md, and state the wedge in one paragraph: (a) grounded agent, (b) URL-addressable per-filter aggregates, (c) form-distinct competitors, (d) multi-algorithm picker.

**Does it adequately address my prior critique?** Yes, substantively. PRIOR_ART.md credibly cites the landscape, the capabilities matrix is honest about what's commodity (Dragonfly Cave's picker UX, TierMaker's per-template aggregation), and the "NOT do" section pulls real weight by naming three specific anti-patterns (UX-craft race vs Dragonfly Cave, template-breadth race vs TierMaker, "AI Pokémon site" positioning). The vision paragraph is the right size — one paragraph naming four wedge components without over-claiming a moat.

**What is dropped / soft / pending.** One soft spot: PLAN.md §2 ("Product thesis — the moat") still reads as if community aggregation alone is the moat, which my prior critique called "a 2018 thesis" because TierMaker and RatePKMN already do aggregation. The §1 update names the wedge correctly but §2 still asserts "single-player tournament tool is a toy. The same tool with public aggregation is a content platform" without acknowledging that aggregation is taken at the per-template level and that *our* aggregation differentiator is specifically per-filter-combination granularity. A reader who skips §1 and jumps to §2 will miss the wedge. Minor — fixable with a one-line edit at the end of §2 pointing to §1's wedge framing.

**Severity:** `[praise]` with a small `[nit]` on §2 internal consistency.

---

## PL-2 (early-shippable picker)

**What was committed.** OPEN_QUESTIONS.md adds a Plan-level section with PL-2 tracked as: "PM proposed a 'crap-but-shippable' Gen-1 picker after Phase 1.B, in parallel with 1.C–1.F, to get user signal before locking downstream architecture. Decision deferred to after Phase 1.E completes; revisit then with whatever signal we have." No commitment, no rejection.

**Does it adequately address my prior critique?** Partially. The assistant chose deferral, and "decide after Phase 1.E" is a defensible compromise on the surface — at that point we have ingest + tags + query API done, which is the natural earliest moment a toy could be plumbed in. But my original critique was about the *information value* of shipping early: locking D-3 (algorithms), D-5 (URL contract), D-9 (sessions) without any user signal. By Phase 1.E completion, those decisions are still locked, not just queued — D-3, D-5, D-9 are already committed and the only unlocked thing left is the UI itself. So "decide after 1.E" defers the toy past the point where the toy could have informed any architectural decision. That's a punt dressed as a deferral.

**What is dropped / soft / pending.** The actual question my critique asked — "should we ship a throwaway picker before locking downstream architecture so we have signal" — has been answered "no" without saying so. By Phase 1.E the architectural ship has sailed; the toy then becomes purely a marketing exercise, which is fine but isn't what I argued for. If the real answer is "we accept the architectural risk because we believe Phase 1.A–F is the cheapest path to a real product," that should be stated; right now it's hidden under the deferral. I'm not asking for the toy to be built — the human's call — but the deferral should be honest about what's been given up.

**Severity:** `[concern]`. Not a blocker for Phase 1.B; flag for the human as a soft-pedal to weigh.

---

## PL-3 (Favorite Picker reframe)

**What was committed.** D-19 ("Favorite Pokémon Picker" framing) is locked. It removes tournament-bracket vocabulary from user-facing surfaces, names the headline product "Favorite Pokémon Picker," and lists the consequence list (Phase 4 UI copy, Phase 5 landing pages, Phase 7 aggregate pages, Phase 4.5 agent self-description). PLAN.md §1 (Vision) opens with "A community-driven **Favorite Pokémon Picker**" and labels mergesort as "the headline ranking algorithm" with other modes plugging into "the same picker UI."

**Does it adequately address my prior critique?** Mostly yes. The framing reframe is real; D-19's consequences section is concrete; PLAN.md §1 leads with the picker framing. The headline reframe lands.

**What is dropped / soft / pending.** The reframe is not propagated through the rest of PLAN.md cleanly. Specifically:
- Phase 4's title is still "Core UI MVP (first shippable)" with deliverables headed by "Filter sidebar" and "Start tournament with algorithm picker." The user-facing button copy in PLAN.md still says "Start tournament" — that's the exact tournament-builder vocabulary D-19 was supposed to remove from user-facing surfaces.
- Phase 5's deliverables describe "Compact URL encoding for tournament + ranking" and `/r/{shortid}` — fine as internal vocabulary (D-19 explicitly permits internal "tournament" shorthand), but still leaks into copy that flows to OG cards and share previews.
- Phase 6 schema names a `tournaments` table. D-19 says internal can stay "tournament"; this is fine, but worth flagging that "tournament" appears 50+ times in PLAN.md and the assistant only renamed the §1 vision and Phase 4.5 description. The Phase 4 "Start tournament" button is a user-facing surface and contradicts D-19's own consequences list.

This is a partial reframe. D-19 itself is well-written; PLAN.md propagation is incomplete.

**Severity:** `[concern]`. The decision is locked and right; PLAN.md needs a follow-up pass to remove user-facing tournament vocabulary in Phase 4 deliverables. One-paragraph fix.

---

## PL-4 (R2 mirror commitment)

**What was committed.** D-21 commits to "before Phase 4 (UI MVP) ships, sync time also mirrors all sprite and cry assets to a Cloudflare R2 free-tier bucket." API rewrites URLs to the R2 mirror; hot-linking from `raw.githubusercontent.com` is removed from production traffic. Phase 4 exit criteria "gain 'all sprites served from R2 mirror' check." D-17 is marked superseded in part. Consequences list names the data-sync agent as the owner of mirror state.

**Does it adequately address my prior critique?** Yes, crisply. The timing commitment is concrete ("before Phase 4 ships"), the rationale enumerates the three production risks I raised (rate limits, hotlink hostility, Lighthouse), the data-model split is honest (D-17's URLs-as-columns stands; only the production-serving plan is replaced), and the rejected-alternatives list correctly diagnoses why Vercel image optimization isn't a good free-tier substitute (1,000-image cap). The Phase 4 exit-criterion update is the load-bearing piece — without it the commitment would be a vibes commitment.

**What is dropped / soft / pending.** Nothing material. One micro-nit: D-21 doesn't specify *who* operates the Cloudflare account (presumably the human owner) or what happens to the mirror if R2 changes its free-tier pricing. Not a blocker; appropriate to defer to the data-sync agent's beat.

**Severity:** `[praise]`.

---

## PL-5 (Phase 4.5 agent insertion)

**What was committed.** D-20 inserts Phase 4.5 between Phase 4 (Core UI MVP) and Phase 5 (Permalinks & SEO). Phase 4.5 ships an Anthropic-Go-SDK chat agent with four schema-validated tools (`search_pokemon`, `get_pokemon_details`, `compare_pokemon`, `propose_tournament`), system-prompt-and-tool-definition prompt caching, an eval suite of 100+ questions with CI-gated pass-rate threshold, and a per-session token cap. Phase 8 is renamed "Agent v2 (aggregate-aware)" and is a layered extension. PLAN.md Phase 4.5 section spells out goal, inputs, deliverables, interface, exit criteria (≥95% eval pass, never quotes a stat without `get_pokemon_details`, per-session cost cap), risks, and complexity.

**Does it adequately address my prior critique?** Yes, completely. The agent ships *before* Phase 5 (permalinks/SEO) and Phase 6 (sessions/auth), which was the core sequencing point of my critique. The eval suite is named with a concrete threshold and CI gate. The token cap is explicit. The "never quotes a stat without first calling `get_pokemon_details`" exit criterion is exactly the grounding-discipline check I'd want — that's the difference between "Pokémon site with chatbot" and "the only Pokémon chatbot that doesn't lie."

**What is dropped / soft / pending.** Two minor gaps versus my original critique:
1. My critique argued Phase 4.5 should also produce *user signal* — does anyone actually use the chat feature? D-20 has a per-session token cap but no analytics commitment. Without a "session-with-agent-engagement %" metric, we'd ship 4.5 and not know whether the differentiator differentiates. Not a blocker; tractable to add to Phase 4.5 deliverables.
2. The "propose_tournament" tool that's in Phase 4.5 deliverables overlaps with Phase 9's headline ("Agent tournament builder"). Phase 9 still claims "Natural-language → fully-configured tournament" as its goal, but D-20's Phase 4.5 already ships `propose_tournament(natural_language) → FilterSpec`. So Phase 9 is now ambiguous — is it still a phase, or is it folded into 4.5? PLAN.md keeps Phase 9 alive without resolving this. The assistant should have either dropped Phase 9 or scoped it down to "advanced agent features (commentary, seeding, etc.) that aren't in 4.5's MVP."

**Severity:** `[praise]` with a `[nit]` on Phase 9 scope ambiguity.

---

## PL-6 (thematic tags now, subjective tags deferred)

**What was committed.** `tags.yaml` gains a `thematic_design` overlay with ten descriptive body-archetype tags (humanoid, quadruped, serpent, aquatic, avian, mecha, round, armored, ghost_humanoid, dragon_classic), members empty pending Phase 1.D curation. PLAN.md Phase 1.D scope is expanded to include thematic curation. Subjective tags (cute/cool/scary/iconic) are deferred to community-curated overlays *post-Phase 7* with the rationale "to avoid bike-shedding."

**Does it adequately address my prior critique?** Partially — and this is the deferral I most want to flag.

What's right: thematic-design tags are objectively the easier half of my original ask, and committing to them now is a real win. The ten chosen archetypes cover the most discriminating clusters (the Whiscash/Wailord/Jigglypuff "round" cluster, the Onix/Steelix "serpent" cluster, the Magearna/Genesect "mecha" cluster). A `data-sync` agent can curate these with reasonable inter-rater reliability.

What's soft: my original critique specifically named "cute, cool, scary" as filter chips fans actually argue about, citing RatePKMN's nine-axis design rating *which is the closest competitor's already-shipped feature*. Deferring those to "community-curated overlays post-Phase 7" means our Phase 4 picker ships without subjective filters, then waits for community-curation infrastructure that doesn't exist until Phase 7+ aggregation, then needs new code to *let* communities curate them. That's three phases of waiting on a feature my critique cited as the explicit fan-favorite axis. The "bike-shedding" rationale is real but understates the cost: while we're avoiding curation arguments, RatePKMN already ranks designs on nine axes and has shipped that for years. We are *worse than the competitor in 2026* on the dimension fans care about most, and the plan is to stay worse until Phase 7+.

What I'd push back on: "deferred to community-curated overlays post-Phase 7" is a bigger concession than it appears. A more honest version would be one of:
- "We curate `cute / cool / scary` ourselves in Phase 1.D, accept the bike-shedding cost, ship it in Phase 4 alongside thematic tags." (My original ask.)
- "We ship Phase 4 without subjective tags, and Phase 4.5 (the agent) gives users a workaround — they can ask 'cute Water Pokémon' in chat and the agent does the filtering on the fly." (A clean wedge use of the agent.)
- "Subjective filters are cut from v1; the moat is filter granularity *plus* aggregation, not subjective axes." (An explicit cut, not a deferral.)

Right now we have option 3 dressed as a deferral. The human should know that.

**What is dropped / soft / pending.** The "post-Phase 7 community-curated overlays" framing is not yet locked anywhere — it's stated in `tags.yaml` and PLAN.md Phase 1.D narrative but isn't a numbered decision. If we believe in it, it should be a D-22 or a noted entry in OPEN_QUESTIONS.md Phase 7 with criteria for when community curation becomes possible.

**Severity:** `[concern]`. Not a blocker on Phase 1.B (subjective tags are a Phase 4 problem) but a soft-pedal that the human should consciously sign off on rather than absorb by default.

---

## Summary

| PL | Topic | Severity | Adequately addressed? |
|----|----|----|----|
| 1 | Prior art + wedge | praise / nit | Yes; minor §2 internal-consistency nit |
| 2 | Early-shippable picker | concern | Deferral past the point where it could inform decisions; punt dressed as compromise |
| 3 | Favorite Picker reframe | concern | D-19 right; PLAN.md propagation incomplete (Phase 4 still says "Start tournament") |
| 4 | R2 mirror | praise | Crisp commitment, correct timing, exit criteria updated |
| 5 | Phase 4.5 agent | praise / nit | Right phase, right scope, right gates; Phase 9 now ambiguous |
| 6 | Thematic tags / subjective tags | concern | Thematic accepted; subjective tags effectively cut from v1 under deferral language |

**Things I would ask the human to weigh before Phase 1.B locks:**

1. **PL-3 propagation.** Phase 4 PLAN.md deliverables still say "Start tournament" as a user-facing button. D-19 explicitly says picker vocabulary on user-facing surfaces. One-paragraph edit to Phase 4 deliverables; should land before 1.B starts so the agent doesn't carry the wrong vocabulary forward.
2. **PL-6 honesty.** "Subjective tags deferred to community-curated overlays post-Phase 7" is in practice "subjective tags cut from v1." If the human is OK with that, fine — it should be a numbered decision, not a YAML comment. RatePKMN has nine subjective axes today; Phase 4 ships with zero.
3. **PL-2 information loss.** Deferring the toy decision to "after Phase 1.E" means D-3 / D-5 / D-9 lock without user signal. Acceptable if the human believes the architectural cost of a throwaway toy outweighs the signal value, but this should be a conscious call.

None of these are blockers on Phase 1.A as committed; Phase 1.A engineering remains sound. They are concerns to factor in before the next planning gate (Phase 1.B scope lock).

---

**Verdict: Approve with nits**
