import { Camera } from "./Camera.js";
import { Input } from "./Input.js";
import { HUD } from "../ui/HUD.js";
import { GameMap } from "../world/GameMap.js";
import { SafeZone } from "../world/SafeZone.js";
import { drawLoot } from "../world/Loot.js";
import { drawUnit } from "../render/drawUnit.js";
import {
  WEAPONS,
  WEAPON_SLOTS,
  MEDKIT_SLOT,
  INPUT_SEND_MS,
  WORLD_WIDTH,
  WORLD_HEIGHT,
  BULLET_RADIUS,
  HOST_STALE_MS,
} from "../utils/constants.js";
import { angleTo } from "../utils/math.js";

const FULL_MAP_ZONE = {
  centerX: WORLD_WIDTH / 2,
  centerY: WORLD_HEIGHT / 2,
  currentRadius: Math.min(WORLD_WIDTH, WORLD_HEIGHT) / 2,
  state: "hold",
  phaseIndex: 0,
  targetCenter: { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 },
  targetRadius: Math.min(WORLD_WIDTH, WORLD_HEIGHT) / 2,
};

// The non-host side of an online match: no local simulation at all, just a
// thin loop that sends this player's input up to the host and renders
// whatever the host's latest snapshot says the world looks like. Reuses the
// same rendering code (GameMap/SafeZone/drawLoot/drawUnit) as the host and
// solo modes by feeding it plain objects shaped like the real classes.
export class GuestView {
  constructor(canvas, roomService, myUid) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.roomService = roomService;
    this.myUid = myUid;
    this.hud = new HUD();
    this.input = new Input(canvas);
    this.camera = new Camera(canvas.width, canvas.height);

    this.mapData = null;
    this.snapshot = null;
    this.running = false;
    this._rafId = null;
    this._lastSendAt = 0;
    this._medkitSeq = 0;
    this._selectedWeapon = "fist";
    this._matchOverNotified = false;
    this._spawnNotified = false;
    this._localDeathNotified = false;
    this._hostLostNotified = false;
    this._lastSnapshotAt = 0;

    this.onGameOver = null; // (didWin: boolean) => void
    this.onSpawned = null; // () => void — fires once this player appears in a snapshot
    this.onLocalDeath = null; // () => void — this player died but the match continues
    this.onHostLost = null; // () => void — no snapshot for HOST_STALE_MS; host likely disconnected

    this._resize();
    this._resizeHandler = () => this._resize();
    window.addEventListener("resize", this._resizeHandler);
  }

  _resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = window.innerWidth * dpr;
    this.canvas.height = window.innerHeight * dpr;
    this.canvas.style.width = `${window.innerWidth}px`;
    this.canvas.style.height = `${window.innerHeight}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.camera) this.camera.resize(window.innerWidth, window.innerHeight);
  }

  setMap(mapData) {
    this.mapData = mapData;
  }

  start() {
    this.hud.show();
    this.running = true;
    this._lastSnapshotAt = performance.now();
    this.roomService.onSnapshot((snap) => {
      this.snapshot = this._hydrateSnapshot(snap);
      this._lastSnapshotAt = performance.now();
      this._checkSpawned();
      this._checkLocalDeath();
      this._checkMatchOver();
    });
    this._rafId = requestAnimationFrame((ts) => this._loop(ts));
  }

  stop() {
    this.running = false;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this.hud.hide();
  }

  destroy() {
    this.stop();
    window.removeEventListener("resize", this._resizeHandler);
  }

  _loop() {
    if (!this.running) return;
    this._checkHostAlive();
    if (!this.running) return; // _checkHostAlive may have stopped us
    this._sendInputThrottled();
    this._draw();
    this.input.endFrame();
    this._rafId = requestAnimationFrame(() => this._loop());
  }

  _checkHostAlive() {
    if (this._hostLostNotified) return;
    if (performance.now() - this._lastSnapshotAt > HOST_STALE_MS) {
      this._hostLostNotified = true;
      this.stop();
      if (this.onHostLost) this.onHostLost();
    }
  }

  _sendInputThrottled() {
    const now = performance.now();
    if (now - this._lastSendAt < INPUT_SEND_MS) return;
    this._lastSendAt = now;

    const me = this.snapshot?.players?.[this.myUid];
    const myX = me?.x ?? WORLD_WIDTH / 2;
    const myY = me?.y ?? WORLD_HEIGHT / 2;
    const worldMouse = this.camera.screenToWorld(this.input.mouseX, this.input.mouseY);
    const facing = angleTo(myX, myY, worldMouse.x, worldMouse.y);

    for (const { code, weapon } of WEAPON_SLOTS) {
      if (this.input.wasJustPressed(code)) this._selectedWeapon = weapon;
    }
    if (this.input.wasJustPressed(MEDKIT_SLOT.code)) this._medkitSeq += 1;

    this.roomService
      .sendInput({
        up: this.input.isDown("KeyW") || this.input.isDown("ArrowUp"),
        down: this.input.isDown("KeyS") || this.input.isDown("ArrowDown"),
        left: this.input.isDown("KeyA") || this.input.isDown("ArrowLeft"),
        right: this.input.isDown("KeyD") || this.input.isDown("ArrowRight"),
        reload: this.input.isDown("KeyR"),
        mouseDown: this.input.mouseDown,
        facing,
        desiredWeapon: this._selectedWeapon,
        medkitSeq: this._medkitSeq,
      })
      .catch(() => {});
  }

  // The host sends `meleeSwingRemainingMs` (a duration, clock-independent) rather
  // than an absolute performance.now() timestamp, since the two processes' clocks
  // don't share an epoch. Re-anchor it to this tab's own clock once, here, so
  // drawUnit()'s repeated performance.now() reads during rendering stay correct
  // between snapshots.
  _hydrateSnapshot(snap) {
    const recvNow = performance.now();
    const hydrateUnit = (u) => ({ ...u, meleeSwingUntil: recvNow + (u.meleeSwingRemainingMs || 0) });

    const players = {};
    for (const [uid, p] of Object.entries(snap.players || {})) players[uid] = hydrateUnit(p);
    const bots = {};
    for (const [id, b] of Object.entries(snap.bots || {})) bots[id] = hydrateUnit(b);

    return { ...snap, players, bots };
  }

  _checkSpawned() {
    if (this._spawnNotified) return;
    if (this.snapshot?.players?.[this.myUid]) {
      this._spawnNotified = true;
      if (this.onSpawned) this.onSpawned();
    }
  }

  _checkLocalDeath() {
    if (this._localDeathNotified) return;
    const me = this.snapshot?.players?.[this.myUid];
    if (me && !me.alive) {
      this._localDeathNotified = true;
      if (this.onLocalDeath) this.onLocalDeath();
    }
  }

  _checkMatchOver() {
    if (this.snapshot?.matchOver && !this._matchOverNotified) {
      this._matchOverNotified = true;
      this.stop();
      if (this.onGameOver) this.onGameOver(this.snapshot.winnerUid === this.myUid);
    }
  }

  _draw() {
    const ctx = this.ctx;
    const camera = this.camera;
    const snap = this.snapshot;

    ctx.fillStyle = "#12210f";
    ctx.fillRect(0, 0, camera.viewWidth, camera.viewHeight);

    if (!snap || !this.mapData) return;

    const me = snap.players?.[this.myUid];
    if (me && me.alive) camera.follow(me);

    ctx.save();
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);

    GameMap.prototype.draw.call(this.mapData, ctx, camera);
    drawLoot(ctx, camera, Object.values(snap.loot || {}));
    SafeZone.prototype.draw.call(snap.safeZone || FULL_MAP_ZONE, ctx, camera);

    for (const bot of Object.values(snap.bots || {})) {
      if (bot.alive) drawUnit(ctx, bot, "#e05a5a", "#555");
    }
    for (const [uid, p] of Object.entries(snap.players || {})) {
      if (uid === this.myUid || !p.alive) continue;
      drawUnit(ctx, p, "#b565d8", "#555");
    }
    for (const bullet of snap.bullets || []) {
      ctx.fillStyle = "#fff59d";
      ctx.beginPath();
      ctx.arc(bullet.x, bullet.y, BULLET_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
    if (me && me.alive) drawUnit(ctx, me, "#3f8efc", "#555");

    ctx.restore();

    if (me) {
      const zone = snap.safeZone || FULL_MAP_ZONE;
      this.hud.update(
        { ...me, weapon: WEAPONS[me.weaponKey], ownedWeapons: new Set(me.ownedWeapons || ["fist"]) },
        snap.aliveCount ?? 0,
        { ...zone, timeUntilNextShrinkMs: () => zone.timeUntilNextShrinkMs ?? 0 }
      );
    }
  }
}
