# AGENTS.md — Obsidian COS Images

## What this is

Desktop **image manager** for Obsidian notes whose images were uploaded by **PicGo** to **Tencent Cloud COS**.

Stack: **Wails v3** (`v3.0.0-beta.6`) + React + TypeScript + Vite.

**Product requirements:** `docs/REQUIREMENTS.md` (scope + acceptance). Read this file for **current code status** and how to run.

## Status (as of 2026-08-12)

**v1 feature set is implemented** — not a skeleton.

| Area | Status |
|------|--------|
| COS list + delete | Done (`ListImages`, `DeleteImages`) |
| Vault Markdown scan | Done (~3587 unique keys on WorkFirst backup smoke test) |
| Orphans + CSV/JSON export | Done |
| Cascade unique-only delete | Done (preview then delete) |
| Filters (size / date / unused) | Done in UI |
| Thumbnails | Done; **default OFF**; disk cache under OS cache dir |
| Vault path persistence | Done (`~/Library/Application Support/obsidian-cos-images/config.json` on macOS) |

`ErrNotImplemented` remains only as a leftover error var; no service method returns it anymore.

Latest commits (newest first): thumbnail cache → polish → vault/orphans/cascade → COS list → initial skeleton.

## Layout

```
main.go              # window + service registration; loads .env
models.go            # ImageObject, ImageRef, AppConfig, …
config.go            # env + persisted settings (vault paths, showThumbnails)
configservice.go     # GetConfig, SaveVaultPaths, SaveShowThumbnails, ConfigFilePath
cosservice.go        # ListImages, DeleteImages
thumbcache.go        # GetThumbnail (base64), ClearThumbnailCache; local disk cache
cosurl.go            # COS host URL extract / key normalize
vaultservice.go      # ScanReferences, FindNotesUsing; emits vault:scan
cleanupservice.go    # ListOrphans, PreviewCascadeDelete, CascadeDeleteNoteImages
export.go            # ExportOrphans (csv|json)
frontend/src/App.tsx # tabs: Images | Orphans | Cascade | Settings
docs/REQUIREMENTS.md # product scope
.env.example         # COS_* and VAULT_PATHS (no secrets)
```

Module: `github.com/uniquejava/obsidian-cos-images`  
Bundle ID: `com.cyper.obsidiancosimages`  
Sibling reference: `../video-editor-wails` (same Wails version).

## Run

```bash
cd ~/code/golang-projects/obsidian-cos-images
cp .env.example .env   # fill COS_SECRET_ID / COS_SECRET_KEY
wails3 task dev
```

Optional: set `VAULT_PATHS` in `.env`, or save paths in **Settings** (persisted config wins over env).

Safe scan target for experiments: `~/Desktop/Obsidian-Backups/WorkFirst`.

```bash
wails3 generate bindings   # after Go service signature changes
wails3 build
wails3 package
```

CLI: `go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.6`

## Network / proxy (China)

```bash
export http_proxy=http://127.0.0.1:7897
export https_proxy=http://127.0.0.1:7897
export HTTP_PROXY=http://127.0.0.1:7897
export HTTPS_PROXY=http://127.0.0.1:7897
export ALL_PROXY=http://127.0.0.1:7897
```

## Cost note (COS traffic)

- **List / delete / vault scan / export** ≈ no object download traffic.
- **Thumbnails ON** → first fetch per key uses `imageMogr2/thumbnail/64x` (egress + possible CI fee), then **local cache**.
- **Thumbnails default OFF.** “open” link / full image still costs egress.
- Do **not** load thumbs via raw public `<img src=cos-url>` in the UI.

## Hard rules

1. Implement against `docs/REQUIREMENTS.md`; do not invent a second product scope.
2. Never commit COS `SecretId` / `SecretKey` or real `.env`.
3. Default cascade / orphan delete must **not** remove images still referenced in any configured vault.
4. Only treat this bucket/host as managed images; ignore other CDN URLs in Markdown.
5. Prefer dry-run / preview before any COS delete.
6. iCloud vault paths may be slow/locked; backup under `~/Desktop/Obsidian-Backups` is OK for scan tests.

## Next session starting point

1. Live-test with real `.env` + vaults (Settings → vault paths; keep thumbs off until needed).
2. Optional UX: virtualized table, note file picker, size histogram.
3. Keep docs in sync when behavior changes (especially this file’s Status table).
