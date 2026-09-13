import { angleTo, dist } from "../utils/math.js";

function normalizeAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// Finds the closest living, grounded unit within melee range and within a facing cone.
export function findMeleeTarget(attacker, units, range, coneRadians = Math.PI / 2) {
  let best = null;
  let bestDist = Infinity;

  for (const unit of units) {
    if (unit === attacker || !unit.alive || unit.falling) continue;
    const d = dist(attacker.x, attacker.y, unit.x, unit.y);
    if (d > range + unit.radius) continue;

    const angleDiff = Math.abs(normalizeAngle(angleTo(attacker.x, attacker.y, unit.x, unit.y) - attacker.facing));
    if (angleDiff > coneRadians / 2) continue;

    if (d < bestDist) {
      bestDist = d;
      best = unit;
    }
  }

  return best;
}
