package main

import (
	"net/url"
	"regexp"
	"strings"
)

// cosURLRe matches http(s) URLs pointing at the configured COS host.
// Host is injected at runtime via newCOSURLMatcher.
var cosURLPathRe = regexp.MustCompile(`(?i)https?://([^/\s"'<>\)]+)/([^\s"'<>\)]+)`)

type cosURLMatcher struct {
	host    string // lower-case host from COS_BASE_URL
	baseURL string
}

func newCOSURLMatcher(baseURL string) cosURLMatcher {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	host := ""
	if u, err := url.Parse(baseURL); err == nil {
		host = strings.ToLower(u.Host)
	}
	return cosURLMatcher{host: host, baseURL: baseURL}
}

// extractCOSURLs finds managed COS image URLs in Markdown / HTML content.
func (m cosURLMatcher) extractCOSURLs(content string) []string {
	if m.host == "" {
		return nil
	}
	seen := make(map[string]struct{})
	var out []string
	for _, match := range cosURLPathRe.FindAllStringSubmatch(content, -1) {
		raw := match[0]
		// Trim trailing punctuation commonly stuck to URLs in prose.
		raw = strings.TrimRight(raw, ".,;:!?")
		key, ok := m.keyFromURL(raw)
		if !ok {
			continue
		}
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, joinCOSURL(m.baseURL, key))
	}
	return out
}

// keyFromURLOrKey normalizes a full COS URL or object key to a decoded key.
func (m cosURLMatcher) keyFromURLOrKey(urlOrKey string) (string, bool) {
	s := strings.TrimSpace(urlOrKey)
	if s == "" {
		return "", false
	}
	if strings.Contains(s, "://") {
		return m.keyFromURL(s)
	}
	key := strings.TrimPrefix(s, "/")
	if decoded, err := url.PathUnescape(key); err == nil {
		key = decoded
	}
	return key, key != ""
}

func (m cosURLMatcher) keyFromURL(raw string) (string, bool) {
	u, err := url.Parse(raw)
	if err != nil {
		return "", false
	}
	if strings.ToLower(u.Host) != m.host {
		return "", false
	}
	key := strings.TrimPrefix(u.Path, "/")
	if key == "" {
		return "", false
	}
	if decoded, err := url.PathUnescape(key); err == nil {
		key = decoded
	}
	// Drop query/fragment by using Path only (already done).
	return key, true
}
