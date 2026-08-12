package main

// VaultService scans Obsidian Markdown files for COS image URLs.
type VaultService struct{}

func NewVaultService() *VaultService {
	return &VaultService{}
}

// ScanReferences walks configured vault paths and maps image URL → note paths.
func (s *VaultService) ScanReferences() ([]ImageRef, error) {
	return nil, ErrNotImplemented
}

// FindNotesUsing returns Markdown files that reference the given image URL or key.
func (s *VaultService) FindNotesUsing(urlOrKey string) ([]string, error) {
	_ = urlOrKey
	return nil, ErrNotImplemented
}
