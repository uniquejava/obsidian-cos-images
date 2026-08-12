package main

// ConfigService exposes local app settings to the UI.
// Credentials stay in env / local config file; only non-secret status is returned.
type ConfigService struct{}

func NewConfigService() *ConfigService {
	return &ConfigService{}
}

// GetConfig returns current config from env / .env (no secrets).
func (s *ConfigService) GetConfig() (AppConfig, error) {
	return loadRuntimeConfig().AppConfig, nil
}

// SaveVaultPaths updates which vault roots are scanned for Markdown references.
func (s *ConfigService) SaveVaultPaths(paths []string) error {
	_ = paths
	return ErrNotImplemented
}
