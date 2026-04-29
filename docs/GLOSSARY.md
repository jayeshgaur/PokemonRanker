# Glossary

> Domain terms used in code, schemas, UI copy, and agent tools. When ambiguous, the definition here wins.

## Core entities

**Species.** A Pokédex-numbered creature concept (e.g., "Charizard" the species). Identified by `species_id`. Has zero or more forms.

**Form.** A specific incarnation of a species (normal, Mega Charizard X, Mega Charizard Y, Gigantamax Charizard, Alolan Vulpix, Galarian Zigzagoon). Identified by `form_id`. May have its own type, ability, sprite, and stat profile.

**Pokemon (the competitor unit).** A unique (species, form) tuple. Identified by `pokemon_id`. **This is the atomic competitor in a tournament.** Charmander, Charmeleon, Charizard, Mega Charizard X, Mega Charizard Y, Gmax Charizard are six distinct `Pokemon`. See [DECISIONS.md](DECISIONS.md#d-1).

**Generation.** A numbered release era (Gen 1 = Red/Blue, Gen 9 = Scarlet/Violet). A species has a "introduced-in" generation; a form may have a different one (Mega Charizard X was introduced in Gen 6 even though Charizard is Gen 1).

## Pokémon categorical tags

Stored in `tags.yaml` and joined via `pokemon_tags`. See [DECISIONS.md](DECISIONS.md#d-2).

**Legendary.** Officially-classified legendary species (e.g., Mewtwo, Lugia, Dialga). The Pokémon Company labels these directly.

**Mythical.** Event-distributed legendaries (Mew, Celebi, Jirachi, Arceus, Genesect, Volcanion, Marshadow, Zarude, etc.). Distinct from regular legendaries by distribution method.

**Sub-legendary.** Trio members and similar (Articuno, Zapdos, Moltres, Cobalion, Terrakion, Virizion, etc.). Sometimes called "minor legendaries."

**Pseudo-legendary.** Species with BST 600, three-stage evolution, late evolution at level 50+ (Dragonite, Tyranitar, Salamence, Metagross, Garchomp, Hydreigon, Goodra, Kommo-o, Dragapult, Baxcalibur). A community-defined category.

**Starter.** First-stage Pokémon offered by the regional professor (Bulbasaur, Charmander, Squirtle, Chikorita, ...). Three per generation, with their evolutions.

**Fossil.** Species revived from fossils in a given game (Omanyte, Kabuto, Aerodactyl, Lileep, Anorith, ...).

**Baby.** Pre-evolved forms introduced in Gen 2+ that hatch from eggs (Pichu, Cleffa, Igglybuff, Magby, Elekid, ...).

**Ultra Beast.** Gen 7 inter-dimensional creatures (Nihilego, Buzzwole, Pheromosa, Xurkitree, Celesteela, Kartana, Guzzlord, Necrozma, Stakataka, Blacephalon, Poipole, Naganadel).

**Paradox.** Gen 9 past/future variants (Great Tusk, Iron Treads, ...). All have the special "Protosynthesis" or "Quark Drive" ability mechanic.

**Regional variant.** Alolan, Galarian, Hisuian, Paldean form of a previously-existing species.

**Mega.** A temporary battle-only form requiring a Mega Stone. Tagged separately from the base form.

**Gmax (Gigantamax).** A Gen 8 dynamax variant with a unique appearance and signature G-Max move.

**Fusion.** A form created by combining two species (Black Kyurem, White Kyurem, Necrozma-Dusk-Mane, Necrozma-Dawn-Wings, Necrozma-Ultra, Calyrex-Ice, Calyrex-Shadow).

## Stats

**HP / Attack / Defense / Sp. Atk / Sp. Def / Speed.** The six base stats. Stored per (pokemon_id, stat).

**BST (Base Stat Total).** Sum of the six base stats. Useful filter; not always proportional to competitive viability.

## Tournament terms

**Tournament.** One user's session of comparing a filtered list down to a ranking. Identified by a tournament ID. Has a filter spec, an algorithm, a ranker state, and (when complete) a ranking.

**Filter spec.** A serialized description of which Pokémon are eligible. Round-trips through URLs and through the agent's `propose_tournament` tool.

**Duel.** A single pair of Pokémon shown to the user for comparison. Has a `left`, `right`, and a `Decision` (LeftWins / RightWins / Draw / Skip).

**Ranker.** The algorithm running the tournament. Implements `NextDuel`, `Submit`, `Progress`, `Result`. See [DECISIONS.md](DECISIONS.md#d-3).

**Comparator.** The thing that decides a duel. Default is `UserComparator` (the human votes via the UI). Future variants include `LLMSeedingComparator` (used to seed the bracket order) and `LLMTiebreakerComparator` (used when the user picks Skip).

**Ranking.** The ordered output of a completed tournament. Stored as `(tournament_id, position, pokemon_id)` rows.

**Aggregate ranking.** A computed ranking derived from many users' rankings sharing the same filter spec. Phase 7+.

## Algorithm terms

**Single-elimination.** Tournament-bracket style. n-1 duels. Top 1 only is reliable; top N is not.

**Merge-sort comparator.** A comparison sort using user duels as the comparator. ~n log n duels. Produces a fully-ranked list.

**Glicko-random.** Anytime rating algorithm. User can stop after any duel; more duels sharpen the rating. Handles draws natively.

**Anytime algorithm.** An algorithm whose output quality improves monotonically with effort and which can be stopped at any time with a meaningful (though imperfect) result.

## Agent terms

**Tool.** A capability the agent can invoke. Has a name, schema, and implementation. Tools never bypass the API contract — they are wrappers around the same APIs the UI uses.

**Tool surface.** The set of tools available to a given agent. Determines what it can do.

**Eval.** A test for the agent. A prompt with an expected behavior (e.g., "agent calls `get_pokemon_details` before quoting a stat"). Eval pass rate is gated in CI.

**Prompt cache.** A 5-minute server-side cache of system prompts and tool definitions; reused across requests for cost savings.

## Other

**Vibes mode.** Duel screen mode that hides stats, showing only sprite + name. Avoids stat-based bias. See [DECISIONS.md](DECISIONS.md#d-8).

**Informed mode.** Duel screen mode that shows stats, types, and abilities. For competitive analysis. See [DECISIONS.md](DECISIONS.md#d-8).

**Session.** Cookie-keyed anonymous identity for visitors who haven't logged in. First-class entity in the schema. See [DECISIONS.md](DECISIONS.md#d-9).
