package main

import (
	"bytes"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// ExportOrphans returns an orphan report as CSV or JSON text (dry-run friendly).
// format: "csv" or "json" (case-insensitive).
func (s *CleanupService) ExportOrphans(format string) (string, error) {
	orphans, err := s.ListOrphans()
	if err != nil {
		return "", err
	}
	switch strings.ToLower(strings.TrimSpace(format)) {
	case "json":
		return exportOrphansJSON(orphans)
	case "csv", "":
		return exportOrphansCSV(orphans)
	default:
		return "", fmt.Errorf("unsupported export format %q (use csv or json)", format)
	}
}

func exportOrphansJSON(orphans []OrphanImage) (string, error) {
	type row struct {
		Key          string    `json:"key"`
		URL          string    `json:"url"`
		Size         int64     `json:"size"`
		UploadTime   time.Time `json:"uploadTime"`
		LastModified time.Time `json:"lastModified"`
	}
	out := make([]row, 0, len(orphans))
	var total int64
	for _, o := range orphans {
		total += o.Size
		out = append(out, row{
			Key:          o.Key,
			URL:          o.URL,
			Size:         o.Size,
			UploadTime:   o.UploadTime,
			LastModified: o.LastModified,
		})
	}
	payload := map[string]any{
		"generatedAt":      time.Now().UTC(),
		"count":            len(orphans),
		"reclaimableBytes": total,
		"orphans":          out,
	}
	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func exportOrphansCSV(orphans []OrphanImage) (string, error) {
	var buf bytes.Buffer
	w := csv.NewWriter(&buf)
	if err := w.Write([]string{"key", "url", "size", "uploadTime", "lastModified"}); err != nil {
		return "", err
	}
	for _, o := range orphans {
		if err := w.Write([]string{
			o.Key,
			o.URL,
			strconv.FormatInt(o.Size, 10),
			o.UploadTime.UTC().Format(time.RFC3339),
			o.LastModified.UTC().Format(time.RFC3339),
		}); err != nil {
			return "", err
		}
	}
	w.Flush()
	if err := w.Error(); err != nil {
		return "", err
	}
	return buf.String(), nil
}
