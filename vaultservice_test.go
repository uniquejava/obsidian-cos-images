package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPathUnderAnyVault(t *testing.T) {
	root := t.TempDir()
	note := filepath.Join(root, "folder", "a.md")
	if err := os.MkdirAll(filepath.Dir(note), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(note, []byte("# hi"), 0o644); err != nil {
		t.Fatal(err)
	}

	ok, err := pathUnderAnyVault(note, []string{root})
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatalf("expected note under vault")
	}

	other := t.TempDir()
	outside := filepath.Join(other, "b.md")
	if err := os.WriteFile(outside, []byte("# x"), 0o644); err != nil {
		t.Fatal(err)
	}
	ok, err = pathUnderAnyVault(outside, []string{root})
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Fatalf("expected outside note rejected")
	}
}
