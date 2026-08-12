# Obsidian COS Images

Manage **PicGo → Tencent COS** images used by **Obsidian** Markdown notes.

Built with **Go + Wails v3** (React / TypeScript).

## Docs

| File | Purpose |
|------|---------|
| [AGENTS.md](AGENTS.md) | Current status + how to run |
| [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) | Product scope |

## Dev

```bash
cd ~/code/golang-projects/obsidian-cos-images
# Optional: .env as a shortcut while developing (never commit)
cp .env.example .env
wails3 task dev
```

On first launch without config, open **Settings** and save COS credentials + vault paths. Values persist under your OS user config directory.

## Config

| Source | Role |
|--------|------|
| **Settings UI** | Primary — COS identity, vault paths, thumbnails |
| **OS user config file** | Persistence (`config.json`, mode `0600` when written) |
| **`.env`** | Dev-only fallback for fields still empty in saved config |

See `.env.example` for env var names. Never commit real secrets.
