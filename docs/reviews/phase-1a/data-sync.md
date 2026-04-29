# Phase 1.A — data-sync beat-owner review

**Reviewer.** `data-sync` subagent (beat owner for Phase 1).
**Scope.** Foundation laid in 1.A: `internal/pokedex/schema.sql`, `internal/pokedex/db.go`, `internal/pokedex/types.go`, `internal/pokedex/query.go`, `internal/pokedex/ingest/bulk.go`, `cmd/pokedex-sync/main.go`, `data/tags.yaml`.
**Date.** 2026-04-28.

The 1.A scaffold is in good shape and most decisions hold. There are a small number of concrete schema gaps and one ingestion-ordering hazard that should be fixed *before* 1.B starts ingesting real data, because doing them now is a one-line schema change and doing them in 1.B is a migration plus a re-sync.

---

## 1. Schema fitness vs real PokeAPI data

I cross-checked `schema.sql` against the live API shapes for `pokemon`, `pokemon-species`, `pokemon-form`, `evolution-chain`, `move`, and `ability` (sample fetch keys captured below). The schema is **mostly fit-for-purpose** but is missing a handful of fields we will want, and one of them is hard to add later.

### 1.1 `pokemon` table — fields to add

PokeAPI's `Pokemon` exposes:
`abilities, base_experience, cries, forms, game_indices, height, held_items, id, is_default, location_area_encounters, moves, name, order, past_abilities, past_stats, past_types, species, sprites, stats, types, weight`

What `pokemon` (`schema.sql:81–96`) is missing that we care about:

- **`is_default INTEGER NOT NULL DEFAULT 0`.** PokeAPI's `species.varieties[].is_default` flag is the canonical "this is the headline form for the species" signal. It is the cleanest way to drive the Phase 2 `FormInclusionFilter` default (`AllForms` vs `DefaultFormOnly`). Today we infer it transitively through `forms.is_default`, but the *Pokemon-level* default is sometimes different from the *form-level* default (see Aegislash, Mimikyu-disguised, Eternatus-eternamax). Adding it now costs one column.
- **`order INTEGER NOT NULL DEFAULT 0`.** The `order` field is what PokeAPI uses to sort Pokémon in regional/national listings; it differs from `pokedex_number` for forms. Without it we cannot stably reproduce PokeAPI's sort order, which the snapshot test will care about.
- **`pokemon_id` separate from species `id`.** Sanity-check: `pokemon.id` is the *Pokemon* resource id (e.g. `10034` for charizard-mega-y), not the species id. The current schema uses `pokemon.id INTEGER PRIMARY KEY` and seems to intend the Pokemon resource id. Document this in a comment to prevent the next-author confusion.

### 1.2 `species` table — fields to add

`pokemon-species` (charizard sample) returns:
`base_happiness, capture_rate, color, egg_groups, evolution_chain, evolves_from_species, flavor_text_entries, form_descriptions, forms_switchable, gender_rate, genera, generation, growth_rate, habitat, has_gender_differences, hatch_counter, id, is_baby, is_legendary, is_mythical, name, names, order, pal_park_encounters, pokedex_numbers, shape, varieties`

`schema.sql:45–59` covers `id, slug, name, pokedex_number, generation_id, is_legendary, is_mythical, is_baby, color, shape, habitat, evolution_chain_id, source_commit_sha`. Gaps that matter:

- **`gender_rate INTEGER`** (range −1..8). Required to render gendered sprites and to support the inevitable "exclude female-only species" filter. Cheap to add now.
- **`has_gender_differences INTEGER NOT NULL DEFAULT 0`.** Drives whether to expose the female sprite variants. Cheap to add now.
- **`forms_switchable INTEGER NOT NULL DEFAULT 0`.** Distinguishes Aegislash-style mid-battle form switches from permanent forms; relevant to filter design in Phase 2.
- **`growth_rate TEXT`** and **`base_happiness INTEGER`, `capture_rate INTEGER`, `hatch_counter INTEGER`.** Lower priority — none drive Phase 2 filters today, but the Phase 8 agent ("compare a Pokémon's catch rate") will want them and adding them now avoids a re-sync later.
- **`order INTEGER`.** Same argument as the `pokemon.order` case — needed to reproduce upstream sort order.
- **`evolves_from_species_id INTEGER REFERENCES species(id)`.** Right now the only place evolution lineage lives is the `evolutions` table. Having the parent on the species row is the cheapest way to answer "is this a base form?" for the `EvolutionStageFilter` in Phase 2 without a join.

### 1.3 `forms` table — fields to add

`pokemon-form` returns:
`form_name, form_names, form_order, id, is_battle_only, is_default, is_mega, name, names, order, pokemon, sprites, types, version_group`

`schema.sql:65–76` covers most of this, but is missing **`form_order INTEGER`** (the canonical sort within the species — Charizard, Mega X, Mega Y, GMax) and **`pokemon_id`** (the back-pointer; we have it transitively via `pokemon.form_id` but PokeAPI gives it directly). The form's `version_group` (e.g. `sword-shield` for GMax) is also worth keeping as `introduced_in_version_group TEXT` — it disambiguates GMax (SwSh) from other battle-only forms.

### 1.4 `evolutions` — branching trigger detail

The evolution-chain `evolution_details` array is rich: `min_level, item, trigger, gender, held_item, known_move, known_move_type, location, min_affection, min_beauty, min_happiness, min_steps, needs_overworld_rain, party_species, party_type, region, time_of_day, trade_species, turn_upside_down`. The current schema (`schema.sql:182–191`) collapses everything beyond `min_level` and `item` into `conditions_json`. That is the right call — those fields are extensive and rarely-used — but two things to capture as columns:

- **`trigger TEXT`** is already a column; good.
- **`min_level INTEGER`** is already a column; good.
- **Add `gender INTEGER` and `time_of_day TEXT`.** These are the two non-item conditions that show up in the most evolutions and that filters could plausibly use ("evolutions that work at night"). Otherwise we are forced to JSON-extract from `conditions_json` for two of the most-asked questions.

### 1.5 `moves` and `abilities` — JSON shape coverage

For `move`, the schema captures `damage_class`, `power`, `accuracy`, `pp`, `priority`, `short_effect`, `effect`, `type_id`. PokeAPI also gives `target` (e.g. `selected-pokemon`, `all-opponents`) and `effect_chance`. These should be added — `target` because the Phase 8 agent will want it, and `effect_chance` is a column on the API for a reason.

For `ability`, the schema captures `slug, name, short_effect, effect`. PokeAPI also has `is_main_series` (a bool — relevant because some abilities are stadium/side-game only) and `generation`. Add both as cheap columns.

### 1.6 i18n names

Cross-cutting principle from `PLAN.md` §4: "Schema supports multilingual names from day 1 (PokeAPI provides them)." The current schema has only `name TEXT` columns on `species`, `pokemon`, `forms`, `moves`, `abilities`, `types`. The `flavor_text` table is multilingual; nothing else is. PokeAPI ships per-language `names[]` for every one of these resources (charizard ships 11 language variants). I do not propose ingesting them in 1.B — the volume is significant — but the schema should *accommodate* them now. Add a single multipurpose table:

```sql
CREATE TABLE IF NOT EXISTS localized_names (
  resource_kind TEXT NOT NULL CHECK (resource_kind IN
    ('species','pokemon','form','move','ability','type','generation')),
  resource_id INTEGER NOT NULL,
  language TEXT NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY (resource_kind, resource_id, language)
);
```

This costs one table now and zero migrations later. Phase 1.B can leave it empty; Phase 7+ fills it when i18n traffic arrives.

---

## 2. Atomic-rename pattern (`bulk.go`)

`ingest/bulk.go` writes to a `.tmp` sibling and `os.Rename`s on success. This is the right design and it works correctly on POSIX same-filesystem renames. Edge cases the current code handles or punts on:

- **Stale `.tmp` from a crashed run** — handled (`bulk.go:55-56`).
- **Concurrent runs of `pokedex-sync bulk`** — *not* handled. Two concurrent processes both writing `pokedex.sqlite.tmp` will silently corrupt each other. **Recommend:** acquire an exclusive `flock` on `<output>.lock` for the duration of the run, or use a randomized temp suffix (`pokedex.sqlite.tmp.<pid>.<rand>`) and rely on rename atomicity. The latter is simpler and Go-portable. The lock approach is more defensive for cron-driven schedules in Phase 1.F.
- **Mid-sync crash** — partial: `os.Remove(tmp)` is called on most error paths, but a SIGKILL or panic between schema apply and rename leaves a stale `.tmp`. Already mitigated by the unconditional `os.Remove(tmp)` at the start of the next run. OK.
- **Disk full mid-write** — the SQLite open and ExecContexts will return ENOSPC, the error path runs `os.Remove(tmp)`, and the destination is untouched. Behaves correctly.
- **Partial rename across filesystems** — `os.Rename` on Linux/macOS returns `EXDEV` if `OutputPath` and `<OutputPath>.tmp` are on different filesystems. They will not be in our setup (sibling files), but if the user passes `--out /tmp/...` while the temp is on `/Users/...`... wait, the temp is constructed as `OutputPath + ".tmp"` (`bulk.go:54`), so it is *always* a sibling. Safe by construction. Good.
- **fsync of the directory** — `os.Rename` on macOS/Linux is atomic for a crash mid-rename, but the *durability* of the rename is not guaranteed without an `fsync` on the parent directory. For a v1 zero-cost build that re-syncs idempotently, durability does not matter (we can always re-run). Document this rather than fix it; the cost of fsync'ing the dir is one syscall.
- **SQLite open of a file the destination is mmaped from** — the API server (Phase 1.E onward) will hold an open `*sql.DB` against the same file. On macOS/Linux, `rename(2)` succeeds while readers hold descriptors; the readers continue to see the old inode until they reopen. We need a **reload-on-change** path in the read API (or just an API restart). Flag for Phase 1.E. Not a 1.A blocker.

**Concrete recommendation for 1.B:** before opening the temp DB, take an `flock` on `<OutputPath>.lock` (using `golang.org/x/sys/unix.Flock` or the `gofrs/flock` package — the latter is simpler and cross-platform). Release after rename. Two-line change.

---

## 3. Ingestion ordering

The plan lists: generations → types → species → forms → pokemon → joins → moves → evolutions → flavor_text. Reviewing the FK graph:

- `generations` — no FKs out. Correct first.
- `types` — no FKs out. Correct.
- `stats` — referenced by `pokemon_stats.stat_id`; not in the listed order. **Add `stats` to the ordering, between types and species, even if it's a 6-row constant table.** Otherwise `pokemon_stats` inserts in the join phase will FK-fail. (The 6 stat rows are constants from `/api/v2/stat` — hp, attack, defense, special-attack, special-defense, speed. Likely we hard-code them rather than pull from PokeAPI.)
- `abilities` — same thing. Referenced by `pokemon_abilities.ability_id`. **Add abilities ingest before pokemon-joins phase.** The plan has "joins" as a single bucket, which papers over this dependency.
- `species` — FKs to `generations`. Correct after generations.
- `forms` — FKs to `species` and `generations`. Correct after species.
- `pokemon` — FKs to `species` and `forms`. Correct.
- `pokemon_types` — FKs to `pokemon` and `types`. Correct in joins phase.
- `pokemon_stats` — FKs to `pokemon` and `stats`. Needs stats first (above).
- `pokemon_abilities` — FKs to `pokemon` and `abilities`. Needs abilities first (above).
- `pokemon_moves` — FKs to `pokemon`, `moves`, `generations`. Correct after moves are ingested.
- `evolution_chains` then `evolutions` — `evolutions.from_species_id`/`to_species_id` reference species. Correct after species.
- `flavor_text` — FKs to species. Correct.

**Circularity check.** PokeAPI has one near-circular shape: `pokemon_form.pokemon` points to a `pokemon` that has `pokemon.forms` pointing back. That is a data-shape circularity, not a FK circularity, because we resolve the IDs at parse time. No issue.

**Real circularity risk.** `species.evolves_from_species_id` (proposed in §1.2) creates a self-FK on `species`. SQLite handles self-FKs but you must insert in topological order *or* defer FK checks. Either set `evolves_from_species_id` in a second pass (after all species are inserted), or use `PRAGMA defer_foreign_keys=ON` in the ingest transaction. Document the choice; the second-pass approach is more debuggable.

**Concrete ordering revision:** generations → types → **stats** → **abilities** → **moves** → species → forms → pokemon → pokemon_types/stats/abilities/moves → evolution_chains → evolutions → species.evolves_from (second pass) → flavor_text.

---

## 4. Cloning `PokeAPI/api-data`

Empirical numbers (measured 2026-04-28):

- **Repo size on disk after `git clone --depth 1`:** 557 MB working tree + 20 MB `.git`. (`--filter=blob:none` does not change the working-tree size meaningfully because shallow already drops history; both strategies clone in ~17 seconds on a fast connection.)
- **Update cadence:** an "Updater Bot" pushes regenerated data 2–4 times a week. The most recent 20 commits span 2026-03-19 to 2026-04-26 — about 0.5 commits/day.
- **Default branch:** `master`.

**Recommendations:**

1. **Use `git clone --depth 1 --branch master`.** No reason to fetch history we will not consult. Add `--single-branch` for clarity. `--filter=blob:none` is unnecessary at depth 1.
2. **Pin to a specific commit SHA per sync run.** Do not use `master` as the source of truth. The sync flow should be: `git fetch --depth 1 origin master`, then `git rev-parse origin/master` → record that SHA in `sync_meta.api_data_commit_sha` *before* ingestion. This is exactly what the existing column expects, and `commitSHAOrPlaceholder` (`bulk.go:106`) is the right hook — replace its body with `git -C <path> rev-parse HEAD` in 1.B.
3. **Document the disk-space requirement.** 557 MB working tree is more than a CI runner's free disk (`actions/runner` images have ~14 GB free, so we are fine, but a contributor cloning on a small VM should know). Note in `Makefile` and the `bulk` `--api-data` flag's help text.
4. **Don't shallow-clone in CI's hot path.** A 17-second clone on every CI run is wasteful. CI should `actions/cache` the api-data working tree keyed by the Pokémon Ranker repo's `tags.yaml + schema.sql` hash. Out of scope for 1.A but worth flagging in 1.B's CI integration.
5. **Phase 1.F drift-check uses live API, not the dump.** The plan already says this. Confirm: live API calls in drift-check should rate-limit to PokeAPI's published 100 req/min and use the same `If-Modified-Since` header behavior the SDKs use.

---

## 5. Tag structure: multi-tag fitness

`schema.sql:215-218` defines `pokemon_tags` as `(pokemon_id, tag_id) PRIMARY KEY`. This is correct: a single Pokemon row can carry an arbitrary number of tag rows. Verifying against the user's named edge cases:

- **Necrozma-Ultra = legendary AND ultra_beast.** ✅ — `pokemon_tags` will have two rows, one for `tag_id=legendary`, one for `tag_id=ultra_beast`. Both reference the same `pokemon.id` for the necrozma-ultra row.
- **Kyurem-Black = legendary AND fusion.** ✅ — same mechanism.
- **Calyrex-Ice = legendary AND fusion.** ✅ — same.
- **Charizard's Mega X = mega only; Charizard base = no mega tag.** ✅ — because tags are pinned per *form-qualified slug* in `tags.yaml` (the file's leading comment says exactly this), and `pokemon_tags.pokemon_id` is form-specific. The tag joins onto the (species, form) row, not the species, which is correct.

**One concern:** `tags.yaml` says "members" is a flat list of slugs, with the comment that form-qualified slugs are valid for form-specific tags. The loader must:

1. Match `mega`/`gmax` only against form-qualified slugs (e.g. `charizard-mega-x`), never against species slugs (i.e. `charizard` should never get the `mega` tag).
2. Match `legendary`/`mythical`/`ultra_beast`/`paradox` against the species slug, *propagating* to every `pokemon` row sharing that species (so all of `mewtwo`, `mewtwo-mega-x`, `mewtwo-mega-y` get `legendary`).
3. Validate that every listed slug resolves to *something* (species or pokemon row). Unresolved slugs must fail the sync (per `data-sync.md` rule "if a record fails validation, report it and stop").
4. The loader's resolution rules need to be in `tags.yaml`'s leading comment or in a separate `data-sync` doc — they are non-obvious and PR reviewers will need them.

**Recommendation:** when 1.D builds the tag loader, write the resolution rules as code comments in `internal/pokedex/ingest/tags.go` *and* mirror them as a one-paragraph section in `tags.yaml`'s header. Property-based test: for every tag, exercise the resolution against a fixture pokedex.

---

## 6. Drift detection — per-row hash columns

Phase 1.F drift-check needs to compare our SQLite content against live PokeAPI without re-ingesting. The cheapest design is per-row hashes that drift-check recomputes from live data and compares.

**Recommendation: add `content_hash TEXT` columns now, in 1.A.**

- `pokemon.content_hash` — SHA-256 over the canonical-JSON serialization of the relevant subset of upstream pokemon JSON. Computed at ingest time.
- `species.content_hash` — same for species JSON.
- `forms.content_hash` — same for forms JSON.
- `moves.content_hash`, `abilities.content_hash` — same.

Adding these now is a 5-line schema change. Adding them in 1.F is a `ALTER TABLE` plus a backfill (and SQLite ALTER TABLE has historically been clunky for column adds — fine for adding a nullable column, but every migration is a thing we do not want).

The hash content needs to be stable: order-of-keys-canonical, ignore upstream-inserted timestamps, ignore `learned_by_pokemon`-style backreferences. Document the canonicalization function so 1.F's drift-check uses the exact same one. **If we do not ship hash columns now, we will ship them in a 1.F migration and re-sync the entire dataset to populate them.**

Also: **drop `source_commit_sha` from the per-row schema and rely on `sync_meta` for provenance.** `pokemon.source_commit_sha` and `species.source_commit_sha` (`schema.sql:58, 95`) duplicate what `sync_meta` already tracks per-run, and they will be the same value for every row in a bulk sync. They are only useful in the *delta* mode (Phase 1.F) where different rows might have come from different commits. If we keep them, the delta path is cleaner; if we drop them, we save 100kb on the SQLite file. Either is defensible; **flag for the user as a v1 schema choice to ratify**.

---

## 7. Provenance — `sync_meta` audit trail

`sync_meta` (`schema.sql:24-31`) captures `id, ran_at, mode, api_data_commit_sha, duration_ms, record_counts_json`. For the audit trail D-17 / D-18 imply (we accept upstream rate-limit risk; we accept zero-cost ops; reproducibility is on us), this is *almost* enough. Gaps:

- **`schema_version INTEGER`** — which schema version was active for this sync. Lets a future debugger correlate "this row was synced under schema v1" with the specific column set in play.
- **`pokedex_sync_version TEXT`** — which version of the `pokedex-sync` binary ran. Either embed `runtime/debug.ReadBuildInfo()`'s vcs revision or a build-time `-ldflags "-X main.version=..."`. Lets us tell a "schema v1 + binary at commit abc123" sync apart from "schema v1 + binary at def456".
- **`status TEXT NOT NULL CHECK (status IN ('success','failed','partial'))`** — currently we only record successful syncs (the `INSERT INTO sync_meta` runs after ingestion completes). When 1.B starts doing real ingestion, partial failures will exist. We need a row for them. Insert at the *start* of the run with `status='running'`, update on success or to `failed` with an error column on failure. (Tradeoff: this means the `sync_meta` row is no longer atomic-renamed with the data; on rename, the in-progress row in the .tmp DB is replaced with the new file's history, losing the failure record. That is fine for v1 — failures are diagnosed from logs, not the DB. But document the choice.)
- **`error_message TEXT`** for failed runs.
- **`tags_yaml_sha TEXT`** — the SHA-256 of `tags.yaml` at sync time. Tags can change without `api-data` changing; this lets drift-check distinguish the two.

**Concrete ALTER:**

```sql
ALTER TABLE sync_meta ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE sync_meta ADD COLUMN binary_version TEXT NOT NULL DEFAULT '';
ALTER TABLE sync_meta ADD COLUMN tags_yaml_sha TEXT NOT NULL DEFAULT '';
ALTER TABLE sync_meta ADD COLUMN status TEXT NOT NULL DEFAULT 'success'
  CHECK (status IN ('success','failed','partial'));
ALTER TABLE sync_meta ADD COLUMN error_message TEXT;
```

Or, since the schema is rebuilt each bulk sync and version 1 has not shipped, just edit `schema.sql` directly. **Do this in 1.A, not 1.B.**

---

## 8. Other small things worth flagging

- `bulk.go:70-83` — the `INSERT INTO sync_meta` is not in a transaction. Trivially correct for one row, but when 1.B adds 30 ingest steps, the lack of an outer `BEGIN ... COMMIT` will be a perf problem (every insert flushes WAL). Wrap the entire ingestion in a single `BEGIN IMMEDIATE` / `COMMIT` to keep the .tmp DB consistent and dramatically faster.
- `db.go:28` — `busy_timeout(5000)` is fine for ingest, low for a long-running web server. Different from a 1.A concern; flag for 1.E.
- `db.go:43` — the schema apply runs every `Open`. This is correct and idempotent today. With the proposed `localized_names` table and any other new table, double-check `IF NOT EXISTS` survives across pre-existing DBs. (For 1.A this is moot; the file is rebuilt each sync.)
- `query.go:11` — `ErrNotImplemented` mentions "Phase 1.B"; good signpost.
- `tags.yaml` — `pseudo_legendary`'s 10 members look correct for Gens 1–9. Add `iron_valiant` etc.? No — `iron_valiant` is `paradox`, not `pseudo`. Members list is right. Tag descriptions read well; no nits.

---

## 9. Action list before 1.B starts

Blockers (must fix in 1.A):

1. **Add `stats` and `abilities` tables to the ingest order before the joins phase.** Update `docs/PLAN.md` Phase 1.B description and `bulk.go`'s comment block (`bulk.go:66-68`).
2. **Add `content_hash TEXT NOT NULL DEFAULT ''`** to `pokemon`, `species`, `forms`, `moves`, `abilities`. Required to support drift-check (Phase 1.F) without a future migration.
3. **Expand `sync_meta`** with `schema_version`, `binary_version`, `tags_yaml_sha`, `status`, `error_message` (or rebuild — schema is unshipped).
4. **Add concurrent-run guard** to `bulk.go` via `flock` on `<OutputPath>.lock`. Two-line change once `gofrs/flock` is added.

Strongly recommended (cheap and relevant before 1.B fills in ingestion):

5. Add `pokemon.is_default`, `pokemon.order`.
6. Add `species.gender_rate`, `species.has_gender_differences`, `species.forms_switchable`, `species.evolves_from_species_id`, `species.order`.
7. Add `forms.form_order`, `forms.introduced_in_version_group`.
8. Add `evolutions.gender INTEGER`, `evolutions.time_of_day TEXT`.
9. Add `moves.target TEXT`, `moves.effect_chance INTEGER`, `abilities.is_main_series INTEGER`, `abilities.generation_id INTEGER`.
10. Add `localized_names` table (empty in 1.B; populated when i18n is needed).
11. Wrap all 1.B ingestion in `BEGIN IMMEDIATE` / `COMMIT` in the .tmp DB.

Discretionary (flag for the user):

12. Drop `pokemon.source_commit_sha` and `species.source_commit_sha` if we are happy treating `sync_meta.api_data_commit_sha` as the per-run authority. Keep them if the delta path will benefit. *User decision.*
13. Consider `schema_version=2` semantics now that several adds are queued — or just rewrite schema.sql in place since v1 has not shipped. *Assistant call; I lean "rewrite in place".*

---

**Verdict: Request changes**

The 1.A foundation is sound, but four items (the four blockers in §9) are *much* cheaper to fix now than after 1.B has populated the database. The schema gaps in §1 are not formally blocking, but they are individually one-line changes; folding them in before 1.B would prevent the second migration we are otherwise queuing up. I would withdraw the "request changes" verdict to "approve with nits" if items 1–4 are resolved and items 5–11 are at least filed as 1.B starter work.
