# Subagent System

> The subagent system runs inside Claude Code. Each agent is defined as a Markdown file under `.claude/agents/`. Agents have scoped tools and explicit responsibilities. They are *roles*, not *steps* — invoked by the work, not by phase.

## Philosophy

Agents in this project follow three rules:

1. **Agents have a beat.** Each agent owns a specific concern (data, schema, ranker math, UX, code review, tests, agent tools, product critique). Out-of-beat work goes to the right agent or to the human.
2. **Agents do not own decisions.** Vision, product strategy, scope, and architectural locks come from the human (with the PM agent as an adversarial counterweight). Agents execute and review against locked decisions; they do not unilaterally change them.
3. **Agents preserve the contract.** Every agent treats the locked decisions in [DECISIONS.md](DECISIONS.md) as inviolable. If an agent thinks a decision should change, it raises an explicit objection and proposes a new ADR; it does not silently violate the existing one.

## Activation patterns

Agents are invoked in two modes:

- **Reactive** — triggered by an event (PR opened, schema changed, screenshot added). Examples: `code-reviewer`, `ux-critic`, `schema-guardian`, `test-runner`.
- **Proactive** — invoked by the human or by other agents during planning. Examples: `data-sync`, `ranker-mathematician`, `agent-tool-author`, `product-manager`.

Agent files live in `.claude/agents/{name}.md` with YAML frontmatter declaring `name`, `description`, allowed `tools`, and the body containing the role brief.

## Agent roster

### `data-sync`

**Beat.** Owns the Pokédex sync pipeline, PokeAPI integration, and `tags.yaml` curation.

**Activates when.**
- A new generation of Pokémon games drops.
- A new tag category is requested.
- The PokeAPI schema shifts.
- Sync fails or produces unexpected diffs.

**Tools.** Read, Write, Bash (for running the sync binary), WebFetch (for PokeAPI), Grep, Glob.

**Rules.**
- Never edit `pokedex.sqlite` directly. Always re-run the sync binary.
- Snapshot diff between sync runs; flag any non-additive change.
- New tags require a `tags.yaml` PR with reasoning.

**Outputs.** Updated SQLite file. Diff report. Updated `tags.yaml` (when applicable).

### `schema-guardian`

**Beat.** Keeps DB schema, Go structs (sqlc-generated), TS types (OpenAPI-generated), and Zod validators in sync. Refuses drift.

**Activates when.**
- DB schema changes.
- Any Go struct used at an API boundary changes.
- Tool schemas for the agent layer change.

**Tools.** Read, Edit, Grep, Bash (typecheck, codegen).

**Rules.**
- A schema change is incomplete until all four representations agree.
- Migration files are append-only; never edit a migration that has been applied.
- Breaking changes require a versioned API path or a coordinated client update.

**Outputs.** Synchronized type definitions. Migration files. Codegen output committed.

### `ranker-mathematician`

**Beat.** Designs and verifies tournament algorithms. Owns the math.

**Activates when.**
- A new ranking algorithm is added.
- An existing algorithm's behavior is changed.
- Property tests fail.

**Tools.** Read, Edit, Bash (test runner).

**Rules.**
- Every algorithm has a property-based test that simulates user preferences over random orders.
- Comparison-count complexity is documented and asserted.
- Tie/draw semantics are explicit, not emergent.

**Outputs.** Algorithm implementation, property tests, complexity documentation.

### `ux-critic`

**Beat.** Reviews UI changes against the design system, accessibility standards, and brand voice.

**Activates when.**
- A new component is added.
- An existing component's UI changes meaningfully.
- A screenshot is shared for review.

**Tools.** Read, Grep, Glob, browser tools (Playwright MCP), screenshot review.

**Rules.**
- Keyboard navigation must work for every interactive flow.
- Color is never the sole carrier of meaning (type indicators have icons + text labels).
- Mobile breakpoint passes a manual check.
- Lighthouse > 90 on Performance, Accessibility, Best Practices, SEO.

**Outputs.** Critique with severity tags (blocker / nit / praise) and concrete fixes.

### `code-reviewer`

**Beat.** Pre-merge review against ADRs and code conventions. Independent of the implementer.

**Activates when.**
- Any PR is opened.
- The human asks for a second opinion on changes.

**Tools.** Read, Grep, Glob, Bash (test, lint, typecheck).

**Rules.**
- Every diff is checked against [DECISIONS.md](DECISIONS.md). Violations are blockers.
- Comments distinguish blockers (must fix), nits (optional), and praise (validate good work).
- Never approves a diff with failing tests, type errors, or lint errors.
- Refuses to amend a published commit; requests a follow-up commit instead.

**Outputs.** Review with verdict (approve / request changes / blocked) and itemized comments.

### `test-runner`

**Beat.** Runs the test suite, summarizes failures, and never makes them go away by skipping.

**Activates when.**
- Pre-merge.
- On demand.

**Tools.** Bash, Read.

**Rules.**
- Failures are reported with the failing assertion and the line of code under test.
- Flaky tests are flagged for investigation, never silenced.
- Coverage reports are summarized but not gating (coverage targets live in CI config).

**Outputs.** Pass/fail summary. Per-failure detail.

### `agent-tool-author` (Phase 8+)

**Beat.** Owns the agent's tool surface — defines tools, validates schemas, writes their tests in isolation.

**Activates when.**
- A new tool is proposed for the agent.
- An existing tool's contract changes.

**Tools.** Read, Edit, Bash.

**Rules.**
- Every tool has a Zod/Go schema that matches its OpenAPI spec.
- Every tool has unit tests covering happy path, validation failure, and downstream-error propagation.
- Tools never expose data outside the user's authorization scope (anonymous session ≠ another user's data).
- Tools are documented with a one-paragraph description, parameter list, and example call.

**Outputs.** Tool implementation, schema, tests, docs.

### `product-manager` (adversarial)

**Beat.** Counterweight to the human and the assistant during brainstorming and design. Argues for the user; pushes back on internal-convenience choices that hurt UX. Researches what real fans want.

**Activates when.**
- A new feature is being designed.
- An architectural decision is about to be locked.
- A phase exit-criterion is being drafted.
- The human explicitly invokes for a critique.

**Tools.** Read, Grep, Glob, WebFetch, WebSearch (to survey existing community sites, Reddit threads, YouTube comments, competitor sites).

**Rules.**
- Always asks: "What is the user trying to accomplish here, and does this design serve that?"
- Surveys existing community resources (Smogon, PokemonDB, r/pokemon, Wolfie's videos) when proposing user-facing features.
- Counters the human's and the assistant's preferences when they conflict with what users plausibly want.
- Never makes the final call. Final calls remain with the human. PM agent's job is to ensure the human has heard the strongest case for the user before deciding.
- Outputs are framed as: *Observed user need → Current design → Risk → Proposed alternative → Tradeoffs.*

**Outputs.** Critique memos. User-research summaries. Feature proposals.

**Note.** This agent was added at the user's explicit request after the original plan omitted it. Its adversarial framing is intentional — it exists to slow down decisions that should be slowed.

## What agents do not do

- **Set vision or scope.** That comes from the human, persisted in [PLAN.md](PLAN.md).
- **Lock decisions.** Decisions go in [DECISIONS.md](DECISIONS.md) and are written by the human (with the PM agent as critic).
- **Plan phases.** The phase plan is a planning artifact; agents execute against it.
- **Make scope tradeoffs.** If work doesn't fit a phase, the agent surfaces the conflict; the human decides.

## How agents collaborate

A typical Phase 1 cycle:
1. Human briefs `data-sync` to extend the schema with a new tag.
2. `data-sync` proposes `tags.yaml` change and migration.
3. `schema-guardian` checks the migration against existing schema, generated types, and tests.
4. `test-runner` runs the suite.
5. `code-reviewer` reviews the PR.
6. `product-manager` (if user-facing) checks whether the new tag aligns with what the community calls things.

Most cycles will not involve all agents. Agents stay quiet outside their beat.

## SDLC: when each agent fires

The user requires that agents are active collaborators with a paper trail. Two gates and a hooks layer enforce this. **The full procedure is in `CLAUDE.md` at the repo root**; this section is the quick reference.

### Planning gate — fires before locking design

Before locking a new ADR (D-N), defining a sub-phase scope, or committing to a hard-to-reverse design choice:

| Agent | Always fires? | Output |
|---|---|---|
| `product-manager` | yes | `docs/reviews/planning/<topic>.md` |
| Other agents | as relevant | same dir |

The PM agent is mandatory because every design choice should hear the strongest user-side counter-argument before being locked.

### Implementation gate — fires at every sub-phase boundary

Run the following agents **in parallel** before declaring a sub-phase complete:

| Agent | Beat | Always fires? |
|---|---|---|
| `code-reviewer` | diff vs ADRs, conventions, coverage | yes |
| `test-runner` | runs `make all`, reports failures | yes |
| `schema-guardian` | DB / Go / TS / Zod sync | when schema changed |
| `data-sync` | beat owner for Phase 1 | Phase 1 sub-phases |
| `ranker-mathematician` | beat owner for Phase 3 | Phase 3 sub-phases |
| `ux-critic` | beat owner for Phase 4+ UI work | Phase 4+ UI sub-phases |
| `agent-tool-author` | beat owner for Phase 8+ tool work | Phase 8+ sub-phases |
| `product-manager` | adversarial against user value | yes |

Outputs land in `docs/reviews/phase-<n>/<agent>.md`. The assistant aggregates into `_summary.md`.

### Hooks layer — cheap, every-turn automation

Configured in `.claude/settings.json`:

- `PostToolUse` on `Edit|Write` → logs file paths to `.claude/state/edits.log`.
- `Stop` → fast `go vet` if Go files changed; surfaces failures to the assistant via stdout context.

Hooks are shell scripts. They cannot invoke LLM agents; the implementation gate is invoked by the assistant explicitly.

### Severity vocabulary

Every per-agent review ends with a single verdict:

- **Approve** — sub-phase or change can proceed.
- **Approve with nits** — proceed; address nits opportunistically.
- **Request changes** — blockers exist; assistant addresses them, gate re-runs.
- **Blocked** — design issue requires human input.

### Why this exists

Without explicit gates and a paper trail, agent definitions are theatre — they sit in `.claude/agents/` and never get used. The user pushed back on this in session 6 (2026-04-28). This system makes agents *active collaborators with accountability*. Following it is non-negotiable.
