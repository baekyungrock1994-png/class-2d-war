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

  follow(target) {
    this.x = clamp(target.x - this.visibleWorldWidth / 2, 0, Math.max(0, WORLD_WIDTH - this.visibleWorldWidth));
    this.y = clamp(target.y - this.visibleWorldHeight / 2, 0, Math.max(0, WORLD_HEIGHT - this.visibleWorldHeight));
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
