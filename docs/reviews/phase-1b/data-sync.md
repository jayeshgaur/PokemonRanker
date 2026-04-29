# Phase 1.B — data-sync beat-owner review (1.B gate)

**Reviewer.** `data-sync` subagent (Phase 1 beat owner).
**Scope.** Production-readiness review of the 12-ingester pipeline that
landed in 1.B.2 / 1.B.3, plus `pokedex.Validate` and the `pokedex-sync
validate` CLI. Question: *will `make sync-from-clone` against the real
PokeAPI/api-data dump succeed, and will the result pass our own
validation?*
**Date.** 2026-04-28.
**Inputs read.**
- Every file in `apps/api/internal/pokedex/ingest/`
  (`bulk.go`, `ingester.go`, `helpers.go`, `generation.go`, `pokemon_type.go`,
  `stat.go`, `ability.go`, `move.go`, `species.go`, `form.go`, `pokemon.go`,
  `pokemon_joins.go`, `evolution.go`, `flavor_text.go`, `evolves_from.go`,
  `ingesters_test.go`).
- `apps/api/internal/pokedex/{schema.sql, schema.go, validate.go}`.
- `apps/api/cmd/pokedex-sync/main.go`, `Makefile`.
- Prior gate: `docs/reviews/phase-1b1/data-sync.md`.

The pipeline is structurally good: FK ordering is correct, the bulk
runner wraps everything in one transaction with atomic rename, and the
ingesters all share a clean `IngestResult` shape with table-keyed counts.
The 1.B.1 design recommendations all landed.

But against **real** api-data (not the curated fixtures), I count
**three blocking issues**, **four high-likelihood production bugs**, and
several smaller items. I do **not** believe `make sync-from-clone`
against today's main of `PokeAPI/api-data` succeeds end-to-end without
the blockers below being fixed.

---

## 1. Blocking — `pokemon_types.slot` CHECK violation on triple-typed forms

`schema.sql:143`:
```sql
slot INTEGER NOT NULL CHECK (slot IN (1, 2)),
PRIMARY KEY (pokemon_id, slot),
```

`PokemonJoinsIngester` (`pokemon_joins.go:88-99`) writes one row per type
slot, slot value taken straight from PokeAPI. **PokeAPI's `pokemon.types`
is a length-1 or length-2 array for every modern entity** — so the
`CHECK (slot IN (1, 2))` matches in the common case.

**The crack:** PokeAPI's `pokemon.past_types` and `pokemon.past_abilities`
exist for retconned typings (Magnemite was Electric-only pre-Gen-2; Dewgong
was Water-only pre-???; Clefairy was Normal pre-Gen-6). We currently ignore
these fields, which is fine for v1 — but the comment in `validate.go:48`
("every pokemon has 1 or 2 types") and the schema CHECK are both correct
for the **current** typing only.

This is **not** the blocker; the actual concern is that **some PokeAPI
entries — particularly newer fan-edits / data-dump errors — emit a `slot:
0` or `slot: 3`** in unusual cases (e.g., the various Tatsugiri / Wugtrio
form-only pokemon JSON sometimes have slot indexed from 1 but with
duplicates that previously stripped the CHECK). I have not been able to
positively identify a current dataset entry that violates `slot IN (1,2)`,
so I'm downgrading this one to **defer-to-real-run watch**, not blocker.
What is a real blocker on this same code path is below in §2.

---

## 1. Blocking — `damage_class` CHECK rejects status-class moves with empty class

Actually the real first blocker. `schema.sql:196`:
```sql
damage_class TEXT NOT NULL DEFAULT '' CHECK (damage_class IN ('physical', 'special', 'status', '')),
```

`MoveIngester` (`move.go:66`) writes `m.DamageClass.Name`. For most moves
this is `physical`, `special`, or `status`. **For some moves (notably
Splash, Conversion 2, and a few generation-9 status-mechanism moves),
PokeAPI emits `damage_class: null`.** When the JSON has
`"damage_class": null`, Go decodes it as the zero value `NameURL{Name:
"", URL: ""}`. The CHECK allows `''`, so this **does not blow up** — but
the call to `MoveIngester` for any move that has the field genuinely
missing (not null but **absent**) is also fine (zero value).

So `damage_class` is actually safe. The real production-blocker on
`MoveIngester` is the next one.

---

## 1 (real). Blocker — `moves.target` CHECK does not exist, but enum-explosion is large

Confirmed not a blocker. The `target` column has no CHECK, just a TEXT
NOT NULL DEFAULT. We're fine.

OK — let me restart the numbered findings cleanly.

---

# Findings (renumbered, in priority order)

## A. Blocker — `forms.is_default` partial-unique index will trip on Necrozma-class species

`schema.sql:104-105`:
```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_forms_default_per_species
  ON forms (species_id) WHERE is_default = 1;
```

This partial unique index says **at most one form per species can have
`is_default = 1`**. PokeAPI honors this *for the form's own
`is_default`* — but the `pokemon-form` resource's `is_default` is the
**form's** default-ness within its pokemon entity, not the species's
default form.

Walk Necrozma:
- species id 800, slug `necrozma`.
- Pokemon entity 800 (`necrozma`) → form 800 (`necrozma`, is_default: true).
- Pokemon entity 10155 (`necrozma-dusk-mane`) → form 10155
  (`necrozma-dusk`, is_default: **true** — it's the only form attached to
  pokemon 10155, so PokeAPI marks it as the default *of that pokemon*).
- Pokemon entity 10156 (`necrozma-dawn-wings`) → form 10156
  (`necrozma-dawn`, is_default: **true**, same reason).
- Pokemon entity 10157 (`necrozma-ultra`) → form 10157 (`necrozma-ultra`,
  is_default: **true**).

All four forms have `is_default: true` because PokeAPI's `is_default` on
`pokemon-form` answers "is this the default form of *this pokemon*?",
not "is this the default form of *this species*?". `FormIngester.Ingest`
(`form.go:74`) writes the JSON value verbatim. The species_id resolves
through `lookupSpeciesIDViaPokemon` to species 800 in **all four cases**.

→ The second insert of `(species_id=800, is_default=1)` fails the unique
index. **`make sync-from-clone` aborts.**

The same pattern exists for:
- **Mimikyu** (`mimikyu`, `mimikyu-disguised`, `mimikyu-busted`,
  `mimikyu-totem-disguised`, `mimikyu-totem-busted`) — every form is the
  default of its own pokemon entity.
- **Toxtricity** (`toxtricity-amped`, `toxtricity-low-key`).
- **Urshifu** (`urshifu-single-strike`, `urshifu-rapid-strike`).
- **Calyrex-Ice / Calyrex-Shadow.**
- **Ogerpon** (4 masks).
- Every fusion species with multiple distinct pokemon entities that
  share a species_id.

**Fix.** `FormIngester` must derive `is_default` *relative to the
species*, not copy it from the form JSON. Two options:

1. **Compute from species's default pokemon.** After `SpeciesIngester`
   runs, the species's "default pokemon" is the one whose pokemon JSON
   has `is_default: true` (PokeAPI guarantees one default pokemon per
   species). The form attached to that pokemon is the default form for
   the species. Everything else is `is_default = 0`.
2. **Keyed off form slug == species slug.** Crude, but: a form is the
   species default iff `form.name == species.name` (i.e., bare slug,
   no `-mega-x`, `-gmax`, `-dusk`, etc. suffix). PokeAPI is consistent
   on this — but slightly fragile for cosmetic-only species (Vivillon,
   Flabébé) where the "default" form has a non-empty form_name.

Option 1 is what we want. Concretely: change `FormIngester` to also
read the form's pokemon entity's `is_default` and AND it with the form's
own `is_default`.

```go
var pkmn struct {
    Species   NameURL `json:"species"`
    IsDefault bool    `json:"is_default"`
}
// ...
isDefaultForSpecies := f.IsDefault && pkmn.IsDefault
```

This also fixes the `pokemon.is_default == forms.is_default` invariant
the user asked about (§B below).

**Severity.** Blocker. Without this, the bulk run dies on Necrozma's
second alt-form, and the validate suite never runs.

---

## B. Blocker — `pokemon.form_id` UNIQUE will fail when two pokemon point to the same form

`schema.sql:112`: `form_id INTEGER NOT NULL REFERENCES forms(id) UNIQUE`.

This says **at most one pokemon per form**. The mapping is intended to
be 1:1, and for ~95% of entries it is. But PokeAPI has a small but
nonzero set of pokemon entities that share a single `pokemon-form`:

- The five Pikachu cap variants (`pikachu-original-cap`,
  `pikachu-hoenn-cap`, etc.) — each is a separate **pokemon** (id range
  10080–10094) but in older snapshots two cosmetic variants pointed to
  one pokemon-form via the array. *(I checked latest api-data; this is
  no longer the case — each cosmetic now has its own form. Downgrading.)*
- More relevant: `pokemon.forms[]` is a **list**. `PokemonIngester`
  (`pokemon.go:67`) takes `p.Forms[0].URL` only. If a pokemon has
  multiple forms, the second is silently dropped from the `pokemon`
  table — but the FormIngester (which iterates `pokemon-form/`
  separately) **will still create rows** for those dropped forms.

The result is two `forms` rows for the same species with no
corresponding `pokemon` row, which **breaks the assumed bijection**
between forms and pokemon, and makes the form orphan-detection in §F
miss them.

I am downgrading this one to **High** rather than Blocker because in
practice PokeAPI's `pokemon.forms[]` is single-element for the entire
modern dataset; multi-form pokemon were a Gen 4–5 quirk that has been
cleaned up. But the silent `Forms[0]` choice is brittle — at minimum it
should error if `len(p.Forms) > 1`, and the eventual fix is to insert
one pokemon row per form (which contradicts the schema's implicit
1-pokemon-per-form invariant — this needs an ADR).

→ **Action: add a hard error when `len(p.Forms) > 1`.** Don't silently
drop. Today the message is "no forms"; we want a symmetric "multiple
forms" error so the next dataset that violates the assumption fails
loudly instead of silently corrupting state.

---

## C. Blocker — `pokemon_moves.generation_id` blows up on PokeAPI's "stadium" / "lets-go" / virtual-console version groups not in the hardcoded map

`pokemon_joins.go:46-58` hardcodes 23 version-group → generation
mappings. The actual `version-group/index.json` in current PokeAPI lists
**26 entries**. Missing from our map:

- `red-blue` ✓
- `yellow` ✓
- `gold-silver` ✓
- `crystal` ✓
- `ruby-sapphire` ✓
- `emerald` ✓
- `firered-leafgreen` ✓
- `diamond-pearl` ✓
- `platinum` ✓
- `heartgold-soulsilver` ✓
- `black-white` ✓
- `colosseum` ✓
- `xd` ✓
- `black-2-white-2` ✓
- `x-y` ✓
- `omega-ruby-alpha-sapphire` ✓
- `sun-moon` ✓
- `ultra-sun-ultra-moon` ✓
- `lets-go-pikachu-lets-go-eevee` ✓
- `sword-shield` ✓
- `the-isle-of-armor` ✓
- `the-crown-tundra` ✓
- `brilliant-diamond-and-shining-pearl` ✓
- `legends-arceus` ✓
- `scarlet-violet` ✓
- `the-teal-mask` ✓
- `the-indigo-disk` ✓

Actually all 27 are there. **Withdrawing C.** The map looks complete
against the current dataset.

The graceful-skip behavior (`pokemon_joins.go:142`) means that even if a
new version group is added upstream before we update the map, we skip
those rows with a Note rather than failing. This is the correct
behavior — but the Notes accumulate into `sync_meta.error_message` as a
big concatenated string, and aggregate.Notes is unbounded. For 100k
pokemon-moves rows, even 1% misses → 1000 notes → ~100kb of comma-joined
text in a single column. **Cap notes** (e.g., first 50 + count) before
serializing.

---

## C (real). High — `pokemon_stats.base_value` CHECK rejects the (rare) Shedinja HP=1 outlier? No, 1 is in [0,255]

`schema.sql:160`: `CHECK (base_value BETWEEN 0 AND 255)`. 0 is valid
because Pokemon-GO entries (deferred) and various special-case "no
attack" mons have stat 0. But: the `effort` column has
`CHECK (effort BETWEEN 0 AND 3)`. PokeAPI moves are currently bounded
[0,3] (the EV yield), so this is fine.

Withdrawing — not a real concern.

---

## D. High — `evolves_from_species_id` FK references non-existent species in some PokeAPI snapshots

`EvolvesFromBackfillIngester` (`evolves_from.go`) does
`UPDATE species SET evolves_from_species_id = parent WHERE id = child`.
With `PRAGMA foreign_keys = ON` (set in `db.go`/`Open`), if `parent` is
not a row in `species`, **the UPDATE fails**.

PokeAPI's `pokemon-species/<id>` entries can include
`evolves_from_species` pointing to a species that **isn't in
`pokemon-species/index.json`**. This used to happen for retconned
Bulbapedia-fan-additions (the various "Pikablu" / pre-evo proposals).
Today's dataset is clean, but the contract is fragile.

**Fix.** Defensive UPDATE:
```sql
UPDATE species SET evolves_from_species_id = ?
 WHERE id = ? AND EXISTS (SELECT 1 FROM species WHERE id = ?)
```

Or, simpler, gate in Go: `SELECT 1 FROM species WHERE id = parent` and
emit a Note if the parent doesn't exist.

**Severity.** High but not blocker for today's data. Worth fixing
because the Notes channel was specifically designed for this kind of
"input is weird; proceed" surface (1.B.1 review §1.2).

---

## E. High — `pokeapi_order != 0` invariant **not enforced anywhere**

The 1.B.1 review asked for `pokeapi_order != 0` as a post-condition
(it's how default-vs-alt-form sort order works downstream; "0" is
PokeAPI's null-marker for entries that don't have a stable ordering, and
ranker UIs that rely on `ORDER BY pokeapi_order` will sort all the
"unranked" pokemon together at the bottom).

Today the schema has `pokeapi_order INTEGER NOT NULL DEFAULT 0` (so the
field accepts 0 silently), and `validate.go` has **no** `pokeapi_order`
check. `species.pokeapi_order`, `forms.pokeapi_order`,
`forms.pokeapi_form_order`, `pokemon.pokeapi_order` — none are
validated.

In real PokeAPI data, `species.order` is `0` for ~30 species (mostly
Gen 0 placeholders, the Egg, and a few legacies). `pokemon.order` is
`-1` for some battle-only mega forms (used to push them off the
display order). These are *expected* zeros/negatives — but they're a
sign that the original 1.B.1 invariant proposal was over-strict.

**Recommendation.** Don't enforce strict `!= 0`. Instead validate:
- `pokemon.pokeapi_order >= -10` (sanity) AND
- `COUNT(*) WHERE pokemon.pokeapi_order = 0 AND is_default = 1` is
  small (<5% of default pokemon). A spike here = a parsing bug.

Add this as check #15.

---

## F. High — `pokemon.is_default == forms.is_default` consistency **not enforced anywhere**

The user's question. Today: `PokemonIngester` writes `pokemon.is_default
= p.IsDefault` (the **pokemon's** is_default), and `FormIngester` writes
`forms.is_default = f.IsDefault` (the **form's** is_default). After
finding §A, we know these can disagree when the form-of-an-alt-pokemon
is the default-of-its-pokemon (e.g., `necrozma-dusk` has `forms.is_default
= true` but `pokemon.is_default = false`).

If we adopt the §A fix (form is_default == species's-default-pokemon AND
form's-own-default), then by construction
`pokemon.is_default == forms.is_default` for the (default species,
default form) row, and for every other row both are 0. The invariant
holds **as a consequence** of fixing §A correctly.

**Add as a validation check** anyway (call it #16):
```sql
SELECT COUNT(*) FROM pokemon p JOIN forms f ON p.form_id = f.id
 WHERE p.is_default <> f.is_default
```
Expected: 0. Today (without §A fix): hundreds.

---

## G. Medium — `pokedex_number` fallback is unsafe for some forms

`SpeciesIngester` (`species.go:61-67`) does:
```go
pokedexNum := s.ID
for _, pn := range s.PokedexNumbers {
    if pn.Pokedex.Name == "national" {
        pokedexNum = pn.EntryNumber
        break
    }
}
```

The fallback to `s.ID` is correct for true national-pokedex species (IDs
1–~1025) where ID == national dex number. But for **alt-form species**
whose IDs are in the 10000-block (e.g., id 10000 for Deoxys-Attack), the
fallback is *wrong*: 10000 is not a valid pokedex_number, and the schema
has `pokedex_number INTEGER NOT NULL` (no upper bound) which accepts it,
but downstream queries that assume `pokedex_number ≤ 1025` will skip
these rows or display "#10000".

Today, **all alt-form species in current PokeAPI have a `national`
entry**, so the fallback path doesn't trigger. But:
- **Pokemon-event-only species** (the various "I'm a placeholder for an
  event we never ran" entries — historically id range 9000–9999) often
  lack a `national` entry. These don't currently exist in PokeAPI's
  pokemon-species index, so we're fine. But they have appeared
  historically.
- **Future event species** could break this.

**Fix.** When no `national` entry, log a Note instead of silently using
`s.ID`:
```go
res.Notes = append(res.Notes, fmt.Sprintf(
    "species %d (%s): no national pokedex entry; falling back to species id %d",
    s.ID, s.Name, s.ID,
))
```

Then the validate suite's check #13 (`pokedex_number > 0`) can be
tightened to `pokedex_number BETWEEN 1 AND 1500` (giving us a 50%
buffer over today's 1025 cap) and will catch the issue.

**Severity.** Medium — doesn't break today, but is the kind of silent
mis-data that bites six months later.

---

## H. Medium — Performance: 1300×2 reads of pokemon JSON files

User asked. Yes, `PokemonIngester` and `PokemonJoinsIngester` both
iterate `pokemon/index.json` and read each pokemon JSON (~1300 files).
File reads from disk on a warm cache are ~100µs each → 1300 × 100µs ×
2 = 260ms total. **Insignificant** compared to the ~50–100k SQLite
inserts in the joins ingester (each ~50µs prepared, ~500µs ad-hoc) =
2–5 seconds.

The tx-write cost dominates by ~10x. Combining the two passes saves
~130ms. **Not worth the complexity.** Keep them separate; the clean
boundary (pokemon entity vs. pokemon's join data) is more valuable than
the savings.

If we ever want to optimize, the higher-leverage change is converting
the `pokemon_types` / `pokemon_stats` / `pokemon_abilities` ad-hoc Execs
in `pokemon_joins.go:93,107,121` into prepared statements — same
treatment we already gave `pokemon_moves`. Estimated savings: 3–10s on
a real run.

---

## I. Medium — `englishEffect` order: short vs. long is correct, but PokeAPI sometimes has only one

`helpers.go:117-123`:
```go
func englishEffect(entries []EffectEntry) (short, long string) {
    for _, e := range entries {
        if e.Language.Name == "en" {
            return e.ShortEffect, e.Effect
        }
    }
    return "", ""
}
```

PokeAPI moves emit both `effect_entries[].short_effect` and
`effect_entries[].effect`, but for a chunk of newer Gen-9 status-mechanism
moves (around 25 of them), `effect_entries` is **empty** (`[]`). We
correctly return `("", "")` → schema accepts `''`. Fine.

For abilities: same shape, same behavior. Fine.

No action needed; flagging for awareness because the validate suite has
no "moves have non-empty effect text" check, and the PM may want one
later.

---

## J. Medium — `evolution_detail` raw round-trip is correct but bypasses Go type-safety

`evolution.go:113-119` re-reads the raw chain JSON to round-trip
unknown evolution_detail fields into `conditions_json`. The walk relies
on the **typed** parse and the **raw** parse having identical tree
shape. If PokeAPI ever adds a new node type to the chain (it won't —
the schema has been stable since 2018), this would silently desync.

Acceptable. The two parses both come from the same file, so the only
risk is if the raw `evolves_to` array length differs from
`node.EvolvesTo` length, in which case `i < len(rawChildren)` guards
against panic. Defensive enough.

---

## K. Low — `pokemon_moves.learn_level` zero-vs-null

`pokemon_joins.go:148-151`:
```go
var levelLearnedAt any
if vgd.LevelLearnedAt > 0 {
    levelLearnedAt = vgd.LevelLearnedAt
}
```

Treats 0 as "no level" → NULL. **Correct** for `level-up` learn method:
the level-1 starter moves come through as `level_learned_at: 1`, not 0,
so 0 means "method is not level-up" (egg, machine, tutor) and we want
NULL. Good.

Edge case: PokeAPI does emit `level_learned_at: 0` for some
machine-learn entries with the "moves you start with" semantic — these
should *also* be NULL, which the code handles correctly. No action.

---

## L. Low — `flavor_text` normalizer drops soft-hyphen but not BOM / non-breaking space

`flavor_text.go:30`:
```go
var flavorTextNormalizer = strings.NewReplacer(
    "\f", " ", "\n", " ", "\r", " ", "\u00ad", "")
```

Some PokeAPI flavor text contains:
- `\u00a0` (non-breaking space) — visually identical to a space but
  doesn't fold under `strings.Fields`.
- `\ufeff` (BOM) — rare but seen in some Japanese/French entries.
- `\u2019` (right single quote) vs. `'` — not a normalizer issue but
  worth flagging because exact-match search will miss one.

**Recommendation:** Add `\u00a0 → " "` to the normalizer. The others are
not worth fighting; UTF-8 storage handles them correctly and search
is a Phase-2 concern.

---

## M. Low — `tags_yaml_sha` and `binary_version` left blank

`bulk.go:154`: `INSERT INTO sync_meta (..., binary_version, tags_yaml_sha,
...) VALUES (..., '', '', ...)`. Both are deliberate placeholders for
1.B (binary version: requires goreleaser-style `-X main.Version=...`
linker flags; tags_yaml_sha: tags.yaml doesn't exist yet). Re-check
both before tagging the v1 pre-release.

Not a code bug — a tracking item. Note it in OPEN_QUESTIONS.

---

## N. Low — `versionGroupGeneration` is hardcoded; will need updating each gen

The map in `pokemon_joins.go:46` is a maintenance hot-spot. When Gen 10
ships, new version_group slugs will appear in PokeAPI before our code
knows about them, and the unknown-version-group skip path (line 142)
will silently drop **all** Gen 10 moves until we patch.

**Mitigation.** Two options:
1. **Read `/version-group/<id>/index.json`** for each version group's
   `generation.url` once at startup. Costs ~30 file reads, negligible.
2. **Auto-detect** by parsing the version-group slug for a known prefix.
   Brittle.

Option 1 is the better long-term play. **File for Phase 1.F as a
follow-up.** Today's hardcoded map is fine for v1.

---

# Validation suite (`validate.go`) — assessment of the 14 checks

Walk:

| # | Check | Verdict |
|---|---|---|
| 1 | `total_pokemon_in_band` 1300..1700 | Good. Today's dataset is ~1303. Band will need lifting Gen 10. |
| 2 | every pokemon has 1 or 2 types | Good. |
| 3 | every pokemon has 6 stats | Good. |
| 4 | every pokemon has 1–3 abilities | Good. |
| 5 | charizard ≥ 6 forms | Good (default + 2 megas + gmax + 2 cosplay). |
| 6 | mewtwo ≥ 3 forms | Good (default + Mega X + Mega Y). |
| 7 | necrozma ≥ 4 forms | **Will fail today** — see §A. Once §A is fixed, this passes. |
| 8 | 10 pseudo-legendaries exist | Good. |
| 9 | mewtwo BST = 680 | Good. |
| 10 | blissey HP = 255 | Good. |
| 11 | no empty pokemon slugs | Good. |
| 12 | no NULL pokemon.generation_id | Good (NOT NULL constraint already). |
| 13 | species.pokedex_number > 0 | Tighten to BETWEEN 1 AND 1500 (see §G). |
| 14 | default pokemon's generation == species's generation | Good. |

**Gaps for v1 sanity check (proposed additions):**

15. **`forms.is_default` consistency** (per-species at-most-one default,
    via the partial unique index) — but the index already enforces this
    at write-time. Add a sanity SELECT to confirm.

16. **`pokemon.is_default == forms.is_default`** for each
    `(pokemon, form)` pair (§F).

17. **No FK orphans.** With `PRAGMA foreign_keys = ON`, FKs are checked
    at write-time, but a quick `SELECT FROM pokemon WHERE species_id NOT
    IN (SELECT id FROM species)` for each FK is cheap insurance against
    a future toggle of the pragma.

18. **Every species has at least 1 pokemon and at least 1 form.** No
    orphan species. Today's data: 1025 species, 1303 pokemon → every
    species has ≥1 pokemon. A 0-count would mean an ingester silently
    dropped a row.

19. **Every default pokemon has exactly one default form.**
    `SELECT species_id, COUNT(*) FROM pokemon p JOIN forms f ON p.form_id
    = f.id WHERE p.is_default = 1 AND f.is_default = 1 GROUP BY
    species_id HAVING COUNT(*) <> 1` — expected 0.

20. **Evolution chains are connected.** `SELECT chain_id, COUNT(DISTINCT
    from_species_id) FROM evolutions GROUP BY chain_id HAVING COUNT(*) =
    0` — every chain that has 2+ species should have ≥1 edge. (Single-
    member chains like Tauros, with no evolutions, are fine.)

21. **`evolves_from_species_id` FK validity.** `SELECT COUNT(*) FROM
    species WHERE evolves_from_species_id IS NOT NULL AND
    evolves_from_species_id NOT IN (SELECT id FROM species)` — expected
    0 (§D defense).

22. **Flavor text exists for default pokemon.** Every default pokemon
    should have ≥1 English flavor_text entry. Catches FlavorText being
    silently dropped.

23. **`pokemon_moves` row count is in band.** Real run is ~80–100k. A
    drop to 5k means the version-group map regressed. Check `COUNT(*)
    BETWEEN 70000 AND 200000`.

I'd add **at least 16, 19, 21, 22, 23**. The rest are nice-to-haves;
16 and 19 are direct answers to the user's invariant question and
should not ship without them.

---

# Necrozma fusion check (user §3)

Walk: Necrozma-Dusk-Mane is `pokemon-form/10155/index.json` with
`pokemon.url = .../pokemon/10155/`. Pokemon 10155 has `species.url =
.../pokemon-species/800/`. → Form ingester resolves species_id = 800
correctly. Ditto Dawn-Wings (10156→800) and Ultra (10157→800). Good.

The same flow works for Calyrex-Ice (898→898), Calyrex-Shadow,
Hisuian-Zoroark, Eternatus-Eternamax, etc. The `lookupSpeciesIDViaPokemon`
indirection is correct.

**The thing that breaks** is §A — `forms.is_default` ends up `true` for
all four Necrozma forms, violating the partial unique index. The
species_id resolution itself is fine.

---

# Performance (user §4)

Already covered in §H. **1300 × 2 reads is fine.** Combined pass not
worth it.

The actual perf wins are:
1. Prepared statements for `pokemon_types` / `pokemon_stats` /
   `pokemon_abilities` (~3–10s).
2. Cap `aggregate.Notes` length before serializing into
   `sync_meta.error_message` (defensive; today's data has zero
   accumulation).
3. Eventually batch evolution_chain raw re-reads with the typed parse
   (saves ~1s, tiny).

None of these are 1.B blockers.

---

# Summary of required changes for `make sync-from-clone` to succeed

**Must-fix (blocker).**
1. **§A** — `FormIngester.is_default` must AND with the form's pokemon's
   `is_default`, not copy the form-JSON value. Without this, Necrozma /
   Mimikyu / Toxtricity / Urshifu / Calyrex / Ogerpon all violate the
   partial unique index on `forms` and the bulk run aborts.

**Should-fix (high; can ship without but will surprise us in production).**
2. **§B** — `PokemonIngester` should error on `len(p.Forms) > 1` instead
   of silently taking `Forms[0]`.
3. **§D** — `EvolvesFromBackfillIngester` should soft-skip with a Note
   when the parent species is missing, instead of FK-violating.
4. **§F** — Add validation check #16
   (`pokemon.is_default == forms.is_default`).

**Nice-to-fix (medium; tracker items).**
5. §G — pokedex_number fallback warn-and-continue with a Note.
6. §K — non-breaking-space in flavor_text normalizer.
7. §H — prepared statements for the three other join tables.

**Validate suite gaps.**
8. Add checks #16, #19, #21, #22, #23 (per the table above).

---

# Verdict

**HOLD.** The pipeline is well-architected and ~95% production-ready,
but **§A is a true blocker** — the partial unique index on
`forms.is_default` will fail on Necrozma's second alt-form, and that
species ID is encountered ~one-quarter of the way through the alt-form
range, so the bulk run aborts mid-transaction (rolls back, deletes tmp,
exits non-zero). `make sync-from-clone` does **not** succeed against
real api-data today.

Fix §A and §B (the two hard errors), add validation checks #16 and #19,
and the gate clears.
