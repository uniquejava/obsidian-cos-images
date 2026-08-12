package main

import (
	"os"
	"strings"

	"github.com/joho/godotenv"
)

const (
	defaultCOSBucket  = "REDACTED_BUCKET"
	defaultCOSRegion  = "ap-shanghai"
	defaultCOSPrefix  = "obsidian/"
	defaultCOSBaseURL = "https://example-bucket.cos.ap-testing.myqcloud.com"
	defaultVaultPath  = ""
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

func loadRuntimeConfig() runtimeConfig {
	secretID := strings.TrimSpace(os.Getenv("COS_SECRET_ID"))
	secretKey := strings.TrimSpace(os.Getenv("COS_SECRET_KEY"))

	bucket := envOr("COS_BUCKET", defaultCOSBucket)
	region := envOr("COS_REGION", defaultCOSRegion)
	prefix := envOr("COS_PREFIX", defaultCOSPrefix)
	baseURL := strings.TrimRight(envOr("COS_BASE_URL", defaultCOSBaseURL), "/")

	vaultPaths := parseVaultPaths(os.Getenv("VAULT_PATHS"))
	if len(vaultPaths) == 0 {
		vaultPaths = []string{defaultVaultPath}
	}

	return runtimeConfig{
		AppConfig: AppConfig{
			COSBucket:    bucket,
			COSRegion:    region,
			COSPrefix:    prefix,
			COSBaseURL:   baseURL,
			VaultPaths:   vaultPaths,
			SecretIDSet:  secretID != "",
			SecretKeySet: secretKey != "",
		},
		SecretID:  secretID,
		SecretKey: secretKey,
	}
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
