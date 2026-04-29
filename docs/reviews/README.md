# Reviews — paper trail for agent feedback

This directory holds every gate review run by the subagent system. The user explicitly required a paper trail so we can audit what each agent said, when, and why.

## Layout

```
docs/reviews/
├── README.md                     # this file
├── planning/
│   ├── D-17-hot-link.md          # planning-gate review for ADR D-17 (example)
│   └── D-18-zero-cost.md         # planning-gate review for ADR D-18
└── phase-<n>/
    ├── code-reviewer.md          # implementation-gate, one file per agent
    ├── test-runner.md
    ├── schema-guardian.md
    ├── data-sync.md              # beat owner for Phase 1
    ├── ranker-mathematician.md   # beat owner for Phase 3
    ├── ux-critic.md              # beat owner for Phase 4+
    ├── agent-tool-author.md      # beat owner for Phase 8+
    ├── product-manager.md        # adversarial, every gate
    └── _summary.md               # assistant's aggregate of the above
```

## What each file contains

Every per-agent review is a Markdown file written by the corresponding subagent. The format varies per agent (see `docs/AGENTS.md`), but every file ends with a clear **Verdict**:

- `Approve` — sub-phase or change can proceed.
- `Approve with nits` — proceed; address nits opportunistically.
- `Request changes` — blockers exist; assistant addresses them, gate re-runs.
- `Blocked` — design issue requires human input.

The assistant aggregates these into `_summary.md` with the overall verdict and the action list.

## When are reviews written

- **Planning gate** — before locking a new ADR or non-trivial design choice. The `product-manager` agent runs at minimum.
- **Implementation gate** — at every sub-phase boundary. Multiple agents run in parallel.

See `CLAUDE.md` for the procedural details.

## Why

Three reasons:

1. **The user wants to see agents working,** not be told they exist.
2. **The assistant needs accountability** — without a paper trail, agent reviews are just performance art.
3. **Future sessions need context** — a session months from now should be able to read these files and understand why a decision was made.
