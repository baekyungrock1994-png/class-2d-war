import { PLAYER_RADIUS, PLAYER_MAX_HEALTH, WEAPONS, WORLD_WIDTH, WORLD_HEIGHT, FALL_DURATION_MS, MELEE_SWING_MS } from "../utils/constants.js";
import { clamp, circleRectPush } from "../utils/math.js";

let nextId = 1;

// Shared logic for the human player and bots: health, movement resolution, weapon state.
export class Unit {
  constructor(x, y, isPlayer = false) {
    this.id = `unit_${nextId++}`;
    this.x = x;
    this.y = y;
    this.radius = PLAYER_RADIUS;
    this.health = PLAYER_MAX_HEALTH;
    this.maxHealth = PLAYER_MAX_HEALTH;
    this.isPlayer = isPlayer;
    this.alive = true;
    this.facing = 0;

    this.weaponKey = "fist";
    this.mag = 0;
    this.reserveAmmo = 0;
    this.lastShotAt = -Infinity;
    this.meleeSwingUntil = 0;
    this.punchHand = 0;

    // Inventory: weapons found in crates are added here, not auto-equipped —
    // the unit (player via number keys, bots via AI) chooses when to switch.
    this.ownedWeapons = new Set(["fist"]);
    this.weaponAmmo = {}; // weaponKey -> { mag, reserve }, preserved across switches
    this.medkitCount = 0;

    this.falling = false;
    this.fallElapsed = 0;
    this.fallDurationMs = FALL_DURATION_MS;

    this.name = isPlayer ? "나" : `봇-${nextId}`;
  }

  get weapon() {
    return WEAPONS[this.weaponKey];
  }

  startFall() {
    this.falling = true;
    this.fallElapsed = 0;
  }

  applyMovement(dx, dy, dtSec, obstacles) {
    this.x += dx * dtSec;
    this.y += dy * dtSec;

    this.x = clamp(this.x, this.radius, WORLD_WIDTH - this.radius);
    this.y = clamp(this.y, this.radius, WORLD_HEIGHT - this.radius);

    for (const rect of obstacles) {
      const push = circleRectPush(this.x, this.y, this.radius, rect);
      if (push) {
        this.x += push.x;
        this.y += push.y;
      }
    }
  }

  canShoot(nowMs) {
    if (!this.alive || this.falling) return false;
    if (!this.weapon.melee && this.mag <= 0) return false;
    return nowMs - this.lastShotAt >= this.weapon.fireRateMs;
  }

  consumeShot(nowMs) {
    this.lastShotAt = nowMs;
    if (!this.weapon.melee) this.mag -= 1;
  }

  reload() {
    if (this.weapon.melee) return;
    if (this.mag >= this.weapon.magSize || this.reserveAmmo <= 0) return;
    const needed = this.weapon.magSize - this.mag;
    const taken = Math.min(needed, this.reserveAmmo);
    this.mag += taken;
    this.reserveAmmo -= taken;
  }

  // Adds a weapon to the inventory (from opening a crate) without equipping it.
  acquireWeapon(weaponKey) {
    if (this.ownedWeapons.has(weaponKey)) {
      // Already carrying one — top up its reserve instead of doing nothing.
      const store = this.weaponAmmo[weaponKey];
      const maxReserve = WEAPONS[weaponKey].reserveAmmo * 2;
      store.reserve = Math.min(store.reserve + WEAPONS[weaponKey].reserveAmmo, maxReserve);
      return;
    }
    this.ownedWeapons.add(weaponKey);
    this.weaponAmmo[weaponKey] = { mag: WEAPONS[weaponKey].magSize, reserve: WEAPONS[weaponKey].reserveAmmo };
  }

  // Switches the active weapon, restoring that weapon's own saved ammo counts.
  equipWeapon(weaponKey) {
    if (!this.ownedWeapons.has(weaponKey) || weaponKey === this.weaponKey) return false;

    if (!this.weapon.melee) {
      this.weaponAmmo[this.weaponKey] = { mag: this.mag, reserve: this.reserveAmmo };
    }

    this.weaponKey = weaponKey;
    if (this.weapon.melee) {
      this.mag = 0;
      this.reserveAmmo = 0;
    } else {
      const store = this.weaponAmmo[weaponKey];
      this.mag = store.mag;
      this.reserveAmmo = store.reserve;
    }
    return true;
  }

  addAmmoToOwnedWeapons(amount) {
    for (const key of this.ownedWeapons) {
      if (key === "fist") continue;
      if (key === this.weaponKey) {
        this.reserveAmmo += amount;
      } else {
        this.weaponAmmo[key].reserve += amount;
      }
    }
  }

  useMedkit(healAmount) {
    if (this.medkitCount <= 0) return false;
    this.medkitCount -= 1;
    this.heal(healAmount);
    return true;
  }

  triggerMeleeSwing(nowMs) {
    this.meleeSwingUntil = nowMs + MELEE_SWING_MS;
    this.punchHand = 1 - this.punchHand;
  }

  heal(amount) {
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  takeDamage(amount) {
    if (!this.alive) return;
    this.health -= amount;
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
    }
  }

  // Draws directly in world-space coordinates; the caller has already applied the
  // camera's zoom/pan transform, so no manual screen-space conversion happens here.
  drawBody(ctx, colorAlive, colorDead) {
    if (this.falling) {
      this._drawFalling(ctx, colorAlive);
      return;
    }

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.facing);

    ctx.fillStyle = this.alive ? colorAlive : colorDead;
    ctx.beginPath();
    ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 2;
    ctx.stroke();

    if (this.weapon.melee) {
      this._drawFists(ctx);
    } else {
      const reach = this.radius + 14;
      ctx.strokeStyle = "#222";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(reach, 0);
      ctx.stroke();
    }

    ctx.restore();

    if (this.alive) {
      ctx.fillStyle = "#000a";
      ctx.fillRect(this.x - 18, this.y - this.radius - 14, 36, 5);
      ctx.fillStyle = "#4caf50";
      ctx.fillRect(this.x - 18, this.y - this.radius - 14, 36 * (this.health / this.maxHealth), 5);

      ctx.fillStyle = "#fff";
      ctx.font = "11px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(this.name, this.x, this.y - this.radius - 18);
    }
  }

  // Two small fists in front of the body, standing in for the "no weapon" look.
  // They rest near the chest and punch forward when a melee swing is active.
  _drawFists(ctx) {
    const now = performance.now();
    let swingT = 0;
    if (this.meleeSwingUntil > now) {
      const remain = this.meleeSwingUntil - now;
      swingT = 1 - clamp(remain / MELEE_SWING_MS, 0, 1);
    }
    const punch = Math.sin(swingT * Math.PI); // 0 -> 1 -> 0 across the swing

    const restX = this.radius * 0.55;
    const sideY = this.radius * 0.55;
    const fistRadius = this.radius * 0.42;
    const reachDistance = this.radius * 0.9;

    const leadOffset = punch * reachDistance;
    const followOffset = punch * reachDistance * 0.3;
    const fistA = this.punchHand === 0 ? leadOffset : followOffset;
    const fistB = this.punchHand === 1 ? leadOffset : followOffset;

    ctx.fillStyle = "#f2b48c";
    ctx.strokeStyle = "#a5673f";
    ctx.lineWidth = 1.5;

    ctx.beginPath();
    ctx.arc(restX + fistA, -sideY, fistRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(restX + fistB, sideY, fistRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // Simple top-down parachute illusion: a fixed ground shadow plus a body that
  // starts small/high and grows as it drops, with a canopy shown above it.
  _drawFalling(ctx, colorAlive) {
    const t = clamp(this.fallElapsed / this.fallDurationMs, 0, 1);
    const heightOffset = (1 - t) * 90;
    const scale = 0.55 + 0.45 * t;

    ctx.save();
    ctx.globalAlpha = 0.35 + 0.25 * t;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(this.x, this.y, this.radius * 0.9 * t + 4, this.radius * 0.5 * t + 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const drawY = this.y - heightOffset;

    if (t < 0.92) {
      ctx.save();
      ctx.translate(this.x, drawY - this.radius * 2.2 * scale);
      ctx.fillStyle = "#e0a800";
      ctx.beginPath();
      ctx.ellipse(0, 0, this.radius * 1.6 * scale, this.radius * 0.9 * scale, 0, Math.PI, 0);
      ctx.fill();
      ctx.strokeStyle = "#333";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-this.radius * 1.6 * scale, 0);
      ctx.lineTo(0, this.radius * 1.8 * scale);
      ctx.moveTo(this.radius * 1.6 * scale, 0);
      ctx.lineTo(0, this.radius * 1.8 * scale);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(this.x, drawY);
    ctx.scale(scale, scale);
    ctx.rotate(this.facing);
    ctx.fillStyle = colorAlive;
    ctx.beginPath();
    ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }
}
