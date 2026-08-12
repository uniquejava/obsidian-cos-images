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
cp .env.example .env   # fill locally; never commit .env
wails3 task dev
```

## Config

All COS identity and vault paths come from **`.env`** (see `.env.example` placeholders) or the Settings UI (vault paths / thumbnail preference only, stored under your OS user config directory).
