# Launch handoff — Ben's actions only

Snapshot 2026-07-20. STEAM.md stays the canonical tracker; this is just
your to-do view of it. Everything not listed here is done, automated, or
Claude's job on request.

## Now (this week — none of this waits on Valve)

1. **Push + merge to main** (you said you'd do this later — it gates the
   rest): puts the app icon into CI artifacts, deploys the hardened server
   (rate limit, protocol gate, /healthz) and the healthz nginx proxy to
   prod, and gets the art/steam kit off this one laptop.
2. **Screenshot session (~1 hour):** `npm run build`, then
   `cd desktop && ../node_modules/.bin/electron . --shots`, play solo with
   bots (N seats them), press **F12** at the six moments listed in
   steam/STORE_PAGE.md. Keep the best 4 — backdrop-b and backdrop-c already
   count as two. Park them in steam/art/screenshots/.
3. **Game server droplet (~1 evening):** DO Premium AMD 2 vCPU / 2 GB /
   NVMe (~$21/mo). Docker + compose + your traefik stack, 2 GB swapfile,
   update DROPLET_HOST / DROPLET_USER / DROPLET_SSH_KEY repo secrets,
   repoint blackjack.benjafo.com DNS, push to deploy, then point
   UptimeRobot (free) at https://blackjack.benjafo.com/healthz.
   Deadline: before the Coming Soon page goes live.

## When Valve's email arrives (app-ID day — ~1 focused day)

Open STEAM.md and follow the runbook top to bottom. Your parts: the
Steamworks dashboard clicking (store page assembly from steam/STORE_PAGE.md,
questionnaire paste, pricing $9.99 + 15% launch discount, depot config per
steam/README.md, the steamcmd upload, submitting both reviews). Ask Claude
first for the code side: the 480→appID swap and vdf placeholder fills.

## During the 2-week Coming Soon window

- Set up the Playtest app in Steamworks; run one friends session (this is
  also the multiplayer load test — watch /healthz during it).
- If either Valve review bounces anything: hand the rejection text to
  Claude, fixes come back same day.
- Optional, only if you feel like it: OBS-record a hand for a trailer.

## Launch day

Press the release button (needs: both reviews green + 2 weeks elapsed).
Then watch /healthz and the reviews page for the first weekend.

## Standing offers (ask Claude any time)

App-ID swap + vdf fills · store copy tweaks · art regens (any capsule,
new backdrop angle, trashier floor — ~2 min) · review-rejection fixes ·
post-launch items (gamepad, music, snapshot slimming) when you want them.
