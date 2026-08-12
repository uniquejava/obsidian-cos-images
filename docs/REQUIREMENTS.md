# Obsidian COS Images — Requirements

> Product scope. For run instructions and “what is implemented”, see `AGENTS.md`.
>
> **Do not put real bucket names, AppIds, base URLs, secrets, or personal absolute paths in this repo.** Those belong in a local gitignored `.env` (see `.env.example`).

Related context: PicGo uploads clipboard images to Tencent COS; Obsidian notes embed HTTPS URLs pointing at that bucket.

## Goal

Desktop app (Go + **Wails v3**) to manage images stored on **one Tencent Cloud COS bucket** that are referenced by **Obsidian Markdown** notes.

## Background (operator-local facts)

Configure via `.env` (not committed):

| Setting | Env var |
|---------|---------|
| SecretId / SecretKey | `COS_SECRET_ID`, `COS_SECRET_KEY` |
| Bucket (`name-appid`) | `COS_BUCKET` |
| Region | `COS_REGION` |
| Object prefix | `COS_PREFIX` (often `obsidian/`) |
| Public / virtual-host base URL | `COS_BASE_URL` |
| Vault roots to scan | `VAULT_PATHS` and/or Settings UI |

Typical PicGo key pattern: `{prefix}YYYYMMDDHHMMSS.png` (sometimes millis / URL-encoded names).

Markdown forms to parse (host must match `COS_BASE_URL`):

- `![...](https://…/obsidian/….png)`
- Obsidian size suffix: `![image.png\|800](url)`, `![\|768](url)`
- Occasional HTML `<img src="...">`

Ignore non-configured hosts for orphan / cascade logic.

## Functional requirements

### 1. Management UI

- List COS images under the configured prefix.
- Sort by **upload time** (prefer timestamp in object key; else `LastModified`).
- Show size, upload time, key, public URL; optional thumbnails.
- Filters: size, date range, unused only.
- Multi-select delete with confirmation.
- Thumbnails **default off**; local cache when enabled.

### 2. Reference mapping

- Scan configured vault root(s) for `.md` files.
- Map image URL/key → note paths.
- From an image, show which notes use it.

### 3. Orphan detection

- `orphans = COS objects − referenced set` (normalized keys; decode `%20` etc.).
- Report size / reclaimable bytes; export CSV/JSON; delete only after confirm.

### 4. Cascade delete with notes

- Note path → preview images to remove.
- **Default:** delete only uniquely referenced images; keep shared.
- Preview + bytes before destructive action.
- Deleting the note file itself is out of scope for v1.

### 5. Image size awareness

- Display COS `Size`; sort by size to find large uploads.

## Non-functional

- Stack: Go 1.25+, Wails **v3.0.0-beta.6**, React + TypeScript + Vite.
- Secrets and account identity only via `.env` / env; never commit.
- Vault paths may be persisted in **OS user config** (local, no secrets).
- Confirm before destructive ops; scan all configured vaults for cross-vault safety.

## Architecture

```
ConfigService   — GetConfig, SaveVaultPaths, SaveShowThumbnails, ConfigFilePath
COSService      — ListImages, DeleteImages, GetThumbnail, ClearThumbnailCache
VaultService    — ScanReferences, FindNotesUsing  (+ event vault:scan)
CleanupService  — ListOrphans, ExportOrphans, PreviewCascadeDelete, CascadeDeleteNoteImages
```

## Implementation phases

| Phase | Scope | Status |
|-------|--------|--------|
| 1–5 | Config/list, vault, orphans, cascade, polish | Done |

## Out of scope (v1)

- Replacing PicGo; editing Markdown links; multi-cloud; automatic vault delete watch.

## Acceptance checks

- [x] List/sort/size from COS using env-configured bucket.
- [x] Vault scan for configured host only.
- [x] Orphans exclude images still referenced in any configured vault.
- [x] Cascade default keeps shared images.
- [x] No secrets or personal COS/path defaults in git; `.env.example` is placeholders only.
- [x] Thumbnails default off; cached locally when enabled.
