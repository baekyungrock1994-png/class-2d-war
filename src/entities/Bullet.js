import { BULLET_RADIUS, BULLET_LIFETIME_MS } from "../utils/constants.js";
import { segmentIntersectsRect, dist } from "../utils/math.js";

let nextId = 1;

export class Bullet {
  constructor(x, y, angle, speed, damage, ownerId, range = Infinity) {
    this.id = `bullet_${nextId++}`;
    this.x = x;
    this.y = y;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.speed = speed;
    this.range = range; // px traveled before it despawns, distinct from weapon.range (melee reach)
    this.traveled = 0;
    this.damage = damage;
    this.ownerId = ownerId;
    this.ageMs = 0;
    this.dead = false;
  }

  update(dtMs, obstacles, units) {
    const dtSec = dtMs / 1000;
    const prevX = this.x;
    const prevY = this.y;
    this.x += this.vx * dtSec;
    this.y += this.vy * dtSec;
    this.ageMs += dtMs;
    this.traveled += this.speed * dtSec;

    if (this.ageMs > BULLET_LIFETIME_MS || this.traveled >= this.range) {
      this.dead = true;
      return;
    }

    for (const rect of obstacles) {
      if (segmentIntersectsRect(prevX, prevY, this.x, this.y, rect)) {
        this.dead = true;
        return;
      }
    }

    for (const unit of units) {
      if (!unit.alive || unit.id === this.ownerId || unit.falling) continue;
      if (dist(this.x, this.y, unit.x, unit.y) <= unit.radius + BULLET_RADIUS) {
        unit.takeDamage(this.damage, this.ownerId);
        this.dead = true;
        return;
      }
    }
  }

  draw(ctx) {
    ctx.fillStyle = "#fff59d";
    ctx.beginPath();
    ctx.arc(this.x, this.y, BULLET_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }
}
