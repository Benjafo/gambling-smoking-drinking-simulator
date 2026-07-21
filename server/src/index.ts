/* Entry point: bind the lobby server. Clients connect with
   http://<vite host>:5173/  (the menu dials ws://<page host>:8081 by
   default; ?server=… overrides — see client/src/transport.ts).

   MAX_LOBBIES is required on purpose: the cap is this box's measured
   table capacity (run src/loadtest.ts against it), and a deploy that
   hasn't stated one shouldn't come up with a silent guess. */
import { startServer } from "./server";

const PORT = Number(process.env.PORT ?? 8081);
const maxLobbies = Number(process.env.MAX_LOBBIES);
if (!Number.isInteger(maxLobbies) || maxLobbies < 1) {
  console.error(
    "MAX_LOBBIES env var is required (positive integer: this box's measured " +
      "table capacity — see server/src/loadtest.ts). Refusing to start."
  );
  process.exit(1);
}
startServer(PORT, maxLobbies);
console.log(`blackjack house open on ws://localhost:${PORT}`);
