import { dist } from "../utils/math.js";
import { HIDDEN_REVEAL_RANGE } from "../utils/constants.js";

// Finds the closest living, grounded unit within range for auto-aim — a unit
// hiding in a bush only counts once the attacker is close enough to spot it,
// same rule used for rendering (see Game.js's _visibleToLocalPlayer). A unit
// on the other side of the special room's door never counts, no matter how
// close in raw x/y — see constants.js's SPECIAL_ROOM_* comment for why that
// check is needed even though both "layers" share real coordinates.
export function findNearestTarget(attacker, units, range) {
  let best = null;
  let bestDist = Infinity;

  for (const unit of units) {
    if (unit === attacker || !unit.alive || unit.falling) continue;
    if (!!unit.inSpecialRoom !== !!attacker.inSpecialRoom) continue;
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

// Same idea, for loot crates — lets a player/bot auto-face an unbroken crate
// (to then attack it, see Game.js's _tryBreakCrateNear) the same way they
// auto-face the nearest enemy. Only consulted once no enemy is in range (see
// Player.js/GuestView.js), so combat always takes priority over looting.
export function findNearestCrate(attacker, crates, range) {
  let best = null;
  let bestDist = Infinity;

  for (const crate of crates) {
    if (crate.collected) continue;
    if (!!crate.inSpecialRoom !== !!attacker.inSpecialRoom) continue;
    const d = dist(attacker.x, attacker.y, crate.x, crate.y);
    if (d > range) continue;
    if (d < bestDist) {
      bestDist = d;
      best = crate;
    }
  }

  return best;
}
