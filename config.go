package main

import (
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/joho/godotenv"
)

const (
	// Only non-identifying defaults may live in source. Account/host/paths come from
	// Settings (persisted) or optional .env for development.
	defaultCOSPrefix  = "obsidian/"
	appConfigDirName  = "obsidian-cos-images"
	appConfigFileName = "config.json"
)

// loadDotEnv loads a local .env if present (no error when missing).
func loadDotEnv() {
	_ = godotenv.Load()
}

type runtimeConfig struct {
	AppConfig
	SecretID  string
	SecretKey string
}

// persistedSettings is stored under the OS user config directory (never committed).
// Includes COS identity so packaged installs can configure without a .env file.
type persistedSettings struct {
	SecretID       string   `json:"secretId,omitempty"`
	SecretKey      string   `json:"secretKey,omitempty"`
	COSBucket      string   `json:"cosBucket,omitempty"`
	COSRegion      string   `json:"cosRegion,omitempty"`
	COSPrefix      string   `json:"cosPrefix,omitempty"`
	COSBaseURL     string   `json:"cosBaseURL,omitempty"`
	VaultPaths     []string `json:"vaultPaths,omitempty"`
	ShowThumbnails bool     `json:"showThumbnails"`
}

func loadRuntimeConfig() runtimeConfig {
	settings, _ := loadPersistedSettings()

	// Persisted Settings win; env fills empty fields (dev convenience).
	secretID := firstNonEmpty(settings.SecretID, os.Getenv("COS_SECRET_ID"))
	secretKey := firstNonEmpty(settings.SecretKey, os.Getenv("COS_SECRET_KEY"))
	bucket := firstNonEmpty(settings.COSBucket, os.Getenv("COS_BUCKET"))
	region := firstNonEmpty(settings.COSRegion, os.Getenv("COS_REGION"))
	prefix := firstNonEmpty(settings.COSPrefix, os.Getenv("COS_PREFIX"))
	if prefix == "" {
		prefix = defaultCOSPrefix
	}
	baseURL := strings.TrimRight(
		firstNonEmpty(settings.COSBaseURL, os.Getenv("COS_BASE_URL")),
		"/",
	)

	vaultPaths := settings.VaultPaths
	if len(vaultPaths) == 0 {
		vaultPaths = parseVaultPaths(os.Getenv("VAULT_PATHS"))
	}
	vaultPaths = cleanPaths(vaultPaths)
	_, vaultPathErrors := validateVaultRoots(vaultPaths)

	return runtimeConfig{
		AppConfig: AppConfig{
			COSBucket:       bucket,
			COSRegion:       region,
			COSPrefix:       prefix,
			COSBaseURL:      baseURL,
			VaultPaths:      vaultPaths,
			VaultPathErrors: vaultPathErrors,
			ShowThumbnails:  settings.ShowThumbnails,
			SecretID:        secretID,
			SecretIDSet:     secretID != "",
			SecretKeySet:    secretKey != "",
		},
		SecretID:  secretID,
		SecretKey: secretKey,
	}
}

// requireCOSEnv returns an error if required COS identity is missing.
func requireCOSEnv(cfg runtimeConfig) error {
	var missing []string
	if cfg.SecretID == "" {
		missing = append(missing, "SecretId")
	}
	if cfg.SecretKey == "" {
		missing = append(missing, "SecretKey")
	}
	if cfg.COSBucket == "" {
		missing = append(missing, "Bucket")
	}
	if cfg.COSRegion == "" {
		missing = append(missing, "Region")
	}
	if cfg.COSBaseURL == "" {
		missing = append(missing, "Base URL")
	}
	if len(missing) == 0 {
		return nil
	}
	return fmt.Errorf("%w: set %s in Settings (or .env for local dev)", ErrMissingCredentials, strings.Join(missing, ", "))
}

// configFilePathOverride is used by tests; empty means use the real user config dir.
var configFilePathOverride string

// thumbnailCacheDirOverride is used by tests.
var thumbnailCacheDirOverride string

func configFilePath() (string, error) {
	if configFilePathOverride != "" {
		return configFilePathOverride, nil
	}
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, appConfigDirName, appConfigFileName), nil
}

func loadPersistedSettings() (persistedSettings, error) {
	path, err := configFilePath()
	if err != nil {
		return persistedSettings{}, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return persistedSettings{}, nil
		}
		return persistedSettings{}, err
	}
	var settings persistedSettings
	if err := json.Unmarshal(data, &settings); err != nil {
		return persistedSettings{}, fmt.Errorf("parse config %s: %w", path, err)
	}
	settings.VaultPaths = cleanPaths(settings.VaultPaths)
	settings.SecretID = strings.TrimSpace(settings.SecretID)
	settings.SecretKey = strings.TrimSpace(settings.SecretKey)
	settings.COSBucket = strings.TrimSpace(settings.COSBucket)
	settings.COSRegion = strings.TrimSpace(settings.COSRegion)
	settings.COSPrefix = strings.TrimSpace(settings.COSPrefix)
	settings.COSBaseURL = strings.TrimRight(strings.TrimSpace(settings.COSBaseURL), "/")
	return settings, nil
}

func savePersistedSettings(settings persistedSettings) error {
	settings.VaultPaths = cleanPaths(settings.VaultPaths)
	settings.SecretID = strings.TrimSpace(settings.SecretID)
	settings.SecretKey = strings.TrimSpace(settings.SecretKey)
	settings.COSBucket = strings.TrimSpace(settings.COSBucket)
	settings.COSRegion = strings.TrimSpace(settings.COSRegion)
	settings.COSPrefix = strings.TrimSpace(settings.COSPrefix)
	settings.COSBaseURL = strings.TrimRight(strings.TrimSpace(settings.COSBaseURL), "/")
	path, err := configFilePath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return err
	}
	// Restrictive mode: file may contain COS secrets.
	return os.WriteFile(path, data, 0o600)
}

func saveCOSSettings(in COSSettings) error {
	cfg, err := resolveCOSIdentity(in)
	if err != nil {
		return err
	}
	settings, err := loadPersistedSettings()
	if err != nil {
		return err
	}
	settings.SecretID = cfg.SecretID
	settings.SecretKey = cfg.SecretKey
	settings.COSBucket = cfg.COSBucket
	settings.COSRegion = cfg.COSRegion
	settings.COSPrefix = cfg.COSPrefix
	settings.COSBaseURL = cfg.COSBaseURL
	return savePersistedSettings(settings)
}

// resolveCOSIdentity builds a runtime COS identity from Settings form input.
// Empty SecretKey keeps the previously saved (or env) key. Does not persist.
func resolveCOSIdentity(in COSSettings) (runtimeConfig, error) {
	secretID := strings.TrimSpace(in.SecretID)
	secretKey := strings.TrimSpace(in.SecretKey)
	bucket := strings.TrimSpace(in.COSBucket)
	region := strings.TrimSpace(in.COSRegion)
	prefix := strings.TrimSpace(in.COSPrefix)
	if prefix == "" {
		prefix = defaultCOSPrefix
	}
	baseURL := strings.TrimRight(strings.TrimSpace(in.COSBaseURL), "/")

	if secretKey == "" {
		settings, _ := loadPersistedSettings()
		secretKey = settings.SecretKey
	}
	if secretKey == "" {
		secretKey = strings.TrimSpace(os.Getenv("COS_SECRET_KEY"))
	}

	var missing []string
	if secretID == "" {
		missing = append(missing, "SecretId")
	}
	if secretKey == "" {
		missing = append(missing, "SecretKey")
	}
	if bucket == "" {
		missing = append(missing, "Bucket")
	}
	if region == "" {
		missing = append(missing, "Region")
	}
	if baseURL == "" {
		missing = append(missing, "Base URL")
	}
	if len(missing) > 0 {
		return runtimeConfig{}, fmt.Errorf("missing required fields: %s", strings.Join(missing, ", "))
	}

	u, err := url.Parse(baseURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return runtimeConfig{}, fmt.Errorf("Base URL must be an absolute http(s) URL")
	}

	return runtimeConfig{
		AppConfig: AppConfig{
			COSBucket:    bucket,
			COSRegion:    region,
			COSPrefix:    prefix,
			COSBaseURL:   baseURL,
			SecretID:     secretID,
			SecretIDSet:  true,
			SecretKeySet: true,
		},
		SecretID:  secretID,
		SecretKey: secretKey,
	}, nil
}

func savePersistedVaultPaths(paths []string) error {
	cleaned, errs := validateVaultRoots(paths)
	if len(errs) > 0 {
		return fmt.Errorf("%s", strings.Join(errs, "; "))
	}
	if len(cleaned) == 0 {
		return fmt.Errorf("at least one vault path is required")
	}
	settings, err := loadPersistedSettings()
	if err != nil {
		return err
	}
	settings.VaultPaths = cleaned
	return savePersistedSettings(settings)
}

func saveShowThumbnails(enabled bool) error {
	settings, err := loadPersistedSettings()
	if err != nil {
		return err
	}
	settings.ShowThumbnails = enabled
	return savePersistedSettings(settings)
}

func cleanPaths(paths []string) []string {
	out := make([]string, 0, len(paths))
	seen := make(map[string]struct{}, len(paths))
	for _, p := range paths {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		if abs, err := filepath.Abs(p); err == nil {
			p = abs
		}
		if _, exists := seen[p]; exists {
			continue
		}
		seen[p] = struct{}{}
		out = append(out, p)
	}
	return out
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if s := strings.TrimSpace(v); s != "" {
			return s
		}
	}
	return ""
}

func parseVaultPaths(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}
