import { Camera } from "./Camera.js";
import { Input } from "./Input.js";
import { HUD } from "../ui/HUD.js";
import { GameMap, isHiddenInBushes } from "../world/GameMap.js";
import { SafeZone } from "../world/SafeZone.js";
import { drawLoot } from "../world/Loot.js";
import { drawUnit } from "../render/drawUnit.js";
import { drawDeathEffects } from "../render/drawDeathEffect.js";
import { drawGrenades } from "../render/drawGrenades.js";
import { Player } from "../entities/Player.js";
import { Bullet } from "../entities/Bullet.js";
import { P2PTransport } from "../network/P2PTransport.js";
import {
  MEDKIT_SLOT,
  GRENADE_SLOT,
  FIRE_KEY_CODE,
  INPUT_SEND_MS,
  WORLD_WIDTH,
  WORLD_HEIGHT,
  BULLET_RADIUS,
  HOST_STALE_MS,
  HOST_WARN_MS,
  HIDDEN_REVEAL_RANGE,
  REMOTE_SMOOTHING_PER_SEC,
  RECONCILE_SNAP_DISTANCE,
  SPECTATOR_SPEED,
  UNIT_CULL_MARGIN,
} from "../utils/constants.js";
import { dist, clamp, circleRectPush } from "../utils/math.js";

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
    this.spectator = null; // {x, y} free-look camera target once this player dies
    this.snapshot = null;
    this._remoteRender = new Map(); // uid/botId -> eased {x, y} for smooth rendering
    this.localBullets = new Map(); // id -> Bullet
    this.p2p = new P2PTransport(roomService, false, myUid);
    this.isWaitingHost = false;
    this._lastSnapshotServerTs = 0;

    this.running = false;
    this._rafId = null;
    this._lastTs = 0;
    this._lastSendAt = 0;
    this._medkitSeq = 0;
    this._grenadeSeq = 0;
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

    // 1. WebRTC P2P DataChannel listener (ultra-low latency)
    this.p2p.start();
    this.p2p.onData = (_, snap) => {
      this._onReceiveSnapshot(snap);
    };

    // 2. Firebase RTDB listener (reliable fallback)
    this._unsubscribeSnapshot = this.roomService.onSnapshot((snap) => {
      this._onReceiveSnapshot(snap);
    });

    this._rafId = requestAnimationFrame((ts) => this._loop(ts));
  }

  _onReceiveSnapshot(snap) {
    if (!snap) return;
    // Discard older snapshots if out-of-order packets arrive
    if (snap.t && snap.t < this._lastSnapshotServerTs) return;
    if (snap.t) this._lastSnapshotServerTs = snap.t;

    this.snapshot = this._hydrateSnapshot(snap);
    this._lastSnapshotAt = performance.now();
    this.isWaitingHost = false;

    this._syncBulletEvents(snap.bulletEvents);
    this._reconcileMyPlayer();
    this._checkLocalDeath();
    this._checkMatchOver();
  }

  _syncBulletEvents(events) {
    if (!events || !Array.isArray(events)) return;
    const now = performance.now();
    const obstacles = this.mapData?.obstacles ?? [];

    for (const be of events) {
      if (!this.localBullets.has(be.id)) {
        const angle = Math.atan2(be.vy, be.vx);
        const b = new Bullet(be.x, be.y, angle, be.speed, 0, be.ownerId, be.range);
        b.id = be.id;

        // Catch up on flight distance if event arrived slightly late
        const elapsedMs = Math.max(0, now - (be.t || now));
        if (elapsedMs > 0 && elapsedMs < 1000) {
          b.update(elapsedMs, obstacles, []);
        }
        if (!b.dead) {
          this.localBullets.set(be.id, b);
        }
      }
    }
  }

  stop() {
    this.running = false;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    if (this.p2p) this.p2p.destroy();
    this.hud.hide();
  }

  // A host restart replaces this whole GuestView with a fresh one for the new
  // round (see main.js's enterGuestRound) — unsubscribe this instance's own
  // snapshot listener so it doesn't keep firing into an abandoned object.
  destroy() {
    this.stop();
    if (this._unsubscribeSnapshot) this._unsubscribeSnapshot();
    if (this.p2p) this.p2p.destroy();
    window.removeEventListener("resize", this._resizeHandler);
  }

  _loop(ts) {
    if (!this.running) return;
    const dtMs = Math.min(50, ts - this._lastTs);
    this._lastTs = ts;

    this._checkHostAlive();
    if (!this.running) return; // _checkHostAlive may have stopped us

    try {
      this._updateMyPlayer(dtMs);
      this._updateLocalBullets(dtMs);
      this._sendInputThrottled();
      this._draw(dtMs);
    } catch (err) {
      console.error("게임 루프 오류 (한 프레임 건너뜀):", err);
    }
    this.input.endFrame();

    this._rafId = requestAnimationFrame((t) => this._loop(t));
  }

  _updateLocalBullets(dtMs) {
    const obstacles = this.mapData?.obstacles ?? [];
    for (const [id, bullet] of this.localBullets) {
      bullet.update(dtMs, obstacles, []);
      if (bullet.dead) {
        this.localBullets.delete(id);
      }
    }
  }

  _checkHostAlive() {
    if (this._hostLostNotified) return;
    const quietMs = performance.now() - this._lastSnapshotAt;
    this.isWaitingHost = quietMs > HOST_WARN_MS;

    if (quietMs > HOST_STALE_MS) {
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
    if (!this.myPlayer) return;
    if (!this.myPlayer.alive) {
      this._updateSpectatorCamera(dtMs);
      return;
    }
    this.myPlayer.update(dtMs, this.input, this.mapData?.obstacles ?? [], this._autoAimUnits());
    if (this.input.isDown(FIRE_KEY_CODE)) this.myPlayer.tryShoot(performance.now(), []);

    // Computed locally (not synced from the snapshot) so the fade-when-hidden
    // feedback is instant, same as the host sees for its own player.
    this.myPlayer.hidden =
      !this.myPlayer.falling && isHiddenInBushes(this.myPlayer.x, this.myPlayer.y, this.mapData?.bushes ?? []);
  }

  // Auto-aim needs a "who's nearby" list, same shape the host's own auto-aim
  // uses (x/y/alive/falling/hidden) — the latest snapshot's plain bot/player
  // objects already duck-type as that, so no real Unit instances are needed.
  _autoAimUnits() {
    if (!this.snapshot) return [];
    const units = [];
    for (const bot of Object.values(this.snapshot.bots || {})) units.push(bot);
    for (const [uid, p] of Object.entries(this.snapshot.players || {})) {
      if (uid !== this.myUid) units.push(p);
    }
    return units;
  }

  // Free-look camera pan once dead, so this player can watch the rest of the
  // match instead of staring at the spot they died. Reuses WASD, which
  // Player.update() no longer consumes once the player isn't alive.
  _updateSpectatorCamera(dtMs) {
    if (!this.spectator) return;
    let dx = 0, dy = 0;
    if (this.input.isDown("KeyW") || this.input.isDown("ArrowUp")) dy -= 1;
    if (this.input.isDown("KeyS") || this.input.isDown("ArrowDown")) dy += 1;
    if (this.input.isDown("KeyA") || this.input.isDown("ArrowLeft")) dx -= 1;
    if (this.input.isDown("KeyD") || this.input.isDown("ArrowRight")) dx += 1;
    if (dx === 0 && dy === 0) return;

    const len = Math.hypot(dx, dy);
    const dtSec = dtMs / 1000;
    this.spectator.x = clamp(this.spectator.x + (dx / len) * SPECTATOR_SPEED * dtSec, 0, WORLD_WIDTH);
    this.spectator.y = clamp(this.spectator.y + (dy / len) * SPECTATOR_SPEED * dtSec, 0, WORLD_HEIGHT);
  }

  _sendInputThrottled() {
    const now = performance.now();
    if (now - this._lastSendAt < INPUT_SEND_MS) return;
    this._lastSendAt = now;
    if (!this.myPlayer || !this.myPlayer.alive) return;

    if (this.input.wasJustPressed(MEDKIT_SLOT.code)) this._medkitSeq += 1;
    if (this.input.wasJustPressed(GRENADE_SLOT.code)) this._grenadeSeq += 1;

    const payload = {
      up: this.input.isDown("KeyW") || this.input.isDown("ArrowUp"),
      down: this.input.isDown("KeyS") || this.input.isDown("ArrowDown"),
      left: this.input.isDown("KeyA") || this.input.isDown("ArrowLeft"),
      right: this.input.isDown("KeyD") || this.input.isDown("ArrowRight"),
      reload: this.input.isDown("KeyR"),
      firing: this.input.isDown(FIRE_KEY_CODE),
      facing: this.myPlayer.facing,
      desiredWeapon: this.myPlayer.weaponKey,
      medkitSeq: this._medkitSeq,
      grenadeSeq: this._grenadeSeq,
    };

    // 1. Send via WebRTC P2P DataChannel if ready (ultra-low latency 10~30ms)
    const sentViaP2p = this.p2p ? this.p2p.sendToHost(payload) : false;

    // 2. Fallback to Firebase if P2P not yet connected
    if (!sentViaP2p) {
      this.roomService.sendInput(payload).catch(() => {});
    }
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
    const deathEffects = (snap.deathEffects || []).map((e) => ({
      x: e.x,
      y: e.y,
      expiresAt: recvNow + (e.remainingMs || 0),
      durationMs: e.durationMs,
      maxRadius: e.maxRadius,
      debrisCount: e.debrisCount,
    }));
    const grenades = (snap.grenades || []).map((g) => ({
      x: g.x,
      y: g.y,
      targetX: g.targetX,
      targetY: g.targetY,
      explodeAt: recvNow + (g.remainingMs || 0),
    }));

    return { ...snap, players, bots, deathEffects, grenades };
  }

  // Health/inventory/ammo are host-decided (crates, damage), so they're synced
  // in outright. Position is reconciled toward the host's copy while STRICTLY
  // respecting obstacle walls so lag never causes the player to clip through or
  // get sucked into structures.
  _reconcileMyPlayer() {
    const me = this.snapshot?.players?.[this.myUid];
    if (!me || !this.myPlayer) return;

    this.myPlayer.health = me.health;
    this.myPlayer.alive = me.alive;
    this.myPlayer.medkitCount = me.medkitCount;
    this.myPlayer.grenadeCount = me.grenadeCount;
    this.myPlayer.ownedWeapons = new Set(me.ownedWeapons || ["fist"]);
    this.myPlayer.mag = me.mag;
    this.myPlayer.reserveAmmo = me.reserveAmmo;

    if (me.weaponKey && me.weaponKey !== "fist") {
      this.myPlayer.weaponAmmo[me.weaponKey] = { mag: me.mag, reserve: me.reserveAmmo };
    }

    const obstacles = this.mapData?.obstacles ?? [];
    const driftDist = dist(this.myPlayer.x, this.myPlayer.y, me.x, me.y);

    if (this.myPlayer.falling) {
      if (driftDist > RECONCILE_SNAP_DISTANCE) {
        this.myPlayer.x = me.x;
        this.myPlayer.y = me.y;
      }
    } else {
      if (driftDist > RECONCILE_SNAP_DISTANCE) {
        // Snap to host position, then immediately push out of any obstacle walls
        this.myPlayer.x = clamp(me.x, this.myPlayer.radius, WORLD_WIDTH - this.myPlayer.radius);
        this.myPlayer.y = clamp(me.y, this.myPlayer.radius, WORLD_HEIGHT - this.myPlayer.radius);
        for (const rect of obstacles) {
          const push = circleRectPush(this.myPlayer.x, this.myPlayer.y, this.myPlayer.radius, rect);
          if (push) {
            this.myPlayer.x += push.x;
            this.myPlayer.y += push.y;
          }
        }
      } else if (driftDist > 3) {
        // Nudge gently toward host, but never push through walls
        const stepX = (me.x - this.myPlayer.x) * 0.25;
        const stepY = (me.y - this.myPlayer.y) * 0.25;
        this.myPlayer.x += stepX;
        this.myPlayer.y += stepY;
        this.myPlayer.x = clamp(this.myPlayer.x, this.myPlayer.radius, WORLD_WIDTH - this.myPlayer.radius);
        this.myPlayer.y = clamp(this.myPlayer.y, this.myPlayer.radius, WORLD_HEIGHT - this.myPlayer.radius);

        for (const rect of obstacles) {
          const push = circleRectPush(this.myPlayer.x, this.myPlayer.y, this.myPlayer.radius, rect);
          if (push) {
            this.myPlayer.x += push.x;
            this.myPlayer.y += push.y;
          }
        }
      }
    }
  }

  _checkLocalDeath() {
    if (this._localDeathNotified) return;
    const me = this.snapshot?.players?.[this.myUid];
    if (me && !me.alive) {
      this._localDeathNotified = true;
      this.spectator = { x: this.myPlayer.x, y: this.myPlayer.y };
      if (this.onLocalDeath) this.onLocalDeath();
    }
  }

  _checkMatchOver() {
    if (this.snapshot?.matchOver && !this._matchOverNotified) {
      this._matchOverNotified = true;
      this.stop();
      if (this.onGameOver) this.onGameOver(this.snapshot.winnerUid === this.myUid, this._buildResults());
    }
  }

  // Mirrors Game.js's _buildResults() using the final snapshot's plain
  // player/bot objects instead of real Unit instances — same placement/kills
  // fields, just read off whatever the host last broadcast.
  _buildResults() {
    const snap = this.snapshot;
    if (!snap) return [];
    const rows = [];
    for (const [uid, p] of Object.entries(snap.players || {})) {
      if (p.placement == null) continue;
      rows.push({ name: p.name, kills: p.kills ?? 0, placement: p.placement, isMe: uid === this.myUid });
    }
    for (const b of Object.values(snap.bots || {})) {
      if (b.placement == null) continue;
      rows.push({ name: b.name, kills: b.kills ?? 0, placement: b.placement, isMe: false });
    }
    rows.sort((a, b) => a.placement - b.placement);
    return rows;
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
    const viewer = this.myPlayer.alive ? this.myPlayer : this.spectator;
    if (!viewer) return false;
    return dist(viewer.x, viewer.y, unit.x, unit.y) <= HIDDEN_REVEAL_RANGE;
  }

  _draw(dtMs) {
    const ctx = this.ctx;
    const camera = this.camera;
    const snap = this.snapshot;
    const dtSec = dtMs / 1000;

    ctx.fillStyle = "#12210f";
    ctx.fillRect(0, 0, camera.viewWidth, camera.viewHeight);

    if (!this.myPlayer || !this.mapData) return;

    if (this.myPlayer.alive) {
      camera.follow(this.myPlayer);
    } else if (this.spectator) {
      camera.follow(this.spectator);
    }

    ctx.save();
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);

    GameMap.prototype.draw.call(this.mapData, ctx, camera);
    drawLoot(ctx, camera, Object.values(snap?.loot || {}));
    SafeZone.prototype.draw.call(snap?.safeZone || FULL_MAP_ZONE, ctx, camera);

    for (const [id, bot] of Object.entries(snap?.bots || {})) {
      if (!bot.alive || !this._visibleToMe(bot)) continue;
      const eased = this._easedPosition(`bot:${id}`, bot.x, bot.y, dtSec);
      if (!camera.isRoughlyVisible(eased.x, eased.y, bot.radius + UNIT_CULL_MARGIN)) continue;
      drawUnit(ctx, { ...bot, x: eased.x, y: eased.y }, "#e05a5a", "#555");
    }
    for (const [uid, p] of Object.entries(snap?.players || {})) {
      if (uid === this.myUid || !p.alive || !this._visibleToMe(p)) continue;
      const eased = this._easedPosition(`player:${uid}`, p.x, p.y, dtSec);
      if (!camera.isRoughlyVisible(eased.x, eased.y, p.radius + UNIT_CULL_MARGIN)) continue;
      drawUnit(ctx, { ...p, x: eased.x, y: eased.y }, "#b565d8", "#555");
    }
    // Render smooth local bullets (60fps simulation from synchronized fire events)
    for (const bullet of this.localBullets.values()) {
      if (!camera.isRoughlyVisible(bullet.x, bullet.y, BULLET_RADIUS)) continue;
      bullet.draw(ctx);
    }
    // Fallback: if no local bullets, render snapshot bullets
    if (this.localBullets.size === 0) {
      for (const bullet of snap?.bullets || []) {
        if (!camera.isRoughlyVisible(bullet.x, bullet.y, BULLET_RADIUS)) continue;
        ctx.fillStyle = "#fff59d";
        ctx.beginPath();
        ctx.arc(bullet.x, bullet.y, BULLET_RADIUS, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (this.myPlayer.alive) this.myPlayer.draw(ctx);

    drawGrenades(ctx, snap?.grenades || [], performance.now());
    drawDeathEffects(ctx, snap?.deathEffects || [], performance.now());

    ctx.restore();

    const aliveCount = snap?.aliveCount ?? (this.myPlayer.alive ? 1 : 0);
    const zone = snap?.safeZone || FULL_MAP_ZONE;
    this.hud.update(this.myPlayer, aliveCount, {
      ...zone,
      timeUntilNextShrinkMs: () => zone.timeUntilNextShrinkMs ?? 0,
    });

    if (this.isWaitingHost) {
      ctx.save();
      ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
      ctx.fillRect(camera.viewWidth / 2 - 130, 60, 260, 34);
      ctx.strokeStyle = "#e05a5a";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(camera.viewWidth / 2 - 130, 60, 260, 34);
      ctx.fillStyle = "#ffeb3b";
      ctx.font = "bold 13px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("⚠️ 호스트 응답 대기 중...", camera.viewWidth / 2, 77);
      ctx.restore();
    }
  }
}
