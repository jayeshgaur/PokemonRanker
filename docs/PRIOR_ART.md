# Prior Art — the favorite-Pokémon-ranking landscape

We are entering a mature category. There is no first-mover angle on the picker itself or on aggregation as a concept. Differentiation has to come from the combination of features we ship together. This file is the canonical reference; updated when the landscape shifts.

Last surveyed: 2026-04-28 by `product-manager` agent (full review at `docs/reviews/phase-1a/product-manager.md`).

## Pickers — single-user comparison-based ranking

- **Cave of Dragonflies — Favorite Pokémon Picker** (https://www.dragonflycave.com/favorite.html). Running since 2014. Multi-select rounds with rescue/undo, filters for shinies / final-evos / forms / categories / Gens I–IX / type / spoiler-content. Beloved across r/pokemon, Smogon, PokeCommunity, Tumblr. **The category leader.**
- **Commodity tier:** PokemonFusions, Randomizer.tech, PokePicker, AlienFusionGenerator, FavoritePokemonPicker.org, cajunavenger.github.io. Most cover all 1,025 Pokémon; type/Gen filters; share links; batch-size tuning (6/12/18/24 per round); auto-save.

## Tier-list / aggregation sites

- **TierMaker.** Dominant general-purpose tier-list maker. Pokémon templates have **10,678+ submitted lists** for "Every Pokémon 2026" alone, plus regional and themed templates. Live community voting, alignment charts, brackets, spin-wheel. **Already does aggregation per-template.**
- **RatePKMN** (ratepkmn.com). Community-driven Pokémon design rating across 9 axes ("a more objective lens than the views of a single person"). **Already does community-aggregation as differentiation.**

## Surveys & creator content

- **"Every Pokémon is Someone's Favorite" Reddit survey** (r/pokemon, Mamamia1001). **52,000+ respondents.** Charizard, Gengar, Arcanine top three. Pikachu *not* in the top 10. Coverage in GameSpot and Nintendo Life. Open Tableau/Bokeh visualizations on GitHub. **The single largest aggregate fan-vote dataset in existence.**
- **WolfeyVGC — "I Ranked Literally Every Pokemon."** 4-hour video, 1,133 Pokémon, three-axis scoring (competitive / design / iconic). Tens of millions of views. The audience is enormous, and it's accustomed to *creator voice*, not aggregation.

## Capabilities matrix

| Capability | Dragonfly Cave | TierMaker | RatePKMN | Wolfey | Pokemon Ranker (target) |
|---|---|---|---|---|---|
| Multi-Pokémon picker | ✅ | ✅ | — | — | ✅ |
| All forms (Megas, Gmax, regional) as distinct competitors | partial (toggle) | template-defined | — | partial | **✅ (D-1)** |
| Aggregate fan rankings | — | per-template | per-axis | one-time | **per (filter spec) (D-11)** |
| Filter granularity | type / Gen / category | template-defined | — | — | **type / Gen / BST / form / tag combos (Phase 2)** |
| Permalinks / share | export-import only | yes | yes | — | **URL is source of truth (D-5)** |
| Pokémon-grounded LLM agent | — | — | — | — | **✅ (Phase 4.5, D-20)** |
| Mobile | yes | yes | yes | n/a | yes |
| Multiple ranker algorithms | one (multi-select) | drag-drop | rating axes | declarative | **MergeSort + SingleElim + Glicko + LLM-augmented Comparator (D-3)** |

## Why us, why now (the wedge)

We are not innovating on "single-player picker" — that's commodity. We differentiate on the combination of:

1. **Pokémon-grounded LLM agent** that doesn't hallucinate (D-20 / Phase 4.5).
2. **Per-filter-combination aggregation.** Not per-template (TierMaker) or per-axis (RatePKMN). Combinatorially more granular.
3. **Form-specific competitors** including pre-evolutions (D-1). Most pickers bundle.
4. **URL is source of truth** (D-5). Better than Dragonfly Cave's JSON-blob export; richer than TierMaker because filter granularity is encoded.
5. **Multiple ranking algorithms** behind one picker UI (D-3). MergeSort comparator (true ranking), single-elim (quick top-1), Glicko anytime, LLM-augmented seeding/tiebreaker.

None of these alone is a moat. Together, with execution, they form a defensible position.

## What we should NOT do

- **Compete head-on with Dragonfly Cave on UX polish for the picker itself.** A UX-craft race we'd lose to a decade-old incumbent.
- **Compete with TierMaker on template breadth.** Ten-year head start on organic SEO.
- **Position as "the AI Pokémon site."** That's a feature, not an identity. The agent is *one of several* differentiators, not the headline.

## Implications for our plan

- **D-19** (Favorite Picker product framing) reflects fan vocabulary, not engineering.
- **D-20** (Phase 4.5 agent) sequences the agent before aggregation so the differentiator ships early.
- **D-21** (R2 mirror by Phase 4) ensures sprite/cry experience is competitive on day-one launch.
- **Phase 1.D** expands `tags.yaml` with thematic-design tags so D-8 Vibes-mode filters are real.
