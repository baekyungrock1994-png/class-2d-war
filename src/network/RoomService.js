import {
  ref,
  get,
  set,
  update,
  remove,
  onValue,
  onChildAdded,
  onChildChanged,
  onChildRemoved,
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
    this._listeners = new Set(); // unsubscribe functions, for leaveRoom()'s cleanup sweep
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

  // Host only: wipes every connected guest's input entry — in particular
  // `dropRequest`, which otherwise would still be sitting there from the
  // round that just ended and would be replayed as a fresh drop request the
  // instant a restarted match starts processing input again, before the
  // guest has picked a new landing spot. Same ancestor-level write rule as
  // kickPlayer().
  async clearAllInput() {
    if (!this.isHost || !this.roomId) return;
    await remove(ref(db, `rooms/${this.roomId}/input`)).catch(() => {});
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

  // Host only: publishes the generated map so guests can preview it while
  // picking a drop point, then flips the room into "playing". `round` is a
  // fresh marker every call (including a same-room restart after a match
  // ends) — guests watch it via onMatch() to know a new round has begun,
  // since "status" alone would stay "playing" -> "playing" and not re-fire.
  async startMatch(mapPayload) {
    if (!this.isHost || !this.roomId) return;
    await update(ref(db, `rooms/${this.roomId}`), {
      match: { map: mapPayload, round: Date.now() },
      status: "playing",
      startedAt: serverTimestamp(),
    });
  }

  async endMatch(result) {
    if (!this.isHost || !this.roomId) return;
    await update(ref(db, `rooms/${this.roomId}`), { status: "ended", result });
  }

  // Each onX() below returns an unsubscribe function. Multiple independent
  // listeners on the same path are fine and expected — e.g. Lobby.js and
  // Game.js both watch `lobby` for their own separate reasons — so callers
  // that re-subscribe over a match's lifetime (Game.prepareMatch() on a host
  // restart, GuestView per round) are responsible for calling their own
  // previous unsubscribe first; see Game.js/GuestView.js.
  onLobby(callback) {
    return this._subscribe(`rooms/${this.roomId}/lobby`, (val) => callback(val || {}));
  }

  onStatus(callback) {
    return this._subscribe(`rooms/${this.roomId}/status`, (val) => callback(val || "lobby"));
  }

  // Fires once for the first match and again every time the host restarts
  // the room (see startMatch's `round` marker) — callback gets { map, round }.
  onMatch(callback) {
    return this._subscribe(`rooms/${this.roomId}/match`, (val) => {
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

  // Host only: subscribes to every connected guest's latest input.
  //
  // Deliberately NOT a plain onValue() on the whole `input` node: that fires
  // with the *entire* input tree every time even one guest's entry changes,
  // so with N guests each sending ~20 updates/sec, the host would end up
  // parsing on the order of N^2 guest-entries' worth of data per second —
  // the more people in the room, the worse everyone's frame time gets, even
  // though only one guest actually changed anything.
  //
  // child_added/child_changed/child_removed instead deliver just the one
  // entry that changed; a small local map is kept in sync from those and
  // handed to the caller in full each time, so callers (Game.js) don't need
  // to know the difference.
  onAllInput(callback) {
    const path = `rooms/${this.roomId}/input`;
    const r = ref(db, path);
    const merged = {};
    const emit = () => callback({ ...merged });

    const onAdded = (snap) => {
      merged[snap.key] = snap.val();
      emit();
    };
    const onChanged = (snap) => {
      merged[snap.key] = snap.val();
      emit();
    };
    const onRemoved = (snap) => {
      delete merged[snap.key];
      emit();
    };

    onChildAdded(r, onAdded);
    onChildChanged(r, onChanged);
    onChildRemoved(r, onRemoved);

    const unsubscribe = () => {
      off(r, "child_added", onAdded);
      off(r, "child_changed", onChanged);
      off(r, "child_removed", onRemoved);
      this._listeners.delete(unsubscribe);
    };
    this._listeners.add(unsubscribe);
    return unsubscribe;
  }

  // Host -> everyone: throttle calls to this on the caller's side (SNAPSHOT_SEND_MS).
  async sendSnapshot(snapshot) {
    if (!this.isHost || !this.roomId) return;
    await set(ref(db, `rooms/${this.roomId}/snapshot`), { ...snapshot, t: Date.now() });
  }

  onSnapshot(callback) {
    return this._subscribe(`rooms/${this.roomId}/snapshot`, (val) => {
      if (val) callback(val);
    });
  }

  async requestDrop(x, y) {
    const uid = getUid();
    if (!uid || !this.roomId) return;
    await update(ref(db, `rooms/${this.roomId}/input/${uid}`), { dropRequest: { x, y } });
  }

  // Returns an unsubscribe function. Also tracked in _listeners so leaveRoom()
  // can sweep up anything a caller forgot to unsubscribe itself.
  _subscribe(path, callback) {
    const r = ref(db, path);
    const wrapped = (snap) => callback(snap.val());
    onValue(r, wrapped);

    const unsubscribe = () => {
      off(r, "value", wrapped);
      this._listeners.delete(unsubscribe);
    };
    this._listeners.add(unsubscribe);
    return unsubscribe;
  }

  _offAll() {
    for (const unsubscribe of [...this._listeners]) unsubscribe();
  }
}
