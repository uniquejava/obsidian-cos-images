package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSaveAndLoadVaultPaths(t *testing.T) {
	tmp := t.TempDir()
	configFilePathOverride = filepath.Join(tmp, "config.json")
	t.Cleanup(func() { configFilePathOverride = "" })

	paths := []string{filepath.Join(tmp, "vault-a"), filepath.Join(tmp, "vault-b")}
	for _, p := range paths {
		if err := os.MkdirAll(filepath.Join(p, ".obsidian"), 0o755); err != nil {
			t.Fatal(err)
		}
	}

	if err := savePersistedVaultPaths(paths); err != nil {
		t.Fatal(err)
	}
	settings, err := loadPersistedSettings()
	if err != nil {
		t.Fatal(err)
	}
	if len(settings.VaultPaths) != 2 {
		t.Fatalf("got %v", settings.VaultPaths)
	}
	if settings.ShowThumbnails {
		t.Fatal("ShowThumbnails should default false")
	}

	if err := saveShowThumbnails(true); err != nil {
		t.Fatal(err)
	}
	cfg := loadRuntimeConfig()
	if len(cfg.VaultPaths) != 2 {
		t.Fatalf("runtime vault paths = %v", cfg.VaultPaths)
	}
	if len(cfg.VaultPathErrors) != 0 {
		t.Fatalf("unexpected vault path errors: %v", cfg.VaultPathErrors)
	}
	if !cfg.ShowThumbnails {
		t.Fatal("expected ShowThumbnails true after save")
	}
}

func TestSaveAndLoadCOSSettings(t *testing.T) {
	tmp := t.TempDir()
	configFilePathOverride = filepath.Join(tmp, "config.json")
	t.Cleanup(func() {
		configFilePathOverride = ""
		os.Unsetenv("COS_SECRET_ID")
		os.Unsetenv("COS_SECRET_KEY")
		os.Unsetenv("COS_BUCKET")
		os.Unsetenv("COS_REGION")
		os.Unsetenv("COS_BASE_URL")
		os.Unsetenv("COS_PREFIX")
	})

	if err := saveCOSSettings(COSSettings{
		SecretID:   "AKID-test",
		SecretKey:  "secret-value",
		COSBucket:  "demo-123",
		COSRegion:  "ap-shanghai",
		COSPrefix:  "obsidian/",
		COSBaseURL: "https://example.cos.ap-shanghai.myqcloud.com/",
	}); err != nil {
		t.Fatal(err)
	}

	path := filepath.Join(tmp, "config.json")
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("config mode = %o, want 0600", info.Mode().Perm())
	}

	cfg := loadRuntimeConfig()
	if cfg.SecretID != "AKID-test" || !cfg.SecretIDSet || !cfg.SecretKeySet {
		t.Fatalf("secret flags/id: id=%q set=%v keySet=%v", cfg.SecretID, cfg.SecretIDSet, cfg.SecretKeySet)
	}
	if cfg.COSBucket != "demo-123" || cfg.COSRegion != "ap-shanghai" {
		t.Fatalf("bucket/region: %q %q", cfg.COSBucket, cfg.COSRegion)
	}
	if cfg.COSBaseURL != "https://example.cos.ap-shanghai.myqcloud.com" {
		t.Fatalf("base URL = %q", cfg.COSBaseURL)
	}
	if cfg.SecretKey != "secret-value" {
		t.Fatal("runtime SecretKey mismatch")
	}
	// AppConfig must not expose SecretKey via JSON field — only runtimeConfig has it.
	if cfg.AppConfig.SecretID != "AKID-test" {
		t.Fatal("expected SecretID on AppConfig for Settings prefilling")
	}

	// Blank SecretKey keeps previous value.
	if err := saveCOSSettings(COSSettings{
		SecretID:   "AKID-test-2",
		SecretKey:  "",
		COSBucket:  "demo-123",
		COSRegion:  "ap-shanghai",
		COSPrefix:  "pics/",
		COSBaseURL: "https://example.cos.ap-shanghai.myqcloud.com",
	}); err != nil {
		t.Fatal(err)
	}
	cfg = loadRuntimeConfig()
	if cfg.SecretID != "AKID-test-2" {
		t.Fatalf("secret id = %q", cfg.SecretID)
	}
	if cfg.SecretKey != "secret-value" {
		t.Fatalf("secret key should be preserved, got %q", cfg.SecretKey)
	}
	if cfg.COSPrefix != "pics/" {
		t.Fatalf("prefix = %q", cfg.COSPrefix)
	}
}

func TestPersistedOverridesEnv(t *testing.T) {
	tmp := t.TempDir()
	configFilePathOverride = filepath.Join(tmp, "config.json")
	t.Cleanup(func() {
		configFilePathOverride = ""
		os.Unsetenv("COS_BUCKET")
	})

	t.Setenv("COS_BUCKET", "from-env")
	if err := saveCOSSettings(COSSettings{
		SecretID:   "id",
		SecretKey:  "key",
		COSBucket:  "from-ui",
		COSRegion:  "ap-beijing",
		COSPrefix:  "obsidian/",
		COSBaseURL: "https://ui.example.com",
	}); err != nil {
		t.Fatal(err)
	}
	cfg := loadRuntimeConfig()
	if cfg.COSBucket != "from-ui" {
		t.Fatalf("expected persisted to win, got %q", cfg.COSBucket)
	}
}

func TestEnvFillsWhenPersistedEmpty(t *testing.T) {
	tmp := t.TempDir()
	configFilePathOverride = filepath.Join(tmp, "config.json")
	t.Cleanup(func() { configFilePathOverride = "" })

	t.Setenv("COS_SECRET_ID", "env-id")
	t.Setenv("COS_SECRET_KEY", "env-key")
	t.Setenv("COS_BUCKET", "env-bucket")
	t.Setenv("COS_REGION", "ap-guangzhou")
	t.Setenv("COS_BASE_URL", "https://env.example.com")
	t.Setenv("COS_PREFIX", "env/")

	cfg := loadRuntimeConfig()
	if cfg.SecretID != "env-id" || cfg.COSBucket != "env-bucket" || cfg.COSPrefix != "env/" {
		t.Fatalf("env fallback failed: %+v", cfg.AppConfig)
	}
	if err := requireCOSEnv(cfg); err != nil {
		t.Fatal(err)
	}
}

func TestResolveCOSIdentityRejectsBadBaseURL(t *testing.T) {
	tmp := t.TempDir()
	configFilePathOverride = filepath.Join(tmp, "config.json")
	t.Cleanup(func() { configFilePathOverride = "" })

	_, err := resolveCOSIdentity(COSSettings{
		SecretID:   "id",
		SecretKey:  "key",
		COSBucket:  "b",
		COSRegion:  "ap-shanghai",
		COSPrefix:  "obsidian/",
		COSBaseURL: "not-a-url",
	})
	if err == nil {
		t.Fatal("expected bad Base URL error")
	}
}

func TestThumbnailCacheRoundTrip(t *testing.T) {
	tmp := t.TempDir()
	thumbnailCacheDirOverride = tmp
	t.Cleanup(func() { thumbnailCacheDirOverride = "" })

	key := "obsidian/demo.png"
	path, err := thumbnailCachePath(key)
	if err != nil {
		t.Fatal(err)
	}
	payload := []byte("fake-thumb-bytes")
	if err := os.WriteFile(path, payload, 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := getOrFetchThumbnail(key)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(payload) {
		t.Fatalf("cache miss? got %q", got)
	}
}

func TestExportOrphansCSVHeader(t *testing.T) {
	csv, err := exportOrphansCSV(nil)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(csv, "key,url,size,uploadTime,lastModified") {
		t.Fatalf("unexpected csv: %q", csv)
	}
}
