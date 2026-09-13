import { WORLD_WIDTH, WORLD_HEIGHT, LOOT_COUNT, CRATE_OPEN_MS } from "../utils/constants.js";
import { randRange } from "../utils/math.js";

const LOOT_TYPES = [
  { type: "weapon", weapon: "pistol", weight: 3 },
  { type: "weapon", weapon: "rifle", weight: 2 },
  { type: "weapon", weapon: "shotgun", weight: 2 },
  { type: "ammo", weight: 4 },
  { type: "medkit", weight: 3 },
];

function pickWeighted() {
  const total = LOOT_TYPES.reduce((sum, t) => sum + t.weight, 0);
  let r = randRange(0, total);
  for (const t of LOOT_TYPES) {
    if (r < t.weight) return t;
    r -= t.weight;
  }
  return LOOT_TYPES[0];
}

// Crates hide their contents until opened — the type/weapon fields exist from
// spawn time (so opening is deterministic) but are never drawn or exposed
// before `collected` is set, which is what creates the "what's inside?" tension.
export function generateLoot(map) {
  const items = [];
  for (let i = 0; i < LOOT_COUNT; i++) {
    const spawn = map.findFreeSpawn(20);
    const picked = pickWeighted();
    items.push({
      id: `crate_${i}`,
      x: spawn.x,
      y: spawn.y,
      type: picked.type,
      weapon: picked.weapon ?? null,
      collected: false,
      openerId: null,
      progress: 0,
    });
  }
  return items;
}

const BOX_SIZE = 24;

// Draws directly in world-space; the caller applies the camera's zoom/pan transform.
// Crates always render identically regardless of contents — only opened state differs.
export function drawLoot(ctx, camera, items) {
  for (const item of items) {
    if (item.collected) continue;
    if (!camera.isRoughlyVisible(item.x, item.y, 50)) continue;

    const opening = item.progress > 0;
    const half = BOX_SIZE / 2;

    ctx.save();
    ctx.translate(item.x, item.y);

    if (opening) {
      ctx.shadowColor = "rgba(255, 210, 90, 0.85)";
      ctx.shadowBlur = 12;
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

    ctx.restore();

    if (opening) {
      const t = Math.min(1, item.progress / CRATE_OPEN_MS);
      drawHourglass(ctx, item.x, item.y - half - 20, 16, 22, t);
    }
  }
}

// Progress goes 0 -> 1: the top bulb's remaining sand shrinks toward the neck
// while the bottom bulb fills from its base, exactly like real sand physics.
function drawHourglass(ctx, cx, cy, w, h, progress) {
  const halfW = w / 2;
  const halfH = h / 2;

  ctx.save();
  ctx.translate(cx, cy);

  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(-halfW - 3, -halfH - 3, w + 6, h + 6);

  ctx.strokeStyle = "#e8dcb8";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-halfW, -halfH);
  ctx.lineTo(halfW, -halfH);
  ctx.lineTo(0, 0);
  ctx.lineTo(halfW, halfH);
  ctx.lineTo(-halfW, halfH);
  ctx.lineTo(0, 0);
  ctx.closePath();
  ctx.stroke();

  ctx.fillStyle = "#f2c94c";

  // Remaining sand in the top bulb: a triangle scaled by (1 - progress), apex at the neck.
  const remain = 1 - progress;
  ctx.beginPath();
  ctx.moveTo(-halfW * remain, -halfH * remain);
  ctx.lineTo(halfW * remain, -halfH * remain);
  ctx.lineTo(0, 0);
  ctx.closePath();
  ctx.fill();

  // Accumulated sand in the bottom bulb: fills from the base up to level y0.
  const y0 = halfH * remain;
  const levelHalfW = halfW * (y0 / halfH);
  ctx.beginPath();
  ctx.moveTo(-levelHalfW, y0);
  ctx.lineTo(levelHalfW, y0);
  ctx.lineTo(halfW, halfH);
  ctx.lineTo(-halfW, halfH);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}
