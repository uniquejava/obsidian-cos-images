package main

// CleanupService finds unused (orphan) COS images.
type CleanupService struct{}

func NewCleanupService() *CleanupService {
	return &CleanupService{}
}

// ListOrphans returns COS images not referenced by any scanned Markdown file.
func (s *CleanupService) ListOrphans() ([]OrphanImage, error) {
	images, err := NewCOSService().ListImages()
	if err != nil {
		return nil, err
	}
	cfg := loadRuntimeConfig()
	refs, err := scanVaultReferences(cfg.VaultPaths, cfg.COSBaseURL)
	if err != nil {
		return nil, err
	}

	orphans := make([]OrphanImage, 0)
	for _, img := range images {
		if _, used := refs[img.Key]; used {
			continue
		}
		orphans = append(orphans, OrphanImage{ImageObject: img})
	}
	return orphans, nil
}
