import { PLAYER_RADIUS, PLAYER_MAX_HEALTH, WEAPONS, WORLD_WIDTH, WORLD_HEIGHT, FALL_DURATION_MS, MELEE_SWING_MS } from "../utils/constants.js";
import { clamp, circleRectPush } from "../utils/math.js";
import { drawUnit } from "../render/drawUnit.js";

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

    // Recomputed every tick from bush cover (see Game.js) — hides this unit's
    // body/name from other viewers' rendering unless they're standing close.
    this.hidden = false;

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
      // A guest's locally-predicted player has this weapon in `ownedWeapons`
      // (synced from the host's snapshot) but never actually ran acquireWeapon()
      // itself, so weaponAmmo[weaponKey] can be missing — fall back to a fresh
      // magazine rather than crashing.
      const store = this.weaponAmmo[weaponKey] ?? {
        mag: WEAPONS[weaponKey].magSize,
        reserve: WEAPONS[weaponKey].reserveAmmo,
      };
      this.weaponAmmo[weaponKey] = store;
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
  // Shared with guest-side network rendering — see src/render/drawUnit.js.
  drawBody(ctx, colorAlive, colorDead) {
    drawUnit(ctx, this, colorAlive, colorDead);
  }
}
