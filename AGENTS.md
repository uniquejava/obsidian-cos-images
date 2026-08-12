# AGENTS.md — Obsidian COS Images

## What this is

Desktop **image manager** for Obsidian notes whose images were uploaded by **PicGo** to **Tencent Cloud COS**.

Stack: **Wails v3** (`v3.0.0-beta.6`) + React + TypeScript + Vite.

**Product requirements:** `docs/REQUIREMENTS.md` (read this first in a new session).

## Status

Core features done (list/delete, vault scan, orphans, unique-only cascade) plus polish: thumbnails, date-range filter, orphan CSV/JSON export, SaveVaultPaths persistence, vault scan progress events.

## Layout

```
main.go                 # app window + service registration
models.go               # ImageObject, ImageRef, AppConfig, …
config.go               # env + persisted vault paths (~/Library/Application Support/…)
configservice.go        # settings / vault paths
cosservice.go           # COS list + delete
vaultservice.go         # Markdown URL scan (+ vault:scan events)
cleanupservice.go       # orphans + cascade delete
export.go               # orphan CSV/JSON export
errors.go
frontend/src/App.tsx    # Images / Orphans / Cascade / Settings UI
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

1. Live-test against real COS + vaults (delete orphans carefully; always preview first).
2. Optional UX: virtualized table for very large lists, date histogram, note file picker.
