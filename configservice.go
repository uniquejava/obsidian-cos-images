package main

import (
	"fmt"
)

// ConfigService exposes local app settings to the UI.
// SecretKey is never returned after save; only a set/unset flag is exposed.
type ConfigService struct{}

func NewConfigService() *ConfigService {
	return &ConfigService{}
}

// GetConfig returns current config from persisted settings / optional env (no SecretKey).
func (s *ConfigService) GetConfig() (AppConfig, error) {
	return loadRuntimeConfig().AppConfig, nil
}

// SaveCOSSettings persists COS identity for packaged installs (Settings UI).
// Empty SecretKey keeps the previously saved key.
func (s *ConfigService) SaveCOSSettings(settings COSSettings) error {
	if err := saveCOSSettings(settings); err != nil {
		return fmt.Errorf("save COS settings: %w", err)
	}
	return nil
}

// SaveVaultPaths updates which vault roots are scanned for Markdown references.
// Paths are persisted under the user config directory.
func (s *ConfigService) SaveVaultPaths(paths []string) error {
	if err := savePersistedVaultPaths(paths); err != nil {
		return fmt.Errorf("save vault paths: %w", err)
	}
	return nil
}

// SaveShowThumbnails persists whether the UI should load/cached thumbnails.
// Default is off to avoid COS egress until the user opts in.
func (s *ConfigService) SaveShowThumbnails(enabled bool) error {
	if err := saveShowThumbnails(enabled); err != nil {
		return fmt.Errorf("save showThumbnails: %w", err)
	}
	return nil
}

// ConfigFilePath returns where settings are stored (for UI display).
func (s *ConfigService) ConfigFilePath() (string, error) {
	return configFilePath()
}
