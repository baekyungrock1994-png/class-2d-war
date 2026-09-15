import { ONLINE_TOTAL_SLOTS } from "../utils/constants.js";
import { getUid } from "../network/firebase.js";

const NICKNAME_STORAGE_KEY = "2dwar_nickname";

// Owns the two pre-match online screens: the create/join menu and the room
// lobby (player list + host's start button). Room create/join talk to
// RoomService directly; anything that needs the Game instance (starting the
// match, entering drop-select) is bubbled up via the on* callbacks below,
// which main.js wires up — matching the pattern DropSelect already uses.
export class Lobby {
  constructor(roomService) {
    this.roomService = roomService;

    this.onlineMenuScreen = document.getElementById("online-menu-screen");
    this.nameInput = document.getElementById("player-name-input");
    this.createBtn = document.getElementById("create-room-btn");
    this.roomCodeInput = document.getElementById("room-code-input");
    this.joinBtn = document.getElementById("join-room-btn");
    this.errorText = document.getElementById("online-error-text");
    this.backBtn = document.getElementById("online-back-btn");

    this.roomLobbyScreen = document.getElementById("room-lobby-screen");
    this.roomCodeDisplay = document.getElementById("room-code-display");
    this.playerListEl = document.getElementById("lobby-player-list");
    this.statusText = document.getElementById("lobby-status-text");
    this.startBtn = document.getElementById("lobby-start-btn");
    this.leaveBtn = document.getElementById("lobby-leave-btn");
    this.botCountRow = document.getElementById("bot-count-row");
    this.botCountInput = document.getElementById("bot-count-input");

    this.isHost = false;
    this._currentLobby = {};
    this._hasSeenSelfInLobby = false;
    this._leavingVoluntarily = false;
    this._botCountEdited = false;

    // Set by main.js.
    this.onMatchStarted = null; // (isHost: boolean) => void
    this.onLeave = null; // () => void
    this.onStartMatch = null; // (botCount: number) => void — host's "매치 시작" click
    this.onKicked = null; // () => void — the host removed this player from the lobby

    this.createBtn.addEventListener("click", () => this._createRoom());
    this.joinBtn.addEventListener("click", () => this._joinRoom());
    this.backBtn.addEventListener("click", () => {
      this.hide();
      if (this.onLeave) this.onLeave();
    });
    this.startBtn.addEventListener("click", () => this._startMatch());
    this.leaveBtn.addEventListener("click", () => this._leave());
    this.botCountInput.addEventListener("input", () => {
      this._botCountEdited = true;
    });
  }

  showOnlineMenu() {
    this.hide();
    this._setError("");
    if (!this.nameInput.value) {
      const saved = this._loadNickname();
      if (saved) this.nameInput.value = saved;
    }
    this.onlineMenuScreen.classList.remove("hidden");
  }

  // No account behind the nickname (see firebase.js's anonymous sign-in) —
  // just remember the last one typed on this device, .io-game style, so
  // returning players don't have to retype it every time.
  _loadNickname() {
    try {
      return localStorage.getItem(NICKNAME_STORAGE_KEY) || "";
    } catch {
      return "";
    }
  }

  _saveNickname(name) {
    if (!name) return;
    try {
      localStorage.setItem(NICKNAME_STORAGE_KEY, name);
    } catch {
      // Private browsing or storage disabled — nothing to remember, no harm done.
    }
  }

  hide() {
    this.onlineMenuScreen.classList.add("hidden");
    this.roomLobbyScreen.classList.add("hidden");
  }

  _setError(msg) {
    this.errorText.textContent = msg;
    this.errorText.classList.toggle("hidden", !msg);
  }

  async _createRoom() {
    this._setError("");
    const name = this.nameInput.value.trim();
    try {
      const roomId = await this.roomService.createRoom(name);
      this._saveNickname(name);
      this._enterRoomLobby(roomId, true);
    } catch (err) {
      this._setError(err.message || "방을 만들지 못했습니다.");
    }
  }

  async _joinRoom() {
    this._setError("");
    const code = this.roomCodeInput.value.trim();
    if (!code) {
      this._setError("방 코드를 입력해주세요.");
      return;
    }
    const name = this.nameInput.value.trim();
    try {
      const roomId = await this.roomService.joinRoom(code, name);
      this._saveNickname(name);
      this._enterRoomLobby(roomId, this.roomService.isHost);
    } catch (err) {
      this._setError(err.message || "참가하지 못했습니다.");
    }
  }

  _enterRoomLobby(roomId, isHost) {
    this.isHost = isHost;
    this._hasSeenSelfInLobby = false;
    this._leavingVoluntarily = false;
    this._botCountEdited = false;
    this.hide();
    this.roomLobbyScreen.classList.remove("hidden");
    this.roomCodeDisplay.textContent = `방 코드: ${roomId}`;
    this.startBtn.classList.toggle("hidden", !isHost);
    this.botCountRow.classList.toggle("hidden", !isHost);
    this.statusText.textContent = isHost
      ? "인원이 모이면 매치 시작을 눌러주세요."
      : "호스트가 매치를 시작하길 기다리는 중...";

    this.roomService.onLobby((lobby) => {
      this._currentLobby = lobby || {};
      this._checkKicked();
      this._renderPlayerList();
      this._suggestBotCount();
    });

    this.roomService.onStatus((status) => {
      if (status === "playing") {
        this.hide();
        if (this.onMatchStarted) this.onMatchStarted(this.isHost);
      }
    });
  }

  // If our own uid was present at some point and then disappears from the
  // lobby without us having asked to leave, the host removed us.
  _checkKicked() {
    const myUid = getUid();
    if (!myUid) return;
    const stillHere = myUid in this._currentLobby;
    if (stillHere) {
      this._hasSeenSelfInLobby = true;
      return;
    }
    if (this._hasSeenSelfInLobby && !this._leavingVoluntarily) {
      this._hasSeenSelfInLobby = false;
      this.hide();
      if (this.onKicked) this.onKicked();
    }
  }

  _renderPlayerList() {
    this.playerListEl.innerHTML = "";
    const myUid = getUid();
    for (const [uid, entry] of Object.entries(this._currentLobby)) {
      const li = document.createElement("li");
      if (entry.isHost) li.classList.add("is-host");

      const nameSpan = document.createElement("span");
      nameSpan.className = "player-name";
      nameSpan.textContent = entry.name || "플레이어";
      li.appendChild(nameSpan);

      if (this.isHost && !entry.isHost && uid !== myUid) {
        const kickBtn = document.createElement("button");
        kickBtn.className = "kick-btn";
        kickBtn.textContent = "추방";
        kickBtn.addEventListener("click", () => this.roomService.kickPlayer(uid));
        li.appendChild(kickBtn);
      }

      this.playerListEl.appendChild(li);
    }
  }

  // Keeps the bot-count input defaulted to "fill the rest of the slots" as
  // people join/leave, but only until the host actually types a value —
  // after that their choice sticks regardless of lobby size.
  _suggestBotCount() {
    if (!this.isHost || this._botCountEdited) return;
    const realPlayerCount = Math.max(1, Object.keys(this._currentLobby).length);
    this.botCountInput.value = Math.max(0, ONLINE_TOTAL_SLOTS - realPlayerCount);
  }

  _startMatch() {
    if (!this.isHost) return;
    const parsed = parseInt(this.botCountInput.value, 10);
    const botCount = Number.isFinite(parsed) ? Math.max(0, Math.min(30, parsed)) : 0;
    if (this.onStartMatch) this.onStartMatch(botCount);
  }

  async _leave() {
    this._leavingVoluntarily = true;
    await this.roomService.leaveRoom();
    this.hide();
    if (this.onLeave) this.onLeave();
  }
}
