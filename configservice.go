package main

import (
	"fmt"
)

// ConfigService exposes local app settings to the UI.
// Credentials stay in env / local config file; only non-secret status is returned.
type ConfigService struct{}

func NewConfigService() *ConfigService {
	return &ConfigService{}
}

// GetConfig returns current config from env / persisted settings (no secrets).
func (s *ConfigService) GetConfig() (AppConfig, error) {
	return loadRuntimeConfig().AppConfig, nil
}

// SaveVaultPaths updates which vault roots are scanned for Markdown references.
// Paths are persisted under the user config directory.
func (s *ConfigService) SaveVaultPaths(paths []string) error {
	if err := savePersistedVaultPaths(paths); err != nil {
		return fmt.Errorf("save vault paths: %w", err)
	}
	return nil
}

// ConfigFilePath returns where vault settings are stored (for UI display).
func (s *ConfigService) ConfigFilePath() (string, error) {
	return configFilePath()
}
