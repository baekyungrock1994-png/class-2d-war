import { dist } from "../utils/math.js";
import { HIDDEN_REVEAL_RANGE } from "../utils/constants.js";

// Finds the closest living, grounded unit within range for auto-aim — a unit
// hiding in a bush only counts once the attacker is close enough to spot it,
// same rule used for rendering (see Game.js's _visibleToLocalPlayer).
export function findNearestTarget(attacker, units, range) {
  let best = null;
  let bestDist = Infinity;

  for (const unit of units) {
    if (unit === attacker || !unit.alive || unit.falling) continue;
    const d = dist(attacker.x, attacker.y, unit.x, unit.y);
    if (d > range) continue;
    if (unit.hidden && d > HIDDEN_REVEAL_RANGE) continue;
    if (d < bestDist) {
      bestDist = d;
      best = unit;
    }
  }

  return best;
}
