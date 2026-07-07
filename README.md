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
npm run dev          # then open http://localhost:5173/?server=ws://localhost:8081
```

Checks:

```sh
npm run test:sim     # headless end-to-end sim drive (round + ritual + fling)
npm run typecheck
npm run build
```

### Docker

```sh
docker compose up --build
```

Starts the websocket room on `:8081` (`server/Dockerfile`, runs `server/src`
via `tsx`, no compile step) and the built client behind nginx on `:8080`
(`client/Dockerfile`, multi-stage `vite build`). Open:

- `http://localhost:8080` — single player (sim runs in a browser worker).
- `http://localhost:8080/?server=ws://localhost:8081` — multiplayer, against
  the containerized room.

Both Dockerfiles build from the repo root (`docker build -f server/Dockerfile .`)
since npm workspaces span `client/`, `server/`, and `shared/`.

## Controls

- Bet with the chip rack, DEAL / HIT / STAND / DOUBLE.
- **Smoke**: drag the cigar from the sidebar to the target ring mid-screen,
  then hold still while the lighter does its work — wobble and the flame
  restarts. **Drink**: drag the bottle to the ring, then swipe up and hold to
  pour; tip back down to pause. (Enter on a focused item runs the ritual
  hands-free at the same time cost.)
- The empty stays in your hand: grab it with the pointer, drag, and release
  to fling it. Or ignore it and it drops on its own.
- Click a settled bottle/butt within reach to pick it back up.
- Drag anywhere else to look around.

Ritual progress is enforced by the simulation: the client only reports
whether the gesture is currently engaged; the sim runs the clock, so the
time cost can't be skipped by a modified client.

The original 2D game is preserved untouched at `degenerate-blackjack.html`.
