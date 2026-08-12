# Obsidian COS Images

Manage **PicGo → Tencent COS** images used by **Obsidian** Markdown notes.

Built with **Go + Wails v3** (React / TypeScript).

## Docs

| File | Purpose |
|------|---------|
| [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) | Product requirements (source of truth) |
| [AGENTS.md](AGENTS.md) | Agent / contributor orientation |

## Status

Project **skeleton**. Backend APIs are stubbed (`not implemented`) except default config readout.

## Dev

```bash
cd ~/code/golang-projects/obsidian-cos-images
cp .env.example .env   # fill COS credentials locally
wails3 task dev
```

## Config

See `.env.example`. Defaults assume bucket `REDACTED_BUCKET` / region `ap-shanghai` / prefix `obsidian/`.
