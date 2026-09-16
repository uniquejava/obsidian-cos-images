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
	// Vault / Obsidian COS (Images, Orphans, vault URL matching).
	COSBucket  string   `json:"cosBucket"`
	COSRegion  string   `json:"cosRegion"`
	COSPrefix  string   `json:"cosPrefix"` // e.g. "obsidian/"
	COSBaseURL string   `json:"cosBaseURL"`
	VaultPaths []string `json:"vaultPaths"`
	// VaultPathErrors are non-fatal startup checks (bad roots, missing .obsidian/).
	VaultPathErrors []string `json:"vaultPathErrors"`
	ShowThumbnails  bool     `json:"showThumbnails"`
	// Browse COS is a separate bucket for the Browse tab (preview only; no vault).
	BrowseCOSBucket  string `json:"browseCosBucket"`
	BrowseCOSRegion  string `json:"browseCosRegion"`
	BrowseCOSBaseURL string `json:"browseCosBaseURL"`
	// SecretID is returned so Settings can prefill; SecretKey is never returned.
	SecretID     string `json:"secretId"`
	SecretIDSet  bool   `json:"secretIdSet"`
	SecretKeySet bool   `json:"secretKeySet"`
}

// COSSettings is the writable Vault/Obsidian COS identity from the Settings UI.
// Empty SecretKey means leave the existing stored key unchanged.
type COSSettings struct {
	SecretID   string `json:"secretId"`
	SecretKey  string `json:"secretKey"`
	COSBucket  string `json:"cosBucket"`
	COSRegion  string `json:"cosRegion"`
	COSPrefix  string `json:"cosPrefix"`
	COSBaseURL string `json:"cosBaseURL"`
}

// BrowseCOSSettings is the writable Browse-tab bucket (shares SecretId/Key with Vault COS).
type BrowseCOSSettings struct {
	COSBucket  string `json:"cosBucket"`
	COSRegion  string `json:"cosRegion"`
	COSBaseURL string `json:"cosBaseURL"`
}

// CompressOptions controls local recompression before a same-key COS overwrite.
type CompressOptions struct {
	// Quality is 1–100 (default 80). JPEG: encoder quality. PNG: pngquant max quality (TinyPNG-style).
	Quality int `json:"quality"`
	// MaxEdge is the max long-edge in pixels; 0 means no resize.
	MaxEdge int `json:"maxEdge"`
}

// COSBucketInfo is one bucket from the account-level List Buckets API.
type COSBucketInfo struct {
	Name         string `json:"name"`
	Region       string `json:"region"`
	CreationDate string `json:"creationDate,omitempty"`
}

// BrowseListing is one folder level under a COS prefix (Delimiter=/).
type BrowseListing struct {
	Prefix  string   `json:"prefix"`
	Folders []string `json:"folders"` // common prefixes (full keys, trailing /)
	// Objects are all non-directory keys in this folder (images and other files).
	Objects []ImageObject `json:"objects"`
}

// CompressPreview is a dry-run recompress result for UI comparison (no upload).
type CompressPreview struct {
	Key               string `json:"key"`
	URL               string `json:"url"`
	OriginalSize      int64  `json:"originalSize"`
	CompressedSize    int64  `json:"compressedSize"`
	CompressedDataURL string `json:"compressedDataURL"`
	Width             int    `json:"width"`
	Height            int    `json:"height"`
	Format            string `json:"format"` // jpeg | png
	Quality           int    `json:"quality"`
	MaxEdge           int    `json:"maxEdge"`
	// Smaller is false when compressed size is not strictly less than original.
	Smaller bool   `json:"smaller"`
	Message string `json:"message"`
}
