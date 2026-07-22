# Launch checklist — Ben's remaining items

Slimmed 2026-07-21. STEAM.md is the canonical tracker with full detail;
this is only what's left that needs YOUR hands. Ask Claude for anything
code/docs/art shaped.

## Now (nothing here waits on Valve)

- [x] ~~Provider call~~ RESOLVED 2026-07-21: DigitalOcean (Premium AMD
      2 vCPU / 2 GB, ~$21/mo, per the original STEAM.md spec). Hetzner's
      June 2026 price hikes erased its US advantage — details in STEAM.md.
- [ ] **Provision the game box** — IN PROGRESS 2026-07-21, new droplet
      159.223.98.142 (DO Premium AMD 2 vCPU/2 GB, NYC): box + docker +
      swapfile + traefik (/opt/traefik) + app + .env DONE and verified
      end-to-end; DNS repointed, waiting on propagation + cert.
      Remaining: old box `compose down` → fresh deploy key + update
      DROPLET_HOST / DROPLET_USER / DROPLET_SSH_KEY secrets → re-run
      Deploy workflow green (fold in the uncommitted doc edits).
- [ ] **Load test the box** (~30 min):
      `npm run loadtest -- --url wss://blackjack.benjafo.com/ws --tables 10,25,50 --hold 90`
      → write the highest stage that holds ~60 ticks/s into the box's
      .env as MAX_LOBBIES, and tell Claude the numbers.
- [ ] **UptimeRobot** at https://blackjack.benjafo.com/healthz (can be
      done today against current prod for a baseline).

## Optional, any time

- [ ] Screenshot fidelity pass — re-shoot with a diegetic lobby name;
      add THE MIRROR + cause-of-death shots (list in steam/STORE_PAGE.md).
- [ ] Trailer (OBS-record a hand).

## When Valve's email arrives (~1 focused day)

- [ ] Run the app-ID day runbook in STEAM.md top to bottom. Your parts:
      Steamworks dashboard clicks (store page from steam/STORE_PAGE.md,
      questionnaire, $9.99 + 15% launch discount, depots per
      steam/README.md, steamcmd upload, submit both reviews). Ask Claude
      first for the 480→appID swap + vdf fills.

## During the 2-week Coming Soon window

- [ ] Set up the Playtest app; run one friends session (doubles as the
      real multiplayer load test — watch /healthz during it).
- [ ] Any review rejection → hand the text to Claude, same-day fixes.

## Launch day

- [ ] Press release (needs both reviews green + 2 weeks elapsed), then
      watch /healthz and the reviews page over the first weekend.
