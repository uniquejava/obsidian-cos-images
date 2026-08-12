# Obsidian COS Images — Requirements

> Source of truth for product scope. Implement against this doc.
> Related context: PicGo uploads clipboard images to Tencent COS; Obsidian notes embed HTTPS URLs.

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
- Filters: by size (e.g. `> 1MB` to find early uncompressed classroom notes), by date range, by “unused only”.
- Select one or many images for delete (with confirmation).

### 2. Reference mapping

- Scan configured vault root(s) recursively for `.md` files.
- Build map: `image URL/key → [markdown file paths…]`.
- From an image, jump / show which notes use it.
- From a note path, list images it references.

### 3. Orphan detection

- `orphans = COS objects − referenced set` (normalized URL/key comparison; decode `%20` etc.).
- Report orphans with size and estimated reclaimable storage.
- Delete orphans only after explicit user confirm (support dry-run / export report).

### 4. Cascade delete with notes

- User selects a Markdown note (or “note was deleted” workflow): preview images that would be removed.
- **Default policy:** delete only images **uniquely** referenced by that note; keep images still used by other notes.
- Optionally delete the note file itself later; v1 may focus on **image cleanup given a note path**.
- Always show preview + total bytes before destructive action.

### 5. Image size awareness

- Persist / display COS `Size` for every object.
- Help user find large pre-compression uploads (sort by size desc, size histogram optional).

## Non-functional

- Stack: Go 1.25+, Wails **v3.0.0-beta.6**, React + TypeScript + Vite (same as sibling `video-editor-wails`).
- Secrets: `SecretId` / `SecretKey` via env or local config (`~/.config/...` or `.env`); never commit.
- Destructive ops: confirm dialog; prefer dry-run first.
- Scan all configured vaults so cross-vault shared images are not marked orphan incorrectly.
- iCloud paths may be slow / locked; allow scanning a local backup path for development.

## Suggested architecture

```
ConfigService   — vault paths, COS endpoint metadata (no raw secrets in UI)
COSService      — ListImages, DeleteImages
VaultService    — ScanReferences, FindNotesUsing
CleanupService  — ListOrphans, PreviewCascadeDelete, CascadeDeleteNoteImages
```

Models live in `models.go`. Stub methods currently return `ErrNotImplemented`.

## Implementation phases (suggested)

1. **Config + COS list** — credentials, list objects with size + time, basic UI table/grid.
2. **Vault scan** — regex extract COS URLs; reference map UI.
3. **Orphans** — diff + report + delete.
4. **Cascade** — preview + unique-only delete.
5. **Polish** — thumbnails, filters, progress events, export CSV/JSON report.

## Out of scope (v1)

- Replacing PicGo upload pipeline.
- Editing Markdown image links / CDN migration.
- Multi-cloud providers other than this Tencent COS bucket.
- Automatic watch of vault deletes (can be manual “cleanup for note” first).

## Acceptance checks

- [ ] List shows real COS objects with correct sizes.
- [ ] Sort by upload time matches PicGo naming order for typical keys.
- [ ] Reference scan finds known WorkFirst links (≈3500+ unique COS URLs observed).
- [ ] Orphan list excludes images still used in any configured vault.
- [ ] Cascade preview never proposes deleting shared images under default policy.
- [ ] No secrets in git; `.env.example` documents required vars.
