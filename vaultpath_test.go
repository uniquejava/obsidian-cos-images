package main

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestValidateVaultRootRequiresObsidianDir(t *testing.T) {
	root := t.TempDir()
	_, err := validateVaultRoot(root)
	if err == nil {
		t.Fatal("expected error without .obsidian")
	}

	if err := os.Mkdir(filepath.Join(root, ".obsidian"), 0o755); err != nil {
		t.Fatal(err)
	}
	abs, err := validateVaultRoot(root)
	if err != nil {
		t.Fatal(err)
	}
	if abs == "" {
		t.Fatal("expected abs path")
	}
}

func TestValidateVaultRootRejectsHome(t *testing.T) {
	home, err := os.UserHomeDir()
	if err != nil {
		t.Skip(err)
	}
	// Even if someone creates .obsidian in home, refuse.
	_, err = validateVaultRoot(home)
	if err == nil {
		t.Fatal("expected home directory to be rejected")
	}
}

func TestValidateVaultRootRejectsFilesystemRoot(t *testing.T) {
	root := "/"
	if runtime.GOOS == "windows" {
		root = `C:\`
	}
	_, err := validateVaultRoot(root)
	if err == nil {
		t.Fatal("expected filesystem root to be rejected")
	}
}

func TestValidateVaultRootRejectsUsersDir(t *testing.T) {
	if runtime.GOOS != "darwin" && runtime.GOOS != "linux" {
		t.Skip("unix-only path")
	}
	_, err := validateVaultRoot("/Users")
	if err == nil {
		t.Fatal("expected /Users to be rejected")
	}
}

func TestIsFilesystemRoot(t *testing.T) {
	if !isFilesystemRoot("/") {
		t.Fatal("expected / to be root")
	}
	if isFilesystemRoot("/tmp") {
		t.Fatal("/tmp should not be filesystem root")
	}
}
