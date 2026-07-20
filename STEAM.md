# Steam Launch Checklist

Canonical tracker for shipping on Steam. Check items off in the same commit
that completes them; add notes inline. Review this doc before starting
Steam-related work and update it after.

**Last reviewed: 2026-07-20**

## Done

- [x] Offline solo mode (sim in local worker, bots) — no server dependency
- [x] Self-contained assets — fonts self-hosted, no CDN, procedural audio/textures
- [x] Options menu with master/music/effects volume + mute, persisted
- [x] Electron shell (`desktop/` workspace) — `app://` scheme, F11 fullscreen,
      QUIT on title screen, crash log in userData, server URL injection
      (`--server=` / `LAST_CALL_SERVER`, defaults to prod)
- [x] Automated boot check — `npm run desktop:smoke` (exit 0/1, CI-able)
- [x] Packaged macOS arm64 build — `npm run desktop:pack` → `desktop/release/`

## Code

- [ ] **Windows build via CI** — GitHub Actions `windows-latest` running
      `desktop:pack`; electron-builder can't cross-build reliably from macOS.
      Windows depot is effectively mandatory for Steam.
- [ ] **Third-party license bundle + repo LICENSE** — OFL texts (Pixelify
      Sans, VT323, Silkscreen), three.js MIT, Rapier Apache-2.0 + NOTICE,
      shipped in the packaged app; add a LICENSE to the repo itself.
- [ ] **Steamworks minimum** — `steamworks.js` in the shell: init with app ID,
      pass Steam persona name through `window.desktop` (replaces typed name),
      verify overlay renders over the WebGL canvas (test early — Electron +
      overlay sometimes needs launch flags).
- [ ] **Protocol version in WS handshake** — server rejects mismatched
      clients with an "update the game" message. Needed once Steam
      auto-updates clients on a different cadence than server deploys.
- [ ] **App icon** — proper `.icns`/`.ico` for the shell (currently default
      Electron icon); overlaps with store art below.

## Steam process (longest lead times — start early)

- [ ] **Steamworks account + $100 Steam Direct fee** — identity/tax/bank
      verification takes days.
- [ ] **Final title decision + trademark search** — before any store assets.
- [ ] **Store page assets** — ~6 capsule sizes, 5+ screenshots, trailer,
      description. The most time-consuming non-code item.
- [ ] **Content questionnaire** — disclose simulated gambling + tobacco/
      alcohol. Fictional currency only; expect an age gate.
- [ ] **"Coming Soon" page live ≥ 2 weeks before launch** — hard Valve
      requirement; page review and build review are separate, days each.
- [ ] **SteamPipe setup** — depot per OS, `steamcmd` upload script, launch
      options. Mechanical once the Windows build exists.

## Operational (before launch day)

- [ ] **Server plan** — sizing for launch spike (known ceiling: all lobbies
      step Rapier on one Node event loop), restart-on-crash, basic
      monitoring. Store page should set expectations that solo works offline.
- [ ] **Intent rate limiting** — per-connection cap on the server; cheapest
      griefing vector once strangers connect.
- [ ] **Pricing + launch discount decision**
- [ ] **Playtest or Next Fest demo decision** — free visibility and a real
      multiplayer load test.

## Post-launch / optional

- [ ] Gamepad support → Steam Deck Playable/Verified
- [ ] Key rebinding
- [ ] Achievements, rich presence
- [ ] Localization (needs non-latin font subsets too)
- [ ] Snapshot slimming (delta/binary encoding) — only if bandwidth metrics say so
- [ ] Lobby sharding across processes — only if traffic demands
- [ ] Background music (music bus exists, plays nothing yet)
