// Stub network layer. The game currently runs fully offline against local bots.
//
// Later, plug Firebase in here (Realtime Database or Firestore) so this becomes the
// single seam between game logic and the network:
//   1. `npm install firebase`
//   2. Initialize the app with `initializeApp(config)` and grab
//      `getDatabase()` (Realtime DB, best fit for frequent position updates) or
//      `getFirestore()`.
//   3. Implement a room/lobby model: create a match doc, have each client write its
//      player state under `matches/{matchId}/players/{uid}`, and subscribe with
//      `onValue`/`onSnapshot` to receive other players' states.
//   4. Replace local `Bot` instances with `RemotePlayer` entities driven by
//      incoming network state instead of AI, while your own `Player` stays
//      locally simulated and just publishes its state on an interval.
//   5. Keep the safe zone / loot / win-condition authority on one client (host)
//      or, better, a Cloud Function, to prevent cheating.
//
// Everything below is a no-op placeholder so the rest of the codebase can already
// depend on this interface.
export class NetworkManager {
  constructor() {
    this.connected = false;
    this.matchId = null;
    this._listeners = new Map();
  }

  async connect(/* config */) {
    // TODO: initialize Firebase app + database here.
    this.connected = false;
    return false;
  }

  async joinMatch(/* matchId */) {
    // TODO: subscribe to `matches/{matchId}` and player list.
  }

  sendPlayerState(/* state */) {
    // TODO: write local player's { x, y, facing, health, weaponKey } to the DB,
    // throttled (e.g. every 50-100ms) rather than every frame.
  }

  on(event, callback) {
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    this._listeners.get(event).push(callback);
  }

  _emit(event, payload) {
    for (const cb of this._listeners.get(event) ?? []) cb(payload);
  }

  disconnect() {
    this.connected = false;
  }
}
