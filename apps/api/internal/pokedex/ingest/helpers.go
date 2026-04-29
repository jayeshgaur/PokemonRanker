package ingest

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// Helpers for the ingest package: read JSON files from a PokeAPI/api-data
// checkout, resolve URL → file path mappings, and small string utilities.

// PokeAPI references appear in two URL shapes depending on where the JSON
// is sourced from:
//   - Public PokeAPI website / `ditto transform` output: absolute,
//     e.g. "https://pokeapi.co/api/v2/generation/1/"
//   - The `PokeAPI/api-data` GitHub repo's checked-in JSON: relative,
//     e.g. "/api/v2/generation/1/"
//
// Both must resolve to the same local file under <api-data>/data/api/v2/...
// (Phase 1.B regression — fixture-based tests used the absolute form, but
// `make sync-from-clone` against the real repo hit the relative form and
// crashed. Now both prefixes are accepted.)
var pokeAPIURLPrefixes = []string{
	"https://pokeapi.co/api/v2/",
	"/api/v2/",
}

// NameURL is the {name, url} reference shape that appears throughout PokeAPI.
type NameURL struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

// LocalizedName is the {language, name} entry in PokeAPI's `names` arrays.
type LocalizedName struct {
	Language NameURL `json:"language"`
	Name     string  `json:"name"`
}

// EffectEntry is the {effect, short_effect, language} entry in PokeAPI's
// `effect_entries` arrays.
type EffectEntry struct {
	Effect      string  `json:"effect"`
	ShortEffect string  `json:"short_effect"`
	Language    NameURL `json:"language"`
}

// ResourceList is the shape of `…/<resource>/index.json` in api-data.
type ResourceList struct {
	Count    int       `json:"count"`
	Next     *string   `json:"next"`
	Previous *string   `json:"previous"`
	Results  []NameURL `json:"results"`
}

// listResources reads the index.json for a resource (e.g., "generation",
// "type") and returns the list of (name, url) references.
func listResources(apiDataPath, resource string) ([]NameURL, error) {
	path := filepath.Join(apiDataPath, "data", "api", "v2", resource, "index.json")
	data, err := os.ReadFile(path) //nolint:gosec // path is constructed from a trusted constant + resource name
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}
	var idx ResourceList
	if err := json.Unmarshal(data, &idx); err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}
	return idx.Results, nil
}

// readJSONFromURL resolves a PokeAPI absolute URL to a local api-data file
// path and parses the JSON into dst.
func readJSONFromURL(apiDataPath, url string, dst any) error {
	path, err := apiDataFilePath(apiDataPath, url)
	if err != nil {
		return err
	}
	data, err := os.ReadFile(path) //nolint:gosec // path derived from validated PokeAPI URL prefix
	if err != nil {
		return fmt.Errorf("read %s: %w", path, err)
	}
	if err := json.Unmarshal(data, dst); err != nil {
		return fmt.Errorf("parse %s: %w", path, err)
	}
	return nil
}

// apiDataFilePath maps a PokeAPI URL (absolute or relative — see
// pokeAPIURLPrefixes) to the corresponding file in a local api-data checkout.
func apiDataFilePath(apiDataPath, url string) (string, error) {
	for _, p := range pokeAPIURLPrefixes {
		if strings.HasPrefix(url, p) {
			rest := strings.TrimSuffix(strings.TrimPrefix(url, p), "/")
			return filepath.Join(apiDataPath, "data", "api", "v2", filepath.FromSlash(rest), "index.json"), nil
		}
	}
	return "", fmt.Errorf("unexpected URL prefix: %s", url)
}

// idFromURL extracts the trailing numeric id from a PokeAPI absolute URL.
// Some PokeAPI URLs have non-numeric trailing segments (e.g., version-group
// "red-blue") — callers must accept the returned error in those cases.
func idFromURL(url string) (int64, error) {
	parts := strings.Split(strings.TrimSuffix(url, "/"), "/")
	if len(parts) == 0 {
		return 0, fmt.Errorf("empty url path")
	}
	last := parts[len(parts)-1]
	id, err := strconv.ParseInt(last, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("non-numeric id in %q: %w", url, err)
	}
	return id, nil
}

// englishName picks the entry from `names` with language.name == "en", or
// returns the fallback when no English entry is present.
func englishName(names []LocalizedName, fallback string) string {
	for _, n := range names {
		if n.Language.Name == "en" {
			return n.Name
		}
	}
	return fallback
}

// englishEffect picks the {short, long} effect entries from `effect_entries`
// with language.name == "en", or returns ("", "") if no English entry exists.
func englishEffect(entries []EffectEntry) (short, long string) {
	for _, e := range entries {
		if e.Language.Name == "en" {
			return e.ShortEffect, e.Effect
		}
	}
	return "", ""
}

// titleFromSlug converts a PokeAPI slug ("generation-i", "ultra-beast") to a
// space-separated Title-Case display name as a fallback when no English
// localized name is available.
func titleFromSlug(s string) string {
	parts := strings.Split(s, "-")
	for i, p := range parts {
		if p == "" {
			continue
		}
		parts[i] = strings.ToUpper(p[:1]) + p[1:]
	}
	return strings.Join(parts, " ")
}

// boolToInt converts a Go bool to SQLite's 0/1 INTEGER convention.
func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// nilIfEmpty returns nil for an empty string (so the SQL driver writes NULL),
// or the string itself otherwise.
func nilIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// nameOrNil returns the .Name of an optional NameURL, or untyped nil so the
// SQL driver writes NULL. Used for nullable foreign keys to enum-like tables.
func nameOrNil(n *NameURL) any {
	if n == nil {
		return nil
	}
	return n.Name
}

// idFromOptionalURL returns the trailing numeric id of an optional URL, or
// untyped nil if the URL is missing. Used for nullable foreign keys.
func idFromOptionalURL(n *NameURL) (any, error) {
	if n == nil || n.URL == "" {
		return nil, nil
	}
	id, err := idFromURL(n.URL)
	if err != nil {
		return nil, err
	}
	return id, nil
}
