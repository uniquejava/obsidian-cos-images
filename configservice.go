package main

// ConfigService exposes local app settings to the UI.
// Credentials stay in env / local config file; only non-secret status is returned.
type ConfigService struct{}

func NewConfigService() *ConfigService {
	return &ConfigService{}
}

// GetConfig returns current config (stubs until implementation).
func (s *ConfigService) GetConfig() (AppConfig, error) {
	return AppConfig{
		COSBucket:  "REDACTED_BUCKET",
		COSRegion:  "ap-shanghai",
		COSPrefix:  "obsidian/",
		COSBaseURL: "https://example-bucket.cos.ap-testing.myqcloud.com",
		VaultPaths: []string{
			// Default Obsidian iCloud container; UI should allow editing.
			"",
		},
	}, nil
}

// SaveVaultPaths updates which vault roots are scanned for Markdown references.
func (s *ConfigService) SaveVaultPaths(paths []string) error {
	_ = paths
	return ErrNotImplemented
}
