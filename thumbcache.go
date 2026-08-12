package main

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/tencentyun/cos-go-sdk-v5"
)

const thumbQuery = "imageMogr2/thumbnail/64x"

// GetThumbnail returns a base64-encoded thumbnail for the object key.
// Results are cached under the user cache directory so repeat views avoid COS traffic.
func (s *COSService) GetThumbnail(key string) (string, error) {
	key = strings.TrimSpace(strings.TrimPrefix(key, "/"))
	if key == "" {
		return "", fmt.Errorf("empty key")
	}
	data, err := getOrFetchThumbnail(key)
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(data), nil
}

// ClearThumbnailCache deletes locally cached thumbnails.
func (s *COSService) ClearThumbnailCache() error {
	dir, err := thumbnailCacheDir()
	if err != nil {
		return err
	}
	if err := os.RemoveAll(dir); err != nil {
		return err
	}
	return os.MkdirAll(dir, 0o755)
}

func thumbnailCacheDir() (string, error) {
	if thumbnailCacheDirOverride != "" {
		return thumbnailCacheDirOverride, nil
	}
	root, err := os.UserCacheDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(root, appConfigDirName, "thumbs"), nil
}

func thumbnailCachePath(key string) (string, error) {
	dir, err := thumbnailCacheDir()
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256([]byte(key))
	name := hex.EncodeToString(sum[:]) + ".img"
	return filepath.Join(dir, name), nil
}

func getOrFetchThumbnail(key string) ([]byte, error) {
	path, err := thumbnailCachePath(key)
	if err != nil {
		return nil, err
	}
	if data, err := os.ReadFile(path); err == nil && len(data) > 0 {
		return data, nil
	}

	data, err := fetchThumbnailBytes(key)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return data, nil // still return bytes even if cache write fails
	}
	_ = os.WriteFile(path, data, 0o644)
	return data, nil
}

func fetchThumbnailBytes(key string) ([]byte, error) {
	cfg := loadRuntimeConfig()
	if cfg.SecretID == "" || cfg.SecretKey == "" {
		return nil, fmt.Errorf("%w: set COS_SECRET_ID and COS_SECRET_KEY (see .env.example)", ErrMissingCredentials)
	}

	rawURL := joinCOSURL(cfg.COSBaseURL, key)
	sep := "?"
	if strings.Contains(rawURL, "?") {
		sep = "&"
	}
	thumbURL := rawURL + sep + thumbQuery

	client := &http.Client{
		Timeout: 30 * time.Second,
		Transport: &cos.AuthorizationTransport{
			SecretID:  cfg.SecretID,
			SecretKey: cfg.SecretKey,
		},
	}

	resp, err := client.Get(thumbURL)
	if err != nil {
		return nil, fmt.Errorf("fetch thumbnail: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		data, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20)) // 2MB cap
		if err != nil {
			return nil, err
		}
		if len(data) == 0 {
			return nil, fmt.Errorf("empty thumbnail for %s", key)
		}
		return data, nil
	}

	// Fallback: original object (may be larger; still cached once).
	resp2, err := client.Get(rawURL)
	if err != nil {
		return nil, fmt.Errorf("fetch object: %w", err)
	}
	defer resp2.Body.Close()
	if resp2.StatusCode < 200 || resp2.StatusCode >= 300 {
		return nil, fmt.Errorf("fetch object %s: HTTP %d", key, resp2.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp2.Body, 512<<10)) // 512KB cap for fallback
	if err != nil {
		return nil, err
	}
	if len(data) == 0 {
		return nil, fmt.Errorf("empty object for %s", key)
	}
	return data, nil
}
