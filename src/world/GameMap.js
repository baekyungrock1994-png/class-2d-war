import {
  WORLD_WIDTH,
  WORLD_HEIGHT,
  OBSTACLE_COUNT,
  BUSH_COUNT,
  BUSH_RADIUS_RANGE,
  CONTAINER_YARD_COUNT,
  MILITARY_BASE_COUNT,
  MILITARY_BASE_RADIUS,
  MILITARY_BASE_MIN_SEPARATION,
  MILITARY_BASE_EDGE_MARGIN,
  MILITARY_CONTAINER_COUNT,
  MILITARY_FENCE_POST_GAP,
  SPECIAL_ROOM_SIZE,
  SPECIAL_ROOM_LOCAL_OFFSET_Y,
  SPECIAL_ROOM_WALL_THICKNESS,
  SPECIAL_ROOM_DOOR_GAP,
  SPECIAL_ROOM_MARGIN,
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

// "군사기지" POIs: a circular zone (used by Loot.js to bias what spawns
// inside it) with a container-yard for chase cover plus a scatter of
// standalone camo containers that double as hiding spots (see isHiddenInBushes).
function generateMilitaryBases() {
  const bases = [];
  let attempts = 0;
  while (bases.length < MILITARY_BASE_COUNT && attempts < 300) {
    attempts++;
    const x = randRange(MILITARY_BASE_EDGE_MARGIN, WORLD_WIDTH - MILITARY_BASE_EDGE_MARGIN);
    const y = randRange(MILITARY_BASE_EDGE_MARGIN, WORLD_HEIGHT - MILITARY_BASE_EDGE_MARGIN);
    if (bases.some((b) => dist(x, y, b.x, b.y) < MILITARY_BASE_MIN_SEPARATION)) continue;
    bases.push({ x, y, radius: MILITARY_BASE_RADIUS });
  }
  return bases;
}

function buildMilitaryBaseObstacles(base) {
  const obstacles = [...buildContainerYard(base.x, base.y)];

  const placed = [];
  for (let i = 0; i < MILITARY_CONTAINER_COUNT; i++) {
    let cx, cy;
    let attempts = 0;
    do {
      const angle = randRange(0, Math.PI * 2);
      const r = randRange(base.radius * 0.4, base.radius * 0.88);
      cx = base.x + Math.cos(angle) * r;
      cy = base.y + Math.sin(angle) * r;
      attempts++;
    } while (placed.some((p) => dist(cx, cy, p.x, p.y) < 90) && attempts < 25);
    placed.push({ x: cx, y: cy });

    const w = randRange(50, 72);
    const h = randRange(30, 44);
    obstacles.push({ x: cx - w / 2, y: cy - h / 2, w, h, kind: "milContainer" });
  }
  return obstacles;
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// One door on the surface, clear of the military bases and (as best effort)
// not sitting on top of another obstacle, so it's a normal walkable spot.
function pickSpecialRoomDoor(militaryBases, obstacles) {
  for (let attempts = 0; attempts < 300; attempts++) {
    const x = randRange(250, WORLD_WIDTH - 250);
    const y = randRange(250, WORLD_HEIGHT - 250);
    if (militaryBases.some((b) => dist(x, y, b.x, b.y) < b.radius + 300)) continue;
    const blocked = obstacles.some((rect) => {
      const closestX = Math.max(rect.x, Math.min(x, rect.x + rect.w));
      const closestY = Math.max(rect.y, Math.min(y, rect.y + rect.h));
      return Math.hypot(x - closestX, y - closestY) < 60;
    });
    if (blocked) continue;
    return { x, y };
  }
  return { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 };
}

// A small bonus loot room sitting directly beneath its single surface door —
// see constants.js's SPECIAL_ROOM_* for why this is a small local Y offset
// rather than a disconnected coordinate elsewhere on (or off) the map. Its
// footprint is carved out of every other obstacle placed on the map (see the
// GameMap constructor) so nothing else overlaps it.
function buildSpecialRoom(militaryBases, obstacles) {
  const door = pickSpecialRoomDoor(militaryBases, obstacles);

  const cx = door.x;
  const cy = door.y + SPECIAL_ROOM_LOCAL_OFFSET_Y;
  const half = SPECIAL_ROOM_SIZE / 2;
  const t = SPECIAL_ROOM_WALL_THICKNESS;
  const sideLen = (SPECIAL_ROOM_SIZE - SPECIAL_ROOM_DOOR_GAP) / 2;

  const walls = [
    // ceiling, door gap in the middle (this is what the surface door opens into)
    { x: cx - half, y: cy - half, w: sideLen, h: t, kind: "bunkerWall" },
    { x: cx + SPECIAL_ROOM_DOOR_GAP / 2, y: cy - half, w: sideLen, h: t, kind: "bunkerWall" },
    // floor, left, right (solid)
    { x: cx - half, y: cy + half - t, w: SPECIAL_ROOM_SIZE, h: t, kind: "bunkerWall" },
    { x: cx - half, y: cy - half, w: t, h: SPECIAL_ROOM_SIZE, kind: "bunkerWall" },
    { x: cx + half - t, y: cy - half, w: t, h: SPECIAL_ROOM_SIZE, kind: "bunkerWall" },
  ];

  const margin = SPECIAL_ROOM_MARGIN;
  return {
    door, // on the surface — walk onto this to go down
    interior: { x: cx, y: cy },
    exit: { x: cx, y: cy - half + t / 2 }, // the gap in the ceiling — walk onto this to come back up
    spawn: { x: cx, y: cy - half + 60 }, // just inside, below the ceiling gap
    footprint: { x: cx - half - margin, y: cy - half - margin, w: SPECIAL_ROOM_SIZE + margin * 2, h: SPECIAL_ROOM_SIZE + margin * 2 },
    cameraBounds: {
      x: cx - half - margin,
      y: cy - half - margin,
      width: SPECIAL_ROOM_SIZE + margin * 2,
      height: SPECIAL_ROOM_SIZE + margin * 2,
    },
    walls,
  };
}

// True if (x, y) falls inside any bush, or *inside* a hide-capable
// "milContainer" (the camo containers inside a military base — see
// buildMilitaryBaseObstacles below) — used to hide a unit's sprite/name from
// other viewers (see Game.js) and to keep bots from spotting it from afar.
// Unlike bushes (a circle), a milContainer only hides you once you've
// actually stepped inside its own footprint — standing next to it doesn't
// count — so this is a plain point-in-rect test, not a distance check.
// hideContainers is a list of plain {x, y, w, h} rects, not derived circles.
export function isHiddenInBushes(x, y, bushes, hideContainers = []) {
  for (const bush of bushes) {
    if (dist(x, y, bush.x, bush.y) <= bush.radius) return true;
  }
  for (const c of hideContainers) {
    if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) return true;
  }
  return false;
}

// Picks out the milContainer rects from the full obstacle list — shared by
// the host (from real obstacles) and the guest (from the broadcast map's
// obstacles) so both compute hiding the same way.
export function deriveHideContainers(obstacles) {
  return obstacles.filter((o) => o.kind === "milContainer");
}

// Which obstacle list applies to a given unit's movement/collision, based on
// which side of the special room's door it's currently on. Shared by the
// host (real GameMap instance) and the guest (plain snapshot object, once
// GuestView.setMap has derived surfaceObstacles/bunkerObstacles onto it the
// same way the GameMap constructor does).
export function obstaclesForUnit(map, unit) {
  return unit.inSpecialRoom ? map.bunkerObstacles : map.surfaceObstacles;
}

export class GameMap {
  constructor() {
    this.width = WORLD_WIDTH;
    this.height = WORLD_HEIGHT;
    this.terrainPatches = generateTerrainPatches();
    this.bushes = generateBushes();

    this.militaryBases = generateMilitaryBases();
    const surfaceObstacles = [
      ...generateObstacles(),
      ...generateContainerYards(CONTAINER_YARD_COUNT),
      ...this.militaryBases.flatMap((base) => buildMilitaryBaseObstacles(base)),
    ];

    // Picked after the rest of the surface so its door lands somewhere
    // walkable, then its own footprint is carved out of everything else so
    // the room below it never overlaps another obstacle — see buildSpecialRoom.
    this.specialRoom = buildSpecialRoom(this.militaryBases, surfaceObstacles);
    const clearedSurfaceObstacles = surfaceObstacles.filter((o) => !rectsOverlap(o, this.specialRoom.footprint));

    this.obstacles = [...clearedSurfaceObstacles, ...this.specialRoom.walls];
    this.hideContainers = deriveHideContainers(this.obstacles);

    // Two different unit populations need two different collision lists:
    // milContainers are walk-through everywhere (like bushes — see
    // isHiddenInBushes), and bunkerWalls (the special room) only exist for
    // whoever's actually down there — see Game.js's per-unit obstaclesFor().
    this.surfaceObstacles = this.obstacles.filter((o) => o.kind !== "milContainer" && o.kind !== "bunkerWall");
    this.bunkerObstacles = this.obstacles.filter((o) => o.kind === "bunkerWall");
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
  // inSpecialRoom picks which of the two "layers" sharing this map's
  // coordinate space to draw — the special room's small footprint is carved
  // out of the surface (see the constructor), so nothing here ever overlaps;
  // this just decides which side gets rendered for a given viewer.
  draw(ctx, camera, inSpecialRoom = false) {
    if (inSpecialRoom) {
      this._drawBunker(ctx, camera);
      return;
    }

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
      if (rect.kind === "bunkerWall") continue; // only relevant to whoever's down in the special room
      if (!camera.isRoughlyVisible(rect.x + rect.w / 2, rect.y + rect.h / 2, Math.max(rect.w, rect.h))) continue;
      if (rect.kind === "container") {
        drawContainer(ctx, rect, "#8a4a2a", "#4a2814");
      } else if (rect.kind === "milContainer") {
        drawContainer(ctx, rect, "#5c6b3a", "#33401f"); // olive-drab camo crate, distinct from field containers
      } else {
        ctx.fillStyle = "#5c4a2f";
        ctx.strokeStyle = "#3a2e1c";
        ctx.lineWidth = 2;
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
        ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
      }
    }

    // Barbed-wire perimeter around each military base — purely visual (units
    // walk through it freely), just there so the POI reads as a distinct zone
    // from open field at a glance.
    for (const base of this.militaryBases || []) {
      if (!camera.isRoughlyVisible(base.x, base.y, base.radius)) continue;
      drawFence(ctx, base.x, base.y, base.radius);
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

    if (this.specialRoom && camera.isRoughlyVisible(this.specialRoom.door.x, this.specialRoom.door.y, 40)) {
      drawHatch(ctx, this.specialRoom.door.x, this.specialRoom.door.y);
    }
  }

  // The special room's own "layer" — a plain floor fill plus just its own
  // walls and exit hatch. Nothing from the surface (terrain, bushes, other
  // obstacles) is drawn here, same way nothing from this room is drawn on
  // the surface — see draw() above.
  _drawBunker(ctx, camera) {
    ctx.fillStyle = "#171b21";
    ctx.fillRect(camera.x, camera.y, camera.visibleWorldWidth, camera.visibleWorldHeight);

    for (const rect of this.obstacles) {
      if (rect.kind !== "bunkerWall") continue;
      if (!camera.isRoughlyVisible(rect.x + rect.w / 2, rect.y + rect.h / 2, Math.max(rect.w, rect.h))) continue;
      ctx.fillStyle = "#2c3038";
      ctx.strokeStyle = "#14161b";
      ctx.lineWidth = 2;
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    }

    if (this.specialRoom && camera.isRoughlyVisible(this.specialRoom.exit.x, this.specialRoom.exit.y, 40)) {
      drawHatch(ctx, this.specialRoom.exit.x, this.specialRoom.exit.y);
    }
  }

}

// Standalone (not a GameMap method) so draw() can call it even when invoked via
// `GameMap.prototype.draw.call(plainMapData, ...)` on the guest side, where
// `this` is a plain snapshot object with no other GameMap methods on it.
function drawContainer(ctx, rect, fill = "#8a4a2a", stroke = "#4a2814") {
  ctx.fillStyle = fill;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.strokeStyle = stroke;
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

// A ring of posts + a taut wire between them, with a couple of barb ticks per
// span — reads as "barbed-wire fence" at a glance without needing a sprite.
// Purely decorative: nothing here blocks movement.
function drawFence(ctx, cx, cy, radius) {
  const postCount = Math.max(12, Math.round((2 * Math.PI * radius) / MILITARY_FENCE_POST_GAP));

  ctx.strokeStyle = "#9a8a6a";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();

  for (let i = 0; i < postCount; i++) {
    const angle = (i / postCount) * Math.PI * 2;
    const px = cx + Math.cos(angle) * radius;
    const py = cy + Math.sin(angle) * radius;

    ctx.strokeStyle = "#6b5d43";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(px - Math.cos(angle) * 6, py - Math.sin(angle) * 6);
    ctx.lineTo(px + Math.cos(angle) * 6, py + Math.sin(angle) * 6);
    ctx.stroke();

    // A couple of small barb ticks jutting off the wire, perpendicular to it.
    const perpX = -Math.sin(angle) * 5;
    const perpY = Math.cos(angle) * 5;
    ctx.strokeStyle = "#c9c2a8";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px - perpX, py - perpY);
    ctx.lineTo(px + perpX, py + perpY);
    ctx.stroke();
  }
}

// The circular hatch marking the special room's entrance (on the surface)
// and exit (inside the room) — same look for both since it's the same
// interaction either way: walk onto it to teleport.
function drawHatch(ctx, x, y) {
  ctx.save();
  ctx.translate(x, y);

  ctx.fillStyle = "#3a3f33";
  ctx.beginPath();
  ctx.arc(0, 0, 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#f5c518";
  ctx.lineWidth = 3;
  ctx.setLineDash([6, 5]);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = "#f5c518";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, 14, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
}
