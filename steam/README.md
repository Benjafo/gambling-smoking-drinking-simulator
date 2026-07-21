# SteamPipe upload

One-time setup, then ~5 minutes per build.

## Layout

```
steam/
  app_build.vdf        the build recipe (app ID + depot list)
  depot_windows.vdf    depot 1: contents of the win-unpacked CI artifact
  depot_macos.vdf      depot 2: contents of the mac-arm64 CI artifact
  content/             UNZIPPED builds go here (gitignored)
    windows/           ← joint-liability-win-unpacked artifact contents
    macos/             ← joint-liability-mac-arm64 artifact contents
  output/              steamcmd build logs/cache (gitignored)
```

## Per-upload procedure

1. Take the green "Desktop builds" run for the commit you're shipping;
   download both artifacts.
2. Empty `steam/content/windows` and `steam/content/macos`, unzip the
   artifacts into them (`Joint Liability.exe` directly under `windows/`,
   `Joint Liability.app` directly under `macos/`).
3. Edit `Desc` in app_build.vdf to the git sha you're shipping.
4. `steamcmd +login <account> +run_app_build /absolute/path/to/steam/app_build.vdf +quit`
   (first run prompts for Steam Guard).
5. App Admin → SteamPipe → Builds: the upload appears; set it live on the
   `default` branch (or a `beta` branch first — create branches in the same
   page). SetLive is deliberately blank in the vdf so nothing goes live
   without a human clicking it.

## One-time dashboard config (app-ID day)

- Replace YOUR_APP_ID / YOUR_APP_ID_PLUS_1 / YOUR_APP_ID_PLUS_2 in the three
  vdf files with the real IDs from App Admin → SteamPipe → Depots.
- Installation → General: add launch options —
  Windows: executable `Joint Liability.exe`;
  macOS: executable `Joint Liability.app` (operating system filters set on
  each so the right depot maps to the right OS).
- Depots: create the two depots (Windows 64-bit, macOS), map depot → OS,
  add both to the default launch package.
- steamworks.js needs no separate steam_api install step — the redistributable
  libs ship inside resources/steamworks in the build.
