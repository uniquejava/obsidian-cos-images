package main

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/tencentyun/cos-go-sdk-v5"
)

// COSService lists and deletes objects on Tencent Cloud COS.
type COSService struct{}

func NewCOSService() *COSService {
	return &COSService{}
}

var (
	picGoTimestampRe    = regexp.MustCompile(`(?:^|[^0-9])(\d{14})(\d{0,3})(?:[^0-9]|$)`)
	lastModifiedLayouts = []string{
		time.RFC3339,
		"2006-01-02T15:04:05.000Z",
		"2006-01-02T15:04:05Z",
		"2006-01-02T15:04:05",
	}
)

// ListImages returns objects under the configured prefix, newest upload first.
func (s *COSService) ListImages() ([]ImageObject, error) {
	cfg := loadRuntimeConfig()
	if err := requireCOSEnv(cfg); err != nil {
		return nil, err
	}

	client, err := newCOSClient(cfg)
	if err != nil {
		return nil, err
	}

	ctx := context.Background()
	opt := &cos.BucketGetOptions{
		Prefix:  cfg.COSPrefix,
		MaxKeys: 1000,
	}

	images := make([]ImageObject, 0, 1024)
	var marker string
	for {
		opt.Marker = marker
		result, _, err := client.Bucket.Get(ctx, opt)
		if err != nil {
			return nil, fmt.Errorf("list COS objects: %w", err)
		}

		for _, obj := range result.Contents {
			if obj.Key == "" || strings.HasSuffix(obj.Key, "/") {
				continue
			}
			lastMod := parseCOSLastModified(obj.LastModified)
			uploadTime := parseUploadTimeFromKey(obj.Key)
			if uploadTime.IsZero() {
				uploadTime = lastMod
			}
			images = append(images, ImageObject{
				Key:          obj.Key,
				URL:          joinCOSURL(cfg.COSBaseURL, obj.Key),
				Size:         obj.Size,
				LastModified: lastMod,
				UploadTime:   uploadTime,
			})
		}

		if !result.IsTruncated {
			break
		}
		marker = result.NextMarker
		if marker == "" && len(result.Contents) > 0 {
			marker = result.Contents[len(result.Contents)-1].Key
		}
		if marker == "" {
			break
		}
	}

	sort.Slice(images, func(i, j int) bool {
		if images[i].UploadTime.Equal(images[j].UploadTime) {
			return images[i].Key > images[j].Key
		}
		return images[i].UploadTime.After(images[j].UploadTime)
	})

	return images, nil
}

// DeleteImages deletes COS objects by key. Prefer dry-run / confirm in UI first.
func (s *COSService) DeleteImages(keys []string) error {
	cleaned := make([]string, 0, len(keys))
	seen := make(map[string]struct{}, len(keys))
	for _, k := range keys {
		k = strings.TrimSpace(strings.TrimPrefix(k, "/"))
		if k == "" {
			continue
		}
		if _, ok := seen[k]; ok {
			continue
		}
		seen[k] = struct{}{}
		cleaned = append(cleaned, k)
	}
	if len(cleaned) == 0 {
		return nil
	}

	cfg := loadRuntimeConfig()
	if err := requireCOSEnv(cfg); err != nil {
		return err
	}
	client, err := newCOSClient(cfg)
	if err != nil {
		return err
	}

	ctx := context.Background()
	const batchSize = 1000
	for i := 0; i < len(cleaned); i += batchSize {
		end := i + batchSize
		if end > len(cleaned) {
			end = len(cleaned)
		}
		objs := make([]cos.Object, 0, end-i)
		for _, k := range cleaned[i:end] {
			objs = append(objs, cos.Object{Key: k})
		}
		result, _, err := client.Object.DeleteMulti(ctx, &cos.ObjectDeleteMultiOptions{
			Objects: objs,
			Quiet:   false,
		})
		if err != nil {
			return fmt.Errorf("delete COS objects: %w", err)
		}
		if result != nil && len(result.Errors) > 0 {
			e := result.Errors[0]
			return fmt.Errorf("delete COS object %s: %s (%s)", e.Key, e.Message, e.Code)
		}
	}
	return nil
}

// PreviewCompress downloads the object, compresses in memory, and returns a
// side-by-side preview payload. It does not upload.
func (s *COSService) PreviewCompress(key string, opts CompressOptions) (CompressPreview, error) {
	key = strings.TrimSpace(strings.TrimPrefix(key, "/"))
	if key == "" {
		return CompressPreview{}, fmt.Errorf("empty key")
	}
	opts = normalizeCompressOptions(opts)
	format, contentType, err := imageFormatFromKey(key)
	if err != nil {
		return CompressPreview{}, err
	}

	cfg := loadRuntimeConfig()
	if err := requireCOSEnv(cfg); err != nil {
		return CompressPreview{}, err
	}
	client, err := newCOSClient(cfg)
	if err != nil {
		return CompressPreview{}, err
	}

	ctx := context.Background()
	src, err := downloadCOSObject(ctx, client, key)
	if err != nil {
		return CompressPreview{}, err
	}

	out, w, h, err := compressImageBytes(src, format, opts)
	if err != nil {
		return CompressPreview{}, err
	}

	preview := CompressPreview{
		Key:               key,
		URL:               joinCOSURL(cfg.COSBaseURL, key),
		OriginalSize:      int64(len(src)),
		CompressedSize:    int64(len(out)),
		CompressedDataURL: dataURL(contentType, out),
		Width:             w,
		Height:            h,
		Format:            format,
		Quality:           opts.Quality,
		MaxEdge:           opts.MaxEdge,
		Smaller:           int64(len(out)) < int64(len(src)),
	}
	if !preview.Smaller {
		preview.Message = "Compressed size is not smaller than the original; replace is blocked unless you change settings."
	}
	return preview, nil
}

// ReplaceWithCompressed recompresses the object and overwrites the same COS key.
// Markdown URLs stay unchanged. Refuses to upload when compressed is not smaller.
func (s *COSService) ReplaceWithCompressed(key string, opts CompressOptions) (ImageObject, error) {
	key = strings.TrimSpace(strings.TrimPrefix(key, "/"))
	if key == "" {
		return ImageObject{}, fmt.Errorf("empty key")
	}
	opts = normalizeCompressOptions(opts)
	format, contentType, err := imageFormatFromKey(key)
	if err != nil {
		return ImageObject{}, err
	}

	cfg := loadRuntimeConfig()
	if err := requireCOSEnv(cfg); err != nil {
		return ImageObject{}, err
	}
	client, err := newCOSClient(cfg)
	if err != nil {
		return ImageObject{}, err
	}

	ctx := context.Background()
	src, err := downloadCOSObject(ctx, client, key)
	if err != nil {
		return ImageObject{}, err
	}

	out, _, _, err := compressImageBytes(src, format, opts)
	if err != nil {
		return ImageObject{}, err
	}
	if int64(len(out)) >= int64(len(src)) {
		return ImageObject{}, fmt.Errorf(
			"compressed size (%d) is not smaller than original (%d); aborting replace",
			len(out), len(src),
		)
	}

	_, err = client.Object.Put(ctx, key, bytes.NewReader(out), &cos.ObjectPutOptions{
		ObjectPutHeaderOptions: &cos.ObjectPutHeaderOptions{
			ContentType: contentType,
		},
	})
	if err != nil {
		return ImageObject{}, fmt.Errorf("upload compressed object: %w", err)
	}

	_ = invalidateThumbnail(key)

	now := time.Now()
	uploadTime := parseUploadTimeFromKey(key)
	if uploadTime.IsZero() {
		uploadTime = now
	}
	return ImageObject{
		Key:          key,
		URL:          joinCOSURL(cfg.COSBaseURL, key),
		Size:         int64(len(out)),
		LastModified: now.UTC(),
		UploadTime:   uploadTime,
	}, nil
}

func downloadCOSObject(ctx context.Context, client *cos.Client, key string) ([]byte, error) {
	resp, err := client.Object.Get(ctx, key, nil)
	if err != nil {
		return nil, fmt.Errorf("download COS object: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("download COS object %s: HTTP %d", key, resp.StatusCode)
	}
	data, err := readAllLimited(resp.Body, maxCompressSourceBytes)
	if err != nil {
		return nil, fmt.Errorf("read COS object %s: %w", key, err)
	}
	if len(data) == 0 {
		return nil, fmt.Errorf("empty COS object %s", key)
	}
	return data, nil
}

// TestConnection probes the COS bucket with the Settings form values (does not save).
// Empty SecretKey reuses the stored/env key. Returns a short success summary.
func (s *COSService) TestConnection(settings COSSettings) (string, error) {
	cfg, err := resolveCOSIdentity(settings)
	if err != nil {
		return "", err
	}
	client, err := newCOSClient(cfg)
	if err != nil {
		return "", err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	if _, err := client.Bucket.Head(ctx); err != nil {
		return "", fmt.Errorf("bucket access failed (check SecretId/SecretKey, Bucket, Region): %w", err)
	}

	result, _, err := client.Bucket.Get(ctx, &cos.BucketGetOptions{
		Prefix:  cfg.COSPrefix,
		MaxKeys: 1,
	})
	if err != nil {
		return "", fmt.Errorf("list under prefix %q failed: %w", cfg.COSPrefix, err)
	}

	n := 0
	if result != nil {
		for _, obj := range result.Contents {
			if obj.Key != "" && !strings.HasSuffix(obj.Key, "/") {
				n++
			}
		}
	}
	if n == 0 {
		return fmt.Sprintf(
			"OK — bucket %s reachable; prefix %q is readable (no objects found yet). Base URL host: %s",
			cfg.COSBucket, cfg.COSPrefix, hostOf(cfg.COSBaseURL),
		), nil
	}
	return fmt.Sprintf(
		"OK — bucket %s reachable; prefix %q is readable. Base URL host: %s",
		cfg.COSBucket, cfg.COSPrefix, hostOf(cfg.COSBaseURL),
	), nil
}

func hostOf(baseURL string) string {
	u, err := url.Parse(baseURL)
	if err != nil || u.Host == "" {
		return baseURL
	}
	return u.Host
}

func newCOSClient(cfg runtimeConfig) (*cos.Client, error) {
	bucketURL, err := url.Parse(fmt.Sprintf("https://%s.cos.%s.myqcloud.com", cfg.COSBucket, cfg.COSRegion))
	if err != nil {
		return nil, fmt.Errorf("parse COS bucket URL: %w", err)
	}
	return cos.NewClient(&cos.BaseURL{BucketURL: bucketURL}, &http.Client{
		Transport: &cos.AuthorizationTransport{
			SecretID:  cfg.SecretID,
			SecretKey: cfg.SecretKey,
		},
	}), nil
}

func joinCOSURL(baseURL, key string) string {
	base := strings.TrimRight(baseURL, "/")
	escaped := (&url.URL{Path: key}).EscapedPath()
	if !strings.HasPrefix(escaped, "/") {
		escaped = "/" + escaped
	}
	return base + escaped
}

func parseCOSLastModified(raw string) time.Time {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return time.Time{}
	}
	for _, layout := range lastModifiedLayouts {
		if t, err := time.Parse(layout, raw); err == nil {
			return t.UTC()
		}
	}
	return time.Time{}
}

// parseUploadTimeFromKey prefers PicGo-style timestamps in the object basename
// (e.g. obsidian/20231002222829.png or …29123.png with millis).
func parseUploadTimeFromKey(key string) time.Time {
	name := path.Base(key)
	if decoded, err := url.PathUnescape(name); err == nil {
		name = decoded
	}
	// Strip extension for cleaner matching.
	if i := strings.LastIndex(name, "."); i > 0 {
		name = name[:i]
	}

	m := picGoTimestampRe.FindStringSubmatch(name)
	if m == nil {
		return time.Time{}
	}

	secPart := m[1]
	millisPart := m[2]
	t, err := time.ParseInLocation("20060102150405", secPart, time.Local)
	if err != nil {
		return time.Time{}
	}
	if millisPart != "" {
		padded := millisPart
		for len(padded) < 3 {
			padded += "0"
		}
		var ms int
		fmt.Sscanf(padded[:3], "%d", &ms)
		t = t.Add(time.Duration(ms) * time.Millisecond)
	}
	return t
}
