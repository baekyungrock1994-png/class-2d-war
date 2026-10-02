import { WORLD_WIDTH, WORLD_HEIGHT, CAMERA_ZOOM } from "../utils/constants.js";
import { clamp } from "../utils/math.js";

export class Camera {
  constructor(viewWidth, viewHeight) {
    this.x = 0;
    this.y = 0;
    this.viewWidth = viewWidth;
    this.viewHeight = viewHeight;
    this.zoom = CAMERA_ZOOM;
  }

  resize(viewWidth, viewHeight) {
    this.viewWidth = viewWidth;
    this.viewHeight = viewHeight;
  }

  get visibleWorldWidth() {
    return this.viewWidth / this.zoom;
  }

  get visibleWorldHeight() {
    return this.viewHeight / this.zoom;
  }

  // bounds lets the camera stay clamped to a *different* world-space rect than
  // the normal map — used for the special room, which lives at a fixed offset
  // far outside 0..WORLD_WIDTH/HEIGHT (see constants.js's SPECIAL_ROOM_*) so it
  // never overlaps the main map; without an override here the normal clamp
  // would push the camera back toward the main map and never actually frame it.
  follow(target, bounds = { x: 0, y: 0, width: WORLD_WIDTH, height: WORLD_HEIGHT }) {
    this.x = clamp(target.x - this.visibleWorldWidth / 2, bounds.x, Math.max(bounds.x, bounds.x + bounds.width - this.visibleWorldWidth));
    this.y = clamp(target.y - this.visibleWorldHeight / 2, bounds.y, Math.max(bounds.y, bounds.y + bounds.height - this.visibleWorldHeight));
  }

  worldToScreen(x, y) {
    return { x: (x - this.x) * this.zoom, y: (y - this.y) * this.zoom };
  }

  screenToWorld(x, y) {
    return { x: x / this.zoom + this.x, y: y / this.zoom + this.y };
  }

  isRoughlyVisible(worldX, worldY, margin = 0) {
    return (
      worldX + margin >= this.x &&
      worldX - margin <= this.x + this.visibleWorldWidth &&
      worldY + margin >= this.y &&
      worldY - margin <= this.y + this.visibleWorldHeight
    );
  }
}
