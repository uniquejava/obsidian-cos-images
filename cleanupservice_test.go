package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPreviewCascadeUniqueVsShared(t *testing.T) {
	dir := t.TempDir()
	noteA := filepath.Join(dir, "a.md")
	noteB := filepath.Join(dir, "b.md")
	mustWrite(t, noteA, `
![u](https://example-bucket.cos.ap-testing.myqcloud.com/obsidian/unique.png)
![s](https://example-bucket.cos.ap-testing.myqcloud.com/obsidian/shared.png)
`)
	mustWrite(t, noteB, `
![s](https://example-bucket.cos.ap-testing.myqcloud.com/obsidian/shared.png)
`)

	refs, err := scanVaultReferences([]string{dir}, "https://example-bucket.cos.ap-testing.myqcloud.com")
	if err != nil {
		t.Fatal(err)
	}

	absA, _ := filepath.Abs(noteA)
	var unique, shared int
	for key, acc := range refs {
		if _, ok := acc.Notes[absA]; !ok {
			continue
		}
		if len(acc.Notes) == 1 {
			unique++
			if key != "obsidian/unique.png" {
				t.Fatalf("unique key=%s", key)
			}
		} else {
			shared++
			if key != "obsidian/shared.png" {
				t.Fatalf("shared key=%s", key)
			}
		}
	}
	if unique != 1 || shared != 1 {
		t.Fatalf("unique=%d shared=%d", unique, shared)
	}
}

func mustWrite(t *testing.T, path, body string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}
