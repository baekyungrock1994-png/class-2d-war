import { ONLINE_TOTAL_SLOTS } from "../utils/constants.js";
import { getCurrentUser } from "../network/firebase.js";

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

    this.isHost = false;
    this._currentLobby = {};

    // Set by main.js.
    this.onMatchStarted = null; // (isHost: boolean) => void
    this.onLeave = null; // () => void
    this.onStartMatch = null; // (botCount: number) => void — host's "매치 시작" click

    this.createBtn.addEventListener("click", () => this._createRoom());
    this.joinBtn.addEventListener("click", () => this._joinRoom());
    this.backBtn.addEventListener("click", () => {
      this.hide();
      if (this.onLeave) this.onLeave();
    });
    this.startBtn.addEventListener("click", () => this._startMatch());
    this.leaveBtn.addEventListener("click", () => this._leave());
  }

  showOnlineMenu() {
    this.hide();
    this._setError("");
    if (!this.nameInput.value) {
      const user = getCurrentUser();
      if (user?.displayName) this.nameInput.value = user.displayName;
    }
    this.onlineMenuScreen.classList.remove("hidden");
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
    try {
      const roomId = await this.roomService.createRoom(this.nameInput.value.trim());
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
    try {
      const roomId = await this.roomService.joinRoom(code, this.nameInput.value.trim());
      this._enterRoomLobby(roomId, this.roomService.isHost);
    } catch (err) {
      this._setError(err.message || "참가하지 못했습니다.");
    }
  }

  _enterRoomLobby(roomId, isHost) {
    this.isHost = isHost;
    this.hide();
    this.roomLobbyScreen.classList.remove("hidden");
    this.roomCodeDisplay.textContent = `방 코드: ${roomId}`;
    this.startBtn.classList.toggle("hidden", !isHost);
    this.statusText.textContent = isHost
      ? "인원이 모이면 매치 시작을 눌러주세요."
      : "호스트가 매치를 시작하길 기다리는 중...";

    this.roomService.onLobby((lobby) => {
      this._currentLobby = lobby || {};
      this._renderPlayerList();
    });

    this.roomService.onStatus((status) => {
      if (status === "playing") {
        this.hide();
        if (this.onMatchStarted) this.onMatchStarted(this.isHost);
      }
    });
  }

  _renderPlayerList() {
    this.playerListEl.innerHTML = "";
    const entries = Object.values(this._currentLobby);
    for (const entry of entries) {
      const li = document.createElement("li");
      li.textContent = entry.name || "플레이어";
      if (entry.isHost) li.classList.add("is-host");
      this.playerListEl.appendChild(li);
    }
  }

  _startMatch() {
    if (!this.isHost) return;
    const realPlayerCount = Math.max(1, Object.keys(this._currentLobby).length);
    const botCount = Math.max(0, ONLINE_TOTAL_SLOTS - realPlayerCount);
    if (this.onStartMatch) this.onStartMatch(botCount);
  }

  async _leave() {
    await this.roomService.leaveRoom();
    this.hide();
    if (this.onLeave) this.onLeave();
  }
}
