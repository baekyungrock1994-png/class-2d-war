import { GameMap, isHiddenInBushes } from "../world/GameMap.js";
import { SafeZone } from "../world/SafeZone.js";
import { generateLoot, drawLoot } from "../world/Loot.js";
import { Player } from "../entities/Player.js";
import { Bot } from "../entities/Bot.js";
import { Camera } from "./Camera.js";
import { Input } from "./Input.js";
import { HUD } from "../ui/HUD.js";
import { RemoteInputAdapter } from "../network/RemoteInputAdapter.js";
import { getUid } from "../network/firebase.js";
import {
  BOT_COUNT,
  PLAYER_RADIUS,
  CRATE_INTERACT_RADIUS,
  CRATE_OPEN_MS,
  ZONE_DAMAGE_PER_SEC,
  WEAPONS,
  MEDKIT_HEAL_AMOUNT,
  SNAPSHOT_SEND_MS,
  HIDDEN_REVEAL_RANGE,
} from "../utils/constants.js";
import { dist } from "../utils/math.js";

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
    this.player = null;

    this.roomService = roomService;
    this.mode = roomService ? "host" : "solo";
    this.remotePlayers = new Map(); // uid -> Player
    this._remoteAdapters = new Map(); // uid -> RemoteInputAdapter
    this._medkitSeq = new Map(); // uid -> last seen medkitSeq
    this._latestGuestInputs = {};
    this._latestLobby = {};
    this._matchEnded = false;
    this._localDeathNotified = false;
    this._lastSnapshotSentAt = 0;
    this._winnerUid = null;

    if (this.mode === "host") {
      this.hostUid = getUid();
      this.roomService.onAllInput((val) => {
        this._latestGuestInputs = val || {};
      });
      this.roomService.onLobby((val) => {
        this._latestLobby = val || {};
      });
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
  }

  stop() {
    this.running = false;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this.hud.hide();
  }

  _loop(ts) {
    if (!this.running) return;
    const dtMs = Math.min(50, ts - this._lastTs);
    this._lastTs = ts;

    // An uncaught error here would otherwise kill the rAF chain outright —
    // for the host that means the whole match (bots, every connected guest)
    // silently freezes. Log and skip the frame instead of dying.
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

    this.safeZone.update(dtMs);

    this.player.update(dtMs, this.input, this.camera, this.map.obstacles);
    if (this.input.mouseDown) {
      const newBullets = this.player.tryShoot(nowMs, units);
      this.bullets.push(...newBullets);
    }

    if (this.mode === "host") this._updateRemotePlayers(dtMs, nowMs, units);

    for (const bot of this.bots) {
      if (!bot.alive) continue;
      const newBullets = bot.update(dtMs, {
        map: this.map,
        safeZone: this.safeZone,
        units,
        obstacles: this.map.obstacles,
        nowMs,
      });
      this.bullets.push(...newBullets);
    }

    for (const bullet of this.bullets) {
      bullet.update(dtMs, this.map.obstacles, units);
    }
    this.bullets = this.bullets.filter((b) => !b.dead);

    for (const unit of units) {
      if (!unit.alive || unit.falling) continue;
      if (this.safeZone.isOutside(unit.x, unit.y)) {
        unit.takeDamage((ZONE_DAMAGE_PER_SEC * dtMs) / 1000);
      }
    }

    this._handleCrateOpening(dtMs);

    if (this.player.alive) this.camera.follow(this.player);

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

    if (!this._matchEnded) {
      const aliveUnits = this._allUnits().filter((u) => u.alive);
      if (aliveUnits.length <= 1) {
        this._matchEnded = true;
        this._endMatch(aliveUnits[0] ?? null);
      }
    }

    if (nowMs - this._lastSnapshotSentAt >= SNAPSHOT_SEND_MS || this._matchEnded) {
      this._lastSnapshotSentAt = nowMs;
      this.roomService.sendSnapshot(this._buildSnapshot(nowMs)).catch(() => {});
    }
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
    }

    for (const uid of [...this.remotePlayers.keys()]) {
      if (!(uid in this._latestLobby)) {
        this.remotePlayers.delete(uid);
        this._remoteAdapters.delete(uid);
        this._medkitSeq.delete(uid);
      }
    }
  }

  _updateRemotePlayers(dtMs, nowMs, units) {
    for (const [uid, rp] of this.remotePlayers) {
      if (!rp.alive) continue;
      const payload = this._latestGuestInputs[uid] || {};
      const adapter = this._remoteAdapters.get(uid);
      adapter.applyPayload(payload);

      rp.update(dtMs, adapter, this.camera, this.map.obstacles);
      if (adapter.mouseDown) {
        this.bullets.push(...rp.tryShoot(nowMs, units));
      }

      if (rp.falling) continue;

      if (typeof payload.desiredWeapon === "string" && payload.desiredWeapon !== rp.weaponKey) {
        rp.equipWeapon(payload.desiredWeapon);
      }
      const lastSeq = this._medkitSeq.get(uid) ?? 0;
      if (typeof payload.medkitSeq === "number" && payload.medkitSeq > lastSeq) {
        this._medkitSeq.set(uid, payload.medkitSeq);
        rp.useMedkit(MEDKIT_HEAL_AMOUNT);
      }
    }
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
    }
  }

  _endGame(didWin) {
    this.stop();
    if (this.onGameOver) this.onGameOver(didWin);
  }

  _endMatch(winnerUnit) {
    this._winnerUid = winnerUnit === this.player ? this.hostUid : (winnerUnit?.networkUid ?? null);
    this.stop();
    if (this.onGameOver) this.onGameOver(winnerUnit === this.player);
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
    };
  }

  _buildSnapshot(nowMs) {
    const players = {};
    players[this.hostUid] = {
      ...this._serializeUnit(this.player, nowMs),
      mag: this.player.mag,
      reserveAmmo: this.player.reserveAmmo,
      medkitCount: this.player.medkitCount,
      ownedWeapons: [...this.player.ownedWeapons],
    };
    for (const [uid, rp] of this.remotePlayers) {
      players[uid] = {
        ...this._serializeUnit(rp, nowMs),
        mag: rp.mag,
        reserveAmmo: rp.reserveAmmo,
        medkitCount: rp.medkitCount,
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

    return {
      players,
      bots,
      loot,
      bullets,
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
  // — unless the local player happens to be standing close enough to spot them.
  _visibleToLocalPlayer(unit) {
    if (!unit.hidden) return true;
    return dist(this.player.x, this.player.y, unit.x, unit.y) <= HIDDEN_REVEAL_RANGE;
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
      if (bot.alive && this._visibleToLocalPlayer(bot)) bot.draw(ctx);
    }
    for (const rp of this.remotePlayers.values()) {
      if (rp.alive && this._visibleToLocalPlayer(rp)) rp.drawBody(ctx, "#b565d8", "#555");
    }
    for (const bullet of this.bullets) bullet.draw(ctx);

    if (this.player.alive) this.player.draw(ctx);

    ctx.restore();
  }
}
