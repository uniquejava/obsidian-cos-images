package main

import (
	"fmt"
	"path/filepath"
	"sort"
	"strings"
)

// CleanupService finds unused images and previews cascade deletes for notes.
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

// PreviewCascadeDelete lists images tied to a note (and which are shared elsewhere).
func (s *CleanupService) PreviewCascadeDelete(notePath string) (CascadeDeletePreview, error) {
	absNote, err := filepath.Abs(strings.TrimSpace(notePath))
	if err != nil {
		return CascadeDeletePreview{}, fmt.Errorf("resolve note path: %w", err)
	}

	cfg := loadRuntimeConfig()
	refs, err := scanVaultReferences(cfg.VaultPaths, cfg.COSBaseURL)
	if err != nil {
		return CascadeDeletePreview{}, err
	}

	images, err := NewCOSService().ListImages()
	if err != nil {
		return CascadeDeletePreview{}, err
	}
	byKey := make(map[string]ImageObject, len(images))
	for _, img := range images {
		byKey[img.Key] = img
	}

	var unique []ImageObject
	var shared []ImageRef
	for key, acc := range refs {
		if _, ok := acc.Notes[absNote]; !ok {
			continue
		}
		img, onCOS := byKey[key]
		if !onCOS {
			img = ImageObject{
				Key: key,
				URL: acc.URL,
			}
		}
		if len(acc.Notes) == 1 {
			unique = append(unique, img)
			continue
		}
		notes := notesForKey(refs, key)
		shared = append(shared, ImageRef{
			URL:   acc.URL,
			Key:   key,
			Notes: notes,
		})
	}

	sort.Slice(unique, func(i, j int) bool { return unique[i].Key < unique[j].Key })
	sort.Slice(shared, func(i, j int) bool { return shared[i].Key < shared[j].Key })

	return CascadeDeletePreview{
		NotePath:             absNote,
		Images:               unique,
		SharedWithOtherNotes: shared,
	}, nil
}

// CascadeDeleteNoteImages deletes images that are only used by the given note.
// Shared images must not be deleted unless forceUniqueOnly is false (dangerous).
func (s *CleanupService) CascadeDeleteNoteImages(notePath string, forceUniqueOnly bool) error {
	preview, err := s.PreviewCascadeDelete(notePath)
	if err != nil {
		return err
	}

	keys := make([]string, 0, len(preview.Images))
	for _, img := range preview.Images {
		keys = append(keys, img.Key)
	}
	if !forceUniqueOnly {
		for _, ref := range preview.SharedWithOtherNotes {
			keys = append(keys, ref.Key)
		}
	}
	if len(keys) == 0 {
		return nil
	}
	return NewCOSService().DeleteImages(keys)
}
