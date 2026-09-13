import { WORLD_WIDTH, WORLD_HEIGHT } from "../utils/constants.js";

const TERRAIN_COLORS = { sand: "#c2a866", water: "#2a6f8f", darkgrass: "#1c3318" };

// Pre-match screen: shows a top-down preview of the generated map so the player
// can click to choose where their parachute will drop them.
export class DropSelect {
  constructor() {
    this.screen = document.getElementById("drop-screen");
    this.canvas = document.getElementById("drop-canvas");
    this.ctx = this.canvas.getContext("2d");
    this.confirmBtn = document.getElementById("drop-confirm-btn");
    this.selected = null;
    this.map = null;
    this.safeZone = null;

    this.canvas.addEventListener("click", (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const scaleX = WORLD_WIDTH / rect.width;
      const scaleY = WORLD_HEIGHT / rect.height;
      this.selected = { x: px * scaleX, y: py * scaleY };
      this.confirmBtn.disabled = false;
      this._draw();
    });
  }

  open(map, safeZone) {
    this.map = map;
    this.safeZone = safeZone;
    this.selected = null;
    this.confirmBtn.disabled = true;
    this.screen.classList.remove("hidden");
    this._draw();
  }

  close() {
    this.screen.classList.add("hidden");
  }

  onConfirm(callback) {
    this.confirmBtn.onclick = () => {
      if (!this.selected) return;
      callback(this.selected.x, this.selected.y);
    };
  }

  _draw() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const scaleX = w / WORLD_WIDTH;
    const scaleY = h / WORLD_HEIGHT;

    ctx.fillStyle = "#25401f";
    ctx.fillRect(0, 0, w, h);

    for (const patch of this.map.terrainPatches) {
      ctx.fillStyle = TERRAIN_COLORS[patch.kind];
      ctx.beginPath();
      ctx.ellipse(patch.x * scaleX, patch.y * scaleY, patch.r * scaleX, patch.r * scaleY, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const rect of this.map.obstacles) {
      ctx.fillStyle = rect.kind === "container" ? "#8a4a2a" : "#5c4a2f";
      ctx.fillRect(rect.x * scaleX, rect.y * scaleY, Math.max(1, rect.w * scaleX), Math.max(1, rect.h * scaleY));
    }

    if (this.map.bushes) {
      ctx.fillStyle = "#264a1c";
      for (const bush of this.map.bushes) {
        ctx.beginPath();
        ctx.ellipse(bush.x * scaleX, bush.y * scaleY, bush.radius * scaleX, bush.radius * scaleY, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.strokeStyle = "#7ec8ff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(
      this.safeZone.centerX * scaleX,
      this.safeZone.centerY * scaleY,
      this.safeZone.currentRadius * scaleX,
      this.safeZone.currentRadius * scaleY,
      0, 0, Math.PI * 2
    );
    ctx.stroke();

    if (this.selected) {
      const sx = this.selected.x * scaleX;
      const sy = this.selected.y * scaleY;
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx - 10, sy);
      ctx.lineTo(sx + 10, sy);
      ctx.moveTo(sx, sy - 10);
      ctx.lineTo(sx, sy + 10);
      ctx.stroke();

      ctx.fillStyle = "#ff4444";
      ctx.beginPath();
      ctx.arc(sx, sy, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
