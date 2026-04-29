# Phase 2 (proper) — code-reviewer

**Scope.** Diff vs. the MVP slice in:
- `packages/shared/src/index.ts`
- `packages/filter/src/index.ts`
- `packages/filter/src/composition.ts`
- `packages/filter/src/presets.ts`
- `packages/filter/__tests__/{apply,composition,presets}.test.ts`
- `packages/ranker/__tests__/mergesort.test.ts`
- `apps/web/lib/pokedex.ts`

**Verdict: Approve-with-nits.** No blockers. ADRs honored, types tight, tests cover the new primitives plus the URL round-trip, and the engine assumes only data the SQLite reader actually populates. The Charmander/Charmeleon default-form-inclusion fix is correctly wired and explicitly tested. Recommend a small follow-up commit picking up a few of the nits below; none gate the sub-phase.

## Spirit of the change

This is the "proper Phase 2" — the MVP three-field filter is upgraded to the seven-primitive surface PLAN.md §Phase 2 promises (gen, type, tag, BST range, per-stat thresholds, evolution stage, form-inclusion) plus AND/OR/NOT composition, 31 presets, URL round-trip, and a stable `canonicalKey` for Phase 7 aggregation. Backward compatibility for the MVP `Filter` shape is preserved with a deprecated shim (`includeAlternateForms`), and the new `Pokemon` fields are populated from real SQLite columns rather than inferred. The diff serves the long-term plan: D-1 form identity is respected, D-3 pluggability is preserved, D-5 (URL = source of truth) is honored end-to-end, and the new `canonicalKey` already lays the rollup hook for D-11 aggregation.

## ADR compliance

- **D-1 (form identity).** [praise] `FormInclusionMode` is implemented via per-row form/species flags (`isMega`, `isGmax`, `isRegionalVariant`, derived `evolutionStage`); no row collapsing. The default `final-evolutions-excluding-mega` is a *filter*, not a data-model collapse, exactly as D-1 prescribes.
- **D-3 (pluggable rankers).** Untouched — the ranker test fixture only adds the new `Pokemon` fields. No interface change.
- **D-5 (URL is source of truth).** `parseFilter` / `toSearchParams` is total over the new surface. `canonicalKey` collapses the legacy `includeAlternateForms` shim into `formInclusion`, so two equivalent filters that disagree only on the legacy flag hash identically. Good groundwork for Phase 7 rollups.
- **D-6 (validate at every IO edge).** [nit] `parseFilter` is appropriately defensive on garbage input (the `gen=abc,,xyz` test demonstrates it), but the engine would still merit a Zod schema once the `agent-tool-author` beat picks this up in Phase 4.5. Not a blocker — the tool-surface guard belongs in the agent layer, not in `packages/filter`. Worth a comment pointing forward.
- **D-22 (single Vercel deploy).** `apps/web/lib/pokedex.ts` correctly stays server-only (`import "server-only"`), uses `better-sqlite3` with `readonly: true`, single-load caches the snapshot keyed by db path, and falls back gracefully when the file is missing.

No ADR violations.

## Itemized comments

### Type safety

- [praise] `EvolutionStage` is a string-literal union, exported from `@pokemon-ranker/shared`, and the new fields in `Pokemon` are all primitive booleans / typed unions. No `any`, no unguarded casts in the engine.
- [praise] `Filter` makes every field optional, which preserves the MVP shape's structural compatibility — important because the MVP `Picker` localStorage state, the `/pick` route, and `presets.ts` were all written to the narrow shape.
- [nit] `parseFilter` line 376–380:
  ```ts
  .filter((s): s is EvolutionStage =>
    (allowed as string[]).includes(s),
  );
  ```
  The `allowed as string[]` cast is fine but a `Set<string>` (or `(allowed satisfies readonly EvolutionStage[]).includes(s as EvolutionStage)`) is the more idiomatic guard. Minor.
- [nit] `composition.ts` `isFilter` returns `true` for any non-`FilterNode` object, including `Pokemon` rows or random JSON. It's only used for `applyNode` and presets, so a misuse won't compile, but the predicate over-promises. Tightening to require at least one known optional key (or none) would catch a copy-paste error. Optional.

### Engine semantics

- [praise] `effectiveFormInclusion` is the right abstraction: explicit > shim > default. The fact that the MVP-era `includeAlternateForms: false` resolves to the same set as the new default (`final-evolutions-excluding-mega`) is correctly tested (`apply.test.ts` "includeAlternateForms=false ⇒ default").
- [question] `formInclusion: "only-paradox"` (line 175) reads `p.tags.includes("paradox")`, which is the same source the `paradox` preset uses (`tagSlugs: ["paradox"]`). They're behaviorally identical until Phase 1.D ships, but they're two paths to the same predicate. Worth a one-line comment in `matchesFormInclusion` noting that this mode is the form-inclusion-shaped twin of the `paradox` tag, kept for ergonomic UX (radio button alongside Mega/GMax). Not a blocker.
- [nit] `parseRange` requires a literal `-` to recognize a range. `bst=600` (no dash) silently returns `undefined`. Since `toSearchParams` always emits `min-max` form, round-tripping is fine, but a hand-edited URL like `?bst=600` will be silently dropped. A one-line comment in the encoding doc-comment ("ranges always have a `-`; `?bst=600` is parsed as no-bst-filter, not min=600") would save a future debugger ten minutes.
- [nit] `parseFilter` accepts the legacy code `final-no-mega` (URL-friendly) and the verbose `final-evolutions-excluding-mega` (TS-friendly) on the way in, but `toSearchParams` only emits the short form. Asymmetric on purpose, fine, but worth a one-line comment.
- [praise] `canonicalKey` is order-independent (verified by the `[3, 1] / [water, fire]` test) because every list is `.sort()`ed before serialization and the `URLSearchParams.toString()` output mirrors the (deterministic) insertion order in `toSearchParams`. This is the right shape for a Phase 7 rollup hash key.

### URL round-trip edge cases

- [nit] Duplicate values are not deduplicated. `?gen=1,1,2` parses to `generationIds: [1, 1, 2]`, which `apply()` handles correctly (set-membership), but `canonicalKey` would differ from the deduplicated form. Once Phase 7 rolls up by `canonicalKey`, two clients with semantically identical filters could be bucketed apart over a duplicate. A one-line `Array.from(new Set(...))` after the parse on each list field would solve it cheaply. Same applies to `typeSlugs`, `tagSlugs`, `evolutionStages`. Suggest fix before Phase 7, not a Phase 2 blocker.
- [nit] `tagMode === "all"` is the default and is intentionally never serialized. Round-trip drops an explicit `{ tagSlugs: ["a"], tagMode: "all" }` to `{ tagSlugs: ["a"] }`. Semantically identical; no behavioral hole. Worth a comment noting the canonical form.
- [nit] Numeric inputs are parsed with `Number.parseInt(..., 10)` and `Number.isFinite` — good — but the URL accepts negatives (`bst=-200--100` would parse `min=-200, max=-100`). BST is non-negative; an out-of-range guard is one extra `<= 0` check away. Since the server-side filter just produces an empty pool either way, not a blocker.

### Test coverage

- [praise] `apply.test.ts` has 41 cases covering every primitive plus the default-form-inclusion fix, the BST + per-stat threshold paths, the categorical flags, and the URL round-trip including open ranges and the empty-filter case. The named "Charmander/Charmeleon fix" test ties the change explicitly to the OPEN_QUESTIONS.md L51 directive.
- [praise] `composition.test.ts` covers De Morgan, vacuous AND/OR identities, mixed `Filter | FilterNode` inputs to `applyNode`, and the `isFilter`/`isFilterNode` discriminator.
- [praise] `presets.test.ts` spot-checks every category (gen, type, status, form-inclusion, tag-based, BST-based) and explicitly documents that tag-based presets are expected to return empty until Phase 1.D — this is the right way to encode "this is the contract, the empty result is not a bug."
- [nit] `presets.test.ts` lacks a counter-test that the `bst-600-club` preset (BST 600–679) excludes Mega Charizard X (BST 634 in the fixture) — actually wait, 634 is *inside* 600–679, so it would include it. The fixture would benefit from one mid-BST and one ≥680 entry to spot-check the upper bound. Optional.
- [nit] No test that two filters with reordered `evolutionStages` (e.g., `["final","first"]` vs `["first","final"]`) produce the same `canonicalKey`. The `toSearchParams` re-sorts via the fixed `["first","middle","final"]` order so it would, but this isn't asserted. One-line addition.
- [praise] `mergesort.test.ts` only updates the fixture to include the new `Pokemon` fields — no behavioral assertion changes. Correct hygiene.

### Reader / data plumbing

- [praise] `apps/web/lib/pokedex.ts` correctly joins `pokemon` with `forms` (for `is_mega`/`is_gmax`/`is_battle_only`/`is_regional_variant`) and `species` (for `is_legendary`/`is_mythical`/`is_baby`). Schema columns confirmed present in `apps/api/internal/pokedex/schema.sql`. The `pokedex_db_url` column is populated by `PokemonIngester` (verified in `pokemon.go`).
- [praise] `computeEvolutionStages` is exported, single-pass, and produces the correct semantics: single-stage species (no parent, no descendants — Tauros, Lapras, Mewtwo) collapse to `"final"`, which is what the casual user expects from "final evolutions only" and what the `final-evolutions-excluding-mega` default trusts. The doc comment matches the implementation.
- [nit] `loadPokedex` opens a fresh DB handle every call but the snapshot is cached, so this is fine for production. Worth confirming the Next.js HMR dev path doesn't blow up the cache when better-sqlite3 reloads — not visible in this diff, but worth a manual sanity check during the UX walk.
- [nit] `dbPath()` falls back to `candidates[0]!` when neither candidate exists. `pokedexAvailable()` re-runs `existsSync(dbPath())` on the same fallback, so the missing-DB case is handled idempotently, but the non-null assertion is defensible only because the array literal is non-empty. A `??` against a known-bad sentinel like `path.join(process.cwd(), "apps/api/data/pokedex.sqlite")` would document intent more clearly. Optional.
- [nit] `groupStats` silently ignores unknown stat slugs (the `switch` has no `default`). Fine — the Pokédex schema hard-codes 6 stats — but a `default: throw new Error(...)` would catch a future schema change at load time instead of producing zero stats silently.
- [question] The reader's `evolutionStage` falls back to `"final"` when a species is missing from the evo map (`stageBySpecies.get(r.species_id) ?? "final"`). The fallback is conservative (admits the row to the default form-inclusion), but if it ever fires it means a row's species is absent from the species table — which would be a foreign-key violation that the schema enforces. The `?? "final"` is dead defensive code in practice. Not a blocker; consider `?? assertNever()` or a one-line comment marking this branch unreachable.

### Scope / process

- [praise] No scope creep. Every file in this diff is named in the task list (#13–#18) and the changes match. The MVP `/pick` route, components, and ranker are unchanged in this gate's scope.
- [praise] PLAN.md §Phase 2 is met: 7 primitives (✓), AND/OR/NOT (✓), 20+ presets (31, ✓), live count (`eligibleCount` exists, `eligibleCountNode` for FilterNodes ✓), pure functions (✓), URL round-trip (✓).
- [nit] PLAN.md §Phase 2 lists `FormInclusionFilter` options as `AllForms | FinalEvolutionsOnly | FinalEvolutionsExcludingMega | OnlyMegas | OnlyParadox | Custom`. The implementation has eight modes and drops `Custom`, adding `default-forms-only`, `only-gmax`, `only-regional-variants`. The set is strictly broader and `Custom` was the escape hatch for things that turned out to be expressible via the other primitives. Worth a one-line note in PLAN.md (or in the doc-comment on `FormInclusionMode`) explaining why `Custom` is dropped — otherwise a future reader sees the doc-spec drift.

## Summary

The diff cleanly extends the MVP slice into the full Phase 2 surface without breaking any MVP code. ADRs hold, types are tight, tests cover the new primitives plus the previously-promised URL round-trip with a stable `canonicalKey` for Phase 7, and the reader populates exactly the fields the engine consumes — verified against the schema. The Charmander/Charmeleon default-form-inclusion fix is the user-visible win and is the right call (OPEN_QUESTIONS.md L51 was explicit). Approve-with-nits; the nits are paper-trail and ergonomic, not correctness.
