import { Unit } from "./Unit.js";
import { Bullet } from "./Bullet.js";
import { PLAYER_SPEED, MEDKIT_HEAL_AMOUNT, HIDDEN_REVEAL_RANGE } from "../utils/constants.js";
import { angleTo, dist, randRange } from "../utils/math.js";

const SIGHT_RANGE = 480;
const PREFERRED_RANGE = 260;
const WANDER_INTERVAL_MS = 3500;
const LOW_HEALTH_RATIO = 0.5;

export class Bot extends Unit {
  constructor(x, y, name) {
    super(x, y, false);
    this.name = name;
    this.wanderTarget = { x, y };
    this.wanderTimer = randRange(0, WANDER_INTERVAL_MS);
    this.reactionCooldown = randRange(0, 400);
  }

  _pickWanderTarget(map) {
    this.wanderTarget = {
      x: randRange(this.radius, map.width - this.radius),
      y: randRange(this.radius, map.height - this.radius),
    };
  }

  // Bots have no keyboard, so they equip/use inventory items via simple heuristics
  // instead of the player's number-key selection.
  _switchToBestAvailableWeapon() {
    for (const key of this.ownedWeapons) {
      if (key === this.weaponKey || key === "fist") continue;
      const store = this.weaponAmmo[key];
      if (store && (store.mag > 0 || store.reserve > 0)) {
        this.equipWeapon(key);
        return;
      }
    }
    this.equipWeapon("fist");
  }

  update(dtMs, ctx) {
    if (!this.alive) return [];
    const { map, safeZone, units, obstacles, nowMs } = ctx;
    const dtSec = dtMs / 1000;
    const bulletsOut = [];

    if (this.medkitCount > 0 && this.health < this.maxHealth * LOW_HEALTH_RATIO) {
      this.useMedkit(MEDKIT_HEAL_AMOUNT);
    }

    let target = null;
    let bestDist = Infinity;
    for (const u of units) {
      if (u === this || !u.alive || u.falling) continue;
      const d = dist(this.x, this.y, u.x, u.y);
      if (u.hidden && d > HIDDEN_REVEAL_RANGE) continue; // can't spot someone hiding in a bush from afar
      if (d < SIGHT_RANGE && d < bestDist) {
        bestDist = d;
        target = u;
      }
    }

    let moveX = 0, moveY = 0;
    const weapon = this.weapon;
    const preferredRange = weapon.melee ? weapon.range * 0.75 : PREFERRED_RANGE;

    if (safeZone.isOutside(this.x, this.y)) {
      const toCenter = angleTo(this.x, this.y, safeZone.centerX, safeZone.centerY);
      moveX = Math.cos(toCenter);
      moveY = Math.sin(toCenter);
      this.facing = toCenter;
    } else if (target) {
      this.facing = angleTo(this.x, this.y, target.x, target.y);

      if (bestDist > preferredRange) {
        moveX = Math.cos(this.facing);
        moveY = Math.sin(this.facing);
      } else if (bestDist < preferredRange * 0.6) {
        moveX = -Math.cos(this.facing);
        moveY = -Math.sin(this.facing);
      }

      this.reactionCooldown -= dtMs;
      if (this.reactionCooldown <= 0) {
        this.reactionCooldown = randRange(150, 400);
        const canAttack = weapon.melee ? bestDist <= weapon.range : true;

        if (canAttack && this.canShoot(nowMs) && Math.random() < 0.85) {
          this.consumeShot(nowMs);
          if (weapon.melee) {
            this.triggerMeleeSwing(nowMs);
            target.takeDamage(weapon.damage);
          } else {
            const pelletCount = weapon.pellets ?? 1;
            for (let i = 0; i < pelletCount; i++) {
              const spread = randRange(-weapon.spread * 2.2, weapon.spread * 2.2);
              bulletsOut.push(new Bullet(this.x, this.y, this.facing + spread, weapon.bulletSpeed, weapon.damage, this.id));
            }
          }
        } else if (!weapon.melee && this.mag <= 0) {
          if (this.reserveAmmo > 0) {
            this.reload();
          } else {
            this._switchToBestAvailableWeapon();
          }
        }
      }
    } else {
      this.wanderTimer -= dtMs;
      if (this.wanderTimer <= 0 || dist(this.x, this.y, this.wanderTarget.x, this.wanderTarget.y) < 30) {
        this._pickWanderTarget(map);
        this.wanderTimer = WANDER_INTERVAL_MS;
      }
      this.facing = angleTo(this.x, this.y, this.wanderTarget.x, this.wanderTarget.y);
      moveX = Math.cos(this.facing);
      moveY = Math.sin(this.facing);
    }

    if (moveX !== 0 || moveY !== 0) {
      const len = Math.hypot(moveX, moveY);
      const speed = PLAYER_SPEED * 0.85;
      this.applyMovement((moveX / len) * speed, (moveY / len) * speed, dtSec, obstacles);
    }

    return bulletsOut;
  }

  draw(ctx) {
    this.drawBody(ctx, "#e05a5a", "#555");
  }
}
