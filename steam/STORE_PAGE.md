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

Store:
- [ ] Header capsule 460×215
- [ ] Small capsule 231×87
- [ ] Main capsule 616×353
- [ ] Vertical capsule 374×448
- [ ] Screenshots: 5+ at 1920×1080 (see shot list below)
- [ ] Trailer (strongly recommended, not strictly required)

Library:
- [ ] Library capsule 600×900
- [ ] Library hero 3840×1240
- [ ] Library logo 1280×720 (transparent PNG)

Icons:
- [ ] Community icon 184×184 (JPG)
- [ ] Client icon (multi-size .ico)
- [ ] App icons for the build itself: drop `icon.icns` + `icon.ico` into
      `desktop/build/` — electron-builder picks them up by convention,
      no config change needed.


Shot list — launch the desktop build with `--shots` (16:9-locked window)
and press **F12** at each moment; exact 1920×1080 PNGs land in
`~/Pictures/joint-liability-shots/`:
1. title screen over the live den (attract mode)
2. mid-hand at a full table, litter everywhere
3. an empty in flight at another player's head
4. the waiting-room lobby, someone mid-hop
5. THE MIRROR character creator
6. the game-over leaderboard / cause of death screen
