package pokedex_test

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/jayesh/pokemon-ranker/api/internal/pokedex"
)

func TestStats_BST(t *testing.T) {
	tests := []struct {
		name string
		s    pokedex.Stats
		want int
	}{
		{
			name: "all zeros",
			s:    pokedex.Stats{},
			want: 0,
		},
		{
			name: "balanced 100s",
			s: pokedex.Stats{
				HP:             100,
				Attack:         100,
				Defense:        100,
				SpecialAttack:  100,
				SpecialDefense: 100,
				Speed:          100,
			},
			want: 600,
		},
		{
			name: "Garchomp",
			s: pokedex.Stats{
				HP:             108,
				Attack:         130,
				Defense:        95,
				SpecialAttack:  80,
				SpecialDefense: 85,
				Speed:          102,
			},
			want: 600,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, tt.s.BST())
		})
	}
}
