import { WORLD_WIDTH, WORLD_HEIGHT, OBSTACLE_COUNT } from "../utils/constants.js";
import { randRange, randInt } from "../utils/math.js";

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

export class GameMap {
  constructor() {
    this.width = WORLD_WIDTH;
    this.height = WORLD_HEIGHT;
    this.terrainPatches = generateTerrainPatches();
    this.obstacles = generateObstacles();
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

    ctx.fillStyle = "#5c4a2f";
    ctx.strokeStyle = "#3a2e1c";
    ctx.lineWidth = 2;
    for (const rect of this.obstacles) {
      if (!camera.isRoughlyVisible(rect.x + rect.w / 2, rect.y + rect.h / 2, Math.max(rect.w, rect.h))) continue;
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    }
  }
}
