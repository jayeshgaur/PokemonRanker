# Phase 1.B.1 — Product-Manager Sub-Phase Gate

**Date.** 2026-04-28
**Reviewer.** product-manager subagent
**Scope.** Verify the three POC-validation substitutes negotiated at the planning gate (sync-inspect, pin file, deferred text-dump) are actually delivered, and that the schema-trim and 5→4 sub-phase merge match what was approved. This is a tight re-check, not a relitigation.

## 1. The three concerns I raised — status

### 1.1. `make sync-inspect` — the one-screen sanity check

**Asked for.** A single command that, after a sync, shows the user enough state in one screen to know whether anything obviously regressed. Specifically: row counts per table, the latest `sync_meta` row, sample rows from the headline `pokemon` table, and the api-data SHA pin.

**Delivered.** `Makefile:29–44`. Four labeled sections, each separated by a blank line:

1. **Row counts.** Loops every non-`sqlite_%` table (so 1.B.2/1.B.3 ingestion adds rows automatically without me touching this target). Right-aligned counts, fixed-width column. Good.
2. **Latest `sync_meta`.** Pulls `id, ran_at, mode, api_data_commit_sha, duration_ms, status` — the six fields that matter for "did the last run succeed and was it on the SHA I expected?" Skips `record_counts_json` (good — that's noise on one screen). `tags_yaml_sha` is also skipped, which I would have included since it's part of provenance, but row counts in section 1 cover the same need indirectly. Acceptable.
3. **Sample `pokemon`.** First five rows of `id, slug, display_name, generation_id`. Once 1.B.2 lands, this is the eyeball check that ingestion produced the right shape. Right now, in the 1.A/1.B.1 schema-only world, this returns zero rows — that's fine; the framework is in place.
4. **api-data SHA pin.** Reads the sibling pin file with a clear "(not pinned — sync hasn't seen a real api-data checkout yet)" fallback. The fallback message is kind to first-time users; I appreciate that.

**Verdict.** Yes — this is the one-screen check I asked for. Everything I requested is on screen.

**One nit (not a blocker).** When 1.B.2 lands and tables have thousands of rows, an operator running `make sync-inspect` after a regression wants to see a *row count delta vs. the previous run*. That's not in scope here and I am not asking for it now — but I want it captured. Filing it as a 1.F follow-up is appropriate; do not bolt it onto 1.B.1.

### 1.2. `.api-data-sha` pin file for reproducibility

**Asked for.** A sibling text file written next to the SQLite that pins the upstream commit SHA. Must be **committed**, not gitignored, so a fresh clone of this repo can reproduce the exact data we last shipped.

**Delivered.**
- Logic: `apps/api/internal/pokedex/ingest/bulk.go:138–143`. Pin path is `filepath.Join(filepath.Dir(opts.OutputPath), "api-data-sha")` — sits next to the SQLite. Best-effort write (warns to stderr on failure but does not fail the sync). That is the right severity choice: the SQLite is the deliverable; the pin is informational.
- Placeholder guard: `shouldWritePin` skips `""`, `"scaffold"`, `"unknown"` (lines 167–176). So we don't pollute the working tree with a "scaffold" pin file during 1.B.1. Correct.
- Tests: `bulk_test.go:92–151` covers (a) `not-a-git-repo` path → SHA "unknown" → pin file NOT written, (b) real git repo with a commit → real 40-char SHA → pin file IS written and contains the SHA. Both branches of `shouldWritePin` are exercised. Good.
- **Gitignore status: file IS committable.** `.gitignore` lines 33–39 list every artifact that should be ignored, and there is an explicit comment: `# api-data-sha is committed (pin file for reproducibility per PM planning gate, 2026-04-28).` That comment is exactly the right kind of code-as-documentation: a future contributor about to "clean up" the gitignore will read the rationale before stripping it.

**Verdict.** Pin-file logic matches my reproducibility intent. The "do not gitignore" push is honored *and* documented at the place a contributor would re-violate it.

**Worth noting.** The pin file does not currently exist on disk because `make sync` has been run without `APIDATA=` set, so the SHA resolves to `"scaffold"` and the write is suppressed. That is correct behavior — but it means the *first commit that demonstrates the pin* won't happen until 1.B.2 (when `make sync-from-clone` is run for real). I am OK with that. The infrastructure is in place; the artifact lands when there's real data to pin.

### 1.3. Human-readable text-dump snapshot — deferred to 1.B.4

**Asked for.** A snapshot format a human can `git diff` to see ingestion changes — not just an opaque SQLite binary diff. I accepted deferral to 1.B.4 because there is nothing meaningful to dump until 1.B.2/1.B.3 produce real rows.

**Delivered (status).** `docs/PLAN.md:95` lists this explicitly under sub-phase 1.B.4: *"binary-deterministic + human-readable text-dump snapshot."* The deferral is recorded where the work will actually happen, not buried in a review file. Good.

**Verdict.** Honestly deferred — not dropped, not softened. I will hold the line at the 1.B.4 gate.

## 2. Schema trim — were the right columns cut?

**`docs/OPEN_QUESTIONS.md:38–45`** lists the deferred completionism columns. Reading the framing carefully:

> "Deferred until a feature demands them (PM planning-gate decision 2026-04-28: dead columns are noise; with no migration cost in our rebuild model, 'cheap-now' doesn't outweigh 'what is this for?')."

That is the right framing. Specifically:

- It names me as the source of the cut, with a date. Future-me cannot pretend this was someone else's call.
- The reasoning ("dead columns are noise" / "rebuild model, no migration cost") is captured. Anyone re-reading this in three months knows *why* it was cut, not just *that* it was cut.
- The unblock condition is concrete: *"When any of the above is added back, do it as a one-line schema edit + re-sync (no migration; the schema is rebuilt every bulk run)."* That removes the usual reason teams over-include columns ("might be expensive to add later"). Migration cost is zero.
- The list itself: `gender_rate`, `has_gender_differences`, `growth_rate`, `base_happiness`, `capture_rate`, `hatch_counter`, `forms.introduced_in_version_group`, `moves.effect_chance`, `abilities.generation_id`, `localized_names`. None of these are touched by Phases 2 (filters), 3 (rankers), or 4 (UI). Cutting them was correct.

**Verdict.** Honestly tracked. Framing is not softening the cut.

**One pointed observation.** `localized_names` is bracketed with a re-introduce trigger (*"when non-English traffic crosses ~10% of total"*). The other deferrals don't have a trigger. That is fine for now — most of those columns are tied to mechanics we don't yet build for — but if I see one of them re-emerge without a clear feature behind it, I will push back.

## 3. The 4-sub-phase decomposition — drift check

`docs/PLAN.md:91–99` lists:

- **1.A** — schema + sync skeleton (✅ complete)
- **1.B.1** — schema v2 + sync infra (this gate)
- **1.B.2** — constants + core graph (merged from earlier 1.B.2 + 1.B.3)
- **1.B.3** — joins + evolutions + flavor text + transaction wrapping
- **1.B.4** — query API + validation + implementation gate (text-dump snapshot lives here)
- 1.D and 1.F as parallel/follow-on tracks.

This matches what I approved. The merge of "constants" and "core graph" into a single 1.B.2 was my push (separating them produced a sub-phase that delivered no queryable rows and one that delivered too many — neither was independently inspectable). Good — the merger is recorded at line 92.

The note at line 99 explicitly absorbs the old 1.C (sprite/cry URLs) and 1.E (query API) sub-phases into 1.B.2 / 1.B.3 / 1.B.4. That keeps the plan from drifting back to the original 5+ sub-phase layout if someone re-reads only the deliverables list.

**Verdict.** No drift. The 5→4 merge is reflected accurately.

## 4. User-value spot-checks

### 4.1. Does 1.B.1's framework constrain 1.B.2 from delivering a populated SQLite efficiently?

No. The `Ingester` interface (`ingester.go:14–22`) is minimal: `Name() string` and `Ingest(ctx, db, apiDataPath) (int, error)`. It accepts a `DBExecutor` interface (`ingester.go:28–32`) that is satisfied by both `*sql.DB` and `*sql.Tx` — so when 1.B.3 wraps everything in `BEGIN IMMEDIATE / COMMIT`, the same ingester implementations work without changes. The rowcount return value is exactly what `record_counts_json` and `make sync-inspect` will need.

The bulk pipeline comment block (`bulk.go:59–70`) lays out the FK-dependency execution order for 1.B.2/1.B.3 in advance: generations → types → stats/abilities/moves → species → forms → pokemon → joins → evolutions → second-pass → flavor_text. That is the correct order, and getting it written down here saves an argument later.

**Concern, mild.** The interface returns `(int, error)`, not a structured `IngestStats` (rows-written, rows-skipped, warnings). For 1.B.2, plain rowcount is enough. If 1.B.3 needs to surface "skipped 4 forms with missing data" without dumping it to stderr, this signature gets revisited. That is fine — it is internal, no users depend on it.

**Verdict.** 1.B.1 does not constrain 1.B.2 from running efficiently. Anything 1.B.2 needs that this scaffold doesn't yet provide is a one-line interface bump, not a redesign.

### 4.2. Are the three mitigations actually substituting for the rejected toy-picker?

This is the question that matters.

The user rejected a 1.5 toy-picker because it was scope-creep masquerading as validation: it would have built UI work *ahead of the architectural plan*, in the name of "real users early." User position (PL-2 in OPEN_QUESTIONS.md, line 118): "works for me as a POC," not "user-validated." So the question becomes: what kind of validation does the *POC owner* (the user) need, in the absence of external users?

A POC owner needs three things, in plain language:

1. **A way to know the data is correct after each sync.** This is `make sync-inspect`. Six row counts and a sample beat zero confidence in 200 KB of binary SQLite.
2. **A way to reproduce a known-good state.** This is the pin file, committed to git. Without it, "I had it working last week" is a vibe; with it, it's a deterministic checkout.
3. **A way to see what changed when something looks off.** This is the deferred text-dump snapshot — it does nothing in 1.B.1 because there is no data, but it is queued for 1.B.4 where there will be.

These three together do the work the toy-picker was framed as doing: they let the POC owner *trust the data layer* before any UI is built on top of it. That is the actual validation loop for this project at this phase.

What they are **not**: external user validation. They cannot tell the user whether real fans will enjoy the picker. They are not pretending to. The user explicitly deferred external-user validation; PM is not smuggling it back in via cosmetic checkmarks.

**Verdict.** The trio is substantive substitution for an internal POC, not cosmetic. I would defend this decision against a returning user who asks "wait, but how do you know any of this works?" The answer is: row counts you can read, a SHA you can re-pin, and (in 1.B.4) a diff you can read with your eyes.

**One thing I will be watching.** The text-dump snapshot in 1.B.4 must be *legible* — not 50 MB of unsorted INSERT statements. If 1.B.4 ships a "snapshot" that is technically a text file but practically un-reviewable, the trio does become cosmetic. I will hold the 1.B.4 gate to that standard.

## 5. Summary table

| Concern | Status | Where |
|---|---|---|
| `make sync-inspect` covers 4 sections | Yes | `Makefile:29–44` |
| Pin file logic matches reproducibility intent | Yes | `bulk.go:138–143`, tests at `bulk_test.go:92–151` |
| Pin file committed (not gitignored) | Yes, with explicit rationale comment | `.gitignore:39` |
| Deferred completionism columns honestly tracked | Yes; framing names PM, dates the cut, gives unblock condition | `OPEN_QUESTIONS.md:38–45` |
| Text-dump snapshot deferral recorded at the work site | Yes | `PLAN.md:95` |
| 5→4 sub-phase merge reflected | Yes | `PLAN.md:91–99` |
| 1.B.1 framework does not constrain 1.B.2 | Yes; `Ingester` accepts `*sql.Tx` already | `ingester.go:14–32`, `bulk.go:59–70` |
| Trio substitutes for rejected toy-picker | Yes, for an internal POC; not cosmetic | §4.2 above |

## 6. Verdict

**APPROVE — proceed to Phase 1.B.2.**
