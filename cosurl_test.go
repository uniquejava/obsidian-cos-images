package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestExtractCOSURLs(t *testing.T) {
	const base = "https://example-bucket.cos.ap-testing.myqcloud.com"
	m := newCOSURLMatcher(base)
	content := `
![image.png|800](https://example-bucket.cos.ap-testing.myqcloud.com/obsidian/20260604001623801.png)
![|768](https://example-bucket.cos.ap-testing.myqcloud.com/obsidian/20250217115008.png)
<img src="https://example-bucket.cos.ap-testing.myqcloud.com/obsidian/foo%20bar.png">
![other](https://github.com/example/raw/img.png)
`
	got := m.extractCOSURLs(content)
	if len(got) != 3 {
		t.Fatalf("want 3 urls, got %d: %#v", len(got), got)
	}
	key, ok := m.keyFromURL(got[2])
	if !ok || key != "obsidian/foo bar.png" {
		t.Fatalf("decoded key = %q ok=%v", key, ok)
	}
}

func TestKeyFromURLOrKey(t *testing.T) {
	m := newCOSURLMatcher("https://example-bucket.cos.ap-testing.myqcloud.com")
	key, ok := m.keyFromURLOrKey("obsidian/20240120160143.png")
	if !ok || key != "obsidian/20240120160143.png" {
		t.Fatalf("got %q %v", key, ok)
	}
	key, ok = m.keyFromURLOrKey("https://oreilly.com/x.png")
	if ok {
		t.Fatalf("foreign host should fail, got %q", key)
	}
}

func TestScanVaultReferencesFixture(t *testing.T) {
	dir := t.TempDir()
	if err := os.Mkdir(filepath.Join(dir, ".obsidian"), 0o755); err != nil {
		t.Fatal(err)
	}
	md := dir + "/note.md"
	body := "![|768](https://example-bucket.cos.ap-testing.myqcloud.com/obsidian/20240120160143.png)\n"
	if err := os.WriteFile(md, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	refs, err := scanVaultReferences([]string{dir}, "https://example-bucket.cos.ap-testing.myqcloud.com")
	if err != nil {
		t.Fatal(err)
	}
	acc, ok := refs["obsidian/20240120160143.png"]
	if !ok {
		t.Fatalf("missing ref, keys=%v", keysOf(refs))
	}
	if len(acc.Notes) != 1 {
		t.Fatalf("notes=%v", acc.Notes)
	}
	if !strings.HasSuffix(notesForKey(refs, "obsidian/20240120160143.png")[0], "note.md") {
		t.Fatalf("unexpected note path: %v", acc.Notes)
	}
}

func keysOf(refs map[string]*refAccum) []string {
	out := make([]string, 0, len(refs))
	for k := range refs {
		out = append(out, k)
	}
	return out
}
