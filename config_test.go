package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSaveAndLoadVaultPaths(t *testing.T) {
	tmp := t.TempDir()
	configFilePathOverride = filepath.Join(tmp, "config.json")
	t.Cleanup(func() { configFilePathOverride = "" })

	paths := []string{filepath.Join(tmp, "vault-a"), filepath.Join(tmp, "vault-b")}
	for _, p := range paths {
		if err := os.MkdirAll(filepath.Join(p, ".obsidian"), 0o755); err != nil {
			t.Fatal(err)
		}
	}

	if err := savePersistedVaultPaths(paths); err != nil {
		t.Fatal(err)
	}
	settings, err := loadPersistedSettings()
	if err != nil {
		t.Fatal(err)
	}
	if len(settings.VaultPaths) != 2 {
		t.Fatalf("got %v", settings.VaultPaths)
	}
	if settings.ShowThumbnails {
		t.Fatal("ShowThumbnails should default false")
	}

	if err := saveShowThumbnails(true); err != nil {
		t.Fatal(err)
	}
	cfg := loadRuntimeConfig()
	if len(cfg.VaultPaths) != 2 {
		t.Fatalf("runtime vault paths = %v", cfg.VaultPaths)
	}
	if len(cfg.VaultPathErrors) != 0 {
		t.Fatalf("unexpected vault path errors: %v", cfg.VaultPathErrors)
	}
	if !cfg.ShowThumbnails {
		t.Fatal("expected ShowThumbnails true after save")
	}
}

func TestThumbnailCacheRoundTrip(t *testing.T) {
	tmp := t.TempDir()
	thumbnailCacheDirOverride = tmp
	t.Cleanup(func() { thumbnailCacheDirOverride = "" })

	key := "obsidian/demo.png"
	path, err := thumbnailCachePath(key)
	if err != nil {
		t.Fatal(err)
	}
	payload := []byte("fake-thumb-bytes")
	if err := os.WriteFile(path, payload, 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := getOrFetchThumbnail(key)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(payload) {
		t.Fatalf("cache miss? got %q", got)
	}
}

func TestExportOrphansCSVHeader(t *testing.T) {
	csv, err := exportOrphansCSV(nil)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(csv, "key,url,size,uploadTime,lastModified") {
		t.Fatalf("unexpected csv: %q", csv)
	}
}
