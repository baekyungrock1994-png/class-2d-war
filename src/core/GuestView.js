import { Camera } from "./Camera.js";
import { Input } from "./Input.js";
import { HUD } from "../ui/HUD.js";
import { GameMap, isHiddenInBushes } from "../world/GameMap.js";
import { SafeZone } from "../world/SafeZone.js";
import { drawLoot } from "../world/Loot.js";
import { drawUnit } from "../render/drawUnit.js";
import { Player } from "../entities/Player.js";
import {
  MEDKIT_SLOT,
  INPUT_SEND_MS,
  WORLD_WIDTH,
  WORLD_HEIGHT,
  BULLET_RADIUS,
  HOST_STALE_MS,
  HIDDEN_REVEAL_RANGE,
  REMOTE_SMOOTHING_PER_SEC,
  RECONCILE_SNAP_DISTANCE,
} from "../utils/constants.js";
import { angleTo, dist } from "../utils/math.js";

const FULL_MAP_ZONE = {
  centerX: WORLD_WIDTH / 2,
  centerY: WORLD_HEIGHT / 2,
  currentRadius: Math.min(WORLD_WIDTH, WORLD_HEIGHT) / 2,
  state: "hold",
  phaseIndex: 0,
  targetCenter: { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 },
  targetRadius: Math.min(WORLD_WIDTH, WORLD_HEIGHT) / 2,
};

// The non-host side of an online match. Its own player is a *real* Player
// instance, driven by the local keyboard/mouse exactly like the host's —
// movement, aiming, falling, and weapon/medkit switches all render instantly
// instead of waiting on a host round-trip. Health, ammo, and inventory grants
// are still host-authoritative and get synced in from each snapshot, and
// position is softly reconciled toward the host's copy to correct any drift.
// Every other entity (bots, other real players, bullets) is pure host state,
// eased toward its latest reported position each frame so it glides instead
// of jumping between snapshots.
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
    this.myPlayer = null;
    this.snapshot = null;
    this._remoteRender = new Map(); // uid/botId -> eased {x, y} for smooth rendering

    this.running = false;
    this._rafId = null;
    this._lastTs = 0;
    this._lastSendAt = 0;
    this._medkitSeq = 0;
    this._matchOverNotified = false;
    this._localDeathNotified = false;
    this._hostLostNotified = false;
    this._lastSnapshotAt = 0;

    this.onGameOver = null; // (didWin: boolean) => void
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

  // Starts falling immediately at the chosen point — no waiting on the host to
  // acknowledge the drop request (which is still sent separately so the host
  // spawns an authoritative copy of this player).
  beginLocalDrop(x, y) {
    this.myPlayer = new Player(x, y);
    this.myPlayer.startFall();
    this.start();
  }

  start() {
    this.hud.show();
    this.running = true;
    this._lastTs = performance.now();
    this._lastSnapshotAt = performance.now();
    this.roomService.onSnapshot((snap) => {
      this.snapshot = this._hydrateSnapshot(snap);
      this._lastSnapshotAt = performance.now();
      this._reconcileMyPlayer();
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

  _loop(ts) {
    if (!this.running) return;
    const dtMs = Math.min(50, ts - this._lastTs);
    this._lastTs = ts;

    this._checkHostAlive();
    if (!this.running) return; // _checkHostAlive may have stopped us

    // An uncaught error here previously killed this tab's rAF chain outright —
    // the whole match would silently freeze for this one player while the host
    // (and everyone else) kept going. Log and skip the frame instead of dying.
    try {
      this._updateMyPlayer(dtMs);
      this._sendInputThrottled();
      this._draw(dtMs);
    } catch (err) {
      console.error("게임 루프 오류 (한 프레임 건너뜀):", err);
    }
    this.input.endFrame();

    this._rafId = requestAnimationFrame((t) => this._loop(t));
  }

  _checkHostAlive() {
    if (this._hostLostNotified) return;
    if (performance.now() - this._lastSnapshotAt > HOST_STALE_MS) {
      this._hostLostNotified = true;
      this.stop();
      if (this.onHostLost) this.onHostLost();
    }
  }

  // Locally simulates this player's own movement/aim/falling/weapon-switch —
  // the same Player.update() the host runs for its own local player. Melee
  // swings are triggered locally too (instant animation feedback), but with no
  // target list, so no local damage is ever applied — hits stay host-authoritative.
  _updateMyPlayer(dtMs) {
    if (!this.myPlayer || !this.myPlayer.alive) return;
    this.myPlayer.update(dtMs, this.input, this.camera, this.mapData?.obstacles ?? []);
    if (this.input.mouseDown) this.myPlayer.tryShoot(performance.now(), []);

    // Computed locally (not synced from the snapshot) so the fade-when-hidden
    // feedback is instant, same as the host sees for its own player.
    this.myPlayer.hidden =
      !this.myPlayer.falling && isHiddenInBushes(this.myPlayer.x, this.myPlayer.y, this.mapData?.bushes ?? []);
  }

  _sendInputThrottled() {
    const now = performance.now();
    if (now - this._lastSendAt < INPUT_SEND_MS) return;
    this._lastSendAt = now;
    if (!this.myPlayer) return;

    const worldMouse = this.camera.screenToWorld(this.input.mouseX, this.input.mouseY);
    const facing = angleTo(this.myPlayer.x, this.myPlayer.y, worldMouse.x, worldMouse.y);

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
        desiredWeapon: this.myPlayer.weaponKey,
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

  // Health/inventory/ammo are host-decided (crates, damage), so they're synced
  // in outright. Position is only *nudged* toward the host's copy — small drift
  // eases out over a couple of snapshots, large drift (e.g. still catching up
  // right after landing) snaps immediately instead of slowly rubber-banding.
  _reconcileMyPlayer() {
    const me = this.snapshot?.players?.[this.myUid];
    if (!me || !this.myPlayer) return;

    this.myPlayer.health = me.health;
    this.myPlayer.alive = me.alive;
    this.myPlayer.medkitCount = me.medkitCount;
    this.myPlayer.ownedWeapons = new Set(me.ownedWeapons || ["fist"]);
    this.myPlayer.mag = me.mag;
    this.myPlayer.reserveAmmo = me.reserveAmmo;

    // The host is the only one that ever runs acquireWeapon() for this player
    // (crates are host-authoritative), so weaponAmmo — a purely local cache
    // equipWeapon() reads from — would otherwise stay empty for any weapon
    // picked up remotely. Keep at least the host's currently-equipped weapon
    // backed by real numbers; equipWeapon() itself now also tolerates a still-
    // missing entry for any other owned weapon by starting it at a full mag.
    if (me.weaponKey && me.weaponKey !== "fist") {
      this.myPlayer.weaponAmmo[me.weaponKey] = { mag: me.mag, reserve: me.reserveAmmo };
    }

    const driftDist = dist(this.myPlayer.x, this.myPlayer.y, me.x, me.y);
    if (driftDist > RECONCILE_SNAP_DISTANCE) {
      this.myPlayer.x = me.x;
      this.myPlayer.y = me.y;
    } else if (driftDist > 4) {
      this.myPlayer.x += (me.x - this.myPlayer.x) * 0.25;
      this.myPlayer.y += (me.y - this.myPlayer.y) * 0.25;
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

  // Eases a remote entity's rendered position toward `target` instead of
  // snapping to it, so the gap between snapshots reads as a glide.
  _easedPosition(key, targetX, targetY, dtSec) {
    let r = this._remoteRender.get(key);
    if (!r) {
      r = { x: targetX, y: targetY };
      this._remoteRender.set(key, r);
    } else {
      const factor = Math.min(1, REMOTE_SMOOTHING_PER_SEC * dtSec);
      r.x += (targetX - r.x) * factor;
      r.y += (targetY - r.y) * factor;
    }
    return r;
  }

  _visibleToMe(unit) {
    if (!unit.hidden) return true;
    return dist(this.myPlayer.x, this.myPlayer.y, unit.x, unit.y) <= HIDDEN_REVEAL_RANGE;
  }

  _draw(dtMs) {
    const ctx = this.ctx;
    const camera = this.camera;
    const snap = this.snapshot;
    const dtSec = dtMs / 1000;

    ctx.fillStyle = "#12210f";
    ctx.fillRect(0, 0, camera.viewWidth, camera.viewHeight);

    if (!this.myPlayer || !this.mapData) return;

    if (this.myPlayer.alive) camera.follow(this.myPlayer);

    ctx.save();
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);

    GameMap.prototype.draw.call(this.mapData, ctx, camera);
    drawLoot(ctx, camera, Object.values(snap?.loot || {}));
    SafeZone.prototype.draw.call(snap?.safeZone || FULL_MAP_ZONE, ctx, camera);

    for (const [id, bot] of Object.entries(snap?.bots || {})) {
      if (!bot.alive || !this._visibleToMe(bot)) continue;
      const eased = this._easedPosition(`bot:${id}`, bot.x, bot.y, dtSec);
      drawUnit(ctx, { ...bot, x: eased.x, y: eased.y }, "#e05a5a", "#555");
    }
    for (const [uid, p] of Object.entries(snap?.players || {})) {
      if (uid === this.myUid || !p.alive || !this._visibleToMe(p)) continue;
      const eased = this._easedPosition(`player:${uid}`, p.x, p.y, dtSec);
      drawUnit(ctx, { ...p, x: eased.x, y: eased.y }, "#b565d8", "#555");
    }
    for (const bullet of snap?.bullets || []) {
      ctx.fillStyle = "#fff59d";
      ctx.beginPath();
      ctx.arc(bullet.x, bullet.y, BULLET_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
    if (this.myPlayer.alive) this.myPlayer.draw(ctx);

    ctx.restore();

    const aliveCount = snap?.aliveCount ?? (this.myPlayer.alive ? 1 : 0);
    const zone = snap?.safeZone || FULL_MAP_ZONE;
    this.hud.update(this.myPlayer, aliveCount, {
      ...zone,
      timeUntilNextShrinkMs: () => zone.timeUntilNextShrinkMs ?? 0,
    });
  }
}
