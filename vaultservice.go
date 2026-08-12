package main

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
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

// VaultScanProgress is emitted on "vault:scan" while ScanReferences runs.
type VaultScanProgress struct {
	FilesScanned int    `json:"filesScanned"`
	RefsFound    int    `json:"refsFound"`
	CurrentPath  string `json:"currentPath"`
	Done         bool   `json:"done"`
}

// ScanReferences walks configured vault paths and maps image URL → note paths.
func (s *VaultService) ScanReferences() ([]ImageRef, error) {
	cfg := loadRuntimeConfig()
	if cfg.COSBaseURL == "" {
		return nil, fmt.Errorf("%w: set COS_BASE_URL in .env (see .env.example)", ErrMissingCredentials)
	}
	if len(cfg.VaultPaths) == 0 {
		return nil, fmt.Errorf("no vault paths configured: set VAULT_PATHS in .env or save paths in Settings")
	}
	refs, err := scanVaultReferences(cfg.VaultPaths, cfg.COSBaseURL)
	if err != nil {
		return nil, err
	}
	return refsToSlice(refs), nil
}

// FindNotesUsing returns Markdown files that reference the given image URL or key.
func (s *VaultService) FindNotesUsing(urlOrKey string) ([]string, error) {
	cfg := loadRuntimeConfig()
	if cfg.COSBaseURL == "" {
		return nil, fmt.Errorf("%w: set COS_BASE_URL in .env (see .env.example)", ErrMissingCredentials)
	}
	if len(cfg.VaultPaths) == 0 {
		return nil, fmt.Errorf("no vault paths configured: set VAULT_PATHS in .env or save paths in Settings")
	}
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

// ReadNote returns the UTF-8 Markdown body for a note path under a configured vault.
func (s *VaultService) ReadNote(notePath string) (string, error) {
	notePath = strings.TrimSpace(notePath)
	if notePath == "" {
		return "", fmt.Errorf("empty note path")
	}
	cfg := loadRuntimeConfig()
	if len(cfg.VaultPaths) == 0 {
		return "", fmt.Errorf("no vault paths configured: set VAULT_PATHS in .env or save paths in Settings")
	}

	absNote, err := filepath.Abs(notePath)
	if err != nil {
		return "", fmt.Errorf("resolve note path: %w", err)
	}
	if resolved, err := filepath.EvalSymlinks(absNote); err == nil {
		absNote = resolved
	}

	under, err := pathUnderAnyVault(absNote, cfg.VaultPaths)
	if err != nil {
		return "", err
	}
	if !under {
		return "", fmt.Errorf("note path is outside configured vaults")
	}
	if !strings.EqualFold(filepath.Ext(absNote), ".md") {
		return "", fmt.Errorf("not a Markdown file: %s", absNote)
	}

	data, err := os.ReadFile(absNote)
	if err != nil {
		return "", fmt.Errorf("read note: %w", err)
	}
	return string(data), nil
}

func pathUnderAnyVault(absNote string, vaultPaths []string) (bool, error) {
	for _, root := range vaultPaths {
		root = strings.TrimSpace(root)
		if root == "" {
			continue
		}
		absRoot, err := filepath.Abs(root)
		if err != nil {
			return false, fmt.Errorf("resolve vault path %q: %w", root, err)
		}
		if resolved, err := filepath.EvalSymlinks(absRoot); err == nil {
			absRoot = resolved
		}
		rel, err := filepath.Rel(absRoot, absNote)
		if err != nil {
			continue
		}
		if rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
			continue
		}
		return true, nil
	}
	return false, nil
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
	filesScanned := 0
	emitVaultScan(VaultScanProgress{Done: false})

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
			filesScanned++
			data, err := os.ReadFile(path)
			if err != nil {
				return nil
			}
			urls := matcher.extractCOSURLs(string(data))
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
			if filesScanned == 1 || filesScanned%50 == 0 {
				emitVaultScan(VaultScanProgress{
					FilesScanned: filesScanned,
					RefsFound:    len(refs),
					CurrentPath:  absNote,
					Done:         false,
				})
			}
			return nil
		})
		if err != nil {
			return nil, fmt.Errorf("scan vault %s: %w", absRoot, err)
		}
	}

	emitVaultScan(VaultScanProgress{
		FilesScanned: filesScanned,
		RefsFound:    len(refs),
		Done:         true,
	})
	return refs, nil
}

func emitVaultScan(progress VaultScanProgress) {
	app := application.Get()
	if app == nil {
		return
	}
	app.Event.Emit("vault:scan", progress)
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
