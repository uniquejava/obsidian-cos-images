package main

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image"
	"image/color"
	_ "image/gif"
	"image/jpeg"
	"image/png"
	"io"
	"path"
	"strings"

	"golang.org/x/image/draw"
)

const (
	defaultJPEGQuality = 80
	// Cap download / encode work for a single object in the UI flow.
	maxCompressSourceBytes = 40 << 20 // 40 MiB
)

func normalizeCompressOptions(opts CompressOptions) CompressOptions {
	if opts.Quality <= 0 {
		opts.Quality = defaultJPEGQuality
	}
	if opts.Quality > 100 {
		opts.Quality = 100
	}
	if opts.MaxEdge < 0 {
		opts.MaxEdge = 0
	}
	return opts
}

func imageFormatFromKey(key string) (format string, contentType string, err error) {
	ext := strings.ToLower(path.Ext(key))
	switch ext {
	case ".jpg", ".jpeg":
		return "jpeg", "image/jpeg", nil
	case ".png":
		return "png", "image/png", nil
	default:
		return "", "", fmt.Errorf("unsupported image type %q (only .jpg / .jpeg / .png)", ext)
	}
}

func decodeImage(data []byte) (image.Image, error) {
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("decode image: %w", err)
	}
	return img, nil
}

func resizeToMaxEdge(img image.Image, maxEdge int) image.Image {
	if maxEdge <= 0 {
		return img
	}
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	long := w
	if h > long {
		long = h
	}
	if long <= maxEdge {
		return img
	}
	scale := float64(maxEdge) / float64(long)
	nw := int(float64(w)*scale + 0.5)
	nh := int(float64(h)*scale + 0.5)
	if nw < 1 {
		nw = 1
	}
	if nh < 1 {
		nh = 1
	}
	dst := image.NewRGBA(image.Rect(0, 0, nw, nh))
	draw.CatmullRom.Scale(dst, dst.Bounds(), img, b, draw.Over, nil)
	return dst
}

func encodeJPEG(img image.Image, quality int) ([]byte, error) {
	var buf bytes.Buffer
	opaque := flattenForJPEG(img)
	if err := jpeg.Encode(&buf, opaque, &jpeg.Options{Quality: quality}); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func flattenForJPEG(img image.Image) image.Image {
	b := img.Bounds()
	dst := image.NewRGBA(b)
	draw.Draw(dst, b, &image.Uniform{C: color.White}, image.Point{}, draw.Src)
	draw.Draw(dst, b, img, b.Min, draw.Over)
	return dst
}

func compressImageBytes(src []byte, format string, opts CompressOptions) (out []byte, width, height int, err error) {
	opts = normalizeCompressOptions(opts)
	img, err := decodeImage(src)
	if err != nil {
		return nil, 0, 0, err
	}
	b := img.Bounds()
	origW, origH := b.Dx(), b.Dy()

	resized := resizeToMaxEdge(img, opts.MaxEdge)
	rb := resized.Bounds()
	width, height = rb.Dx(), rb.Dy()
	didResize := width != origW || height != origH

	switch format {
	case "jpeg":
		out, err = encodeJPEG(resized, opts.Quality)
	case "png":
		// TinyPNG-style pngquant works best on the original file bytes.
		// Only re-encode when we actually resized.
		var pngIn []byte
		if didResize {
			var buf bytes.Buffer
			if err := png.Encode(&buf, resized); err != nil {
				return nil, 0, 0, err
			}
			pngIn = buf.Bytes()
		} else {
			pngIn = src
		}
		out, err = compressPNGTinyBytes(pngIn, opts.Quality)
	default:
		err = fmt.Errorf("unsupported encode format %q", format)
	}
	if err != nil {
		return nil, 0, 0, err
	}
	return out, width, height, nil
}

func dataURL(contentType string, data []byte) string {
	return "data:" + contentType + ";base64," + base64.StdEncoding.EncodeToString(data)
}

func readAllLimited(r io.Reader, limit int64) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(r, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, fmt.Errorf("object larger than %d bytes limit", limit)
	}
	return data, nil
}
