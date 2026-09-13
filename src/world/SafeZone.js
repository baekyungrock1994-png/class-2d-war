import { WORLD_WIDTH, WORLD_HEIGHT, ZONE_PHASES } from "../utils/constants.js";
import { randRange, dist } from "../utils/math.js";

export class SafeZone {
  constructor() {
    this.centerX = WORLD_WIDTH / 2;
    this.centerY = WORLD_HEIGHT / 2;
    this.maxRadius = Math.min(WORLD_WIDTH, WORLD_HEIGHT) / 2;

    this.phaseIndex = 0;
    this.phaseElapsed = 0;
    this.state = "hold"; // "hold" | "shrink" | "done"

    this.currentRadius = this.maxRadius;
    this.startRadius = this.maxRadius;
    this.targetRadius = this.maxRadius;
    this.startCenter = { x: this.centerX, y: this.centerY };
    this.targetCenter = { x: this.centerX, y: this.centerY };

    this._pickNextTarget();
  }

  _pickNextTarget() {
    const phase = ZONE_PHASES[this.phaseIndex];
    if (!phase) return;
    this.targetRadius = this.maxRadius * phase.radiusRatio;

    const maxOffset = Math.max(0, this.currentRadius - this.targetRadius);
    const angle = randRange(0, Math.PI * 2);
    const offset = randRange(0, maxOffset * 0.6);
    let nx = this.centerX + Math.cos(angle) * offset;
    let ny = this.centerY + Math.sin(angle) * offset;

    nx = Math.max(this.targetRadius, Math.min(WORLD_WIDTH - this.targetRadius, nx));
    ny = Math.max(this.targetRadius, Math.min(WORLD_HEIGHT - this.targetRadius, ny));

    this.startCenter = { x: this.centerX, y: this.centerY };
    this.targetCenter = { x: nx, y: ny };
    this.startRadius = this.currentRadius;
  }

  update(dtMs) {
    const phase = ZONE_PHASES[this.phaseIndex];
    if (!phase) {
      this.state = "done";
      return;
    }

    this.phaseElapsed += dtMs;

    if (this.state === "hold") {
      if (this.phaseElapsed >= phase.holdMs) {
        this.state = "shrink";
        this.phaseElapsed = 0;
      }
      return;
    }

    if (this.state === "shrink") {
      const t = Math.min(1, this.phaseElapsed / phase.shrinkMs);
      this.currentRadius = this.startRadius + (this.targetRadius - this.startRadius) * t;
      this.centerX = this.startCenter.x + (this.targetCenter.x - this.startCenter.x) * t;
      this.centerY = this.startCenter.y + (this.targetCenter.y - this.startCenter.y) * t;

      if (t >= 1) {
        this.phaseIndex++;
        this.phaseElapsed = 0;
        this.state = "hold";
        if (ZONE_PHASES[this.phaseIndex]) this._pickNextTarget();
      }
    }
  }

  timeUntilNextShrinkMs() {
    const phase = ZONE_PHASES[this.phaseIndex];
    if (!phase) return 0;
    if (this.state === "hold") return phase.holdMs - this.phaseElapsed;
    return 0;
  }

  isOutside(x, y) {
    return dist(x, y, this.centerX, this.centerY) > this.currentRadius;
  }

  // Draws directly in world-space; the caller applies the camera's zoom/pan transform.
  draw(ctx, camera) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(camera.x, camera.y, camera.visibleWorldWidth, camera.visibleWorldHeight);
    ctx.arc(this.centerX, this.centerY, this.currentRadius, 0, Math.PI * 2, true);
    ctx.closePath();
    ctx.fillStyle = "rgba(20, 60, 110, 0.45)";
    ctx.fill("evenodd");
    ctx.restore();

    ctx.beginPath();
    ctx.arc(this.centerX, this.centerY, this.currentRadius, 0, Math.PI * 2);
    ctx.strokeStyle = "#7ec8ff";
    ctx.lineWidth = 4;
    ctx.stroke();

    if (this.state === "hold" && ZONE_PHASES[this.phaseIndex + 1]) {
      ctx.beginPath();
      ctx.arc(this.targetCenter.x, this.targetCenter.y, this.targetRadius, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      ctx.setLineDash([8, 6]);
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}
