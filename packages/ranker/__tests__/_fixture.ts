// Shared test fixture builder. Pokemon is treated as opaque by all rankers
// so we only fill the engine-relevant fields and zero everything else.

import type { Pokemon } from "@pokemon-ranker/shared";

export function pkmn(id: number): Pokemon {
  return {
    id,
    speciesId: id,
    formId: id,
    slug: `p-${id}`,
    displayName: `P${id}`,
    generationId: 1,
    isDefault: true,
    types: ["normal"],
    stats: {
      hp: 50,
      attack: 50,
      defense: 50,
      specialAttack: 50,
      specialDefense: 50,
      speed: 50,
    },
    spriteUrl: "",
    shinySpriteUrl: "",
    officialArtworkUrl: "",
    cryUrl: "",
    pokedexDbUrl: "",
    tags: [],
    isMega: false,
    isGmax: false,
    isBattleOnly: false,
    isRegionalVariant: false,
    isLegendary: false,
    isMythical: false,
    isBaby: false,
    evolutionStage: "final",
  };
}

export function pool(ids: number[]): Pokemon[] {
  return ids.map(pkmn);
}
