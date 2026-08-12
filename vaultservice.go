package main

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// VaultService scans Obsidian Markdown files for COS image URLs.
type VaultService struct{}

func NewVaultService() *VaultService {
	return &VaultService{}
}

var skipDirNames = map[string]struct{}{
	".obsidian":    {},
	".trash":       {},
	".git":         {},
	"node_modules": {},
}

// ScanReferences walks configured vault paths and maps image URL → note paths.
func (s *VaultService) ScanReferences() ([]ImageRef, error) {
	cfg := loadRuntimeConfig()
	refs, err := scanVaultReferences(cfg.VaultPaths, cfg.COSBaseURL)
	if err != nil {
		return nil, err
	}
	return refsToSlice(refs), nil
}

// FindNotesUsing returns Markdown files that reference the given image URL or key.
func (s *VaultService) FindNotesUsing(urlOrKey string) ([]string, error) {
	cfg := loadRuntimeConfig()
	matcher := newCOSURLMatcher(cfg.COSBaseURL)
	key, ok := matcher.keyFromURLOrKey(urlOrKey)
	if !ok {
		return nil, fmt.Errorf("invalid URL or key: %q", urlOrKey)
	}
	refs, err := scanVaultReferences(cfg.VaultPaths, cfg.COSBaseURL)
	if err != nil {
		return nil, err
	}
	if _, found := refs[key]; !found {
		return []string{}, nil
	}
	return notesForKey(refs, key), nil
}

type refAccum struct {
	URL   string
	Key   string
	Notes map[string]struct{}
}

func scanVaultReferences(vaultPaths []string, baseURL string) (map[string]*refAccum, error) {
	matcher := newCOSURLMatcher(baseURL)
	if matcher.host == "" {
		return nil, fmt.Errorf("invalid COS_BASE_URL: %q", baseURL)
	}

	refs := make(map[string]*refAccum)
	for _, root := range vaultPaths {
		root = strings.TrimSpace(root)
		if root == "" {
			continue
		}
		absRoot, err := filepath.Abs(root)
		if err != nil {
			return nil, fmt.Errorf("resolve vault path %q: %w", root, err)
		}
		info, err := os.Stat(absRoot)
		if err != nil {
			return nil, fmt.Errorf("vault path %q: %w", absRoot, err)
		}
		if !info.IsDir() {
			return nil, fmt.Errorf("vault path is not a directory: %s", absRoot)
		}

		err = filepath.WalkDir(absRoot, func(path string, d fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				// iCloud / permission hiccups: skip this node, keep scanning.
				if d != nil && d.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}
			name := d.Name()
			if d.IsDir() {
				if _, skip := skipDirNames[name]; skip {
					return filepath.SkipDir
				}
				return nil
			}
			if !strings.EqualFold(filepath.Ext(name), ".md") {
				return nil
			}
			data, err := os.ReadFile(path)
			if err != nil {
				return nil
			}
			urls := matcher.extractCOSURLs(string(data))
			if len(urls) == 0 {
				return nil
			}
			absNote, err := filepath.Abs(path)
			if err != nil {
				absNote = path
			}
			for _, u := range urls {
				key, ok := matcher.keyFromURL(u)
				if !ok {
					continue
				}
				acc, exists := refs[key]
				if !exists {
					acc = &refAccum{
						URL:   joinCOSURL(baseURL, key),
						Key:   key,
						Notes: make(map[string]struct{}),
					}
					refs[key] = acc
				}
				acc.Notes[absNote] = struct{}{}
			}
			return nil
		})
		if err != nil {
			return nil, fmt.Errorf("scan vault %s: %w", absRoot, err)
		}
	}
	return refs, nil
}

func refsToSlice(refs map[string]*refAccum) []ImageRef {
	out := make([]ImageRef, 0, len(refs))
	for _, acc := range refs {
		notes := make([]string, 0, len(acc.Notes))
		for n := range acc.Notes {
			notes = append(notes, n)
		}
		sort.Strings(notes)
		out = append(out, ImageRef{
			URL:   acc.URL,
			Key:   acc.Key,
			Notes: notes,
		})
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].Key < out[j].Key
	})
	return out
}

func notesForKey(refs map[string]*refAccum, key string) []string {
	acc, ok := refs[key]
	if !ok {
		return nil
	}
	notes := make([]string, 0, len(acc.Notes))
	for n := range acc.Notes {
		notes = append(notes, n)
	}
	sort.Strings(notes)
	return notes
}
