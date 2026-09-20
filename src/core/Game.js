import { GameMap, isHiddenInBushes } from "../world/GameMap.js";
import { SafeZone } from "../world/SafeZone.js";
import { generateLoot, drawLoot } from "../world/Loot.js";
import { Player } from "../entities/Player.js";
import { Bot } from "../entities/Bot.js";
import { Camera } from "./Camera.js";
import { Input } from "./Input.js";
import { HUD } from "../ui/HUD.js";
import { RemoteInputAdapter } from "../network/RemoteInputAdapter.js";
import { P2PTransport } from "../network/P2PTransport.js";
import { getUid } from "../network/firebase.js";
import { drawDeathEffects } from "../render/drawDeathEffect.js";
import { drawGrenades } from "../render/drawGrenades.js";
import {
  BOT_COUNT,
  PLAYER_RADIUS,
  CRATE_INTERACT_RADIUS,
  CRATE_OPEN_MS,
  ZONE_DAMAGE_PER_SEC,
  WEAPONS,
  MEDKIT_HEAL_AMOUNT,
  SNAPSHOT_SEND_MS,
  SNAPSHOT_SCALE_START_PLAYERS,
  SNAPSHOT_SEND_MS_PER_EXTRA_PLAYER,
  SNAPSHOT_SEND_MS_MAX,
  HIDDEN_REVEAL_RANGE,
  SPECTATOR_SPEED,
  DEATH_EFFECT_MS,
  DEATH_EFFECT_RADIUS,
  DEATH_EFFECT_DEBRIS_COUNT,
  DEATH_LOOT_SCATTER_RANGE,
  DEATH_MEDKIT_DROP_CAP,
  FIRE_KEY_CODE,
  GRENADE_SLOT,
  GRENADE_EXPLOSION_RADIUS,
  GRENADE_MAX_DAMAGE,
  GRENADE_EXPLOSION_EFFECT_MS,
  GRENADE_EXPLOSION_VISUAL_RADIUS,
  GRENADE_EXPLOSION_DEBRIS_COUNT,
  WORLD_WIDTH,
  WORLD_HEIGHT,
  UNIT_CULL_MARGIN,
  BULLET_RADIUS,
} from "../utils/constants.js";
import { dist, randRange, clamp } from "../utils/math.js";

const WEAPON_PRIORITY = { fist: 0, pistol: 1, shotgun: 2, rifle: 3 };

const BOT_NAMES = [
  "그림자", "매", "여우", "늑대", "독수리", "표범", "까마귀", "전갈", "코브라", "재규어",
  "하이에나", "말벌", "곰", "상어", "살모사", "치타", "퓨마", "송골매", "들개", "맹수",
];

const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.hud = new HUD();
    this.input = new Input(canvas);

    this.camera = new Camera(canvas.width, canvas.height);

    this.onGameOver = null; // (didWin: boolean) => void
    this.onLocalDeath = null; // () => void — host's own avatar died but the match continues

    this._resize();
    window.addEventListener("resize", () => this._resize());

    this.running = false;
    this._rafId = null;
    this._lastTs = 0;
    this.mode = "solo"; // "solo" | "host"
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

  // Generates the map/zone/loot/bots so a drop-point selection screen can preview
  // them, but does not spawn the player or start the loop yet — see beginDrop().
  // Pass a RoomService to run as the online host: this publishes the map/status to
  // Firebase and folds connected guests into the simulation as they drop in.
  prepareMatch(roomService = null, botCount = BOT_COUNT) {
    this.map = new GameMap();
    this.safeZone = new SafeZone();
    this.loot = generateLoot(this.map);

    this.bots = [];
    for (let i = 0; i < botCount; i++) {
      const spawn = this.map.findFreeSpawn(PLAYER_RADIUS);
      this.bots.push(new Bot(spawn.x, spawn.y, BOT_NAMES[i % BOT_NAMES.length]));
    }

    this.bullets = [];
    this.grenades = []; // active (not yet exploded) Grenade instances
    this.deathEffects = []; // [{x, y, expiresAt, durationMs, maxRadius, debrisCount}]
    this._dropIdCounter = 0;
    this.player = null;
    this.spectator = null; // {x, y} free-look camera target once the local player dies

    this.roomService = roomService;
    this.mode = roomService ? "host" : "solo";
    this.remotePlayers = new Map(); // uid -> Player
    this._remoteAdapters = new Map(); // uid -> RemoteInputAdapter
    this._medkitSeq = new Map(); // uid -> last seen medkitSeq
    this._grenadeSeq = new Map(); // uid -> last seen grenadeSeq
    this._latestGuestInputs = {};
    this._latestLobby = {};
    this._matchEnded = false;
    this._localDeathNotified = false;
    this._lastSnapshotSentAt = 0;
    this._winnerUid = null;
    this._maxRosterSeen = 0;
    this._recentBulletEvents = [];
    this._bgIntervalId = null;

    if (this._unsubscribeHostListeners) {
      this._unsubscribeHostListeners();
      this._unsubscribeHostListeners = null;
    }
    if (this.p2p) {
      this.p2p.destroy();
      this.p2p = null;
    }

    if (this.mode === "host") {
      this.hostUid = getUid();
      this.p2p = new P2PTransport(this.roomService, true, this.hostUid);
      this.p2p.start();
      this.p2p.onData = (guestUid, payload) => {
        this._latestGuestInputs[guestUid] = payload;
      };

      const offInput = this.roomService.onAllInput((val) => {
        this._latestGuestInputs = val || {};
      });
      const offLobby = this.roomService.onLobby((val) => {
        this._latestLobby = val || {};
        // Automatically establish WebRTC P2P connection to new guests
        for (const uid of Object.keys(this._latestLobby)) {
          if (uid !== this.hostUid && !this.p2p.peers.has(uid)) {
            this.p2p.connectToGuest(uid);
          }
        }
      });
      this._unsubscribeHostListeners = () => {
        offInput();
        offLobby();
      };

      this.roomService.clearAllInput();
      this.roomService.startMatch(this._serializeMap()).catch((err) => {
        console.error("매치 시작 정보를 공유하지 못했습니다:", err);
      });
    }
  }

  _serializeMap() {
    return { obstacles: this.map.obstacles, terrainPatches: this.map.terrainPatches, bushes: this.map.bushes };
  }

  // Spawns the player at the chosen drop point, parachuting in, and starts the loop.
  beginDrop(x, y) {
    this.player = new Player(x, y);
    this.player.startFall();

    this.hud.show();

    this.running = true;
    this._lastTs = performance.now();
    this._rafId = requestAnimationFrame((ts) => this._loop(ts));

    // Background heartbeat ticker: ensures simulation and snapshot broadcasts continue
    // even if browser tab is minimized or inactive (where requestAnimationFrame freezes)
    if (this._bgIntervalId) clearInterval(this._bgIntervalId);
    this._bgIntervalId = setInterval(() => {
      if (!this.running) return;
      const now = performance.now();
      // If rAF hasn't fired in > 70ms, tab is backgrounded -> step physics & sync
      if (now - this._lastTs > 70) {
        const dtMs = Math.min(50, now - this._lastTs);
        this._lastTs = now;
        try {
          this._update(dtMs);
        } catch (err) {
          console.error("백그라운드 틱 오류:", err);
        }
      }
    }, 50);
  }

  stop() {
    this.running = false;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    if (this._bgIntervalId) {
      clearInterval(this._bgIntervalId);
      this._bgIntervalId = null;
    }
    if (this.p2p) {
      this.p2p.destroy();
      this.p2p = null;
    }
    this.hud.hide();
  }

  _loop(ts) {
    if (!this.running) return;
    const dtMs = Math.min(50, ts - this._lastTs);
    this._lastTs = ts;

    try {
      this._update(dtMs);
      this._draw();
    } catch (err) {
      console.error("게임 루프 오류 (한 프레임 건너뜀):", err);
    }
    this.input.endFrame();

    this._rafId = requestAnimationFrame((t) => this._loop(t));
  }

  _allUnits() {
    return [this.player, ...this.bots, ...this.remotePlayers.values()];
  }

  _update(dtMs) {
    const nowMs = performance.now();

    if (this.mode === "host") this._processGuestDropRequests();

    const units = this._allUnits();
    for (const unit of units) {
      unit.hidden = unit.alive && !unit.falling && isHiddenInBushes(unit.x, unit.y, this.map.bushes);
    }

    // Snapshot who's alive before this frame's damage resolves, so we can spot
    // exactly who just died afterward (see the death-effect pass below) without
    // hooking every single damage source individually.
    const aliveBeforeIds = new Set(units.filter((u) => u.alive).map((u) => u.id));

    this.safeZone.update(dtMs);

    this.player.update(dtMs, this.input, this.map.obstacles, units);
    if (this.input.isDown(FIRE_KEY_CODE)) {
      const newBullets = this.player.tryShoot(nowMs, units);
      this.bullets.push(...newBullets);
      this._recordBulletEvents(newBullets, nowMs);
    }
    if (this.input.wasJustPressed(GRENADE_SLOT.code)) {
      const grenade = this.player.tryThrowGrenade(nowMs);
      if (grenade) this.grenades.push(grenade);
    }

    if (this.mode === "host") this._updateRemotePlayers(dtMs, nowMs, units);

    for (const bot of this.bots) {
      if (!bot.alive) continue;
      const result = bot.update(dtMs, {
        map: this.map,
        safeZone: this.safeZone,
        units,
        obstacles: this.map.obstacles,
        nowMs,
      });
      this.bullets.push(...result.bullets);
      this._recordBulletEvents(result.bullets, nowMs);
      this.grenades.push(...result.grenades);
    }

    for (const bullet of this.bullets) {
      bullet.update(dtMs, this.map.obstacles, units);
    }
    this.bullets = this.bullets.filter((b) => !b.dead);

    for (const grenade of this.grenades) {
      grenade.update(nowMs);
      if (!grenade.dead && nowMs >= grenade.explodeAt) {
        this._explodeGrenade(grenade, units, nowMs);
        grenade.dead = true;
      }
    }
    this.grenades = this.grenades.filter((g) => !g.dead);

    for (const unit of units) {
      if (!unit.alive || unit.falling) continue;
      if (this.safeZone.isOutside(unit.x, unit.y)) {
        unit.takeDamage((ZONE_DAMAGE_PER_SEC * dtMs) / 1000);
      }
    }

    for (const unit of units) {
      if (aliveBeforeIds.has(unit.id) && !unit.alive) this._onUnitDeath(unit, nowMs);
    }
    this.deathEffects = this.deathEffects.filter((e) => e.expiresAt > nowMs);

    this._handleCrateOpening(dtMs);

    if (this.player.alive) {
      this.camera.follow(this.player);
    } else if (this.mode === "host") {
      // Solo mode ends the match the instant the player dies (see below), so
      // there's nothing to spectate there — this only ever runs in host mode.
      if (!this.spectator) this.spectator = { x: this.player.x, y: this.player.y };
      this._updateSpectatorCamera(dtMs);
      this.camera.follow(this.spectator);
    }

    const aliveCount = this._allUnits().filter((u) => u.alive).length;
    this.hud.update(this.player, aliveCount, this.safeZone);

    if (this.mode === "solo") {
      if (!this.player.alive) {
        this._endGame(false);
        return;
      }
      if (this.bots.filter((b) => b.alive).length === 0) {
        this._endGame(true);
      }
      return;
    }

    // Host mode: the match keeps running after the host's own avatar dies —
    // other real players and bots may still be fighting it out.
    if (!this.player.alive && !this._localDeathNotified) {
      this._localDeathNotified = true;
      if (this.onLocalDeath) this.onLocalDeath();
    }

    this._maxRosterSeen = Math.max(this._maxRosterSeen, units.length);

    if (!this._matchEnded && this._maxRosterSeen > 1) {
      const aliveUnits = this._allUnits().filter((u) => u.alive);
      if (aliveUnits.length <= 1) {
        this._matchEnded = true;
        this._endMatch(aliveUnits[0] ?? null);
      }
    }

    if (nowMs - this._lastSnapshotSentAt >= this._snapshotIntervalMs() || this._matchEnded) {
      this._lastSnapshotSentAt = nowMs;
      const snap = this._buildSnapshot(nowMs);
      if (this.p2p) {
        this.p2p.broadcast(snap);
      }
      this.roomService.sendSnapshot(snap).catch(() => {});
    }
  }

  _recordBulletEvents(bullets, nowMs) {
    if (!bullets || bullets.length === 0) return;
    for (const b of bullets) {
      this._recentBulletEvents.push({
        id: b.id,
        x: Math.round(b.x * 10) / 10,
        y: Math.round(b.y * 10) / 10,
        vx: Math.round(b.vx),
        vy: Math.round(b.vy),
        speed: b.speed,
        range: b.range,
        ownerId: b.ownerId,
        t: Math.round(nowMs),
      });
    }
    if (this._recentBulletEvents.length > 60) {
      this._recentBulletEvents = this._recentBulletEvents.slice(-60);
    }
  }

  // Backs off the broadcast rate as more real players fill the room — every
  // snapshot fans out to everyone connected and grows with player/bot count,
  // so left alone, total bandwidth would scale with the square of headcount.
  _snapshotIntervalMs() {
    const playerCount = this.remotePlayers.size + 1; // + the host's own avatar
    const over = Math.max(0, playerCount - SNAPSHOT_SCALE_START_PLAYERS);
    return Math.min(SNAPSHOT_SEND_MS_MAX, SNAPSHOT_SEND_MS + over * SNAPSHOT_SEND_MS_PER_EXTRA_PLAYER);
  }

  // Folds newly-dropped guests into the simulation and drops guests who
  // disconnected (their lobby entry disappears via Firebase onDisconnect).
  _processGuestDropRequests() {
    for (const [uid, payload] of Object.entries(this._latestGuestInputs)) {
      if (uid === this.hostUid || this.remotePlayers.has(uid)) continue;
      const req = payload?.dropRequest;
      if (!req) continue;

      const p = new Player(req.x, req.y);
      p.name = this._latestLobby[uid]?.name || "플레이어";
      p.networkUid = uid;
      p.startFall();
      this.remotePlayers.set(uid, p);
      this._remoteAdapters.set(uid, new RemoteInputAdapter());
      this._medkitSeq.set(uid, 0);
      this._grenadeSeq.set(uid, 0);

      // Connect P2P if not already initiated
      if (this.p2p && !this.p2p.peers.has(uid)) {
        this.p2p.connectToGuest(uid);
      }
    }

    for (const uid of [...this.remotePlayers.keys()]) {
      if (!(uid in this._latestLobby)) {
        this.remotePlayers.delete(uid);
        this._remoteAdapters.delete(uid);
        this._medkitSeq.delete(uid);
        this._grenadeSeq.delete(uid);
      }
    }
  }

  _updateRemotePlayers(dtMs, nowMs, units) {
    for (const [uid, rp] of this.remotePlayers) {
      if (!rp.alive) continue;
      const payload = this._latestGuestInputs[uid] || {};
      const adapter = this._remoteAdapters.get(uid);
      adapter.applyPayload(payload);

      rp.update(dtMs, adapter, this.map.obstacles, units);
      if (adapter.firing) {
        const newBullets = rp.tryShoot(nowMs, units);
        this.bullets.push(...newBullets);
        this._recordBulletEvents(newBullets, nowMs);
      }

      if (rp.falling) continue;

      if (typeof payload.desiredWeapon === "string" && payload.desiredWeapon !== rp.weaponKey) {
        rp.equipWeapon(payload.desiredWeapon);
      }
      const lastMedkitSeq = this._medkitSeq.get(uid) ?? 0;
      if (typeof payload.medkitSeq === "number" && payload.medkitSeq > lastMedkitSeq) {
        this._medkitSeq.set(uid, payload.medkitSeq);
        rp.useMedkit(MEDKIT_HEAL_AMOUNT);
      }
      const lastGrenadeSeq = this._grenadeSeq.get(uid) ?? 0;
      if (typeof payload.grenadeSeq === "number" && payload.grenadeSeq > lastGrenadeSeq) {
        this._grenadeSeq.set(uid, payload.grenadeSeq);
        const grenade = rp.tryThrowGrenade(nowMs);
        if (grenade) this.grenades.push(grenade);
      }
    }
  }

  // Free-look camera pan for a dead host, so they can watch the rest of the
  // match play out instead of staring at the spot they died. Reuses WASD,
  // which Player.update() no longer consumes once the player isn't alive.
  _updateSpectatorCamera(dtMs) {
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

  // Crates take CRATE_OPEN_MS of standing nearby to open (see the hourglass drawn
  // above them in Loot.js) — stepping out of range mid-open cancels the progress,
  // so grabbing loot means committing to stay exposed for a moment.
  _handleCrateOpening(dtMs) {
    const units = this._allUnits();

    for (const crate of this.loot) {
      if (crate.collected) continue;

      let opener = crate.openerId
        ? units.find((u) => u.id === crate.openerId && u.alive && !u.falling)
        : null;
      if (opener && dist(opener.x, opener.y, crate.x, crate.y) > CRATE_INTERACT_RADIUS) {
        opener = null;
      }

      if (!opener && crate.openerId) {
        crate.openerId = null;
        crate.progress = 0;
      }

      if (!opener) {
        for (const unit of units) {
          if (!unit.alive || unit.falling) continue;
          if (dist(unit.x, unit.y, crate.x, crate.y) <= CRATE_INTERACT_RADIUS) {
            opener = unit;
            crate.openerId = unit.id;
            break;
          }
        }
      }

      if (!opener) continue;

      crate.progress += dtMs;
      if (crate.progress >= CRATE_OPEN_MS) {
        this._grantCrateContents(opener, crate);
        crate.collected = true;
        crate.openerId = null;
      }
    }
  }

  // Crates fill the unit's inventory rather than auto-equipping — a human player
  // (local or remote) picks an active weapon/medkit with number keys (see
  // WEAPON_SLOTS), while bots use a simple "always take the stronger weapon" rule.
  _grantCrateContents(unit, crate) {
    if (crate.type === "weapon" && WEAPONS[crate.weapon]) {
      unit.acquireWeapon(crate.weapon);
      if (!unit.isPlayer && WEAPON_PRIORITY[crate.weapon] > WEAPON_PRIORITY[unit.weaponKey]) {
        unit.equipWeapon(crate.weapon);
      }
    } else if (crate.type === "ammo") {
      unit.addAmmoToOwnedWeapons(24);
    } else if (crate.type === "medkit") {
      unit.medkitCount += 1;
    } else if (crate.type === "grenade") {
      unit.grenadeCount += 1;
    }
  }

  // Splash damage falls off linearly from GRENADE_MAX_DAMAGE at the very
  // center to 0 at the edge of GRENADE_EXPLOSION_RADIUS — includes the
  // thrower if they're still in range, same as a real grenade would.
  _explodeGrenade(grenade, units, nowMs) {
    for (const unit of units) {
      if (!unit.alive) continue;
      const d = dist(unit.x, unit.y, grenade.targetX, grenade.targetY);
      if (d > GRENADE_EXPLOSION_RADIUS) continue;
      unit.takeDamage(GRENADE_MAX_DAMAGE * (1 - d / GRENADE_EXPLOSION_RADIUS), grenade.ownerId);
    }

    this.deathEffects.push({
      x: grenade.targetX,
      y: grenade.targetY,
      expiresAt: nowMs + GRENADE_EXPLOSION_EFFECT_MS,
      durationMs: GRENADE_EXPLOSION_EFFECT_MS,
      maxRadius: GRENADE_EXPLOSION_VISUAL_RADIUS,
      debrisCount: GRENADE_EXPLOSION_DEBRIS_COUNT,
    });
  }

  // Fires once, right when a unit's health hits zero: a brief explosion burst
  // at their position, whatever they were carrying scattered on the ground as
  // fresh (still-mystery) crates, a kill credited to whoever landed the fatal
  // hit (see Unit.takeDamage), and this unit's final placement — how many
  // units (including itself) were still alive the instant it died, which is
  // exactly its finishing rank in a battle royale.
  _onUnitDeath(unit, nowMs) {
    const killer = this._allUnits().find((u) => u !== unit && u.id === unit.lastDamagedBy);
    if (killer) killer.kills += 1;
    unit.placement = this._allUnits().filter((u) => u.alive).length + 1;

    this.deathEffects.push({
      x: unit.x,
      y: unit.y,
      expiresAt: nowMs + DEATH_EFFECT_MS,
      durationMs: DEATH_EFFECT_MS,
      maxRadius: DEATH_EFFECT_RADIUS,
      debrisCount: DEATH_EFFECT_DEBRIS_COUNT,
    });
    this._dropLootFromUnit(unit);
  }

  _dropLootFromUnit(unit) {
    const drops = [];
    for (const weaponKey of unit.ownedWeapons) {
      if (weaponKey === "fist") continue;
      drops.push({ type: "weapon", weapon: weaponKey });
    }
    if (drops.length > 0) drops.push({ type: "ammo", weapon: null });
    for (let i = 0; i < Math.min(unit.medkitCount, DEATH_MEDKIT_DROP_CAP); i++) {
      drops.push({ type: "medkit", weapon: null });
    }
    for (let i = 0; i < Math.min(unit.grenadeCount, DEATH_MEDKIT_DROP_CAP); i++) {
      drops.push({ type: "grenade", weapon: null });
    }

    for (const drop of drops) {
      const angle = randRange(0, Math.PI * 2);
      const scatterDist = randRange(DEATH_LOOT_SCATTER_RANGE[0], DEATH_LOOT_SCATTER_RANGE[1]);
      this.loot.push({
        id: `drop_${this._dropIdCounter++}`,
        x: clamp(unit.x + Math.cos(angle) * scatterDist, 20, WORLD_WIDTH - 20),
        y: clamp(unit.y + Math.sin(angle) * scatterDist, 20, WORLD_HEIGHT - 20),
        type: drop.type,
        weapon: drop.weapon,
        collected: false,
        openerId: null,
        progress: 0,
      });
    }
  }

  _endGame(didWin) {
    if (didWin) this.player.placement = 1;
    this.stop();
    if (this.onGameOver) this.onGameOver(didWin, this._buildResults());
  }

  _endMatch(winnerUnit) {
    this._winnerUid = winnerUnit === this.player ? this.hostUid : (winnerUnit?.networkUid ?? null);
    if (winnerUnit) winnerUnit.placement = 1;
    this.stop();
    if (this.onGameOver) this.onGameOver(winnerUnit === this.player, this._buildResults());
  }

  // Ranked by finishing placement (1st = last unit standing). A unit that's
  // still alive when a solo match cuts short (it ends the instant the local
  // player dies, without playing the rest out) has no placement yet and is
  // left out rather than shown with a made-up rank.
  _buildResults() {
    const rows = [];
    for (const unit of this._allUnits()) {
      if (unit.placement == null) continue;
      rows.push({ name: unit.name, kills: unit.kills, placement: unit.placement, isMe: unit === this.player });
    }
    rows.sort((a, b) => a.placement - b.placement);
    return rows;
  }

  // `meleeSwingUntil` is an absolute performance.now() timestamp, which is only
  // meaningful within this process's own clock — a guest's performance.now() runs
  // on a different epoch entirely. Send the remaining duration instead; the
  // receiver re-anchors it to its own clock when the snapshot arrives (see
  // GuestView's _hydrateSnapshot).
  _serializeUnit(unit, nowMs) {
    return {
      x: round1(unit.x),
      y: round1(unit.y),
      facing: round2(unit.facing),
      health: Math.round(unit.health),
      maxHealth: unit.maxHealth,
      alive: unit.alive,
      falling: unit.falling,
      fallElapsed: Math.round(unit.fallElapsed),
      fallDurationMs: unit.fallDurationMs,
      radius: unit.radius,
      weaponKey: unit.weaponKey,
      meleeSwingRemainingMs: Math.max(0, Math.round(unit.meleeSwingUntil - nowMs)),
      punchHand: unit.punchHand,
      hidden: unit.hidden,
      name: unit.name,
      kills: unit.kills,
      placement: unit.placement,
    };
  }

  _buildSnapshot(nowMs) {
    const players = {};
    players[this.hostUid] = {
      ...this._serializeUnit(this.player, nowMs),
      mag: this.player.mag,
      reserveAmmo: this.player.reserveAmmo,
      medkitCount: this.player.medkitCount,
      grenadeCount: this.player.grenadeCount,
      ownedWeapons: [...this.player.ownedWeapons],
    };
    for (const [uid, rp] of this.remotePlayers) {
      players[uid] = {
        ...this._serializeUnit(rp, nowMs),
        mag: rp.mag,
        reserveAmmo: rp.reserveAmmo,
        medkitCount: rp.medkitCount,
        grenadeCount: rp.grenadeCount,
        ownedWeapons: [...rp.ownedWeapons],
      };
    }

    const bots = {};
    this.bots.forEach((b, i) => {
      bots[`bot_${i}`] = this._serializeUnit(b, nowMs);
    });

    // Collected crates never draw (see Loot.js), so there's no reason to keep
    // paying bandwidth for them every broadcast — drop them from the payload.
    const loot = {};
    for (const item of this.loot) {
      if (item.collected) continue;
      loot[item.id] = {
        x: round1(item.x),
        y: round1(item.y),
        progress: Math.round(item.progress),
        openerId: item.openerId ?? null,
      };
    }

    const bullets = this.bullets.map((b) => ({ x: round1(b.x), y: round1(b.y) }));
    const bulletEvents = this._recentBulletEvents.filter((e) => nowMs - e.t < 1200);

    // Same clock-independence pattern as meleeSwingRemainingMs: send how much
    // longer the burst/fuse has left rather than an absolute host-clock timestamp.
    const deathEffects = this.deathEffects.map((e) => ({
      x: round1(e.x),
      y: round1(e.y),
      remainingMs: Math.max(0, Math.round(e.expiresAt - nowMs)),
      durationMs: e.durationMs,
      maxRadius: e.maxRadius,
      debrisCount: e.debrisCount,
    }));

    const grenades = this.grenades.map((g) => ({
      x: round1(g.x),
      y: round1(g.y),
      targetX: round1(g.targetX),
      targetY: round1(g.targetY),
      remainingMs: Math.max(0, Math.round(g.explodeAt - nowMs)),
    }));

    return {
      players,
      bots,
      loot,
      bullets,
      bulletEvents,
      deathEffects,
      grenades,
      safeZone: {
        centerX: round1(this.safeZone.centerX),
        centerY: round1(this.safeZone.centerY),
        currentRadius: round1(this.safeZone.currentRadius),
        targetCenter: { x: round1(this.safeZone.targetCenter.x), y: round1(this.safeZone.targetCenter.y) },
        targetRadius: round1(this.safeZone.targetRadius),
        state: this.safeZone.state,
        phaseIndex: this.safeZone.phaseIndex,
        timeUntilNextShrinkMs: Math.round(this.safeZone.timeUntilNextShrinkMs()),
      },
      aliveCount: this._allUnits().filter((u) => u.alive).length,
      matchOver: this._matchEnded,
      winnerUid: this._winnerUid,
    };
  }

  // A unit hidden in a bush is invisible to everyone except its own controller
  // — unless the local player (or, once dead, the spectator camera) happens to
  // be close enough to spot them.
  _visibleToLocalPlayer(unit) {
    if (!unit.hidden) return true;
    const viewer = this.player.alive ? this.player : this.spectator;
    if (!viewer) return false;
    return dist(viewer.x, viewer.y, unit.x, unit.y) <= HIDDEN_REVEAL_RANGE;
  }

  _draw() {
    const ctx = this.ctx;
    const camera = this.camera;

    ctx.fillStyle = "#12210f";
    ctx.fillRect(0, 0, camera.viewWidth, camera.viewHeight);

    ctx.save();
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);

    this.map.draw(ctx, camera);
    drawLoot(ctx, camera, this.loot);
    this.safeZone.draw(ctx, camera);

    for (const bot of this.bots) {
      if (!bot.alive || !this._visibleToLocalPlayer(bot)) continue;
      if (!camera.isRoughlyVisible(bot.x, bot.y, bot.radius + UNIT_CULL_MARGIN)) continue;
      bot.draw(ctx);
    }
    for (const rp of this.remotePlayers.values()) {
      if (!rp.alive || !this._visibleToLocalPlayer(rp)) continue;
      if (!camera.isRoughlyVisible(rp.x, rp.y, rp.radius + UNIT_CULL_MARGIN)) continue;
      rp.drawBody(ctx, "#b565d8", "#555");
    }
    for (const bullet of this.bullets) {
      if (!camera.isRoughlyVisible(bullet.x, bullet.y, BULLET_RADIUS)) continue;
      bullet.draw(ctx);
    }

    if (this.player.alive) this.player.draw(ctx);

    drawGrenades(ctx, this.grenades, performance.now());
    drawDeathEffects(ctx, this.deathEffects, performance.now());

    ctx.restore();
  }
}
