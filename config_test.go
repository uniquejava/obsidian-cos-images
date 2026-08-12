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
		if err := os.MkdirAll(p, 0o755); err != nil {
			t.Fatal(err)
		}
	}

	if err := savePersistedVaultPaths(paths); err != nil {
		t.Fatal(err)
	}
	got, ok, err := readPersistedVaultPaths()
	if err != nil || !ok {
		t.Fatalf("ok=%v err=%v", ok, err)
	}
	if len(got) != 2 {
		t.Fatalf("got %v", got)
	}

	cfg := loadRuntimeConfig()
	if len(cfg.VaultPaths) != 2 {
		t.Fatalf("runtime vault paths = %v", cfg.VaultPaths)
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
