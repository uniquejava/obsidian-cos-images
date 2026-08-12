package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/joho/godotenv"
)

const (
	// Only non-identifying defaults may live in source. Account/host/paths come from .env.
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
// Vault paths and UI prefs only — no COS secrets or account identifiers.
type persistedSettings struct {
	VaultPaths     []string `json:"vaultPaths,omitempty"`
	ShowThumbnails bool     `json:"showThumbnails"`
}

func loadRuntimeConfig() runtimeConfig {
	secretID := strings.TrimSpace(os.Getenv("COS_SECRET_ID"))
	secretKey := strings.TrimSpace(os.Getenv("COS_SECRET_KEY"))

	bucket := strings.TrimSpace(os.Getenv("COS_BUCKET"))
	region := strings.TrimSpace(os.Getenv("COS_REGION"))
	prefix := envOr("COS_PREFIX", defaultCOSPrefix)
	baseURL := strings.TrimRight(strings.TrimSpace(os.Getenv("COS_BASE_URL")), "/")

	settings, _ := loadPersistedSettings()
	vaultPaths := settings.VaultPaths
	if len(vaultPaths) == 0 {
		vaultPaths = parseVaultPaths(os.Getenv("VAULT_PATHS"))
	}

	return runtimeConfig{
		AppConfig: AppConfig{
			COSBucket:      bucket,
			COSRegion:      region,
			COSPrefix:      prefix,
			COSBaseURL:     baseURL,
			VaultPaths:     vaultPaths,
			ShowThumbnails: settings.ShowThumbnails,
			SecretIDSet:    secretID != "",
			SecretKeySet:   secretKey != "",
		},
		SecretID:  secretID,
		SecretKey: secretKey,
	}
}

// requireCOSEnv returns an error if required COS identity env vars are missing.
func requireCOSEnv(cfg runtimeConfig) error {
	var missing []string
	if cfg.SecretID == "" {
		missing = append(missing, "COS_SECRET_ID")
	}
	if cfg.SecretKey == "" {
		missing = append(missing, "COS_SECRET_KEY")
	}
	if cfg.COSBucket == "" {
		missing = append(missing, "COS_BUCKET")
	}
	if cfg.COSRegion == "" {
		missing = append(missing, "COS_REGION")
	}
	if cfg.COSBaseURL == "" {
		missing = append(missing, "COS_BASE_URL")
	}
	if len(missing) == 0 {
		return nil
	}
	return fmt.Errorf("%w: set %s in .env (see .env.example)", ErrMissingCredentials, strings.Join(missing, ", "))
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
	return settings, nil
}

func savePersistedSettings(settings persistedSettings) error {
	settings.VaultPaths = cleanPaths(settings.VaultPaths)
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
	return os.WriteFile(path, data, 0o644)
}

func savePersistedVaultPaths(paths []string) error {
	cleaned := cleanPaths(paths)
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

func envOr(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
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
