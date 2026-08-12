package main

import (
	"testing"
	"time"
)

func TestParseUploadTimeFromKey(t *testing.T) {
	cases := []struct {
		key  string
		want time.Time
	}{
		{
			key:  "obsidian/20231002222829.png",
			want: time.Date(2023, 10, 2, 22, 28, 29, 0, time.Local),
		},
		{
			key:  "obsidian/20231002222829123.png",
			want: time.Date(2023, 10, 2, 22, 28, 29, 123*int(time.Millisecond), time.Local),
		},
		{
			key:  "obsidian/note%20name.png",
			want: time.Time{},
		},
	}

	for _, tc := range cases {
		got := parseUploadTimeFromKey(tc.key)
		if !got.Equal(tc.want) {
			t.Fatalf("key %q: got %v want %v", tc.key, got, tc.want)
		}
	}
}

func TestJoinCOSURL(t *testing.T) {
	got := joinCOSURL("https://example.com/", "obsidian/a b.png")
	want := "https://example.com/obsidian/a%20b.png"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}
