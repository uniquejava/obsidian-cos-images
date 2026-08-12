package main

// COSService lists and deletes objects on Tencent Cloud COS.
type COSService struct{}

func NewCOSService() *COSService {
	return &COSService{}
}

// ListImages returns objects under the configured prefix, newest upload first.
func (s *COSService) ListImages() ([]ImageObject, error) {
	return nil, ErrNotImplemented
}

// DeleteImages deletes COS objects by key. Prefer dry-run / confirm in UI first.
func (s *COSService) DeleteImages(keys []string) error {
	_ = keys
	return ErrNotImplemented
}
