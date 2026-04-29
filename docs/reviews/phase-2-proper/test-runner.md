# Phase 2 (proper) — test-runner review

**Date:** 2026-04-28
**Scope:** Phase 2 deliverables per `docs/PLAN.md` lines 154–173.
**Verdict:** **Approve-with-reservation.**

The suite is green from a fresh state, the build ships, and the new tests
cover the seven primitives, AND/OR/NOT composition, the 31-preset library,
URL round-trip, and `eligibleCount`. The reservation is **`apps/web/lib/pokedex.ts`
has zero direct tests** — it is the bridge between the on-disk SQLite (Phase
1) and every filter primitive (Phase 2). I recommend a small follow-on of
unit tests for `computeEvolutionStages` and `loadPokedex` before Phase 3
comparator UI lands; not a blocker because Phase 1's `make sync-validate`
plus the production Next.js build with a real DB transitively exercise the
hot path.

---

## 1. Run results (fresh state)

All three commands run from `/Users/jayesh/Experiments/PokemonRanker`:

| Command | Result | Duration |
|---|---|---|
| `make all` | **PASS** — 0 vet issues, 0 lint issues, Go tests cached green, TS: filter 73 / ranker 11 / web 1 / shared 0 = **85 passed, 0 failed** | 10.3 s wall |
| `pnpm -C apps/web build` | **PASS** — 4 pages generated (`/`, `/_not-found`, `/pick`, `/_error`); `/pick` is `ƒ` dynamic per D-22 | 7.6 s wall |
| `make sync-validate` | **PASS** — `validate: 0 issues — all checks passed` against the current `apps/api/data/pokedex.sqlite` | 0.9 s wall |

Per-workspace TS test totals:

- `packages/filter` — 73 tests across 3 files (was 13 in MVP). 22 ms test time.
- `packages/ranker` — 11 tests, fixture-only update (Phase 2 added new fields to `Pokemon`; the ranker doesn't read them, so no new behavior is asserted — correct).
- `apps/web` — 1 sanity test (no Phase 2 additions).
- `packages/shared` — 0 tests (`vitest --passWithNoTests` exits clean).

Go: `internal/pokedex` and `internal/pokedex/ingest` cached green. No Phase 2 Go changes.

No flakes observed across two consecutive runs.

---

## 2. Coverage critique — Phase 2 deliverables

### 2.1 `packages/filter/__tests__/apply.test.ts` (extended to 41 cases)

**Strengths.** The fixture pool of 15 Pokémon is well-chosen — it covers every
primitive: stages (first/middle/final), Megas, GMax, regional variants,
legendaries, mythicals, babies, BST band 309–680, single-type and dual-type,
and a Gen 3 representative for cross-generation tests. The default
form-inclusion regression (the "Charmander vs Charmeleon" complaint) has its
own dedicated `describe` block that asserts both directions: pre-evos
excluded *and* Mega/GMax excluded *and* regional variants of final-stage
species kept. The tag-mode "all" vs "any" semantics are tested. URL
round-trip exercises an extended filter with **every** field set
simultaneously — this is the strongest test in the file because it forces
the serializer and parser to stay in sync.

**Gaps.**

- **`isLegendary=true` URL-only path is not asserted.** `apply.test.ts`
  lines 330–333 test the engine-level matcher, but every assertion adds
  `formInclusion: "all-forms"` so the default form-gate doesn't interfere.
  No test answers: "if a user opens `/pick?legendary=1`, what do they
  see?" Currently the answer is "only final-stage non-Mega legendaries"
  — likely surprising for the user who typed `?legendary=1` expecting
  every form. **This is a UX-relevant interaction, not just a test gap.**
  Suggest: a single test asserting `apply({ isLegendary: true }, pool)`
  excludes Mega-Charizard-X (because of the default form gate). At
  minimum, document the interaction in the matcher comment.
- **`bst=abc-def` parsing is untested.** `parseFilter` falls through to
  `r.min === undefined && r.max === undefined ? undefined : r`, so a
  garbage range yields `bstMin/bstMax` both `undefined`. The "garbage
  input gracefully" test only covers `gen` and `type`. Suggest: extend
  the case to assert `parseFilter({ bst: "abc-def" })` is `{}`.
- **No test for `tagMode: "all"` URL round-trip.** The serializer omits
  `tag-mode` when not `"any"`, so re-parsing produces a Filter without
  `tagMode`. Engine-equivalent (default is "all") but the round-trip
  property `parsed === original` is asymmetric. Mild — flag, don't block.
- **`statThresholds` with a `max` only (no `min`)** is not tested. The
  per-stat round-trip case sets `{ speed: { min }, hp: { min, max } }`
  but never the `{ max }` -only path through `encodeRange("", max)`.

**Tests that pass for the wrong reason — none found.** The Mega-X
inclusion is tested both as exclusion (default) and inclusion (`all-forms`),
which is the kind of paired assertion that catches off-by-one
form-inclusion bugs. Good.

### 2.2 `packages/filter/__tests__/composition.test.ts` (new, 11 cases)

**Strengths.** All four constructors (`leaf`, `and`, `or`, `not`) are exercised
in isolation. The De Morgan test (`not(or(a,b)) === and(not(a), not(b))`)
is the strongest property-style assertion — it catches sign-flip bugs in
`matchesNode`'s `not` branch. The vacuous-truth identities for empty-AND
(matches all) and empty-OR (matches none) are asserted explicitly; both
are easy to get wrong on first implementation. The
`applyNode(bare-Filter, pool)` auto-wrap is tested. Discriminator
predicates `isFilter` / `isFilterNode` are tested for both positive and
negative cases including `null`.

**Gaps.**

- **Double negation `not(not(x))` is not asserted.** Trivially holds
  given the boolean implementation, but it's a one-liner that catches
  a future refactor where someone caches negation results.
- **`not(and())` and `not(or())` (negation of empty composites)** are
  not tested. `not(and())` should match nothing (since empty AND
  matches all), `not(or())` should match all. These are the two boundary
  cases at the intersection of "empty composite" and "negation."
- **Deeply nested compositions (3+ levels)** aren't tested. Real
  presets use 2-level (`legendaries-and-mythicals` is `or(leaf, leaf)`).
  No test like `and(or(leaf, leaf), not(or(leaf, leaf)))`. Mild — the
  4-case recursion in `matchesNode` is straightforward.

**Tests that pass for the wrong reason — none found.** The pool is small
(5 Pokémon) but the assertions check exact slugs, so a no-op `applyNode`
would fail every test.

### 2.3 `packages/filter/__tests__/presets.test.ts` (new, 21 cases)

**Strengths.** The "ships at least 22 presets" check passes (actual: 31).
Spot-checks across every preset family — gen, type, status,
form-inclusion, tag-based, BST, composed. The tag-based-presets-return-
empty assertion is great defensive testing: it documents that a Phase 1.D
prerequisite is gated, so when 1.D lands and tags populate, the tests
will start to **fail** (not silently change behavior) — the failure is
the signal to update the assertions. The `requiresTags: true` flag is
itself tested.

**Gaps.**

- **The `starters` preset test is fixture-asymmetric.** `apply.test.ts`
  tags Bulbasaur as `starter`; `presets.test.ts` only tags Charmander.
  The test asserts `["charmander"]` — correct given this file's
  fixture, but the asymmetry between sibling test files is a foot-gun.
  Suggest: tag at least two starters in this fixture so the assertion
  becomes `.toContain("charmander")` and the test verifies set
  membership, not "happens to be the only one."
- **`dragons` preset asserts empty array** because Mega-X is the only
  dragon-typed Pokémon in the fixture and the default form-inclusion
  excludes it. The test comment is honest about this, but it means the
  preset's *positive* path is unverified. Add a fully-evolved
  dragon-typed Pokémon to the fixture (e.g., a `dragonite` row), or
  add a second assertion overlaying `formInclusion: "all-forms"` on
  the spec, to prove the preset isn't a no-op.
- **`bst-600-club` and `high-bst` presets** have **no spot-check at
  all.** The fixture includes Mewtwo (BST 680) and Mega-X (BST 634)
  but no preset tests them. Suggest: 2-line assertion that
  `bst-600-club` excludes Mewtwo (≥ 680) and `high-bst` includes both.
- **`legendaries-and-mythicals` is the only OR-composed preset
  tested.** `or` composition has its own test in composition.test.ts,
  but a second composed preset (none currently exists) would catch
  preset-construction bugs vs. node-matching bugs.

### 2.4 `packages/ranker/__tests__/mergesort.test.ts` (fixture-only update)

**Verified the change is fixture-only.** `pkmn(id)` now constructs a
Pokémon with the Phase 2 fields (`isLegendary`, `isMythical`, `isBaby`,
`evolutionStage`, `isMega`, etc.) — all defaulted to `false` / `"final"`.
The ranker doesn't read any of these. Correct: the ranker is
form-/stage-agnostic; filtering happens upstream. No new behavior to
assert. Existing 11 tests (n=0/1/2 boundaries, known order, 32-trial
property test, n=8 comparison upper bound, serialize/deserialize round-
trip mid-flight, draw stability, skip determinism, deserialize-rejection
on missing IDs, deserialize-rejection on incompatible state) remain a
strong baseline.

### 2.5 `apps/web/lib/pokedex.ts` — **zero direct tests, gap flagged**

**This is a real gap.** The reader is the bridge between the SQLite (Phase
1's verified surface) and every Phase 2 filter primitive. Untested code
includes:

- **`computeEvolutionStages`** — pure, exported, and the only place
  evolution-stage assignment happens. The function's correctness is
  load-bearing for `evolutionStages` filter, the `final-evolutions-*`
  form-inclusion modes, and 5 presets. No unit test. A trivial table-
  driven test (5 rows: linear chain Charmander→Charmeleon→Charizard,
  branching chain Eevee→Vaporeon, single-stage Tauros, orphan with
  parent missing from set, cycle) would lock the contract. **This is
  the lowest-effort highest-value test to add.**
- **Empty-DB fallback** (`pokedexAvailable() === false` branch) returns
  `{ pool: [], facets: { generations: [], types: [], tags: [] } }`.
  Used by `/pick` to render the "run `make sync-from-clone`" empty
  state. Untested. Easy to break — someone refactors the cache
  invalidation and now the empty-state pokedex is cached forever.
- **Caching keyed on `dbFile`** — `cached` and `cachedDbPath`. If
  `POKEDEX_DB_PATH` env changes between calls, cache is invalidated.
  Untested. Risk: env-driven tests in CI miss this.
- **`groupStats` switch with no default arm** — an unknown stat slug
  in the SQLite (e.g., a future "exhaustion" stat from a PokeAPI
  patch) would silently drop the value. Not a Phase 2 bug, but
  worth a defensive log at minimum.
- **Pokemon row with no entry in `pokemon_stats`** — falls through
  to `zeroStats()`, which gives BST = 0. Untested. Combined with
  `bstMin: 600`, such a row would silently disappear from results.
  In practice this can't happen because `make sync-validate`
  asserts every Pokemon has 6 stats, but a unit test that asserts
  the fallback would document the safety net.
- **Missing-form / missing-species joins** — the SELECT uses
  `INNER JOIN forms` and `INNER JOIN species`. A Pokemon row
  without a matching form or species would silently disappear.
  Again, validate catches this; document via test.

**Why I'm not blocking on this.** `make sync-validate` ran clean (0
issues across the 16-check suite — Phase 1's defensive net), and the
production Next.js build with a real SQLite produced 4 pages with no
runtime errors. The reader is exercised end-to-end. But: the **direct**
unit tests for `computeEvolutionStages` are a 30-minute task that pays
off every time someone touches the SQL or the stage-derivation logic,
and Phase 3 will add a second consumer (the comparator UI) that depends
on `evolutionStage` being correct. **Strongly recommend** a 4–6 case
test file before Phase 3 begins.

### 2.6 Tests that pass for the wrong reason

I did not find any. The fixtures are realistic (Bulbasaur–Venusaur with
the canonical BST values, Mega-X with `is_battle_only=true` matching the
SQLite shape). Assertions check exact slug lists or set membership; no
assertion matches `expect.anything()` or trivially-true conditions. The
"empty AND matches everything" / "empty OR matches nothing" pair is the
exact kind of paired test that prevents accidental tautologies.

---

## 3. Untested error / edge paths summary

Ranked by risk:

1. **`apps/web/lib/pokedex.ts` — zero tests.** Recommend adding direct
   tests for `computeEvolutionStages` (boundary: linear chain, branch,
   single-stage, orphan) and `loadPokedex` empty-DB fallback before
   Phase 3.
2. **`isLegendary=true` URL without explicit `formInclusion`.** Behavior
   is "default form-gate applies" — semantically defensible but
   surprising; not asserted in any test.
3. **`parseRange` rejection of malformed `bst`/`stat-*` values.** Falls
   through to `undefined` silently; only `gen` and `type` malformed
   parsing is tested.
4. **`not(and())` / `not(or())` boundary.** The two-valued algebra at
   the intersection of empty composites and negation. Trivial fix.
5. **Composed presets — only `legendaries-and-mythicals` covered.**
   Single preset of its kind; no defense against preset-builder bugs.
6. **`bst-600-club` / `high-bst` presets — no spot-check.** Easy add.
7. **`dragons` preset — only the empty-result negative path is tested.**
8. **`tagMode: "all"` URL round-trip asymmetry.** Engine-equivalent;
   document in test.

---

## 4. Recommendations to the implementation gate

- **Approve** this Phase 2 implementation gate on test coverage. The
  73-test filter suite is a substantial improvement over the MVP's
  13 tests, the property-test for AND/OR/NOT (De Morgan) catches the
  most likely bug class, and the 22-preset target is exceeded with
  spot-checks across 14 preset slugs.
- **Hand off as a follow-on (not a blocker)** to whomever owns the
  `apps/web/lib/pokedex.ts` test gap. Suggest creating a single
  `apps/web/__tests__/pokedex.test.ts` with `computeEvolutionStages`
  table-driven tests + a `loadPokedex` empty-fallback test. Phase 3
  pre-flight is a natural moment.
- **Hand off `isLegendary=true` URL semantics to ux-critic** or
  document in the `Filter` JSDoc what the URL-typed user sees. Do not
  silently ship a "the legendary preset filters out half the
  legendaries" surprise.

The suite has no flakes, no skipped tests, no `passWithNoTests`-driven
silencing of failures (other than the legitimate `packages/shared`
no-test workspace), and runs in ~10 seconds end-to-end.

**Verdict: Approve-with-reservation.** The reservation is the
`apps/web/lib/pokedex.ts` test gap, which is recommended-not-required.
