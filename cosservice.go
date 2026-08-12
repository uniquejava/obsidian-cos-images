package main

import (
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
	if cfg.SecretID == "" || cfg.SecretKey == "" {
		return nil, fmt.Errorf("%w: set COS_SECRET_ID and COS_SECRET_KEY (see .env.example)", ErrMissingCredentials)
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
	if cfg.SecretID == "" || cfg.SecretKey == "" {
		return fmt.Errorf("%w: set COS_SECRET_ID and COS_SECRET_KEY (see .env.example)", ErrMissingCredentials)
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
