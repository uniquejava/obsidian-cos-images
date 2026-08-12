# AGENTS.md — Obsidian COS Images

## What this is

Desktop **image manager** for Obsidian notes whose images were uploaded by **PicGo** to **Tencent Cloud COS**.

Stack: **Wails v3** (`v3.0.0-beta.6`) + React + TypeScript + Vite.

**Product scope:** `docs/REQUIREMENTS.md`. **This file** is the current implementation / handoff status.

## Status (as of 2026-08-12)

**v1 feature set is implemented.**

| Area | Status |
|------|--------|
| COS list + delete | Done |
| Vault Markdown scan | Done |
| Orphans + CSV/JSON export | Done |
| Filters (size / date / page size) | Done |
| Thumbnails | Done; **default OFF**; local disk cache |
| Config | From **`.env` only** (no account/host/path defaults in source) |

## Secrets & local identity (important)

- **Committed code and `.env.example` must not contain** real `SecretId`/`SecretKey`, bucket/AppId, base URL, or personal absolute paths.
- Runtime values live in **gitignored `.env`** (and optional OS user config for vault paths / UI prefs only).
- Persisted UI settings path (macOS): `~/Library/Application Support/obsidian-cos-images/config.json` — **local only**, never commit.
- Thumbnail cache (macOS): `~/Library/Caches/obsidian-cos-images/thumbs/`.

## Layout

```
main.go              # window + services; godotenv.Load()
models.go
config.go            # reads COS_* / VAULT_PATHS from env; no personal defaults
configservice.go
cosservice.go / thumbcache.go
cosurl.go / vaultservice.go
cleanupservice.go / export.go
frontend/src/App.tsx
docs/REQUIREMENTS.md
.env.example         # placeholders only
```

Module: `github.com/uniquejava/obsidian-cos-images`  
Bundle ID: `com.cyper.obsidiancosimages`  
Sibling: `../video-editor-wails`

## Run

```bash
cd ~/code/golang-projects/obsidian-cos-images
cp .env.example .env   # fill real values locally; never commit .env
wails3 task dev
```

Required in `.env`: `COS_SECRET_ID`, `COS_SECRET_KEY`, `COS_BUCKET`, `COS_REGION`, `COS_BASE_URL`.  
Optional: `COS_PREFIX` (defaults to `obsidian/`), `VAULT_PATHS` (or set in Settings UI).

```bash
wails3 generate bindings
wails3 build && wails3 package
```

## Network / proxy (China)

```bash
export http_proxy=http://127.0.0.1:7897
export https_proxy=http://127.0.0.1:7897
export HTTP_PROXY=http://127.0.0.1:7897
export HTTPS_PROXY=http://127.0.0.1:7897
export ALL_PROXY=http://127.0.0.1:7897
```

## Cost note (COS traffic)

- List / delete / vault scan / export ≈ no object download traffic.
- Thumbnails ON → first fetch per key may egress; then local cache. Default OFF.
- Do not load thumbs via raw public `<img src=cos-url>` in the UI.

## Hard rules

1. Implement against `docs/REQUIREMENTS.md`; do not invent a second product scope.
2. Never commit secrets or real `.env`. Never reintroduce account-specific COS host/bucket/paths as source defaults.
3. Orphan delete must **not** remove images still referenced in any configured vault.
4. Only treat the configured COS host as managed images; ignore other CDN URLs.
5. Prefer dry-run / preview before any COS delete.
6. Prefer local/backup vault paths for destructive experiments.

## Next session starting point

1. Ensure local `.env` is filled; live-test carefully. UI lists stay empty until you click Refresh (no auto-fetch on mount / HMR).
2. Optional UX: virtualized table, note file picker.
3. Keep docs free of personal bucket/path values when editing.
