# Steam Launch Checklist

Canonical tracker for shipping on Steam. Check items off in the same commit
that completes them; add notes inline. Review this doc before starting
Steam-related work and update it after.

**Last reviewed: 2026-07-21** (sixth pass — scalability: load-test driver
built (`npm run loadtest`), /healthz now reports pump timing, MAX_LOBBIES
is a required server env var (per-box measured capacity). Scaling rulings
recorded under Operational. See runbook below for app-ID day.)

## App-ID day runbook (do in this order, same day)

1. Swap `480` → real app ID in `desktop/main.js` (STEAM_APP_ID default);
   commit, push, wait for green CI → these artifacts are the launch build.
2. Fill the three `YOUR_APP_ID*` placeholders in `steam/*.vdf`; do the
   one-time dashboard config in `steam/README.md` (depots, launch options).
3. Store page: paste copy + questionnaire from `steam/STORE_PAGE.md`,
   upload art (checklist in same file), set pricing → submit page for
   review (takes days — this starts the critical path).
4. Upload the build per `steam/README.md`, set live on default branch,
   install + launch via Steam client once, then request build review.
5. Page approved → flip to "Coming Soon" → the 2-week clock starts.
6. During the 2 weeks: run a Playtest with friends (real multiplayer load),
   watch `/healthz`, confirm prod server has the rate-limit + gate deploy.
7. Launch day: press the release button (needs both reviews green and the
   2 weeks elapsed).

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
      green 2026-07-20; win-unpacked exe launched and played on a real
      Windows box same day.
- [x] **Repo LICENSE** — all rights reserved (decided 2026-07-20); LICENSE at
      repo root, third-party terms pointed at THIRD-PARTY-NOTICES.txt.
- [x] **Steamworks minimum** — steamworks.js in the shell: init (STEAM_APP_ID
      env, default 480/Spacewar; LAST_CALL_NO_STEAM=1 disables), persona name
      → `window.desktop` → name field default (typed name still wins),
      overlay hook + GPU switches, module vendored into resources for
      packaged builds; degrades cleanly without Steam. ALL VERIFIED
      2026-07-20: persona on macOS + Windows, shift-tab overlay renders on
      Windows. Cosmetic note: emoji personas render as fallback glyphs
      (pixel fonts are latin-only).
- [x] **App icon** — JL-monogram sign icon generated (steam/art/icon.html →
      icon-1024) and wired into `desktop/build/` (icon.png + icon.ico);
      electron-builder converts per-platform. Ships with the next pack/CI
      build.

## Steam process (longest lead times — start early)

- [ ] **Steamworks account + $100 Steam Direct fee** — IN PROGRESS: submitted
      2026-07-20, waiting on Valve's identity/tax/bank verification.
      When the app ID arrives: swap the 480 default in desktop/main.js
      (one line) and add a `steam_appid.txt` note to the SteamPipe item.
- [x] **Final title decision + trademark search** — "JOINT LIABILITY"
      cleared 2026-07-20: zero Steam store results for the term, no game on
      itch.io, no game-class trademark surfaced (the phrase is a generic
      legal term — which also means our own mark would be weak/hard to
      enforce; acceptable for an indie launch, revisit only if merch/serious
      brand plans emerge). Discoverability note: web searches return legal
      content, so store tags + "blackjack"/"party game" keywords matter.
- [ ] **Store page assets** — copy + ALL capsule/library/icon art DONE
      2026-07-20 (`steam/art/out/`, regenerable via the scripts in
      `steam/art/`). Remaining: 5+ screenshots (F12 session, shot list in
      STORE_PAGE.md; backdrop-b/c count for two) and optional trailer.
- [ ] **Content questionnaire** — answers DRAFTED in `steam/STORE_PAGE.md`
      (mature-content description + which boxes). Remaining: paste on
      app-ID day.
- [ ] **"Coming Soon" page live ≥ 2 weeks before launch** — hard Valve
      requirement; page review and build review are separate, days each.
- [ ] **SteamPipe setup** — vdfs + upload procedure READY in `steam/`
      (win + mac depots, staging dirs gitignored). Remaining: fill real
      app/depot IDs and run the first upload on app-ID day.

## Operational (before launch day)

- [ ] **Server plan** — `/healthz` endpoint + docker healthcheck DONE
      2026-07-20; nginx now proxies it externally (https://<host>/healthz)
      for uptime monitors; restart-on-crash already in compose.
      DECIDED: dedicated droplet, separate from the portfolio box —
      DO Premium AMD 2 vCPU / 2 GB / NVMe (~$21/mo; single-threaded sim
      wants clock speed not cores; 2 GB because deploys build on-droplet).
      PROVIDER UNDER REVIEW 2026-07-21: Hetzner is a live alternative
      (2-3x CPU/$, ~20 TB included transfer vs DO's ~4 TB — and bandwidth
      is our binding constraint, see load test below; DO wins on region
      spread only). See TRADEOFF.md. Create the Hetzner account early if
      switching — their identity check can take days.
      Remaining: provision it, update DROPLET_* repo secrets, repoint DNS,
      add a 2 GB swapfile, write `/var/www/projects/blackjack/.env` with
      `MAX_LOBBIES=<measured>` (required env — server refuses to boot
      without it; compose reads .env automatically), run the load test
      against the box, point UptimeRobot (or similar) at /healthz —
      all before the Coming Soon page goes live.
- [x] **Load test + capacity tooling** — DONE 2026-07-21.
      `npm run loadtest -- --url ws://host --tables 10,25,50 --hold 90`
      (server/src/loadtest.ts): whole tables of wire-honest bots (ported
      BotBrain policy — they bet, play, feed meters, fling empties, restart
      dead runs) with a staged ramp; reports sim rate (60 = healthy,
      sagging = saturated), snapshot KB, egress Mbps/TB-month, hands
      played, and the server's new /healthz pump stats (busy vs 8ms
      budget). MAX_LOBBIES demoted from shared constant to required
      per-box env var. First smoke (2 tables, M-series laptop): sim rate
      60.0, pump busy p95 2.1ms, snapshot p50 ~12 KB.
      SCALING RULINGS 2026-07-21: no lobby-directory/Redis/multi-process
      rewrite pre-launch — short rounds, no persistence, protocol gate,
      and offline solo make hard-cutover deploys safe; ladder is
      MAX_LOBBIES raise → bigger box → shard (post-launch, only if
      traffic demands). Steam auth session tickets also SKIPPED
      pre-launch: server is authoritative, no accounts/economy, and the
      anonymous web client path must exist anyway.
- [x] **Intent rate limiting** — per-connection token bucket (30/s sustained,
      60 burst; honest peak ~20/s) in server.ts. Over-budget intents drop
      silently — no disconnect, so a lag-burst can't cost a seat. Covered in
      server test.
- [x] **Pricing + launch discount decision** — $9.99 with 15% launch
      discount (decided 2026-07-20). Accept Valve's regional-pricing matrix
      on app-ID day.
- [ ] **Playtest or Next Fest demo** — DECIDED YES 2026-07-20. Remaining:
      set up the Playtest app in Steamworks during the Coming Soon window
      and recruit a friends session (doubles as the multiplayer load test).

## Post-launch / optional

- [ ] Gamepad support → Steam Deck Playable/Verified
- [ ] Key rebinding
- [ ] Achievements, rich presence
- [ ] Localization (needs non-latin font subsets too)
- [ ] Snapshot slimming (delta/binary encoding) — only if bandwidth metrics
      say so. First metric (2026-07-21 smoke): ~12 KB/snapshot × 20 Hz ≈
      2 Mbps per seated player — at full house that's hundreds of Mbps and
      >100 TB/mo sustained. Watch this in the droplet load test; likely
      the first post-launch item (settled debris re-sent every frame is
      the obvious fat).
- [ ] Lobby sharding across processes — only if traffic demands
- [ ] Background music (music bus exists, plays nothing yet)
