package main

import (
	"testing"
	"time"

	"github.com/tencentyun/cos-go-sdk-v5"
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

func TestNormalizeBrowsePrefix(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"", ""},
		{"/", ""},
		{"static", "static/"},
		{"static/img/shop/app/", "static/img/shop/app/"},
		{"/static/img/", "static/img/"},
	}
	for _, tc := range cases {
		if got := normalizeBrowsePrefix(tc.in); got != tc.want {
			t.Fatalf("normalizeBrowsePrefix(%q)=%q want %q", tc.in, got, tc.want)
		}
	}
}

func TestIsImageObjectKey(t *testing.T) {
	if !isImageObjectKey("static/img/shop/app/coupon_icon.png") {
		t.Fatal("expected png to be image")
	}
	if isImageObjectKey("static/app.js") {
		t.Fatal("expected js not image")
	}
}

func TestBrowseListingIncludesNonImages(t *testing.T) {
	// Browse maps every non-directory object into Objects (images and other files).
	base := "https://example.com"
	objs := []ImageObject{
		imageObjectFromCOS(base, cos.Object{Key: "static/app.js", Size: 12}),
		imageObjectFromCOS(base, cos.Object{Key: "static/icon.png", Size: 100}),
	}
	listing := &BrowseListing{
		Prefix:  "static/",
		Folders: []string{"static/img/"},
		Objects: objs,
	}
	if len(listing.Objects) != 2 {
		t.Fatalf("objects = %d, want 2", len(listing.Objects))
	}
	var sawJS, sawPNG bool
	for _, o := range listing.Objects {
		if o.Key == "static/app.js" {
			sawJS = true
			if isImageObjectKey(o.Key) {
				t.Fatal("js should not be treated as image")
			}
		}
		if o.Key == "static/icon.png" {
			sawPNG = true
			if !isImageObjectKey(o.Key) {
				t.Fatal("png should be image")
			}
		}
	}
	if !sawJS || !sawPNG {
		t.Fatalf("missing keys in objects: js=%v png=%v", sawJS, sawPNG)
	}
}

func TestDefaultCOSBaseURL(t *testing.T) {
	got := defaultCOSBaseURL("demo-123", "ap-shanghai")
	want := "https://demo-123.cos.ap-shanghai.myqcloud.com"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}
