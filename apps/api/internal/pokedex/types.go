package pokedex

// Pokemon is the atomic competitor unit — a (species, form) tuple.
// Charmander, Charmeleon, Charizard, Mega Charizard X, Mega Charizard Y,
// and Gigantamax Charizard are six distinct Pokemon values. See D-1.
type Pokemon struct {
	ID                 int64
	SpeciesID          int64
	FormID             int64
	Slug               string
	DisplayName        string
	GenerationID       int64
	IsDefault          bool
	PokeAPIOrder       int64
	Types              []string
	Stats              Stats
	HeightDecimeters   int64
	WeightHectograms   int64
	BaseExperience     int64
	SpriteURL          string
	ShinySpriteURL     string
	OfficialArtworkURL string
	CryURL             string
	PokemonDBURL       string
	ContentHash        string
	Tags               []string
}

// Stats holds the six base stats for a Pokemon. Values are guaranteed
// to be in 0..255 by the schema CHECK constraint on pokemon_stats.base_value.
type Stats struct {
	HP             int
	Attack         int
	Defense        int
	SpecialAttack  int
	SpecialDefense int
	Speed          int
}

// BST returns the base stat total — the sum of the six base stats.
func (s Stats) BST() int {
	return s.HP + s.Attack + s.Defense + s.SpecialAttack + s.SpecialDefense + s.Speed
}
