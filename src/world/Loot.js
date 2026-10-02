import {
  WORLD_WIDTH,
  WORLD_HEIGHT,
  LOOT_COUNT,
  CRATE_HP,
  MILITARY_CRATES_PER_BASE,
  SPECIAL_ROOM_CRATE_COUNT,
  SPECIAL_ROOM_SIZE,
  SPECIAL_ROOM_WALL_THICKNESS,
} from "../utils/constants.js";
import { randRange, dist } from "../utils/math.js";

// Crates spawned inside a 군사기지 (military base) lean heavily toward the
// "good" weapons and grenades — the whole point of fighting over the POI.
const MILITARY_LOOT_TYPES = [
  { type: "weapon", weapon: "shotgun", weight: 4 },
  { type: "weapon", weapon: "rifle", weight: 4 },
  { type: "grenade", weight: 3 },
  { type: "weapon", weapon: "pistol", weight: 1 },
  { type: "ammo", weight: 2 },
  { type: "medkit", weight: 2 },
];

// Everywhere else on the map — the same weapons still show up, just less often.
const FIELD_LOOT_TYPES = [
  { type: "weapon", weapon: "pistol", weight: 4 },
  { type: "weapon", weapon: "rifle", weight: 1 },
  { type: "weapon", weapon: "shotgun", weight: 1 },
  { type: "ammo", weight: 4 },
  { type: "medkit", weight: 3 },
  { type: "grenade", weight: 1 },
];

// The special room's own crates skew even harder toward the best gear —
// it's the reward for finding and using the hatch in the first place.
const SPECIAL_ROOM_LOOT_TYPES = [
  { type: "weapon", weapon: "rifle", weight: 4 },
  { type: "weapon", weapon: "shotgun", weight: 3 },
  { type: "grenade", weight: 3 },
  { type: "medkit", weight: 3 },
  { type: "ammo", weight: 2 },
];

function pickWeighted(table) {
  const total = table.reduce((sum, t) => sum + t.weight, 0);
  let r = randRange(0, total);
  for (const t of table) {
    if (r < t.weight) return t;
    r -= t.weight;
  }
  return table[0];
}

function makeCrate(id, x, y, picked) {
  return {
    id,
    x,
    y,
    type: picked.type,
    weapon: picked.weapon ?? null,
    collected: false,
    hp: CRATE_HP,
    maxHp: CRATE_HP,
    inSpecialRoom: false,
  };
}

function inAnyMilitaryBase(x, y, militaryBases) {
  return militaryBases.some((b) => dist(x, y, b.x, b.y) <= b.radius);
}

// Same obstacle-avoidance as GameMap.findFreeSpawn, but constrained to a
// circle so military-base crates actually land inside their base.
function findFreeSpawnInCircle(map, cx, cy, radius, itemRadius) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const angle = randRange(0, Math.PI * 2);
    const r = randRange(0, radius * 0.85);
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    const blocked = map.obstacles.some((rect) => {
      const closestX = Math.max(rect.x, Math.min(x, rect.x + rect.w));
      const closestY = Math.max(rect.y, Math.min(y, rect.y + rect.h));
      return Math.hypot(x - closestX, y - closestY) < itemRadius + 4;
    });
    if (!blocked) return { x, y };
  }
  return { x: cx, y: cy };
}

// Crates hide their contents until broken open — the type/weapon fields exist
// from spawn time (so breaking is deterministic) but are never drawn or
// exposed before `collected` is set, which is what creates the "what's
// inside?" tension. Reserves a chunk of crates inside each military base
// (weighted toward the good stuff) and inside the special room (even more
// so), then fills the rest of the map at the normal, milder rate.
export function generateLoot(map) {
  const items = [];
  let nextId = 0;

  for (const base of map.militaryBases || []) {
    for (let i = 0; i < MILITARY_CRATES_PER_BASE; i++) {
      const spawn = findFreeSpawnInCircle(map, base.x, base.y, base.radius, 20);
      items.push(makeCrate(`crate_${nextId++}`, spawn.x, spawn.y, pickWeighted(MILITARY_LOOT_TYPES)));
    }
  }

  if (map.specialRoom) {
    // Tagged inSpecialRoom so nothing treats these as reachable/visible from
    // the surface even though they share the same (x, y) neighborhood as the
    // room's door — see Game.js/targeting.js's layer checks.
    const { x: cx, y: cy } = map.specialRoom.interior;
    const inset = SPECIAL_ROOM_SIZE / 2 - SPECIAL_ROOM_WALL_THICKNESS - 30;
    for (let i = 0; i < SPECIAL_ROOM_CRATE_COUNT; i++) {
      const x = cx + randRange(-inset, inset);
      const y = cy + randRange(-inset, inset);
      const crate = makeCrate(`crate_${nextId++}`, x, y, pickWeighted(SPECIAL_ROOM_LOOT_TYPES));
      crate.inSpecialRoom = true;
      items.push(crate);
    }
  }

  const fieldCount = Math.max(0, LOOT_COUNT - items.length);
  for (let i = 0; i < fieldCount; i++) {
    let spawn;
    let attempts = 0;
    do {
      spawn = map.findFreeSpawn(20);
      attempts++;
    } while (inAnyMilitaryBase(spawn.x, spawn.y, map.militaryBases || []) && attempts < 20);
    items.push(makeCrate(`crate_${nextId++}`, spawn.x, spawn.y, pickWeighted(FIELD_LOOT_TYPES)));
  }

  return items;
}

const BOX_SIZE = 24;

// Draws directly in world-space; the caller applies the camera's zoom/pan transform.
// Crates always render identically regardless of contents — only damage state differs.
// inSpecialRoom filters to just the crate "layer" matching the viewer — see
// constants.js's SPECIAL_ROOM_* comment for why that matters even though
// positions are plain world coordinates.
export function drawLoot(ctx, camera, items, inSpecialRoom = false) {
  for (const item of items) {
    if (item.collected) continue;
    if (!!item.inSpecialRoom !== inSpecialRoom) continue;
    if (!camera.isRoughlyVisible(item.x, item.y, 50)) continue;

    const maxHp = item.maxHp || CRATE_HP;
    const damageFrac = maxHp > 0 ? 1 - Math.max(0, item.hp ?? maxHp) / maxHp : 0;
    const half = BOX_SIZE / 2;

    ctx.save();
    ctx.translate(item.x, item.y);

    if (damageFrac > 0) {
      ctx.shadowColor = "rgba(255, 120, 60, 0.85)";
      ctx.shadowBlur = 10;
    }

    ctx.fillStyle = "#8a6a3d";
    ctx.fillRect(-half, -half, BOX_SIZE, BOX_SIZE);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "#3a2e1c";
    ctx.lineWidth = 2;
    ctx.strokeRect(-half, -half, BOX_SIZE, BOX_SIZE);

    ctx.strokeStyle = "#5c4526";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-half, -half);
    ctx.lineTo(half, half);
    ctx.moveTo(half, -half);
    ctx.lineTo(-half, half);
    ctx.stroke();

    // Cracks appear and spread as the crate takes damage, instead of the old
    // stand-and-wait hourglass — visual feedback that punching it is working.
    if (damageFrac > 0) {
      ctx.strokeStyle = "rgba(255, 235, 200, 0.9)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-half * 0.5, -half * 0.6);
      ctx.lineTo(-half * 0.1, half * 0.2 * damageFrac);
      ctx.lineTo(half * 0.4, -half * 0.1);
      if (damageFrac > 0.5) {
        ctx.moveTo(half * 0.5, half * 0.5);
        ctx.lineTo(half * 0.1, half * 0.1);
      }
      ctx.stroke();
    }

    ctx.restore();
  }
}
