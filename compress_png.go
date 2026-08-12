package main

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
)

func findTool(name string) (string, error) {
	if p, err := exec.LookPath(name); err == nil {
		return p, nil
	}
	var candidates []string
	if home, err := os.UserHomeDir(); err == nil {
		candidates = append(candidates,
			filepath.Join(home, ".local", "bin", name),
		)
	}
	candidates = append(candidates,
		"/opt/homebrew/bin/"+name,
		"/usr/local/bin/"+name,
		"/usr/bin/"+name,
	)
	if exe, err := os.Executable(); err == nil {
		dir := filepath.Dir(exe)
		candidates = append(candidates,
			filepath.Join(dir, name),
			filepath.Join(dir, "bin", name),
			// macOS .app: Contents/MacOS → Contents/Resources
			filepath.Join(dir, "..", "Resources", name),
			filepath.Join(dir, "..", "Resources", "bin", name),
		)
	}
	for _, c := range candidates {
		if st, err := os.Stat(c); err == nil && !st.IsDir() {
			return c, nil
		}
	}
	hint := "brew install " + name
	if runtime.GOOS != "darwin" {
		hint = "install `" + name + "` and ensure it is on PATH"
	}
	return "", fmt.Errorf("%s not found (%s)", name, hint)
}

// pngquantQualityRange maps the UI quality (1–100) to pngquant --quality=min-max.
// TinyPNG-style defaults: max≈80 with a loose floor so hard photos still convert.
func pngquantQualityRange(quality int) (minQ, maxQ int) {
	maxQ = quality
	if maxQ < 40 {
		maxQ = 40
	}
	if maxQ > 100 {
		maxQ = 100
	}
	minQ = maxQ - 35
	if minQ < 0 {
		minQ = 0
	}
	return minQ, maxQ
}

func writeTempPNGBytes(data []byte) (path string, cleanup func(), err error) {
	f, err := os.CreateTemp("", "oci-png-*.png")
	if err != nil {
		return "", nil, err
	}
	path = f.Name()
	cleanup = func() { _ = os.Remove(path) }
	if _, err := f.Write(data); err != nil {
		_ = f.Close()
		cleanup()
		return "", nil, err
	}
	if err := f.Close(); err != nil {
		cleanup()
		return "", nil, err
	}
	return path, cleanup, nil
}

func runPngquantFile(inPath, outPath string, quality int) error {
	bin, err := findTool("pngquant")
	if err != nil {
		return err
	}
	minQ, maxQ := pngquantQualityRange(quality)
	try := func(min, max int) (int, error) {
		cmd := exec.Command(bin,
			"--quality="+strconv.Itoa(min)+"-"+strconv.Itoa(max),
			"--speed=3",
			"--strip",
			"--force",
			"--output", outPath,
			inPath,
		)
		var stderr bytes.Buffer
		cmd.Stderr = &stderr
		err := cmd.Run()
		code := 0
		if err != nil {
			if ee, ok := err.(*exec.ExitError); ok {
				code = ee.ExitCode()
			} else {
				return 0, fmt.Errorf("pngquant: %w (%s)", err, strings.TrimSpace(stderr.String()))
			}
		}
		return code, nil
	}

	code, err := try(minQ, maxQ)
	if err != nil {
		return err
	}
	// 99 = could not meet min quality — retry with floor 0 (TinyPNG is aggressive).
	if code == 99 {
		code, err = try(0, maxQ)
		if err != nil {
			return err
		}
	}
	switch code {
	case 0:
		return nil
	case 98:
		return fmt.Errorf("pngquant: result was not smaller than input")
	case 99:
		return fmt.Errorf("pngquant: could not reach quality ≤%d without excessive loss", maxQ)
	default:
		return fmt.Errorf("pngquant exited with code %d", code)
	}
}

func runOxipngInPlace(path string) error {
	bin, err := findTool("oxipng")
	if err != nil {
		return err // optional
	}
	cmd := exec.Command(bin, "-o", "2", "-s", "--", path)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("oxipng: %w (%s)", err, strings.TrimSpace(stderr.String()))
	}
	return nil
}

// compressPNGTinyBytes runs TinyPNG-style compression on PNG file bytes via pngquant (+ optional oxipng).
func compressPNGTinyBytes(pngData []byte, quality int) ([]byte, error) {
	inPath, cleanupIn, err := writeTempPNGBytes(pngData)
	if err != nil {
		return nil, err
	}
	defer cleanupIn()

	outFile, err := os.CreateTemp("", "oci-pq-*.png")
	if err != nil {
		return nil, err
	}
	outPath := outFile.Name()
	_ = outFile.Close()
	defer os.Remove(outPath)

	if err := runPngquantFile(inPath, outPath, quality); err != nil {
		return nil, err
	}
	// Best-effort lossless second pass (ignore if oxipng missing).
	_ = runOxipngInPlace(outPath)

	data, err := os.ReadFile(outPath)
	if err != nil {
		return nil, err
	}
	if len(data) == 0 {
		return nil, fmt.Errorf("pngquant produced empty output")
	}
	return data, nil
}
