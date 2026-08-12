package main

import "time"

// ImageObject is one object in Tencent COS (PicGo uploads).
type ImageObject struct {
	Key          string    `json:"key"`
	URL          string    `json:"url"`
	Size         int64     `json:"size"` // bytes
	LastModified time.Time `json:"lastModified"`
	// UploadTime prefers timestamp parsed from PicGo key name
	// (e.g. obsidian/20231002222829.png); falls back to LastModified.
	UploadTime time.Time `json:"uploadTime"`
}

// ImageRef links a COS image URL to Markdown files that reference it.
type ImageRef struct {
	URL   string   `json:"url"`
	Key   string   `json:"key"`
	Notes []string `json:"notes"` // absolute or vault-relative .md paths
}

// OrphanImage is on COS but not referenced by any scanned Markdown file.
type OrphanImage struct {
	ImageObject
}

// AppConfig is local settings (loaded from env / config file; never commit secrets).
type AppConfig struct {
	COSBucket      string   `json:"cosBucket"`
	COSRegion      string   `json:"cosRegion"`
	COSPrefix      string   `json:"cosPrefix"` // e.g. "obsidian/"
	COSBaseURL     string   `json:"cosBaseURL"`
	VaultPaths     []string `json:"vaultPaths"`
	ShowThumbnails bool     `json:"showThumbnails"`
	SecretIDSet    bool     `json:"secretIdSet"`
	SecretKeySet   bool     `json:"secretKeySet"`
}
