import {
  WORLD_WIDTH,
  WORLD_HEIGHT,
  OBSTACLE_COUNT,
  BUSH_COUNT,
  BUSH_RADIUS_RANGE,
  CONTAINER_YARD_COUNT,
} from "../utils/constants.js";
import { randRange, randInt, dist } from "../utils/math.js";

// Simple procedural terrain patches purely for visual variety (no gameplay effect yet).
function generateTerrainPatches() {
  const patches = [];
  const kinds = ["sand", "water", "darkgrass"];
  for (let i = 0; i < 40; i++) {
    patches.push({
      x: randRange(0, WORLD_WIDTH),
      y: randRange(0, WORLD_HEIGHT),
      r: randRange(80, 260),
      kind: kinds[randInt(0, kinds.length - 1)],
    });
  }
  return patches;
}

function generateObstacles() {
  const obstacles = [];
  for (let i = 0; i < OBSTACLE_COUNT; i++) {
    const w = randRange(40, 110);
    const h = randRange(40, 110);
    obstacles.push({
      x: randRange(0, WORLD_WIDTH - w),
      y: randRange(0, WORLD_HEIGHT - h),
      w,
      h,
    });
  }
  return obstacles;
}

// A cluster of small overlapping circles precomputed once (not re-randomized
// per draw) so bushes read as a leafy shrub instead of a plain disc.
function generateBushes() {
  const bushes = [];
  for (let i = 0; i < BUSH_COUNT; i++) {
    const radius = randRange(BUSH_RADIUS_RANGE[0], BUSH_RADIUS_RANGE[1]);
    const clumpCount = randInt(4, 6);
    const clumps = [];
    for (let j = 0; j < clumpCount; j++) {
      const angle = randRange(0, Math.PI * 2);
      const offset = randRange(0, radius * 0.55);
      clumps.push({
        dx: Math.cos(angle) * offset,
        dy: Math.sin(angle) * offset,
        r: randRange(radius * 0.35, radius * 0.6),
      });
    }
    bushes.push({ x: randRange(0, WORLD_WIDTH), y: randRange(0, WORLD_HEIGHT), radius, clumps });
  }
  return bushes;
}

const YARD_OUTER_HALF = 130;
const YARD_THICKNESS = 26;
const YARD_GAP = 70;

// A square ring of container obstacles with a gap in the middle of each side —
// players can loop around the inside, the outside, or cut through a gap, which
// is what makes it a chase/juke spot instead of just more scattered cover.
function buildContainerYard(cx, cy) {
  const half = YARD_OUTER_HALF;
  const t = YARD_THICKNESS;
  const sideLen = half - YARD_GAP / 2;

  const rects = [
    // top
    { x: cx - half, y: cy - half, w: sideLen, h: t },
    { x: cx + YARD_GAP / 2, y: cy - half, w: sideLen, h: t },
    // bottom
    { x: cx - half, y: cy + half - t, w: sideLen, h: t },
    { x: cx + YARD_GAP / 2, y: cy + half - t, w: sideLen, h: t },
    // left
    { x: cx - half, y: cy - half, w: t, h: sideLen },
    { x: cx - half, y: cy + YARD_GAP / 2, w: t, h: sideLen },
    // right
    { x: cx + half - t, y: cy - half, w: t, h: sideLen },
    { x: cx + half - t, y: cy + YARD_GAP / 2, w: t, h: sideLen },
  ];

  return rects.map((r) => ({ ...r, kind: "container" }));
}

function generateContainerYards(count) {
  const margin = YARD_OUTER_HALF + 60;
  const centers = [];
  for (let i = 0; i < count; i++) {
    let cx, cy;
    let attempts = 0;
    do {
      cx = randRange(margin, WORLD_WIDTH - margin);
      cy = randRange(margin, WORLD_HEIGHT - margin);
      attempts++;
    } while (centers.some((c) => dist(cx, cy, c.x, c.y) < 700) && attempts < 30);
    centers.push({ x: cx, y: cy });
  }
  return centers.flatMap((c) => buildContainerYard(c.x, c.y));
}

// True if (x, y) falls inside any bush — used to hide a unit's sprite/name
// from other viewers (see Game.js) and to keep bots from spotting it from afar.
export function isHiddenInBushes(x, y, bushes) {
  for (const bush of bushes) {
    if (dist(x, y, bush.x, bush.y) <= bush.radius) return true;
  }
  return false;
}

export class GameMap {
  constructor() {
    this.width = WORLD_WIDTH;
    this.height = WORLD_HEIGHT;
    this.terrainPatches = generateTerrainPatches();
    this.bushes = generateBushes();
    this.obstacles = [...generateObstacles(), ...generateContainerYards(CONTAINER_YARD_COUNT)];
  }

  // Finds an obstacle-free spawn point.
  findFreeSpawn(radius) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const x = randRange(radius, this.width - radius);
      const y = randRange(radius, this.height - radius);
      const blocked = this.obstacles.some((rect) => {
        const closestX = Math.max(rect.x, Math.min(x, rect.x + rect.w));
        const closestY = Math.max(rect.y, Math.min(y, rect.y + rect.h));
        return Math.hypot(x - closestX, y - closestY) < radius + 4;
      });
      if (!blocked) return { x, y };
    }
    return { x: this.width / 2, y: this.height / 2 };
  }

  // Draws directly in world-space; the caller applies the camera's zoom/pan
  // transform beforehand, so this only needs `camera` for visibility culling.
  draw(ctx, camera) {
    const colorFor = { sand: "#c2a866", water: "#2a6f8f", darkgrass: "#1c3318" };
    for (const patch of this.terrainPatches) {
      if (!camera.isRoughlyVisible(patch.x, patch.y, patch.r)) continue;
      ctx.fillStyle = colorFor[patch.kind];
      ctx.beginPath();
      ctx.arc(patch.x, patch.y, patch.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Grid lines for spatial reference; constant on-screen thickness regardless of zoom.
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1 / camera.zoom;
    const gridSize = 200;
    const startX = Math.floor(camera.x / gridSize) * gridSize;
    const startY = Math.floor(camera.y / gridSize) * gridSize;
    const endX = camera.x + camera.visibleWorldWidth + gridSize;
    const endY = camera.y + camera.visibleWorldHeight + gridSize;
    for (let x = startX; x < endX; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, camera.y);
      ctx.lineTo(x, camera.y + camera.visibleWorldHeight);
      ctx.stroke();
    }
    for (let y = startY; y < endY; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(camera.x, y);
      ctx.lineTo(camera.x + camera.visibleWorldWidth, y);
      ctx.stroke();
    }

    for (const rect of this.obstacles) {
      if (!camera.isRoughlyVisible(rect.x + rect.w / 2, rect.y + rect.h / 2, Math.max(rect.w, rect.h))) continue;
      if (rect.kind === "container") {
        drawContainer(ctx, rect);
      } else {
        ctx.fillStyle = "#5c4a2f";
        ctx.strokeStyle = "#3a2e1c";
        ctx.lineWidth = 2;
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
        ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
      }
    }

    // Bushes render last, on top of terrain/grid, so their leafy silhouette reads clearly.
    for (const bush of this.bushes) {
      if (!camera.isRoughlyVisible(bush.x, bush.y, bush.radius)) continue;
      ctx.fillStyle = "#1f3a16";
      for (const c of bush.clumps) {
        ctx.beginPath();
        ctx.arc(bush.x + c.dx, bush.y + c.dy, c.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "#2f5522";
      for (const c of bush.clumps) {
        ctx.beginPath();
        ctx.arc(bush.x + c.dx * 0.9, bush.y + c.dy * 0.9, c.r * 0.7, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

}

// Standalone (not a GameMap method) so draw() can call it even when invoked via
// `GameMap.prototype.draw.call(plainMapData, ...)` on the guest side, where
// `this` is a plain snapshot object with no other GameMap methods on it.
function drawContainer(ctx, rect) {
  ctx.fillStyle = "#8a4a2a";
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.strokeStyle = "#4a2814";
  ctx.lineWidth = 2;
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);

  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.lineWidth = 1;
  if (rect.w >= rect.h) {
    const stripes = Math.max(2, Math.floor(rect.w / 14));
    for (let s = 1; s < stripes; s++) {
      const sx = rect.x + (rect.w / stripes) * s;
      ctx.beginPath();
      ctx.moveTo(sx, rect.y);
      ctx.lineTo(sx, rect.y + rect.h);
      ctx.stroke();
    }
  } else {
    const stripes = Math.max(2, Math.floor(rect.h / 14));
    for (let s = 1; s < stripes; s++) {
      const sy = rect.y + (rect.h / stripes) * s;
      ctx.beginPath();
      ctx.moveTo(rect.x, sy);
      ctx.lineTo(rect.x + rect.w, sy);
      ctx.stroke();
    }
  }
}
