// Pokemon-type styling table. Hex colors are the standard fan-community
// palette used by Bulbapedia and PokemonDB. The text-color column is
// pre-computed for readability against the background.

export interface TypeStyle {
  bg: string;
  text: string;
  label: string;
}

export const TYPE_STYLES: Record<string, TypeStyle> = {
  normal:   { bg: "#9FA19F", text: "#000", label: "Normal" },
  fire:     { bg: "#E62829", text: "#fff", label: "Fire" },
  water:    { bg: "#2980EF", text: "#fff", label: "Water" },
  electric: { bg: "#FAC000", text: "#000", label: "Electric" },
  grass:    { bg: "#3FA129", text: "#fff", label: "Grass" },
  ice:      { bg: "#3DCEF3", text: "#000", label: "Ice" },
  fighting: { bg: "#FF8000", text: "#fff", label: "Fighting" },
  poison:   { bg: "#9141CB", text: "#fff", label: "Poison" },
  ground:   { bg: "#915121", text: "#fff", label: "Ground" },
  flying:   { bg: "#81B9EF", text: "#000", label: "Flying" },
  psychic:  { bg: "#EF4179", text: "#fff", label: "Psychic" },
  bug:      { bg: "#91A119", text: "#fff", label: "Bug" },
  rock:     { bg: "#AFA981", text: "#000", label: "Rock" },
  ghost:    { bg: "#704170", text: "#fff", label: "Ghost" },
  dragon:   { bg: "#5060E1", text: "#fff", label: "Dragon" },
  dark:     { bg: "#624D4E", text: "#fff", label: "Dark" },
  steel:    { bg: "#60A1B8", text: "#fff", label: "Steel" },
  fairy:    { bg: "#EF70EF", text: "#000", label: "Fairy" },
  stellar:  { bg: "#40B5A5", text: "#fff", label: "Stellar" },
  unknown:  { bg: "#68A090", text: "#fff", label: "???" },
};

export function typeStyle(slug: string): TypeStyle {
  return TYPE_STYLES[slug] ?? { bg: "#888", text: "#fff", label: slug };
}
