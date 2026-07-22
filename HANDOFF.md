# Launch checklist — Ben's remaining items

Slimmed 2026-07-21. STEAM.md is the canonical tracker with full detail;
this is only what's left that needs YOUR hands. Ask Claude for anything
code/docs/art shaped.

## Now (nothing here waits on Valve)

- [x] ~~Provider call~~ RESOLVED 2026-07-21: DigitalOcean (Premium AMD
      2 vCPU / 2 GB, ~$21/mo, per the original STEAM.md spec). Hetzner's
      June 2026 price hikes erased its US advantage — details in STEAM.md.
- [x] ~~Provision the game box~~ DONE 2026-07-22: droplet 159.223.98.142
      live behind DNS + Let's Encrypt cert, deploy pipeline green with
      fresh keys, old box retired.
- [x] ~~Load test the box~~ DONE 2026-07-22: capacity ≈ 10 tables /
      50 players (10 tables held 59.9 ticks/s; 25 saturated at 47.4).
      Egress 106 Mbps at 10 tables → snapshot slimming promoted to
      pre-launch (Claude's build, then a re-test raises the cap).
- [ ] **Set the measured cap** on the box (1 min):
      `cd /var/www/projects/blackjack && sed -i 's/^MAX_LOBBIES=.*/MAX_LOBBIES=10/' .env && docker compose --profile prod up -d`
- [ ] **UptimeRobot** at https://blackjack.benjafo.com/healthz.
- [ ] (Claude, on your go) **Snapshot slimming** → then re-run the load
      test together and raise MAX_LOBBIES to the new measurement.

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
