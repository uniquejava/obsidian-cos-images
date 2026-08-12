package main

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"os"
	"os/exec"
	"testing"
)

func TestCompressJPEGSmaller(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 400, 300))
	for y := 0; y < 300; y++ {
		for x := 0; x < 400; x++ {
			img.Set(x, y, color.RGBA{R: uint8(x), G: uint8(y), B: 128, A: 255})
		}
	}
	var srcBuf bytes.Buffer
	if err := jpeg.Encode(&srcBuf, img, &jpeg.Options{Quality: 95}); err != nil {
		t.Fatal(err)
	}
	src := srcBuf.Bytes()

	out, w, h, err := compressImageBytes(src, "jpeg", CompressOptions{Quality: 60, MaxEdge: 0})
	if err != nil {
		t.Fatal(err)
	}
	if w != 400 || h != 300 {
		t.Fatalf("dims %dx%d", w, h)
	}
	if len(out) >= len(src) {
		t.Fatalf("expected smaller jpeg: %d >= %d", len(out), len(src))
	}
}

func TestCompressPNGResizeDims(t *testing.T) {
	if _, err := findTool("pngquant"); err != nil {
		t.Skip(err.Error())
	}
	img := image.NewRGBA(image.Rect(0, 0, 800, 600))
	for y := 0; y < 600; y++ {
		for x := 0; x < 800; x++ {
			img.Set(x, y, color.RGBA{R: uint8(x % 256), G: uint8(y % 256), B: 60, A: 255})
		}
	}
	var srcBuf bytes.Buffer
	if err := png.Encode(&srcBuf, img); err != nil {
		t.Fatal(err)
	}
	out, w, h, err := compressImageBytes(srcBuf.Bytes(), "png", CompressOptions{Quality: 80, MaxEdge: 400})
	if err != nil {
		t.Fatal(err)
	}
	if w != 400 || h != 300 {
		t.Fatalf("expected 400x300 after resize, got %dx%d", w, h)
	}
	if len(out) == 0 {
		t.Fatal("empty output")
	}
}

func TestCompressPNGTinyShrinksLoosePNG(t *testing.T) {
	if _, err := findTool("pngquant"); err != nil {
		t.Skip(err.Error())
	}
	img := image.NewRGBA(image.Rect(0, 0, 640, 480))
	for y := 0; y < 480; y++ {
		for x := 0; x < 640; x++ {
			img.Set(x, y, color.RGBA{R: uint8((x * 3) % 256), G: uint8((y * 5) % 256), B: uint8((x + y) % 256), A: 255})
		}
	}
	f, err := os.CreateTemp("", "oci-loose-*.png")
	if err != nil {
		t.Fatal(err)
	}
	path := f.Name()
	defer os.Remove(path)
	enc := png.Encoder{CompressionLevel: png.NoCompression}
	if err := enc.Encode(f, img); err != nil {
		_ = f.Close()
		t.Fatal(err)
	}
	_ = f.Close()
	src, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}

	out, _, _, err := compressImageBytes(src, "png", CompressOptions{Quality: 80, MaxEdge: 0})
	if err != nil {
		t.Fatal(err)
	}
	if len(out) >= len(src) {
		t.Fatalf("expected pngquant to shrink loose PNG: %d >= %d", len(out), len(src))
	}
	t.Logf("pngquant %d → %d (%.0f%%)", len(src), len(out), 100*float64(len(out))/float64(len(src)))
}

func TestImageFormatFromKey(t *testing.T) {
	f, ct, err := imageFormatFromKey("obsidian/20240101120000.PNG")
	if err != nil || f != "png" || ct != "image/png" {
		t.Fatalf("png: %v %s %s", err, f, ct)
	}
	_, _, err = imageFormatFromKey("obsidian/x.webp")
	if err == nil {
		t.Fatal("expected error for webp")
	}
}

func TestFindPngquant(t *testing.T) {
	if _, err := exec.LookPath("pngquant"); err != nil {
		if _, err2 := findTool("pngquant"); err2 == nil {
			t.Fatal("findTool should fail if LookPath fails and no brew path… unless brew path exists")
		}
	}
}
