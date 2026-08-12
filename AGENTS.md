# AGENTS.md — Obsidian COS Images

## What this is

Desktop **image manager** for Obsidian notes whose images were uploaded by **PicGo** to **Tencent Cloud COS**.

Stack: **Wails v3** (`v3.0.0-beta.6`) + React + TypeScript + Vite.

**Product scope:** `docs/REQUIREMENTS.md`. **This file** is the current implementation / handoff status.

## Status (as of 2026-08-12)

**v1 feature set is implemented.** Settings-first COS config added so packaged installs need no `.env`.

| Area | Status |
|------|--------|
| COS list + delete | Done |
| Vault Markdown scan | Done |
| Orphans + CSV/JSON export | Done |
| Filters (size / date / page size) | Done (Min KB + **≥500 KB** preset) |
| Recompress / same-key replace | Done (JPEG quality; PNG via **pngquant**/oxipng TinyPNG-style) |
| Thumbnails | Done; **default OFF**; local disk cache |
| Config | **Settings UI** (persisted) + optional `.env` fallback for empty fields |

## Secrets & local identity (important)

- **Committed code and `.env.example` must not contain** real `SecretId`/`SecretKey`, bucket/AppId, base URL, or personal absolute paths.
- **Primary:** Settings UI → OS user config file (includes COS secrets; file mode `0600`).
- **Dev fallback:** gitignored `.env` fills fields that are still empty in the saved config.
- Persisted path (macOS): `~/Library/Application Support/obsidian-cos-images/config.json` — **local only**, never commit.
- Thumbnail cache (macOS): `~/Library/Caches/obsidian-cos-images/thumbs/`.
- `GetConfig` may return SecretId for form prefilling; **SecretKey is never returned** (only `secretKeySet`).

## Layout

```
main.go              # window + services; godotenv.Load()
models.go            # AppConfig, COSSettings, …
config.go            # persisted Settings + optional env fallback
configservice.go     # GetConfig, SaveCOSSettings, SaveVaultPaths, …
cosservice.go / thumbcache.go / compress.go
cosurl.go / vaultservice.go
cleanupservice.go / export.go
frontend/src/App.tsx
docs/REQUIREMENTS.md
.env.example         # placeholders only (dev convenience)
```

Module: `github.com/uniquejava/obsidian-cos-images`  
Bundle ID: `com.cyper.obsidiancosimages`  
Sibling: `../video-editor-wails`

## Run

```bash
cd ~/code/golang-projects/obsidian-cos-images
# Option A (recommended for product testing): leave .env empty; fill Settings in the UI
# Option B (dev shortcut):
cp .env.example .env   # fill real values locally; never commit .env
wails3 task dev
```

Required identity (Settings or `.env`): SecretId, SecretKey, Bucket, Region, Base URL.  
Optional: Prefix (defaults to `obsidian/`), vault paths, thumbnails.

```bash
wails3 generate bindings -ts -i
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
- Recompress preview / replace downloads the full object once per action (then uploads compressed bytes on confirm).
- **PNG recompress** requires local `pngquant` (`brew install pngquant`; optional `oxipng`). Not bundled yet.
- Do not load thumbs via raw public `<img src=cos-url>` in the UI.

## Hard rules

1. Implement against `docs/REQUIREMENTS.md`; do not invent a second product scope.
2. Never commit secrets or real `.env`. Never reintroduce account-specific COS host/bucket/paths as source defaults.
3. Orphan delete must **not** remove images still referenced in any configured vault.
4. Only treat the configured COS host as managed images; ignore other CDN URLs.
5. Prefer dry-run / preview before any COS delete or same-key compress replace.
6. Prefer local/backup vault paths for destructive experiments.

## Next session starting point

1. Live-test recompress on real ≥500 KB objects (JPEG quality / max-edge; confirm Obsidian still renders after overwrite).
2. Optional: batch recompress for filtered rows; CDN purge guidance.
3. Keep docs free of personal bucket/path values when editing.
