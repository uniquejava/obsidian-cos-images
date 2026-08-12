# Obsidian COS Images — Requirements

> Product scope (what to build / not build). For **what is already implemented**, see `AGENTS.md` Status — that file is the agent handoff source of truth.

Related context: PicGo uploads clipboard images to Tencent COS; Obsidian notes embed HTTPS URLs.

## Goal

Desktop app (Go + **Wails v3**) to manage images stored on **Tencent Cloud COS** that are referenced by **Obsidian Markdown** notes.

## Background (known facts)

| Item | Value |
|------|--------|
| COS host / base URL | `https://example-bucket.cos.ap-testing.myqcloud.com` |
| Bucket | `REDACTED_BUCKET` |
| Region | `ap-shanghai` |
| Typical object prefix | `obsidian/` |
| Key pattern | `obsidian/YYYYMMDDHHMMSS.png` (sometimes with millis / URL-encoded names) |
| Upload tool | PicGo (clipboard → COS → insert Markdown link) |
| Obsidian vaults (iCloud) | `~/Library/Mobile Documents/iCloud~md~obsidian/Documents` — includes `WorkFirst`, `Family`, `StudyFirst`, … |
| Safe local copy for AI experiments | `~/Desktop/Obsidian-Backups/WorkFirst` (optional; production scan should use real vaults) |

Markdown image forms to parse (non-exhaustive):

- `![...](https://example-bucket.cos.ap-testing.myqcloud.com/obsidian/....png)`
- Obsidian size suffix: `![image.png\|800](url)`, `![\|768](url)`
- Occasional HTML `<img src="...">`

Ignore non-COS hosts (O'Reilly, GitHub, Bilibili, etc.) for orphan / cascade logic.

## Functional requirements

### 1. Management UI

- List COS images under the configured prefix.
- Sort by **upload time** (prefer timestamp in object key; else `LastModified`).
- Show at least: thumbnail or filename, **size** (bytes / human), upload time, key, public URL.
- Filters: by size (e.g. `> 1MB`), by date range, by “unused only”.
- Select one or many images for delete (with confirmation).
- Thumbnails optional; **default off** to limit COS egress; prefer local cache when enabled.

### 2. Reference mapping

- Scan configured vault root(s) recursively for `.md` files.
- Build map: `image URL/key → [markdown file paths…]`.
- From an image, show which notes use it.
- From a note path, list images it references (cascade preview covers this).

### 3. Orphan detection

- `orphans = COS objects − referenced set` (normalized URL/key; decode `%20` etc.).
- Report orphans with size and estimated reclaimable storage.
- Delete only after explicit confirm; support export report (CSV/JSON).

### 4. Cascade delete with notes

- User provides a Markdown note path: preview images that would be removed.
- **Default policy:** delete only images **uniquely** referenced by that note; keep shared images.
- Always show preview + total bytes before destructive action.
- Deleting the note file itself is out of scope for v1.

### 5. Image size awareness

- Display COS `Size` for every object.
- Sort by size desc; help find large pre-compression uploads (histogram optional).

## Non-functional

- Stack: Go 1.25+, Wails **v3.0.0-beta.6**, React + TypeScript + Vite.
- Secrets: `SecretId` / `SecretKey` via `.env` / env; never commit. Vault paths may be persisted in user config (no secrets).
- Destructive ops: confirm dialog; preview / export before mass delete.
- Scan all configured vaults so cross-vault shared images are not marked orphan incorrectly.
- iCloud paths may be slow / locked; allow scanning a local backup path for development.

## Architecture

```
ConfigService   — GetConfig, SaveVaultPaths, SaveShowThumbnails, ConfigFilePath
COSService      — ListImages, DeleteImages, GetThumbnail, ClearThumbnailCache
VaultService    — ScanReferences, FindNotesUsing  (+ event vault:scan)
CleanupService  — ListOrphans, ExportOrphans, PreviewCascadeDelete, CascadeDeleteNoteImages
```

Models: `models.go`. Shared URL/key helpers: `cosurl.go`. Thumbnail disk cache: `thumbcache.go`.

## Implementation phases

| Phase | Scope | Status |
|-------|--------|--------|
| 1 | Config + COS list | Done |
| 2 | Vault scan + reference UI | Done |
| 3 | Orphans + export + delete | Done |
| 4 | Cascade preview + unique-only delete | Done |
| 5 | Polish (filters, thumbs off-by-default + cache, progress) | Done |

## Out of scope (v1)

- Replacing PicGo upload pipeline.
- Editing Markdown image links / CDN migration.
- Multi-cloud providers other than this Tencent COS bucket.
- Automatic watch of vault deletes.

## Acceptance checks

- [x] List shows real COS objects with correct sizes (needs live `.env` to verify in UI).
- [x] Sort by upload time uses PicGo key timestamp when present.
- [x] Reference scan finds WorkFirst-scale COS URLs (≈3500+ unique on backup smoke test).
- [x] Orphan list excludes images still used in any configured vault.
- [x] Cascade preview never proposes deleting shared images under default policy (`forceUniqueOnly=true`).
- [x] No secrets in git; `.env.example` documents required vars.
- [x] Thumbnails default off; cached locally when enabled.
