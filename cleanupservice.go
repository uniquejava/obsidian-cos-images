package main

// CleanupService finds unused images and previews cascade deletes for notes.
type CleanupService struct{}

func NewCleanupService() *CleanupService {
	return &CleanupService{}
}

// ListOrphans returns COS images not referenced by any scanned Markdown file.
func (s *CleanupService) ListOrphans() ([]OrphanImage, error) {
	return nil, ErrNotImplemented
}

// PreviewCascadeDelete lists images tied to a note (and which are shared elsewhere).
func (s *CleanupService) PreviewCascadeDelete(notePath string) (CascadeDeletePreview, error) {
	_ = notePath
	return CascadeDeletePreview{}, ErrNotImplemented
}

// CascadeDeleteNoteImages deletes images that are only used by the given note.
// Shared images must not be deleted unless forceUniqueOnly is false (dangerous).
func (s *CleanupService) CascadeDeleteNoteImages(notePath string, forceUniqueOnly bool) error {
	_, _ = notePath, forceUniqueOnly
	return ErrNotImplemented
}
