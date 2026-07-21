# Store page kit

Everything to paste into Steamworks on app-ID day. Copy is draft — edit
voice to taste, but keep the gambling/tobacco/alcohol disclosures intact.

## Name

JOINT LIABILITY
(tagline: SMOKE · DRINK · GO BROKE)

## Short description (300 char limit — this one is 289)

> Multiplayer blackjack in a bar that never closes. Keep your buzz burning
> or die of sobriety, fling your empties at the other players, and outlast
> every gambler at the table. 1–5 players online, solo against the
> regulars offline. Fictional money. Terrible decisions. The house  always wins.

## About This Game

> **LAST CALL was three hours ago. You're still here.**
>
> Joint Liability is a multiplayer survival-blackjack game set in the back
> room of a bar with no clock and no mercy. Five stools, one dealer, and a
> simple rule: the last gambler still breathing takes the crown.
>
> **Play the cards.** Six-deck blackjack with real casino feel — stack your
> chips, press your luck, double when you shouldn't.
>
> **Feed the habit.** Your vices are keeping you alive. Let the meters run
> dry and you die of sobriety — cigars and beer are life support, and the
> bar knows it - prices continually rise.
>
> **Trash the place.** Every empty bottle is a projectile. Bean another
> player mid-hand, bury their cards in litter, and let the mess pile up —
> physics included, cleanup optional.
>
> **Know your tolerance.** Every cigar hits softer than the last. The loop
> tightens. That's the game.
>
> Online tables for 2–5 with private passwords, or sit down solo against
> the bar's regulars — no connection required. All money is fictional; the
> only thing you can lose for real is the evening.

## Feature bullets

- 1–5 player online tables (create, join, private w/ password) or offline solo vs. bots
- Full-physics bar room: fling empties, hit players, bury hands, make a mess
- Vices-as-lifeline survival loop with tolerance that only ratchets up
- Server-authoritative multiplayer — no host advantage
- Original LAST CALL pixel-sign aesthetic

## Mature content survey (Steamworks "Mature Content Description")

> Joint Liability contains frequent depictions of simulated gambling
> (casino blackjack played with fictional currency — there is no
> real-money wagering, no purchasable currency, and no payouts of any
> kind), and frequent depictions of tobacco and alcohol use (smoking
> cigars and drinking beer are core mechanics; stylized low-poly
> characters die, comedically, of sobriety when they abstain). The tone is
> satirical. No nudity or sexual content, no realistic violence or gore,
> no illegal drugs, no user-generated content.

Checkboxes: mark "Some mature content" → gambling + alcohol/tobacco use.
Do NOT mark Adult Only. Expect Steam to age-gate the page; that's normal.

## System requirements (paste per-OS)

Windows — Minimum: Windows 10 64-bit · dual-core CPU · 4 GB RAM · GPU with
WebGL2/DX11 support · 500 MB disk · broadband for multiplayer (solo mode
plays offline).
macOS — Minimum: macOS 12 · Apple Silicon · 4 GB RAM · 500 MB disk.

## Art checklist (make in one batch — same key art, many crops)

All generated 2026-07-20 into `steam/art/out/` from three masters
(backdrop-a + wordmark-glow + icon-1024; regenerate any time with
capture-art.mjs / capture-backdrop.mjs / compose.mjs — no design tools,
no AI-generated imagery):

Store:
- [x] Header capsule 460×215 — header_capsule_460x215.png
- [x] Small capsule 231×87 — small_capsule_231x87.png
- [x] Main capsule 616×353 — main_capsule_616x353.png
- [x] Vertical capsule 374×448 — vertical_capsule_374x448.png
- [x] Screenshots: 8 captured 2026-07-21 at exact 1920×1080 →
      `steam/screenshots/` (backdrop-b/c no longer needed as filler).
      Suggested upload order: In Game → Delivering Direct Hit in Game →
      Lighting Cigar in Game → On the Couch in the Lobby → Receiving
      Direct Hit in Lobby → Title Screen (Valve favors gameplay-first
      ordering; the two remaining lobby shots are spares).
      Optional re-shoot if the mood strikes: shot-list items 5 (THE
      MIRROR) and 6 (cause-of-death screen) went uncaptured — the
      game-over screen especially is a strong differentiator. Lobby
      shots show the "Testing" lobby name + dev bot-control panel;
      re-shooting with a diegetic lobby name would read less debug-y.
- [ ] Trailer (strongly recommended, not strictly required)

Library:
- [x] Library capsule 600×900 — library_capsule_600x900.png
- [x] Library hero 3840×1240 — library_hero_3840x1240.png (art only;
      Steam overlays the logo)
- [x] Library logo 1280×720 — library_logo_1280x720.png (transparent)

Icons:
- [x] Community icon 184×184 — community_icon_184.jpg
- [x] Client icon — icon.ico (256/64/48/32/16)
- [x] App icon wired into the build — desktop/build/icon.png + icon.ico
      (electron-builder converts per-platform automatically)


Shot list — launch the desktop build with `--shots` (16:9-locked window)
and press **F12** at each moment; exact 1920×1080 PNGs land in
`~/Pictures/joint-liability-shots/`:
1. title screen over the live den (attract mode)
2. mid-hand at a full table, litter everywhere
3. an empty in flight at another player's head
4. the waiting-room lobby, someone mid-hop
5. THE MIRROR character creator
6. the game-over leaderboard / cause of death screen
