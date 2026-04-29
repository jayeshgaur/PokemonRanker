# Phase 1.B Scope — data-sync Beat-Owner Review

**Reviewer.** `data-sync` subagent (Phase 1 beat owner).
**Scope.** Validate the proposed 1.B.1–1.B.5 sub-phasing, the §1.1–§1.6 schema additions queued in `OPEN_QUESTIONS.md`, the 1.B.5 validation gate, PokeAPI shape edge cases, and `api-data` clone management.
**Date.** 2026-04-28.
**Inputs read.**
- `apps/api/internal/pokedex/schema.sql`
- `apps/api/data/tags.yaml`
- `docs/PLAN.md` (Phase 1)
- `docs/OPEN_QUESTIONS.md` (Phase 1.B starter list)
- Prior reviews: `docs/reviews/phase-1a/data-sync.md`, `docs/reviews/phase-1a/data-sync-regate.md`
- PM second-look: `docs/reviews/planning/_phase-1b-prerequisites-second-look.md`

---

## 1. Sub-phasing — is 1.B.1 → 1.B.5 ordered correctly?

The proposed ordering is:

1. **1.B.1** — schema expansion + sync infra
2. **1.B.2** — constants (generations, types, stats)
3. **1.B.3** — core graph (species → forms → pokemon)
4. **1.B.4** — joins/evolutions (pokemon_types, pokemon_stats, pokemon_abilities, pokemon_moves, evolution_chains, evolutions, evolves_from second pass)
5. **1.B.5** — query API + validation gate

This matches the FK dependency DAG that the 1.A re-gate verified at `bulk.go:46-62`. **Approve the ordering with two qualifiers:**

### 1.1 Missing dependency edge: abilities and moves are constants too

The §1.1 description ("constants in 1.B.2") implicitly groups abilities and moves with the joins phase (1.B.4). That is wrong by the same FK argument the 1.A re-gate established:

- `pokemon_abilities` FK-references `abilities`. Therefore `abilities` must be ingested before any `pokemon_abilities` row.
- `pokemon_moves` FK-references `moves`. Same.

The 1.A re-gate's `bulk.go` ordering already reflects this (steps 4 and 5: ingestAbilities, ingestMoves *before* ingestSpecies). The PM call's "constants" framing risks regressing this. **Recommendation:** redefine 1.B.2's scope as "all FK-target tables that don't reference others" — explicitly: generations, types, stats, abilities, moves. That's 5 tables, all small-to-medium, all simple list endpoints, all unblock the rest of ingest. If we keep moves and abilities in 1.B.4, we have a tail-risk of a contributor implementing the join phase and discovering the constants weren't ingested.

### 1.2 Missing dependency edge: `flavor_text` and `pokemon_tags`

Neither appears in the 1.B.1–1.B.5 PM call as named. They both FK to species/pokemon and need to land somewhere:

- **`flavor_text`** — depends only on species. Lowest cost: tail of 1.B.3 or beginning of 1.B.4. It's also the largest table by row count (~10k rows: 1k species × 10 versions × 1 language); arguably a 1.B.4 candidate where we already accept a transaction-heavy step.
- **`pokemon_tags`** — depends on `pokemon` (and thus on the second-pass `evolves_from_species_id` not being needed for tag resolution). The tag loader is a separate workflow with its own validation logic (resolving tags.yaml slugs to pokemon rows, propagating species-tags to all forms — see 1.A review §5). It deserves its own beat. The PM call says it lands in **Phase 1.D** ("tag curation"), not 1.B. **That's correct.** Restate explicitly so 1.B's validation gate doesn't try to assert tag content; tag-related assertions are a 1.D gate.

### 1.3 Missing edge: `localized_names` empty-table creation

The §1.6 add (`localized_names` table) needs to land in 1.B.1 (schema expansion) but never gets ingested in 1.B. It's a structural-only add. Fine, but call it out so a contributor doesn't think 1.B.5 validation should assert anything about it.

### 1.4 Missing edge: tag-loading dry-run

If the PM is keeping tags in Phase 1.D, fine. But 1.B.5 validation should still verify that *the tag join table exists empty* and that **at least one referential test** confirms tag loading would work. The cheapest version: a 1.B.5 unit test that loads a hand-written 2-row `tags.yaml` fixture into a fresh DB and asserts the join works. This catches "tag loader assumes a column we removed during 1.B" bugs *before* 1.D inherits them.

**Verdict on 1:** Ordering is correct in spirit and matches the FK DAG, but the "constants" bucket needs to explicitly include abilities and moves, and `flavor_text` needs to be assigned to a sub-phase (currently floating). Two-line fixes to the PM's table.

---

## 2. §1.1–§1.6 schema additions — which land in 1.B.1 vs elsewhere?

The `OPEN_QUESTIONS.md` Phase 1.B starter list (lines 27–35) enumerates 16 schema additions across pokemon, species, forms, evolutions, moves, abilities, plus the `localized_names` table. Reviewing each for "must land in 1.B.1 (before ingest)" vs "could defer":

### 2.1 Must land in 1.B.1 (schema-only adds; no ingest data needed)

All of these are columns that will be populated in 1.B.3/1.B.4 when we ingest the relevant resource. Adding them in 1.B.1 is free; adding them after ingest costs an `ALTER TABLE` migration (which SQLite tolerates for nullable adds but which we want to avoid as a matter of hygiene):

- `pokemon.is_default`, `pokemon.order` — populated when we ingest `pokemon` in 1.B.3.
- `species.gender_rate`, `species.has_gender_differences`, `species.forms_switchable`, `species.order`, `species.growth_rate`, `species.base_happiness`, `species.capture_rate`, `species.hatch_counter` — all populated when we ingest `species` in 1.B.3.
- `forms.form_order`, `forms.introduced_in_version_group` — populated when we ingest `forms` in 1.B.3.
- `evolutions.gender`, `evolutions.time_of_day` — populated when we ingest `evolutions` in 1.B.4.
- `moves.target`, `moves.effect_chance` — populated when we ingest `moves` in 1.B.2 (per §1.1 fix).
- `abilities.is_main_series`, `abilities.generation_id` — populated when we ingest `abilities` in 1.B.2 (per §1.1 fix).
- `localized_names` table — empty in 1.B; structural-only.

**Conclusion:** all 16 column adds + the `localized_names` table land in 1.B.1. None need ingestion data first. None should defer to 1.C.

### 2.2 The one column that has subtle ordering dependency

**`species.evolves_from_species_id INTEGER REFERENCES species(id)`** is a self-FK. The 1.A re-gate already addressed the ordering: it must be populated in a *second pass* after all species rows exist (`bulk.go:46-62` step 11). Concretely:

- 1.B.1: add the column, defaults to NULL.
- 1.B.3: insert species rows with `evolves_from_species_id = NULL` (first pass).
- 1.B.4: after `evolutions` ingest completes, run the second-pass `UPDATE species SET evolves_from_species_id = ? WHERE id = ?` query.

If a contributor populates `evolves_from_species_id` in the first species insert pass, the FK will fail for any species whose parent is later in the insertion order (e.g., if eevee gets inserted before its evolutions, that's fine; but if charmeleon gets inserted before charmander's id is known, FK fails). The re-gate's recommendation of `PRAGMA defer_foreign_keys=ON` for the duration of the ingest transaction is the simpler defense and worth adopting alongside the second-pass approach.

### 2.3 Should anything land in Phase 1.C (sprite/cry URLs + flavor text)?

Reviewing the 1.C-bound work:

- Sprite columns already exist on `pokemon` (`sprite_url`, `shiny_sprite_url`, `official_artwork_url`, `cry_url`, `pokedex_db_url`). These are populated in 1.C, but the columns themselves should be set in 1.B.3 alongside the rest of the row insert — separating "insert pokemon row" from "set sprite URLs on pokemon row" is artificial. **Recommendation:** roll sprite URL population into 1.B.3, drop the 1.B/1.C boundary on this. 1.C becomes "R2 mirror commitment work" only (per D-21).
- `flavor_text` — table already exists. Populating it is 1.B (see §1.2 above).

**Net:** none of the §1.1–§1.6 schema items defers to 1.C. The 1.C boundary should be redrawn around D-21's R2 mirror work, not around "sprite URL columns" (which are already populated in 1.B by virtue of being on the pokemon row).

---

## 3. Validation cases for 1.B.5 — 20 lookup/filter cases

The 1.B exit criterion in PLAN.md (line 119) reads "20 hand-checked filter cases return correct results. Full snapshot test green." Here are 20 specific cases that exercise the realistic ingest bugs we'd expect:

### 3.1 Form identity (D-1)

1. **Charizard has exactly 6 (species, form) rows.** Charmander/Charmeleon/Charizard/Mega-X/Mega-Y/Gigantamax. Catches collapsed-forms bugs.
2. **Mewtwo has exactly 3 rows.** Base / Mega-X / Mega-Y. (Not 4 — there's no GMax Mewtwo despite the franchise rumors.)
3. **Pikachu has ≥17 rows.** Base + 6 cap forms + Cosplay forms + Gigantamax + Partner-Cap. Catches "we filtered out cosmetic forms" bugs.
4. **Aegislash has 2 rows: shield form (default) and blade form**, and `forms_switchable=1` on the species. Catches the "battle-only forms get dropped" bug and exercises §1.1's `forms_switchable` field.
5. **Necrozma has 4 rows: base, dusk-mane, dawn-wings, ultra**, and *both* `legendary` and `ultra_beast` would tag necrozma-ultra (verified in 1.D).
6. **Total `pokemon` row count is between 1300 and 1600** (Gen 1–9 base + forms; soft band — exact count is a moving target as PokeAPI updates). Catches "we accidentally only ingested 1010 species and dropped all forms."

### 3.2 Tag membership (joins to 1.D but the test fixture lives in 1.B)

7. **Exactly 10 species are tagged `pseudo_legendary`**, with the slugs matching `tags.yaml` lines 40–49 (dragonite, tyranitar, salamence, metagross, garchomp, hydreigon, goodra, kommo-o, dragapult, baxcalibur). Tag propagation: each species's *forms* should *also* carry the tag — so e.g. metagross-mega should also be `pseudo_legendary` if a mega-metagross form exists. (It does. Mega-Tyranitar same. Catches "tag loader didn't propagate to forms" bugs.)
8. **Necrozma-Ultra is tagged BOTH `legendary` AND `ultra_beast`.** (1.A review §5 listed this as the multi-tag canary.) Catches "tag is a single-valued column" bugs.
9. **No species-only tag (`legendary`, `mythical`, `ultra_beast`, `paradox`) is attached to a non-default form's `pokemon` row without also being attached to the default form's `pokemon` row.** Catches "tag attached to mega but not base" inversion bugs.
10. **Exactly the slugs ending in `-mega`, `-mega-x`, `-mega-y`, `-primal` carry the `mega` tag.** No species slugs (e.g., the `charizard` row, separate from `charizard-mega-x`) carry `mega`. Catches the inverse propagation bug from §5 of the 1.A review.

### 3.3 Type system

11. **Every `pokemon` row has 1 or 2 `pokemon_types` rows** (no row has 0; no row has 3+). Catches "type slot collision dropped a row" or "monotype Pokémon got a phantom slot 2."
12. **Charizard (the base form, `slug='charizard'`) has types `fire` (slot 1) and `flying` (slot 2)**, and Charizard-Mega-Y has types `fire` and `flying` while Charizard-Mega-X has types `fire` and `dragon`. Catches form-specific typing bugs (D-1's whole motivation).
13. **Galarian Articuno (`articuno-galar`) has types `psychic` and `flying`**, NOT `ice`/`flying` (which would be the unmodified species types). Catches "regional variant inherits species typing instead of form typing."

### 3.4 Stats and base experience

14. **Every pokemon row has exactly 6 `pokemon_stats` rows** (hp, attack, defense, special-attack, special-defense, speed). Catches missing stat slots.
15. **Mewtwo's BST equals 680**, and Mewtwo-Mega-X's BST equals 780, and Mewtwo-Mega-Y's BST equals 780. Catches "all forms got the species' stats" bugs.
16. **Blissey's HP stat is 255** (the published max). Catches "stat got clamped to a smaller width" bugs and also exercises the schema's `CHECK (base_value BETWEEN 0 AND 255)`.

### 3.5 Evolutions

17. **Charmander → Charmeleon at level 16**, **Charmeleon → Charizard at level 36** — both rows present in `evolutions` with `trigger='level-up'`, `min_level=16` and `36`. Catches dropped/swapped evolution edges.
18. **Eevee has 8 outgoing edges in `evolutions`** (Vaporeon, Jolteon, Flareon, Espeon, Umbreon, Leafeon, Glaceon, Sylveon). Catches "we only kept one evolution per species."
19. **Wurmple → Silcoon AND Wurmple → Cascoon both exist** (the random-branch case), with conditions captured in `conditions_json`. Catches "we picked one branch and dropped the other."

### 3.6 Generations and provenance

20. **Every `pokemon` row's `generation_id` is set** (no NULLs) and matches one of generations 1–9. Counts by generation roughly: Gen 1 ≈ 165 (151 base + Megas + Alolan), Gen 2 ≈ 110, Gen 3 ≈ 145, Gen 4 ≈ 120, Gen 5 ≈ 165, Gen 6 ≈ 80, Gen 7 ≈ 100, Gen 8 ≈ 110, Gen 9 ≈ 130 (loose bands; tight bands per-gen catch off-by-one species-include errors).

**Rationale.** Cases 1–6 catch form-collapse bugs (D-1 violations). Cases 7–10 catch tag-loader bugs that only surface with the multi-tag and form-propagation rules. Cases 11–13 catch typing-by-form bugs that PokeAPI's shape makes easy to get wrong. Cases 14–16 catch stat-population bugs. Cases 17–19 catch evolution-edge bugs (the most JSON-shaped data in the dataset). Case 20 catches the cross-cutting "we ingested everything but our generation_id is wrong" failure mode that touches every row.

If all 20 pass, we have high confidence the dataset is intact across the dimensions the downstream phases (Phase 2 filters, Phase 3 ranker, Phase 4 UI) actually exercise.

---

## 4. PokeAPI edge cases Phase 1.B should anticipate

The bulk dump lives at `github.com/PokeAPI/api-data` under `data/api/v2/`. Real surprises observed in the live data:

### 4.1 Null and absent fields

- **`pokemon.base_experience` is null** for some battle-only forms (e.g. Eternatus-Eternamax, Greninja-Battle-Bond in older dumps, Eevee-Starter from LGPE). Schema declares `NOT NULL DEFAULT 0`; ingest must coalesce nulls to 0 explicitly, not pass through the JSON null.
- **`move.power` is null** for status moves and for moves with variable damage (Seismic Toss, Frustration). Schema column is nullable — verify ingest preserves null and doesn't coerce to 0.
- **`move.accuracy` is null** for moves that never miss (Swift, Aerial Ace) and for moves with variable accuracy. Same caveat.
- **`pokemon.height` and `pokemon.weight` can be 0** for some default-only Pokémon (Wishiwashi-School in older dumps had weight 0 because it stored the school weight in a different field). The schema's `NOT NULL DEFAULT 0` saves us, but a validation case for "no Pokémon has weight 0 except the known list" would catch silent ingest failures.
- **`species.color` is null** for a small number of legendary species. Schema is nullable; verify.
- **`species.habitat` is null** for *most* Pokémon Gen 6+ (the `habitat` field was deprecated; only Gens 1–3 reliably populate it). Plan for ~70% of post-Gen-3 species to have `habitat=NULL`.

### 4.2 Multi-value and array surprises

- **`pokemon-form.types` differs from `pokemon.types`** for some forms. The form-level types are the ones we want (Aegislash blade form has different types than Aegislash shield, even though `pokemon` for both points to the same... wait, actually there are two `pokemon` rows here per D-1, and each carries form-specific types). **Crucial:** ingest `pokemon_types` from the *form's* types array when the form has its own types, falling back to the pokemon's types array otherwise. PokeAPI is inconsistent here — for some forms `pokemon-form.types` is empty/identical to the pokemon.
- **`pokemon.past_types`** is a non-empty array for Pokémon whose typing changed across generations (Gengar, Magnemite, Clefairy gained Fairy in Gen 6; their `past_types` shows what they were before). Decide: do we ingest only the *current* typing or do we capture past_types? **Recommendation:** current typing only in 1.B; capture `past_types` in a future column if a Gen-specific filter is requested. Document the choice in the ingest comment so the agent doesn't think the data is missing.
- **`pokemon-species.varieties` includes battle-only and totem forms** that we may or may not want as `pokemon` rows. Examples: `pikachu-rock-star`, `pikachu-belle`, `pikachu-pop-star`, `pikachu-phd`, `pikachu-libre`, `pikachu-cosplay` (six cosmetic forms). **Decision needed:** include all of them as separate `pokemon` rows (D-1 default) or filter cosmetic forms? If we filter, we need `forms_overrides.yaml` (the Phase 1.B open question per `OPEN_QUESTIONS.md` line 25). Recommend defaulting to "include all varieties; suppress in filter UI in Phase 4 if needed."
- **`pokemon-form.form_order` is sometimes 0** even for non-default forms. Phase 1.B's added `form_order` column will need a documentation comment that 0 is meaningful (the canonical first form, equivalent to `is_default=1`). Sort ties broken by `id`.
- **`evolution_chain.chain` is a deeply nested recursive structure**, not a flat list. Ingest must walk the tree and emit one `evolutions` row per `evolves_to[].evolution_details[]` entry. A species with multiple branches (Eevee, Wurmple, Tyrogue) will emit multiple rows for the same `from_species_id`. A species with multiple evolution conditions for the same target (Slowpoke → Slowking via King's Rock OR via the Galar method) will emit *multiple rows for the same (from, to) pair*. The schema's `evolutions` table has no UNIQUE on (from, to), which is correct — keep it that way.

### 4.3 Deprecated, renamed, and version-specific data

- **`pokemon-form.is_battle_only`** was added late in PokeAPI's lifetime; older dumps may have it as `false` for forms that *are* battle-only (Necrozma-Ultra, Mimikyu-Busted, every Mega and GMax). Check the live API result for ground-truth and don't trust the column blindly.
- **`pokemon-form.is_mega`** was added even later. The *reliable* signal for mega forms is the slug suffix (`-mega`, `-mega-x`, `-mega-y`, `-primal`) plus checking if the form's `version_group` falls in the X/Y or OR/AS or USUM range. **Recommendation:** populate `forms.is_mega` from the slug pattern, not from `pokemon-form.is_mega`. Same for `is_gmax` (slug suffix `-gmax`).
- **`pokemon.cries.latest` and `pokemon.cries.legacy` URLs.** PokeAPI added cry URLs around 2024. Some forms have `null` for both. Schema allows empty string; verify ingest handles the null.
- **Hisuian forms (e.g., `arcanine-hisui`, `samurott-hisui`)** are tagged as the `hisui` region in version_group, but their species `varieties` array conflates them with the base species. The form slug is the disambiguator.

### 4.4 Encoding and string surprises

- **Pokémon names contain special characters.** Farfetch'd → `farfetchd` slug, but the display name has `'`. Type-Null → `type-null` slug, display name `Type: Null` with a colon. Ho-Oh → `ho-oh` slug. Mr. Mime → `mr-mime` slug, display name `Mr. Mime`. Mime Jr. → `mime-jr` slug. Porygon-Z, Porygon2 (the 2 is part of the name; slug is `porygon2` not `porygon-2`). Nidoran♀ / Nidoran♂ — slug strips the gender symbol but display name doesn't. **Validation:** ensure the display_name fixtures for these exact 7 Pokémon survive ingest unchanged.
- **Flavor text contains literal `\f` form-feed bytes** between hyphenated words and after line breaks (artifact of how the games stored text). Many ingest pipelines strip them, which can fuse words together (e.g., "POKé\fMON" → "POKéMON"). Decide: preserve as-is, or normalize to spaces? **Recommendation:** normalize `\f` and `\n` to single spaces, log the count of substitutions per species so we can audit if it ever spikes.
- **`names[]` localized names use UTF-8** including Chinese-Han, Japanese kana, Korean hangul. Schema is TEXT (UTF-8 by default in SQLite); the `localized_names` table will need to handle these. Validation: round-trip a Chinese-Han name through the loader and verify byte-for-byte equality.

### 4.5 Generation 9 surprises

- **Tatsugiri has 3 forms (curly, droopy, stretchy)** — all three are distinct `pokemon-form` entries. Distinct sprites.
- **Maushold has 2 forms (family-of-three, family-of-four)** — both legitimate, both have distinct sprites.
- **Squawkabilly has 4 plumage forms** — green, blue, yellow, white. All four are `pokemon-form` rows.
- **Iron Hands and Roaring Moon (paradox forms)** are *species*, not forms. Their `species_id` is distinct from the modern Pokémon they reference. Don't try to attach them as forms to Hariyama / Salamence respectively.
- **Walking Wake, Iron Leaves, Gouging Fire, Iron Crown, Iron Boulder, Raging Bolt** — all paradox forms added post-launch. May be missing from older dumps. The `tags.yaml` `paradox` member list will need maintaining.

### 4.6 Fields PokeAPI exposes inconsistently

- **`pokemon.location_area_encounters`** is a URL string, not the data itself. Resolving it requires a separate API call per Pokémon, and the data is encounter-table noise that's almost never relevant to ranker UX. **Decision:** skip ingestion of this field in 1.B. Document.
- **`pokemon.held_items`** (Pikachu sometimes spawns holding a Light Ball, etc.). Some held items are absent in the bulk dump but present in the live API. Skip in 1.B; revisit if a "Pokémon that hold items" filter is requested.
- **`pokemon.game_indices`** is a per-version array of indices. Useful for ROM-hacking tools, irrelevant to ranker. Skip.

---

## 5. `api-data` clone management

Empirical numbers from the 1.A review §4 (re-confirmed): 557 MB working tree + 20 MB `.git` after `git clone --depth 1 --branch master`. Update cadence: ~0.5 commits/day from the Updater Bot.

### 5.1 Local `make sync`

**Recommendation: shallow-clone-and-pull, but *only* on explicit refresh.**

- `make sync` should *not* automatically `git pull` on every invocation. The dump is ~557 MB; pulling on every dev iteration is wasteful and slow.
- Introduce `make sync-pull` (or `make sync FRESH=1`) that performs `git fetch --depth 1 origin master && git reset --hard origin/master`. Default `make sync` reuses whatever is in the cache directory.
- The cache directory should default to `${XDG_CACHE_HOME:-$HOME/.cache}/pokeapi-api-data`, *not* a path inside the repo. Keeps the 557 MB out of the user's working tree and out of the project's `.gitignore` blast radius.
- The first `make sync` invocation (when the cache doesn't exist) should auto-clone with a clear progress message. Subsequent invocations skip the network entirely unless `FRESH=1`.
- The `bulk` binary already records `api_data_commit_sha` per run (`schema.sql:29`); a developer running stale data will see the same commit SHA across syncs and can decide whether to refresh.

### 5.2 CI

**Recommendation: `actions/cache` keyed on the api-data commit SHA.**

- CI should resolve `git ls-remote https://github.com/PokeAPI/api-data refs/heads/master` first (3 KB request, no clone). Use the resolved SHA as the `actions/cache` key.
- On cache hit: skip the clone entirely, restore the 557 MB working tree from cache (~5 seconds).
- On cache miss (i.e., upstream pushed since the last CI run): `git clone --depth 1 --branch master`, run sync, save to cache.
- Cache key includes the `tags.yaml` SHA *and* the `schema.sql` SHA (so a tag/schema change invalidates the cache and re-runs the sync). This avoids the perverse case where a tag change goes unnoticed because the api-data SHA is unchanged.
- Cache entries auto-expire after 7 days under GitHub's default policy, which matches our acceptable staleness window.
- **Do not shallow-clone on every CI run.** A 557 MB clone on every push is ~17 seconds plus bandwidth — small in absolute terms but wasteful at scale, and the cache hit rate should be >90% in steady state.

### 5.3 Drift-check (Phase 1.F)

Out of 1.B scope but worth flagging: drift-check uses the *live API* (per PLAN.md), not the dump. For drift-check, no clone is needed. PokeAPI's published rate limit is 100 req/min; with ~1500 Pokémon, drift-check is a 15-minute job at the cap, which is fine for a manual operator-triggered refresh.

### 5.4 The pinning rule

**Whatever clone strategy we adopt, the bulk binary must record the resolved commit SHA in `sync_meta.api_data_commit_sha` *before* ingestion starts** (per the 1.A re-gate's `bulk.go:106` hook). The strategy choices above all preserve this property.

---

## Summary table

| Question | Answer |
|----|----|
| 1.B sub-phasing correct? | Yes, with two qualifiers: (a) move abilities and moves to 1.B.2 constants bucket, not 1.B.4 joins; (b) assign `flavor_text` and `pokemon_tags` to explicit sub-phases (1.B.4 and Phase 1.D respectively). |
| Schema adds (§1.1–§1.6) — all in 1.B.1? | Yes; all 16 columns + `localized_names` table land in 1.B.1. None require ingestion data first; none defer to 1.C. |
| 1.B.5 validation cases | 20 cases listed in §3, covering form identity (1–6), tags (7–10), typing (11–13), stats (14–16), evolutions (17–19), generation provenance (20). |
| PokeAPI edge cases | Null fields (base_experience, color, habitat, move power/accuracy), past_types, cosmetic-form variety inflation (Pikachu), is_mega is unreliable, cries can be null, special-character display names, `\f` in flavor text, Gen 9 multi-form species (Tatsugiri, Maushold, Squawkabilly), paradox-as-species. |
| `api-data` clone management | Shallow clone, cache outside repo at XDG_CACHE_HOME, refresh on explicit `FRESH=1` only. CI uses `actions/cache` keyed on api-data commit SHA + tags.yaml SHA + schema.sql SHA. |

---

**Verdict: Approve with two structural fixes.** The 1.B.1–1.B.5 ordering is correct in spirit but needs the "constants" bucket explicitly redefined to include abilities and moves (per the 1.A re-gate's `bulk.go` ordering) and needs `flavor_text` / `pokemon_tags` assigned to explicit sub-phases. All §1.1–§1.6 schema additions land in 1.B.1. The 20 validation cases above are the recommended exit gate for 1.B.5.
