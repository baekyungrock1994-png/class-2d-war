import { angleTo, dist } from "../utils/math.js";

function normalizeAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// Finds the closest living, grounded unit within melee range and within a
// facing cone. Skips anyone on the other side of the special room's door —
// see constants.js's SPECIAL_ROOM_* comment — since both "layers" share real
// coordinates and would otherwise be reachable at close range.
export function findMeleeTarget(attacker, units, range, coneRadians = Math.PI / 2) {
  let best = null;
  let bestDist = Infinity;

  for (const unit of units) {
    if (unit === attacker || !unit.alive || unit.falling) continue;
    if (!!unit.inSpecialRoom !== !!attacker.inSpecialRoom) continue;
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

// Same idea as findMeleeTarget, but for crates (plain {x, y} loot entries,
// not Units) — used to resolve "punch the box open" instead of walking up
// and waiting. Crates have no explicit radius, so a small fixed one stands
// in for the box's footprint.
const CRATE_RADIUS = 14;

export function findMeleeCrateTarget(attacker, crates, range, coneRadians = Math.PI / 2) {
  let best = null;
  let bestDist = Infinity;

  for (const crate of crates) {
    if (crate.collected) continue;
    if (!!crate.inSpecialRoom !== !!attacker.inSpecialRoom) continue;
    const d = dist(attacker.x, attacker.y, crate.x, crate.y);
    if (d > range + CRATE_RADIUS) continue;

    const angleDiff = Math.abs(normalizeAngle(angleTo(attacker.x, attacker.y, crate.x, crate.y) - attacker.facing));
    if (angleDiff > coneRadians / 2) continue;

    if (d < bestDist) {
      bestDist = d;
      best = crate;
    }
  }

  return best;
}
