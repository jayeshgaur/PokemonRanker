package ingest

import (
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestAPIDataFilePath_BothURLForms pins the contract that the helper accepts
// both URL shapes the ingester encounters in the wild:
//
//   - Absolute (public PokeAPI website / `ditto transform` output):
//     "https://pokeapi.co/api/v2/<resource>/<id>/"
//   - Relative (PokeAPI/api-data GitHub repo's checked-in JSON):
//     "/api/v2/<resource>/<id>/"
//
// Phase 1.B regression: the original implementation only accepted the
// absolute form. Synthetic test fixtures used absolute URLs (matching the
// public website), so tests were green; `make sync-from-clone` against the
// real repo encountered relative URLs and crashed on the first generation.
func TestAPIDataFilePath_BothURLForms(t *testing.T) {
	root := t.TempDir()

	cases := []struct {
		name string
		url  string
		want string
	}{
		{
			name: "absolute_with_trailing_slash",
			url:  "https://pokeapi.co/api/v2/generation/1/",
			want: filepath.Join(root, "data", "api", "v2", "generation", "1", "index.json"),
		},
		{
			name: "relative_with_trailing_slash",
			url:  "/api/v2/generation/1/",
			want: filepath.Join(root, "data", "api", "v2", "generation", "1", "index.json"),
		},
		{
			name: "relative_pokemon_species",
			url:  "/api/v2/pokemon-species/6/",
			want: filepath.Join(root, "data", "api", "v2", "pokemon-species", "6", "index.json"),
		},
		{
			name: "absolute_no_trailing_slash",
			url:  "https://pokeapi.co/api/v2/type/3",
			want: filepath.Join(root, "data", "api", "v2", "type", "3", "index.json"),
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := apiDataFilePath(root, tc.url)
			require.NoError(t, err)
			assert.Equal(t, tc.want, got)
		})
	}
}

func TestAPIDataFilePath_RejectsUnknownPrefix(t *testing.T) {
	_, err := apiDataFilePath(t.TempDir(), "ftp://pokeapi.co/api/v2/generation/1/")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unexpected URL prefix")
}
