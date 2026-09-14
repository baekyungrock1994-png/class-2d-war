import { GRENADE_FLIGHT_MS, GRENADE_FUSE_MS } from "../utils/constants.js";

let nextId = 1;

// Thrown from (x, y) toward (targetX, targetY) — always GRENADE_THROW_DISTANCE
// away in the thrower's aim direction. Explodes GRENADE_FUSE_MS after the
// throw regardless of how long the flight itself takes, matching a real pin-
// pull timer rather than an impact fuse.
export class Grenade {
  constructor(x, y, targetX, targetY, ownerId, nowMs) {
    this.id = `grenade_${nextId++}`;
    this.startX = x;
    this.startY = y;
    this.targetX = targetX;
    this.targetY = targetY;
    this.x = x;
    this.y = y;
    this.ownerId = ownerId;
    this.thrownAt = nowMs;
    this.explodeAt = nowMs + GRENADE_FUSE_MS;
    this.dead = false;
  }

  update(nowMs) {
    const flightT = Math.min(1, (nowMs - this.thrownAt) / GRENADE_FLIGHT_MS);
    this.x = this.startX + (this.targetX - this.startX) * flightT;
    this.y = this.startY + (this.targetY - this.startY) * flightT;
  }
}
