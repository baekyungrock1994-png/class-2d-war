import { GameMap } from "../world/GameMap.js";
import { SafeZone } from "../world/SafeZone.js";
import { generateLoot, drawLoot } from "../world/Loot.js";
import { Player } from "../entities/Player.js";
import { Bot } from "../entities/Bot.js";
import { Camera } from "./Camera.js";
import { Input } from "./Input.js";
import { HUD } from "../ui/HUD.js";
import {
  BOT_COUNT,
  PLAYER_RADIUS,
  CRATE_INTERACT_RADIUS,
  CRATE_OPEN_MS,
  ZONE_DAMAGE_PER_SEC,
  WEAPONS,
} from "../utils/constants.js";
import { dist } from "../utils/math.js";

const WEAPON_PRIORITY = { fist: 0, pistol: 1, shotgun: 2, rifle: 3 };

const BOT_NAMES = [
  "그림자", "매", "여우", "늑대", "독수리", "표범", "까마귀", "전갈", "코브라", "재규어",
  "하이에나", "말벌", "곰", "상어", "살모사", "치타", "퓨마", "송골매", "들개", "맹수",
];

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.hud = new HUD();
    this.input = new Input(canvas);

    this.camera = new Camera(canvas.width, canvas.height);

    this.onGameOver = null; // set by main.js: (didWin: boolean) => void

    this._resize();
    window.addEventListener("resize", () => this._resize());

    this.running = false;
    this._rafId = null;
    this._lastTs = 0;
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
  prepareMatch() {
    this.map = new GameMap();
    this.safeZone = new SafeZone();
    this.loot = generateLoot(this.map);

    this.bots = [];
    for (let i = 0; i < BOT_COUNT; i++) {
      const spawn = this.map.findFreeSpawn(PLAYER_RADIUS);
      this.bots.push(new Bot(spawn.x, spawn.y, BOT_NAMES[i % BOT_NAMES.length]));
    }

    this.bullets = [];
    this.player = null;
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

    this._update(dtMs);
    this._draw();
    this.input.endFrame();

    this._rafId = requestAnimationFrame((t) => this._loop(t));
  }

  _allUnits() {
    return [this.player, ...this.bots];
  }

  _update(dtMs) {
    const nowMs = performance.now();
    const units = this._allUnits();

    this.safeZone.update(dtMs);

    this.player.update(dtMs, this.input, this.camera, this.map.obstacles);
    if (this.input.mouseDown) {
      const newBullets = this.player.tryShoot(nowMs, units);
      this.bullets.push(...newBullets);
    }

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

    this.camera.follow(this.player);

    const aliveBots = this.bots.filter((b) => b.alive).length;
    this.hud.update(this.player, aliveBots + (this.player.alive ? 1 : 0), this.safeZone);

    if (!this.player.alive) {
      this._endGame(false);
      return;
    }
    if (aliveBots === 0) {
      this._endGame(true);
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

  // Crates fill the unit's inventory rather than auto-equipping — the player picks
  // an active weapon/medkit with number keys (see WEAPON_SLOTS), while bots use a
  // simple "always take the stronger weapon" heuristic since they have no keyboard.
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
      if (bot.alive) bot.draw(ctx);
    }
    for (const bullet of this.bullets) bullet.draw(ctx);

    if (this.player.alive) this.player.draw(ctx);

    ctx.restore();
  }
}
