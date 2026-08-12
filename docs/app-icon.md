# App icon (Dock / Finder) — design + Wails packaging

Design rules follow [EggplantFred `docs/app-icon.md`](../../../eggplant-projects/EggplantFred/docs/app-icon.md) (Apple HIG continuous corner ≈ **22.37%**, transparent outside the squircle). This document adds **what bit us on Wails v3 macOS packages**.

Cross-agent skill (Claude / Cursor / others via `~/.agents/skills`): **`macos-app-icon`** — `~/.agents/skills/macos-app-icon/`.

## Not Wails-only — but Wails makes it easy to hit

| Layer | Whose problem | What happens |
|-------|---------------|--------------|
| macOS | General | If both `CFBundleIconFile` (`.icns`) and `CFBundleIconName` (`Assets.car`) are set, **modern macOS prefers the asset catalog name**. Updating only `.icns` looks like “nothing changed”. |
| Wails v3 | Project template | `generate:icons` builds `.icns`/`.ico` from `build/appicon.png` **and** (on macOS) `Assets.car` from `build/appicon.icon`. Default `Info.plist` often has **both** keys. |
| Taskfile | Packaging quirk | `create:app:bundle` does `mkdir -p` + `cp`; it **does not delete** a stale `Resources/Assets.car`. An old car file can survive a rebuild that only refreshed `icons.icns`. |
| Task cache | Packaging quirk | `generate:icons` can report **up to date** and skip regenerating `Assets.car` even when you edited art under `appicon.icon/`. |

Native Swift apps that only ship an `AppIcon.appiconset` (EggplantFred) usually never see the dual-path trap. Electron / other toolchains that emit both `.icns` and an asset catalog can hit the same macOS precedence rule.

## What this repo ships

| Asset | Role |
|-------|------|
| `build/appicon.png` | Master **1024×1024** PNG (squircle + transparent corners). Source of truth for classic `.icns` / `.ico`. |
| `build/appicon.icon/` | Icon Composer input (layer PNG + `icon.json`). Only needed if you intentionally ship `Assets.car`. |
| `build/darwin/icons.icns` | Generated Dock/Finder icon file. |
| `build/windows/icon.ico` | Generated Windows icon. |
| `build/darwin/Assets.car` | Optional layered icon catalog. **Prefer absent** unless you maintain `appicon.icon` in sync. |

Current policy (after the blue-crystal switch):

- **Use `icons.icns` only.**
- `Info.plist` / `Info.dev.plist` keep `CFBundleIconFile=icons` and **do not** set `CFBundleIconName`.
- Do not leave a leftover `Assets.car` in `bin/*.app` or `/Applications/*.app`.

`build/config.yml` documents `info.cfBundleIconName`; leave it commented unless you deliberately re-enable layered icons.

## Replace the icon (checklist)

1. Author / update `build/appicon.png` (1024², rounded mask, transparent corners).
2. If you still use Icon Composer: update `build/appicon.icon/Assets/*` **and** `icon.json` (do not leave the default Wails `wails_icon_vector.svg` as the layer).
3. Force regenerate (do not trust “up to date” after art-only edits):

```bash
rm -f build/darwin/Assets.car build/darwin/icons.icns build/windows/icon.ico
# Optional: drop Assets.car path entirely — omit -iconcomposerinput if you only want .icns
wails3 generate icons \
  -input build/appicon.png \
  -macfilename build/darwin/icons.icns \
  -windowsfilename build/windows/icon.ico
```

4. Wipe stale bundle resources, then package:

```bash
rm -rf bin/obsidian-cos-images.app
wails3 package
ls -lah bin/obsidian-cos-images.app/Contents/Resources/
# Expect: icons.icns only (no Assets.car), unless you intentionally rebuilt the car
plutil -p bin/obsidian-cos-images.app/Contents/Info.plist | grep -i Icon
# Expect: CFBundleIconFile => icons ; no CFBundleIconName
```

5. Reinstall and refresh Launch Services / Dock:

```bash
rm -rf "/Applications/Obsidian COS Images.app"
cp -R bin/obsidian-cos-images.app "/Applications/Obsidian COS Images.app"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "/Applications/Obsidian COS Images.app"
killall Dock 2>/dev/null || true
```

6. Verify the **bytes** Finder will use (not your memory of the Dock):

```bash
iconutil -c iconset "/Applications/Obsidian COS Images.app/Contents/Resources/icons.icns" -o /tmp/check.iconset
# Open /tmp/check.iconset/icon_512x512@2x.png — should be the new art
```

## Symptom → cause

| Symptom | Likely cause |
|---------|----------------|
| Dock still shows default Wails “W” after new `appicon.png` | `Assets.car` / `CFBundleIconName` still pointing at old Icon Composer layers |
| `icons.icns` extracts to new art, Dock still old | Stale `Assets.car` left in `.app/Contents/Resources/` |
| Package says icons “up to date” | Task fingerprint; delete generated icons or `touch build/appicon.png` and regenerate |
| Hard square corners in Dock | Master PNG lacked transparent squircle mask (~22.37% radius) |

## Design note (this app)

Master art is Obsidian-shaped (dark squircle + faceted crystal) recolored to **blue** so it is related but not a clone of Obsidian purple. Keep crystal-only layers (if any) free of the black plate when feeding Icon Composer; let fill / system mask provide the plate.
