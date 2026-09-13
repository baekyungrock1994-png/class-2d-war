import { Unit } from "./Unit.js";
import { Bullet } from "./Bullet.js";
import { findMeleeTarget } from "./melee.js";
import { PLAYER_SPEED, WORLD_WIDTH, WORLD_HEIGHT, WEAPON_SLOTS, MEDKIT_SLOT, MEDKIT_HEAL_AMOUNT } from "../utils/constants.js";
import { angleTo, randRange, clamp } from "../utils/math.js";

export class Player extends Unit {
  constructor(x, y) {
    super(x, y, true);
  }

  update(dtMs, input, camera, obstacles) {
    if (!this.alive) return;

    const dtSec = dtMs / 1000;
    let dx = 0, dy = 0;
    if (input.isDown("KeyW") || input.isDown("ArrowUp")) dy -= 1;
    if (input.isDown("KeyS") || input.isDown("ArrowDown")) dy += 1;
    if (input.isDown("KeyA") || input.isDown("ArrowLeft")) dx -= 1;
    if (input.isDown("KeyD") || input.isDown("ArrowRight")) dx += 1;

    const speed = this.falling ? PLAYER_SPEED * 0.7 : PLAYER_SPEED;
    if (dx !== 0 || dy !== 0) {
      const len = Math.hypot(dx, dy);
      dx = (dx / len) * speed;
      dy = (dy / len) * speed;
    }

    if (this.falling) {
      this.x = clamp(this.x + dx * dtSec, this.radius, WORLD_WIDTH - this.radius);
      this.y = clamp(this.y + dy * dtSec, this.radius, WORLD_HEIGHT - this.radius);
    } else {
      this.applyMovement(dx, dy, dtSec, obstacles);
    }

    if (typeof input.remoteFacing === "number") {
      // Driven by RemoteInputAdapter (host simulating a guest) — the guest
      // already computed this angle against its own camera/mouse and sent the
      // result directly, since it doesn't share the host's camera transform.
      this.facing = input.remoteFacing;
    } else {
      const worldMouse = camera.screenToWorld(input.mouseX, input.mouseY);
      this.facing = angleTo(this.x, this.y, worldMouse.x, worldMouse.y);
    }

    if (this.falling) {
      this.fallElapsed += dtMs;
      if (this.fallElapsed >= this.fallDurationMs) {
        this.falling = false;
        for (const rect of obstacles) {
          this.applyMovement(0, 0, 0, [rect]);
        }
      }
      return;
    }

    for (const { code, weapon } of WEAPON_SLOTS) {
      if (input.wasJustPressed(code) && this.ownedWeapons.has(weapon)) {
        this.equipWeapon(weapon);
      }
    }
    if (input.wasJustPressed(MEDKIT_SLOT.code)) {
      this.useMedkit(MEDKIT_HEAL_AMOUNT);
    }

    if (input.isDown("KeyR")) this.reload();
  }

  tryShoot(nowMs, units) {
    if (!this.canShoot(nowMs)) return [];
    this.consumeShot(nowMs);

    const weapon = this.weapon;

    if (weapon.melee) {
      this.triggerMeleeSwing(nowMs);
      const target = findMeleeTarget(this, units, weapon.range);
      if (target) target.takeDamage(weapon.damage);
      return [];
    }

    const bullets = [];
    const pelletCount = weapon.pellets ?? 1;
    for (let i = 0; i < pelletCount; i++) {
      const spread = randRange(-weapon.spread, weapon.spread);
      bullets.push(new Bullet(this.x, this.y, this.facing + spread, weapon.bulletSpeed, weapon.damage, this.id));
    }
    return bullets;
  }

  draw(ctx) {
    this.drawBody(ctx, "#3f8efc", "#555");
  }
}
