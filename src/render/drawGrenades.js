import { GRENADE_EXPLOSION_RADIUS } from "../utils/constants.js";

// Renders every still-armed grenade: the red damage zone at its landing spot
// — visible the whole time it's armed, so anyone nearby can see exactly where
// it'll go off and get clear — plus the grenade itself flying to, then
// sitting at, that spot. `grenades` are plain {x, y, targetX, targetY,
// explodeAt} — works for both the host's real Grenade instances and a
// guest's snapshot-derived copies (see GuestView's _hydrateSnapshot).
export function drawGrenades(ctx, grenades, nowMs) {
  for (const g of grenades) {
    if (g.explodeAt - nowMs <= 0) continue;

    const pulse = 0.55 + 0.25 * Math.sin(nowMs / 90);
    ctx.save();
    ctx.fillStyle = "rgba(217, 45, 32, 0.28)";
    ctx.beginPath();
    ctx.arc(g.targetX, g.targetY, GRENADE_EXPLOSION_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = pulse;
    ctx.strokeStyle = "#ff4d3d";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = "#3c4a2b";
    ctx.beginPath();
    ctx.arc(g.x, g.y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#1f2717";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#8a9a5b";
    ctx.beginPath();
    ctx.arc(g.x - 2, g.y - 2, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}
