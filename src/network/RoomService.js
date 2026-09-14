import {
  ref,
  get,
  set,
  update,
  remove,
  onValue,
  off,
  onDisconnect,
  runTransaction,
  serverTimestamp,
} from "firebase/database";
import { db, authReady, getUid } from "./firebase.js";
import { ROOM_CODE_LENGTH, ROOM_CODE_ALPHABET } from "../utils/constants.js";

function randomRoomCode() {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

// Wraps the Firebase Realtime Database room/lobby/input/snapshot protocol described
// in the README's Firebase section. One instance per active session; call leaveRoom()
// (or destroy()) when done so onDisconnect cleanup doesn't linger unnecessarily.
export class RoomService {
  constructor() {
    this.roomId = null;
    this.isHost = false;
    this._listeners = []; // [{ path, callback }] for cleanup
  }

  async _uid() {
    if (getUid()) return getUid();
    return authReady;
  }

  _requireDb() {
    if (!db) {
      throw new Error(
        "Realtime Database가 설정되지 않았습니다. firebaseConfig.js의 databaseURL을 확인해주세요."
      );
    }
  }

  // Claims an unused room code via a transaction so two hosts can't collide.
  async createRoom(hostName) {
    this._requireDb();
    const uid = await this._uid();

    for (let attempt = 0; attempt < 8; attempt++) {
      const code = randomRoomCode();
      const roomRef = ref(db, `rooms/${code}`);
      const result = await runTransaction(roomRef, (current) => {
        if (current !== null) return; // abort — taken
        return {
          hostId: uid,
          status: "lobby",
          createdAt: serverTimestamp(),
        };
      });
      if (result.committed) {
        this.roomId = code;
        this.isHost = true;
        await this._joinLobby(code, uid, hostName, true);
        this._armPresenceCleanup(code, uid);
        return code;
      }
    }
    throw new Error("방 코드를 발급하지 못했습니다. 다시 시도해주세요.");
  }

  async joinRoom(roomId, guestName) {
    this._requireDb();
    const code = roomId.trim().toUpperCase();
    const uid = await this._uid();

    const snap = await get(ref(db, `rooms/${code}`));
    if (!snap.exists()) throw new Error("존재하지 않는 방 코드입니다.");
    const room = snap.val();
    if (room.status !== "lobby") throw new Error("이미 시작된 매치입니다.");

    this.roomId = code;
    this.isHost = room.hostId === uid;
    await this._joinLobby(code, uid, guestName, this.isHost);
    this._armPresenceCleanup(code, uid);
    return code;
  }

  async _joinLobby(code, uid, name, isHost) {
    await set(ref(db, `rooms/${code}/lobby/${uid}`), {
      name: name || (isHost ? "호스트" : "플레이어"),
      isHost,
      joinedAt: serverTimestamp(),
    });
  }

  _armPresenceCleanup(code, uid) {
    onDisconnect(ref(db, `rooms/${code}/lobby/${uid}`)).remove();
    onDisconnect(ref(db, `rooms/${code}/input/${uid}`)).remove();
  }

  // Host only: removes a guest from the lobby. Not a ban — they can rejoin
  // with the same room code afterward. Relies on the $roomId-level rule
  // granting the host write access anywhere under the room, same as
  // startMatch()/sendSnapshot(); the target's own uid rule doesn't need to
  // allow this since the host's write is authorized at the ancestor level.
  async kickPlayer(uid) {
    if (!this.isHost || !this.roomId || !uid) return;
    await Promise.all([
      remove(ref(db, `rooms/${this.roomId}/lobby/${uid}`)).catch(() => {}),
      remove(ref(db, `rooms/${this.roomId}/input/${uid}`)).catch(() => {}),
    ]);
  }

  async leaveRoom() {
    if (!this.roomId) return;
    const uid = getUid();
    this._offAll();
    if (uid) {
      await remove(ref(db, `rooms/${this.roomId}/lobby/${uid}`)).catch(() => {});
      await remove(ref(db, `rooms/${this.roomId}/input/${uid}`)).catch(() => {});
    }
    this.roomId = null;
    this.isHost = false;
  }

  // Host only: publishes the generated map once so guests can preview it while
  // picking a drop point, then flips the room into "playing".
  async startMatch(mapPayload) {
    if (!this.isHost || !this.roomId) return;
    await update(ref(db, `rooms/${this.roomId}`), {
      map: mapPayload,
      status: "playing",
      startedAt: serverTimestamp(),
    });
  }

  async endMatch(result) {
    if (!this.isHost || !this.roomId) return;
    await update(ref(db, `rooms/${this.roomId}`), { status: "ended", result });
  }

  onLobby(callback) {
    this._subscribe(`rooms/${this.roomId}/lobby`, (val) => callback(val || {}));
  }

  onStatus(callback) {
    this._subscribe(`rooms/${this.roomId}/status`, (val) => callback(val || "lobby"));
  }

  onMap(callback) {
    this._subscribe(`rooms/${this.roomId}/map`, (val) => {
      if (val) callback(val);
    });
  }

  // Guest -> host: throttle calls to this on the caller's side (INPUT_SEND_MS).
  // Uses update() (merge), not set(), so a one-off field like dropRequest — written
  // separately via requestDrop() — survives subsequent regular input sends instead
  // of being wiped by them.
  async sendInput(payload) {
    const uid = getUid();
    if (!uid || !this.roomId) return;
    await update(ref(db, `rooms/${this.roomId}/input/${uid}`), { ...payload, t: Date.now() });
  }

  // Host only: subscribes to every connected guest's latest input at once.
  onAllInput(callback) {
    this._subscribe(`rooms/${this.roomId}/input`, (val) => callback(val || {}));
  }

  // Host -> everyone: throttle calls to this on the caller's side (SNAPSHOT_SEND_MS).
  async sendSnapshot(snapshot) {
    if (!this.isHost || !this.roomId) return;
    await set(ref(db, `rooms/${this.roomId}/snapshot`), { ...snapshot, t: Date.now() });
  }

  onSnapshot(callback) {
    this._subscribe(`rooms/${this.roomId}/snapshot`, (val) => {
      if (val) callback(val);
    });
  }

  async requestDrop(x, y) {
    const uid = getUid();
    if (!uid || !this.roomId) return;
    await update(ref(db, `rooms/${this.roomId}/input/${uid}`), { dropRequest: { x, y } });
  }

  _subscribe(path, callback) {
    const r = ref(db, path);
    const wrapped = (snap) => callback(snap.val());
    onValue(r, wrapped);
    this._listeners.push({ ref: r, callback: wrapped });
  }

  _offAll() {
    for (const { ref: r, callback } of this._listeners) off(r, "value", callback);
    this._listeners = [];
  }
}
