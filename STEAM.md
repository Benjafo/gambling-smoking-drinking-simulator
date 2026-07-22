# Steam Launch Checklist

Canonical tracker for shipping on Steam. Check items off in the same commit
that completes them; add notes inline. Review this doc before starting
Steam-related work and update it after.

**Last reviewed: 2026-07-21** (seventh pass — provider RESOLVED back to
DigitalOcean after Hetzner's June 2026 price hikes (see Server plan);
earlier same day: load-test driver built (`npm run loadtest`), /healthz
pump timing, MAX_LOBBIES required env var, 8 screenshots captured,
hardened server deployed to prod and verified. See runbook below for
app-ID day.)

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
      2026-07-20 (`steam/art/out/`); 8 screenshots CAPTURED 2026-07-21
      (`steam/screenshots/`, all exact 1920×1080 — suggested upload set +
      optional re-shoot notes in STORE_PAGE.md). Remaining: optional
      trailer, optional MIRROR/cause-of-death re-shoot.
- [ ] **Content questionnaire** — answers DRAFTED in `steam/STORE_PAGE.md`
      (mature-content description + which boxes). Remaining: paste on
      app-ID day.
- [ ] **"Coming Soon" page live ≥ 2 weeks before launch** — hard Valve
      requirement; page review and build review are separate, days each.
- [ ] **SteamPipe setup** — vdfs + upload procedure READY in `steam/`
      (win + mac depots, staging dirs gitignored). Remaining: fill real
      app/depot IDs and run the first upload on app-ID day.

## Operational (before launch day)

- [ ] **Snapshot slimming** — CODE DONE 2026-07-22, awaiting prod re-test.
      Settled debris now ships once as a versioned "debris" message
      (re-sent only on change/seat); snapshots stream flying pieces only;
      wire numbers rounded (≤3dp); PROTOCOL_VERSION → 2. Transport layer
      reassembles, so renderer/HUD untouched. Local smoke: snapshot p50
      12.2 KB → 3.7 KB, egress 3.3× down, all tests + desktop smoke green
      (new suites: shared/test/debrisWire.ts + server join-debris checks).
      Remaining: deploy, re-run load test vs prod (raise box MAX_LOBBIES
      for the test), set the new measured cap, record numbers here.
      Originally PROMOTED from post-launch 2026-07-22 by the
      prod load test: full-JSON snapshots are 12 KB × 20 Hz ≈ 2 Mbps per
      seated player (106 Mbps / ~34 TB-month sustained at just 10 tables,
      vs ~3 TB included on the DO box) and the stringify/send cost is a
      big share of the CPU ceiling. Plan: settled debris sent once with a
      version counter (it never moves), full snapshot on join/rejoin,
      delta or trimmed per-tick fields. Wire-format change → bump
      PROTOCOL_VERSION (gate already handles stale clients). Re-run the
      load test after; expect ~25-40 table capacity on the same box, then
      raise MAX_LOBBIES in the box .env to the new measurement.

- [ ] **Server plan** — `/healthz` endpoint + docker healthcheck DONE
      2026-07-20; nginx now proxies it externally (https://<host>/healthz)
      for uptime monitors; restart-on-crash already in compose.
      DECIDED: dedicated droplet, separate from the portfolio box —
      DO Premium AMD 2 vCPU / 2 GB / NVMe (~$21/mo; single-threaded sim
      wants clock speed not cores; 2 GB because deploys build on-droplet).
      PROVIDER RESOLVED 2026-07-21: staying on DigitalOcean. Hetzner's
      June 2026 price increases (DRAM-driven, +107-204% on CPX/CCX) killed
      the case for a US box: CCX13 US now ~$51/mo, CPX31 US ~$62, and US
      locations include only 1-8 TB traffic — not the ~20 TB the
      TRADEOFF.md argument rested on (that was EU-only, and pre-increase).
      DO Basic 2 vCPU/2 GB is ~$18-21 with 3 TB. Hetzner's only surviving
      edge is the €1/TB overage rate (vs DO ~$10/TB) — revisit only if
      egress metrics blow past the included transfer AND snapshot slimming
      can't fix it. EU Hetzner stays cheap but 100-150ms to US players is
      wrong for a 60Hz game.
      PROVISIONED + CUT OVER 2026-07-21/22: droplet 159.223.98.142 (NYC),
      traefik at /opt/traefik, app at /var/www/projects/joint-liability, DNS
      moved, LE cert live (first issuance failed — ACME fired before DNS
      propagated; a traefik restart after propagation fixed it), deploy
      pipeline re-keyed (new deploy key + read-only GitHub repo key) and
      green. LOAD TESTED 2026-07-22 (results under Load test item):
      capacity of this box is ~10 tables / 50 players; MAX_LOBBIES=10 in
      the box .env. Remaining: UptimeRobot at /healthz; raise
      MAX_LOBBIES after snapshot slimming re-test.
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
      PROD RESULTS 2026-07-22 (2 vCPU/2 GB DO box): 10 tables = sim rate
      59.9, pump busy p95 8.6ms (at budget), egress 106 Mbps (~34 TB/30d
      sustained); 25 tables = SATURATED (sim rate 47.4 avg / 34.5 worst,
      pump busy p95 153ms). Capacity ≈ 10 tables / 50 players →
      MAX_LOBBIES=10. Egress, not RAM, is the binding cost — hence
      snapshot slimming promoted to pre-launch (see Code).
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
- [ ] Lobby sharding across processes — only if traffic demands
- [ ] Background music (music bus exists, plays nothing yet)
