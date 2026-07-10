/* Main menu: the door of the establishment. Shows the live table (lobby)
   list from the server, lets you open a table (optionally private with a
   password), sit down at one, or play solo against a local worker. Hands a
   Session to main.ts and gets out of the way; reappears when the session
   ends (settings → leave, or the connection dying). */
import { LOBBY_NAME_MAX } from "@shared/constants";
import type { LobbyInfo } from "@shared/types";
import {
  LocalSession,
  ServerConnection,
  resolveServerUrl,
  type Session,
} from "../transport";

const $ = (id: string): HTMLElement => document.getElementById(id)!;

/* lobby + player names are user input rendered via innerHTML — escape them */
function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );
}

function phaseLabel(l: LobbyInfo): string {
  if (l.phase === "lobby") return "SEATING";
  if (l.phase === "over") return "BETWEEN RUNS";
  return "IN PLAY";
}

export class MenuControl {
  private conn: ServerConnection;
  private joinTarget: LobbyInfo | null = null;
  private busy = false;

  constructor(private onSession: (s: Session) => void) {
    this.wire();
    this.conn = new ServerConnection(resolveServerUrl());
    this.conn.onChange(() => this.render());
    // keep knocking while the menu is up and the house isn't answering
    setInterval(() => {
      if (
        this.visible() &&
        (this.conn.status === "unreachable" || this.conn.status === "lost")
      )
        this.conn.connect();
    }, 4000);
  }

  /* ---------------- wiring ---------------- */
  private wire(): void {
    const nameInput = $("nameInput") as HTMLInputElement;
    nameInput.value =
      new URLSearchParams(location.search).get("name") ??
      localStorage.getItem("degen-name") ??
      "";

    $("soloBtn").addEventListener("click", () => {
      this.seat(Promise.resolve(new LocalSession(this.playerName())));
    });

    const privateChk = $("privateChk") as HTMLInputElement;
    const passInput = $("lobbyPassInput") as HTMLInputElement;
    privateChk.addEventListener("change", () => {
      passInput.style.display = privateChk.checked ? "" : "none";
      if (privateChk.checked) passInput.focus();
    });

    $("createBtn").addEventListener("click", () => {
      if (this.busy) return;
      const password = privateChk.checked ? passInput.value : null;
      if (privateChk.checked && !password) {
        this.error("A PRIVATE TABLE NEEDS A PASSWORD.");
        passInput.focus();
        return;
      }
      const tableName =
        ($("lobbyNameInput") as HTMLInputElement).value.trim().slice(0, LOBBY_NAME_MAX) ||
        this.playerName() + "'S TABLE";
      this.seat(this.conn.createLobby(tableName, password, this.playerName()));
    });

    $("serverList").addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest(".join-btn") as HTMLButtonElement | null;
      if (!btn || btn.disabled || this.busy) return;
      const lobby = this.conn.lobbies.find((l) => l.id === btn.dataset.id);
      if (!lobby) return;
      if (lobby.locked) {
        // the password box lives outside the re-rendered list so a list
        // refresh mid-typing can't wipe the input
        this.joinTarget = lobby;
        this.error("");
        this.render();
        ($("joinPassInput") as HTMLInputElement).focus();
      } else {
        this.seat(this.conn.joinLobby(lobby.id, null, this.playerName()));
      }
    });

    const joinGo = () => {
      if (!this.joinTarget || this.busy) return;
      const pass = ($("joinPassInput") as HTMLInputElement).value;
      this.seat(this.conn.joinLobby(this.joinTarget.id, pass, this.playerName()));
    };
    $("joinGoBtn").addEventListener("click", joinGo);
    $("joinPassInput").addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Enter") joinGo();
    });
    $("joinCancelBtn").addEventListener("click", () => {
      this.joinTarget = null;
      ($("joinPassInput") as HTMLInputElement).value = "";
      this.render();
    });
  }

  private playerName(): string {
    const name = ($("nameInput") as HTMLInputElement).value.trim().slice(0, 24);
    if (name) localStorage.setItem("degen-name", name);
    return name || "DEGENERATE";
  }

  private seat(pending: Promise<Session>): void {
    this.busy = true;
    this.error("");
    this.render();
    pending
      .then((s) => {
        this.busy = false;
        this.joinTarget = null;
        ($("joinPassInput") as HTMLInputElement).value = "";
        this.hide();
        this.onSession(s);
      })
      .catch((e: Error) => {
        this.busy = false;
        this.error(e.message);
        this.render();
      });
  }

  private error(text: string): void {
    $("menuErr").textContent = text;
  }

  /* ---------------- state → DOM ---------------- */
  private render(): void {
    const status = $("serverStatus");
    const lobbies = this.conn.lobbies;
    switch (this.conn.status) {
      case "connecting":
        status.className = "conn";
        status.textContent = `DIALING ${this.conn.url} …`;
        break;
      case "open":
        status.className = "conn ok";
        status.textContent =
          lobbies.length === 0
            ? "THE HOUSE IS OPEN. NO TABLES YET — START ONE."
            : `${lobbies.length} TABLE${lobbies.length === 1 ? "" : "S"} ON THE FLOOR.`;
        break;
      case "unreachable":
        status.className = "conn bad";
        status.textContent = `NO HOUSE AT ${this.conn.url} — REDIALING. (?server=… to aim elsewhere)`;
        break;
      case "lost":
        status.className = "conn bad";
        status.textContent = "LINE WENT DEAD — REDIALING…";
        break;
    }

    const canAct = this.conn.status === "open" && !this.busy;
    $("serverList").innerHTML = lobbies
      .map(
        (l) =>
          `<div class="server-row">
             <span class="srv-name">${l.locked ? "🔒 " : ""}${esc(l.name)}</span>
             <span class="srv-meta">${l.players}/${l.maxPlayers} · ${phaseLabel(l)}</span>
             <button class="menu-btn join-btn" data-id="${l.id}"
                     ${canAct && l.players < l.maxPlayers ? "" : "disabled"}>
               ${l.players < l.maxPlayers ? "JOIN" : "FULL"}
             </button>
           </div>`
      )
      .join("");
    ($("createBtn") as HTMLButtonElement).disabled = !canAct;
    ($("soloBtn") as HTMLButtonElement).disabled = this.busy;

    // password prompt for the selected locked table
    if (this.joinTarget && !lobbies.some((l) => l.id === this.joinTarget!.id)) {
      this.joinTarget = null; // folded while we hesitated
      this.error("THAT TABLE IS GONE.");
    }
    $("joinBox").style.display = this.joinTarget ? "" : "none";
    if (this.joinTarget)
      $("joinLabel").textContent = `SITTING AT «${this.joinTarget.name}» — SPEAK THE PASSWORD:`;
  }

  /* ---------------- visibility ---------------- */
  visible(): boolean {
    return $("menuScreen").classList.contains("active");
  }
  show(notice?: string): void {
    $("menuNotice").textContent = notice ?? "";
    this.error("");
    $("menuScreen").classList.add("active");
    // the list may be stale after a game; a live socket will push fresh soon
    this.render();
  }
  hide(): void {
    $("menuNotice").textContent = "";
    $("menuScreen").classList.remove("active");
  }
}
