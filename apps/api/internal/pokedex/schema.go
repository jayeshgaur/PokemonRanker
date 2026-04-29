package pokedex

import _ "embed"

//go:embed schema.sql
var schemaSQL string

// SchemaVersion is the current Pokédex schema version. Bump on any schema change.
//
// History:
//   - v1 (Phase 1.A): initial 19-table schema.
//   - v2 (Phase 1.B.1): adds PokeAPI fields the data-sync agent surfaced
//     (is_default, pokeapi_order family, evolves_from_species_id, forms_switchable,
//     evolutions.gender / time_of_day, abilities.is_main_series, moves.target),
//     trimmed by the PM planning gate. Deferred items (gender_rate family,
//     introduced_in_version_group, effect_chance, abilities.generation_id,
//     localized_names table) are tracked in OPEN_QUESTIONS.md.
//   - v3 (Phase 2/3/4 MVP slice, 2026-04-29): drops the false invariant
//     UNIQUE(species_id, form_name) on `forms`. PokeAPI legitimately ships
//     multiple forms with the same form_name under one species (e.g.,
//     Urshifu single-strike-gmax + rapid-strike-gmax both have
//     species_id=892 and form_name="gmax"). The form `slug` is the real
//     unique key.
const SchemaVersion = 3
