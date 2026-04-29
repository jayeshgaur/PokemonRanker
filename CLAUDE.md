# Pokemon Ranker — Assistant Instructions

This file governs how the assistant works on this repo. Read fully before any task. The user has explicitly required that subagents are active collaborators, not passive documentation.

## Read first, every session

1. `docs/PLAN.md` — phase-by-phase roadmap and current status.
2. `docs/DECISIONS.md` — locked architectural decisions (D-1, D-2, …). Do not violate.
3. `docs/AGENTS.md` — subagent roster and the workflow rituals below.
4. `docs/OPEN_QUESTIONS.md` — unresolved items, tagged to phase.
5. `docs/reviews/` — paper trail of past gate reviews. Skim the latest before opening a new sub-phase.

## SDLC: gates and rituals

The user requires explicit, paper-trailed agent reviews. Two gates apply.

### Planning gate — fires before locking design

Triggers: locking a new ADR (D-N), defining or revising a sub-phase's scope, picking between competitive options where one is hard to reverse.

Steps:

1. Draft the proposal in plain text (in the response or a temporary planning doc).
2. Invoke the `product-manager` agent with the proposal and the relevant context (PLAN.md, DECISIONS.md, the affected files).
3. Wait for its critique. Save it to `docs/reviews/planning/D-<n>-<slug>.md` (or `phase-<n>/_planning-<topic>.md`).
4. Either incorporate the critique into the proposal, or write a one-paragraph counter-argument in the ADR's "Rejected alternatives" section explaining the reasoning.
5. Only then commit the change to `DECISIONS.md` / `PLAN.md`.

This is mandatory for every ADR. "It's a small decision" is not an excuse — a small habit beats a half-baked decision.

### Implementation gate — fires before declaring a sub-phase complete

Triggers: any sub-phase boundary (1.A → 1.B, 1.E → 1.F, etc.), or a logically-cohesive batch of changes that adds new tables / endpoints / agents.

**User-directed batching.** The user may explicitly direct that gates run less frequently (e.g., once at the end of a multi-sub-phase run rather than after each sub-phase boundary). When so directed, batch the gate at the named boundary; do not silently skip gates without an explicit user directive. Record the directive in this turn's text so the next session sees it. The 2026-04-29 directive: gates batched at the end of Phase 1.B (after 1.B.4), not between sub-phases.

### Gate-cost discipline (added 2026-04-29 after token-cost concern)

Each agent invocation costs real tokens. The user explicitly raised cost as a concern. Default to a **3-agent gate**:

1. `code-reviewer` (always)
2. `test-runner` (always)
3. The relevant **beat owner** (data-sync / ranker-mathematician / ux-critic / agent-tool-author)

Invoke `schema-guardian` *only* when DB schema, Go-types, or shared TS types changed in the gate's scope.

Invoke `product-manager` *only* when the gate is a **planning-level** gate (locking an ADR, defining sub-phase scope) or when the gate-scope itself is plan-relevant (cross-cutting decisions, user-facing surfaces).

Keep agent prompts ≤30 lines: role pointer + relevant file list + task. Agents read files themselves; do not paste diffs into the prompt.

Use Sonnet for code-reviewer and test-runner; Opus only for the PM and ranker-mathematician beats where judgment matters. The agent-definition `model` field already encodes this; honor it.

Steps:

1. Verify `make all` is green locally.
2. Invoke the following agents **in parallel** via the `Agent` tool:
   - `code-reviewer` — diff review, ADR compliance, test coverage.
   - `test-runner` — runs `make all`, reports failures.
   - `schema-guardian` — DB / Go / TS / Zod consistency (skip if no schema change).
   - The relevant beat owner: `data-sync` for Phase 1, `ranker-mathematician` for Phase 3, `ux-critic` for Phase 4 onward, `agent-tool-author` for Phase 8+.
   - `product-manager` — adversarial review against user value.
3. Each agent writes its review to `docs/reviews/phase-<n>/<agent>.md`. Required.
4. Aggregate findings into `docs/reviews/phase-<n>/_summary.md` with: per-agent verdicts, blockers, nits, praise.
5. Address every blocker. Re-run the gate.
6. Only when all blockers cleared and verdicts are non-blocking: update `docs/PLAN.md` to mark the sub-phase complete and write a brief summary to the user.

Never skip a gate "because the change is obviously fine." If it's that obvious, the gate is trivially fast — run it.

## Hooks (cheap automation, never substitutes for gates)

Configured in `.claude/settings.local.json`:

- **`PostToolUse` on `Edit|Write`** → `.claude/hooks/log-edit.sh` — appends each modified path to `.claude/state/edits.log`. The assistant reads this to detect when "enough has changed" to warrant a gate.
- **`Stop`** → `.claude/hooks/quick-check.sh` — runs `go vet` if Go files changed since last check; surfaces failures back as context. Sub-second and non-blocking.

Hooks output is informational. Hooks do not invoke LLM agents (they are shell-only). The implementation gate is the assistant's responsibility.

## Agent invocation conventions

When invoking a subagent (planning or implementation gate):

1. Use `Agent` tool with `subagent_type` set to the custom agent name (e.g., `code-reviewer`). If the runtime does not yet recognize the custom type, fall back to `general-purpose` and inject the agent's role-brief from `.claude/agents/<name>.md` into the prompt.
2. Always include in the prompt:
   - The agent's role brief (or pointer to `.claude/agents/<name>.md`).
   - Pointers to the relevant project docs (PLAN.md, DECISIONS.md, OPEN_QUESTIONS.md, AGENTS.md).
   - Pointers to the specific files / changes under review.
   - An explicit instruction: write the review to `docs/reviews/<scope>/<agent>.md`, then return a brief summary in the final response.
3. Run independent agents in parallel (one Agent tool call per agent, all in the same response).
4. After all agents return, read the review files, aggregate, and report blockers to the user.

## Paper trail

- ADRs: `docs/DECISIONS.md`.
- Reviews: `docs/reviews/<scope>/<agent>.md`.
- Aggregated review: `docs/reviews/<scope>/_summary.md`.
- Hook log: `.claude/state/edits.log` (gitignored).
- Plan status: `docs/PLAN.md` — keep authoritative.

## Boundary rules

- Never violate a locked decision. Propose a superseding ADR instead.
- Never skip a gate.
- Never invoke an agent without context links.
- Never claim a sub-phase complete without `docs/reviews/<phase>/_summary.md`.
- Never auto-merge an agent's suggestion that's a recommendation, not a blocker — flag it for the user.
- The user is the final decider. Agents inform, the assistant proposes, the user accepts.
