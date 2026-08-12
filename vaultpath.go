package main

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

func resolveExistingPath(path string) (string, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	if resolved, err := filepath.EvalSymlinks(abs); err == nil {
		return filepath.Clean(resolved), nil
	}
	return filepath.Clean(abs), nil
}

// validateVaultRoot checks that path is a usable Obsidian vault root.
// Obsidian vaults always contain a .obsidian/ directory at the root.
// Rejects filesystem roots and the user home directory so a mis-typed
// path cannot freeze the app by walking the entire disk.
func validateVaultRoot(path string) (string, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return "", fmt.Errorf("empty vault path")
	}
	abs, err := resolveExistingPath(path)
	if err != nil {
		return "", fmt.Errorf("resolve vault path %q: %w", path, err)
	}

	if isUnsafeScanRoot(abs) {
		return "", fmt.Errorf(
			"vault path %q is too broad (refusing filesystem root / home / users directory — pick the Obsidian vault folder that contains .obsidian/)",
			abs,
		)
	}

	info, err := os.Stat(abs)
	if err != nil {
		return "", fmt.Errorf("vault path %q: %w", abs, err)
	}
	if !info.IsDir() {
		return "", fmt.Errorf("vault path is not a directory: %s", abs)
	}

	marker := filepath.Join(abs, ".obsidian")
	mi, err := os.Stat(marker)
	if err != nil || !mi.IsDir() {
		return "", fmt.Errorf(
			"%s does not look like an Obsidian vault (missing .obsidian/ directory)",
			abs,
		)
	}
	return abs, nil
}

func isUnsafeScanRoot(abs string) bool {
	abs = filepath.Clean(abs)
	if isFilesystemRoot(abs) {
		return true
	}

	if home, err := os.UserHomeDir(); err == nil {
		if resolved, err := resolveExistingPath(home); err == nil && abs == resolved {
			return true
		}
	}

	switch abs {
	case "/Users", "/home", "/Volumes", "/private", "/System", "/Applications":
		return true
	}
	if runtime.GOOS == "darwin" && (abs == "/Library" || abs == "/Network") {
		return true
	}
	if runtime.GOOS == "windows" {
		lower := strings.ToLower(abs)
		switch lower {
		case `c:\users`, `c:\windows`, `c:\program files`, `c:\program files (x86)`:
			return true
		}
	}
	return false
}

func isFilesystemRoot(abs string) bool {
	abs = filepath.Clean(abs)
	sep := string(filepath.Separator)
	if abs == sep {
		return true
	}
	vol := filepath.VolumeName(abs)
	if vol != "" && abs == vol+sep {
		return true
	}
	// Windows sometimes yields "C:" without separator after Clean in edge cases.
	if runtime.GOOS == "windows" && vol != "" && abs == vol {
		return true
	}
	return false
}

func validateVaultRoots(paths []string) (cleaned []string, errs []string) {
	cleaned = make([]string, 0, len(paths))
	seen := make(map[string]struct{}, len(paths))
	for _, p := range paths {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		abs, err := validateVaultRoot(p)
		if err != nil {
			errs = append(errs, err.Error())
			continue
		}
		if _, ok := seen[abs]; ok {
			continue
		}
		seen[abs] = struct{}{}
		cleaned = append(cleaned, abs)
	}
	return cleaned, errs
}
