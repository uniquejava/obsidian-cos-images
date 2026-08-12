# Obsidian COS Images — Requirements

> Product scope. For run instructions and “what is implemented”, see `AGENTS.md`.
>
> **Do not put real bucket names, AppIds, base URLs, secrets, or personal absolute paths in this repo.** Runtime values live in the OS user config file (Settings UI) and optionally a local gitignored `.env` for development (see `.env.example`).

Related context: PicGo uploads clipboard images to Tencent COS; Obsidian notes embed HTTPS URLs pointing at that bucket.

## Goal

Desktop app (Go + **Wails v3**) to manage images stored on **one Tencent Cloud COS bucket** that are referenced by **Obsidian Markdown** notes.

## Background (operator-local facts)

**Primary path:** configure everything in the **Settings** UI. Values persist under the OS user config directory (local only; never commit).

**Dev fallback:** optional gitignored `.env` fills any field that is still empty in the saved config.

| Setting | Settings UI / persisted | Env var (dev fallback) |
|---------|-------------------------|------------------------|
| SecretId / SecretKey | Yes (SecretKey never returned to UI after save) | `COS_SECRET_ID`, `COS_SECRET_KEY` |
| Bucket (`name-appid`) | Yes | `COS_BUCKET` |
| Region | Yes | `COS_REGION` |
| Object prefix | Yes (default `obsidian/`) | `COS_PREFIX` |
| Public / virtual-host base URL | Yes | `COS_BASE_URL` |
| Vault roots to scan | Yes | `VAULT_PATHS` |
| Show thumbnails | Yes (default off) | — |

Typical PicGo key pattern: `{prefix}YYYYMMDDHHMMSS.png` (sometimes millis / URL-encoded names).

Markdown forms to parse (host must match configured `COS_BASE_URL`):

- `![...](https://…/obsidian/….png)`
- Obsidian size suffix: `![image.png\|800](url)`, `![\|768](url)`
- Occasional HTML `<img src="...">`

Ignore non-configured hosts for orphan logic.

## Functional requirements

### 1. Management UI

- List COS images under the configured prefix.
- Sort by **upload time** (prefer timestamp in object key; else `LastModified`).
- Show size, upload time, key, public URL; optional preview.
- Filters: size, upload year (one year or all), note title/keyword (fuzzy); page size (20 / 50 / 200 / 1000 / 2000 / all).
- Browse-only on Images; COS delete lives under Orphans.
- Thumbnails **default off** (Settings); local cache when enabled.
- Lightweight **toast** notifications for actions (success / Test connection) and sticky errors.

### 2. Reference mapping

- Scan configured vault root(s) for `.md` files.
- Map image URL/key → note paths.
- From an image, show which notes use it.

### 3. Orphan detection

- `orphans = COS objects − referenced set` (normalized keys; decode `%20` etc.).
- Typical workflow: delete a note in Obsidian → its uniquely used images become orphans → delete them here.
- Report size / reclaimable bytes; export CSV/JSON; multi-select / delete-all after confirm.

### 4. Image size awareness

- Display COS `Size`; sort by size to find large uploads.
- Filter by minimum size (KB); quick preset for **≥500 KB** (legacy blog uploads without PicGo compress).

### 5. Recompress / replace (same object key)

For large images already on COS (often >500 KB because PicGo compress was not used):

- From Images (preview), offer **Compress & replace**.
- **Preview first:** download object → compress locally → show side-by-side original vs compressed with byte sizes (and quality / max-edge controls) before any upload.
- **Seamless replace:** `PutObject` overwrites the **same object key** (original filename / path). Markdown URLs stay unchanged; no vault edits.
- Keep output format matched to the key extension (`.jpg` / `.jpeg` / `.png`). Unsupported types are skipped with a clear message.
- **PNG** uses TinyPNG-style compression via local **`pngquant`** (libimagequant; optional **`oxipng`** second pass). Install with `brew install pngquant oxipng`. Go `image/png` re-encode is not used (it often grows files).
- **JPEG** uses standard quality re-encode.
- Defaults: quality ~80, max long edge 2560px (0 = no resize; configurable in the preview UI). If compressed is not smaller, warn and do not overwrite by default.
- After replace: refresh list size; invalidate that key’s local thumbnail cache. Note that CDN / Obsidian may briefly show a cached older image for the same URL.

### 6. First-run / Settings

- Packaged app users initialize via Settings (no requirement to edit `.env`).
- If COS identity is incomplete, surface a clear prompt and steer users to Settings.
- **Test connection** in Settings probes bucket access with the form values (does not save).
- SecretKey: password field; leave blank on save to keep the existing value.
- Config file mode should not be world-readable when secrets are stored.

## Non-functional

- Stack: Go 1.25+, Wails **v3.0.0-beta.6**, React + TypeScript + Vite.
- Never commit secrets or personal COS/path defaults. Committed `.env.example` is placeholders only.
- Runtime identity and vault paths persist in **OS user config** (local). Optional `.env` is a developer convenience only.
- Confirm before destructive ops; scan all configured vaults for cross-vault safety.

## Architecture

```
ConfigService   — GetConfig, SaveCOSSettings, SaveVaultPaths, SaveShowThumbnails, ConfigFilePath
COSService      — ListImages, DeleteImages, TestConnection, GetThumbnail, ClearThumbnailCache,
                  PreviewCompress, ReplaceWithCompressed
VaultService    — ScanReferences, FindNotesUsing, ReadNote  (+ event vault:scan)
CleanupService  — ListOrphans, ExportOrphans
```

## Implementation phases

| Phase | Scope | Status |
|-------|--------|--------|
| 1–4 | Config/list, vault, orphans, polish | Done |
| 5 | Settings-first COS config (UI + persist) | Done |
| 6 | Recompress / replace large images (preview + same-key overwrite) | Done |

## Out of scope (v1)

- Replacing PicGo; editing Markdown links; multi-cloud; automatic vault delete watch.
- Cascade delete / per-note “unique image” cleanup (delete notes in Obsidian; clean leftovers via Orphans).
- Changing object key / extension (would require Markdown URL rewrites).

## Acceptance checks

- [x] List/sort/size from COS using configured bucket.
- [x] Vault scan for configured host only.
- [x] Orphans exclude images still referenced in any configured vault.
- [x] No secrets or personal COS/path defaults in git; `.env.example` is placeholders only.
- [x] Thumbnails default off; cached locally when enabled.
- [x] All COS + vault settings editable in Settings UI and persisted locally.
- [x] Fresh install works without a `.env` file after Settings save.
- [x] Filter images by min size (incl. ≥500 KB preset).
- [x] Filter by upload year (one year or all) and note title/keyword (fuzzy).
- [x] Compress preview before overwrite; same-key replace; no Markdown edits.
