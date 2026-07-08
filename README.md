# Degenerate Blackjack 3D

A 3D, multiplayer-shaped rebuild of `degenerate-blackjack.html`: players sit
around a blackjack table, gamble, chain-smoke and drink to stay alive, and
fling the empties across the room — where they stay, forever, as physics
debris.

## Architecture

```
shared/   The authoritative simulation: blackjack rules, per-player meters,
          round state machine, Rapier physics world, intents in / snapshots out.
          Deterministic (seeded RNG, fixed 60 Hz tick), no DOM, runs anywhere.
client/   Three.js renderer + DOM HUD. Sends intents, draws snapshots.
          Single-player: the sim runs in a web worker (LocalTransport).
server/   The same sim behind a websocket (one shared room) for multiplayer.
```

The renderer never mutates game state. The client's only channel to the game
is intents (`bet`, `hit`, `consumeStart`, `fling`, …); the sim validates
everything (fling velocity is clamped server-side, throw origins are pinned to
arm's length, ritual timing is authoritative). Swapping single player for
multiplayer is swapping the transport.

## Run it

```sh
npm install
npm run dev          # single player at http://localhost:5173 (sim in a worker)
```

Multiplayer (same machine):

```sh
npm run server       # websocket room on :8081
npm run dev          # then open http://localhost:5173/?server=auto
```

`?server=auto` dials `ws://<the page's host>:8081`, so the same URL works
from any machine. Also accepted: `?server=8090` (port on the page's host)
and a full `?server=ws://host:port`. Beware `ws://localhost:8081` on another
machine: that's the *other machine's* localhost. If the table can't be
reached, DEAL ME IN stays disabled and the title screen says why.

Multiplayer across two machines on your LAN (second machine joins the same
room; `?name=` skips typing a name):

```sh
npm run server
npm run dev -- --host        # vite must listen beyond localhost
# this machine:   http://localhost:5173/?server=auto
# other machine:  http://<this-machine-ip>:5173/?server=auto&name=BOB
```

(The docker dev profile already runs vite with `--host`, so with
`docker compose --profile dev up` the same two URLs work as-is.)

Checks:

```sh
npm run test:sim     # headless end-to-end sim drive (round + ritual + fling)
npm run typecheck
npm run build
```

### Docker

```sh
docker compose --profile prod up --build
```

Starts the websocket room on `:8081` (`server/Dockerfile`, runs `server/src`
via `tsx`, no compile step) and the built client behind nginx on `:8080`
(`client/Dockerfile`, multi-stage `vite build`). Open:

- `http://localhost:8080` — single player (sim runs in a browser worker).
- `http://localhost:8080/?server=ws://localhost:8081` — multiplayer, against
  the containerized room.

Both Dockerfiles build from the repo root (`docker build -f server/Dockerfile .`)
since npm workspaces span `client/`, `server/`, and `shared/`.

Hot reload — the repo is bind-mounted into the containers, `tsx watch`
restarts the room and vite HMR patches the browser on every edit:

```sh
docker compose --profile dev up --build
```

- `http://localhost:5173` — vite dev server (single player).
- `http://localhost:5173/?server=auto` — multiplayer.

## Controls

- Bet with the chip rack, DEAL / HIT / STAND / DOUBLE.
- **Smoke**: drag the cigar from the sidebar to the target ring mid-screen,
  then hold still while the lighter does its work — wobble and the flame
  restarts. **Drink**: drag the bottle to the ring, then swipe up and hold to
  pour; tip back down to pause. (Enter on a focused item runs the ritual
  hands-free at the same time cost.)
- The empty stays in your hand: grab it with the pointer, drag, and release
  to fling it. Or ignore it and it drops on its own.
- Debris glows amber under the cursor when it's grabbable — press-drag-release
  flings it straight off the floor, a plain click takes it into your hand.
  Rolling and mid-air items can be snatched too. With your hands full the
  held item flashes red and the grab is denied.
- Drag anywhere else to look around.

Ritual progress is enforced by the simulation: the client only reports
whether the gesture is currently engaged; the sim runs the clock, so the
time cost can't be skipped by a modified client.

The original 2D game is preserved untouched at `degenerate-blackjack.html`.
