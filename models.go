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

// AppConfig is local settings for the UI (SecretKey is never included).
type AppConfig struct {
	COSBucket  string   `json:"cosBucket"`
	COSRegion  string   `json:"cosRegion"`
	COSPrefix  string   `json:"cosPrefix"` // e.g. "obsidian/"
	COSBaseURL string   `json:"cosBaseURL"`
	VaultPaths []string `json:"vaultPaths"`
	// VaultPathErrors are non-fatal startup checks (bad roots, missing .obsidian/).
	VaultPathErrors []string `json:"vaultPathErrors"`
	ShowThumbnails  bool     `json:"showThumbnails"`
	// SecretID is returned so Settings can prefill; SecretKey is never returned.
	SecretID     string `json:"secretId"`
	SecretIDSet  bool   `json:"secretIdSet"`
	SecretKeySet bool   `json:"secretKeySet"`
}

// COSSettings is the writable COS identity from the Settings UI.
// Empty SecretKey means leave the existing stored key unchanged.
type COSSettings struct {
	SecretID   string `json:"secretId"`
	SecretKey  string `json:"secretKey"`
	COSBucket  string `json:"cosBucket"`
	COSRegion  string `json:"cosRegion"`
	COSPrefix  string `json:"cosPrefix"`
	COSBaseURL string `json:"cosBaseURL"`
}
