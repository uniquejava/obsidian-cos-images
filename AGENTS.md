# AGENTS.md — Obsidian COS Images

## What this is

Desktop **image manager** for Obsidian notes whose images were uploaded by **PicGo** to **Tencent Cloud COS**.

Stack: **Wails v3** (`v3.0.0-beta.6`) + React + TypeScript + Vite.

**Product requirements:** `docs/REQUIREMENTS.md` (read this first in a new session).

## Status

Phase 1–4 mostly done: COS list/delete, vault reference scan, orphans, unique-only cascade preview/delete. UI has Images / Orphans / Cascade tabs with size + unused filters. Polish (thumbnails, export) still open.

## Layout

```
main.go                 # app window + service registration
models.go               # ImageObject, ImageRef, AppConfig, …
configservice.go        # settings / vault paths
cosservice.go           # COS list + delete
vaultservice.go         # Markdown URL scan
cleanupservice.go       # orphans + cascade delete
errors.go
frontend/src/App.tsx    # placeholder UI
docs/REQUIREMENTS.md    # full requirements
.env.example            # COS credential keys (no secrets)
```

Module: `github.com/uniquejava/obsidian-cos-images`  
Bundle ID: `com.cyper.obsidiancosimages`

Sibling reference project: `../video-editor-wails` (same Wails version / Taskfile style).

## Commands

```bash
cd ~/code/golang-projects/obsidian-cos-images
wails3 task dev          # hot reload
wails3 build
wails3 package
```

CLI (if needed): `go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.6`

After changing Go service method signatures:

```bash
wails3 generate bindings
# or rely on `wails3 task dev` / build tasks that regenerate
```

## Network / proxy (China)

Local proxy is usually `127.0.0.1:7897`:

```bash
export http_proxy=http://127.0.0.1:7897
export https_proxy=http://127.0.0.1:7897
export HTTP_PROXY=http://127.0.0.1:7897
export HTTPS_PROXY=http://127.0.0.1:7897
export ALL_PROXY=http://127.0.0.1:7897
```

## Hard rules

1. Implement against `docs/REQUIREMENTS.md`; do not invent a second product scope.
2. Never commit COS `SecretId` / `SecretKey` or real `.env`.
3. Default cascade / orphan delete must **not** remove images still referenced in any configured vault.
4. Only treat this bucket/host as managed images; ignore other CDN URLs in Markdown.
5. Prefer dry-run / preview before any COS delete.
6. When developing against iCloud Obsidian paths, be aware of sync locks; local backup under `~/Desktop/Obsidian-Backups` is OK for scan tests.

## Next session starting point

1. Polish: thumbnails, date-range filter, progress events, export orphan CSV/JSON.
2. Optional: SaveVaultPaths persistence beyond env.
3. Live-test cascade against a disposable note on the backup vault.
