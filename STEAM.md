# Steam Launch Checklist

Canonical tracker for shipping on Steam. Check items off in the same commit
that completes them; add notes inline. Review this doc before starting
Steam-related work and update it after.

**Last reviewed: 2026-07-20** (third pass — CI verified, persona verified, rate limiting)

## Done

- [x] Offline solo mode (sim in local worker, bots) — no server dependency
- [x] Self-contained assets — fonts self-hosted, no CDN, procedural audio/textures
- [x] Options menu with master/music/effects volume + mute, persisted
- [x] Electron shell (`desktop/` workspace) — `app://` scheme, F11 fullscreen,
      QUIT on title screen, crash log in userData, server URL injection
      (`--server=` / `LAST_CALL_SERVER`, defaults to prod)
- [x] Automated boot check — `npm run desktop:smoke` (exit 0/1, CI-able)
- [x] Packaged macOS arm64 build — `npm run desktop:pack` → `desktop/release/`
- [x] Third-party notices — `client/public/THIRD-PARTY-NOTICES.txt` (three.js
      MIT, Rapier Apache-2.0, fonts OFL); ships in every web + desktop build
- [x] Protocol version gate — client dials `?v=N` (`PROTOCOL_VERSION` in
      shared/constants.ts, bump on any wire-format change); server hangs up
      4400 → menu shows "UPDATE THE GAME". Covered in server test.
      Note: deploy server + web together (docker compose already does) so
      the gate never strands the site's own client.

## Code

- [x] **Windows build via CI** — `.github/workflows/desktop.yml` (windows +
      macos matrix, unpacked-dir artifacts on push to main). Both platforms
      verified green 2026-07-20. Before SteamPipe upload: launch the
      win-unpacked exe once on a real Windows box (smoke only proves the
      builder's own platform).
- [x] **Repo LICENSE** — all rights reserved (decided 2026-07-20); LICENSE at
      repo root, third-party terms pointed at THIRD-PARTY-NOTICES.txt.
- [ ] **Steamworks minimum** — CODE DONE, VERIFICATION PENDING. steamworks.js
      wired into the shell: init (STEAM_APP_ID env, default 480/Spacewar;
      LAST_CALL_NO_STEAM=1 disables), persona name → `window.desktop` → name
      field default (typed name still wins), overlay hook + GPU switches,
      module vendored into resources for packaged builds. Degrades cleanly
      without Steam (verified). Persona → name field VERIFIED on macOS with
      Steam running (2026-07-20). Remaining: overlay check — macOS overlay
      over Electron often can't render (Metal vs GL hook), so the
      authoritative test is the Windows CI artifact on a real Windows box;
      swap 480 for our app ID when Valve issues it. Cosmetic note: personas
      with emoji render in fallback glyphs (pixel fonts are latin-only).
- [ ] **App icon** — proper `.icns`/`.ico` for the shell (currently default
      Electron icon); overlaps with store art below.

## Steam process (longest lead times — start early)

- [ ] **Steamworks account + $100 Steam Direct fee** — IN PROGRESS: submitted
      2026-07-20, waiting on Valve's identity/tax/bank verification.
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
- [x] **Intent rate limiting** — per-connection token bucket (30/s sustained,
      60 burst; honest peak ~20/s) in server.ts. Over-budget intents drop
      silently — no disconnect, so a lag-burst can't cost a seat. Covered in
      server test.
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
