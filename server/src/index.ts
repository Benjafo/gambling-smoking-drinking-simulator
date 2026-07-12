/* Entry point: bind the lobby server. Clients connect with
   http://<vite host>:5173/  (the menu dials ws://<page host>:8081 by
   default; ?server=… overrides — see client/src/transport.ts). */
import { startServer } from "./server";

const PORT = Number(process.env.PORT ?? 8081);
startServer(PORT);
console.log(`blackjack house open on ws://localhost:${PORT}`);
