import { clamp } from "../utils/math.js";

// Draws every still-active burst in `effects` — each is
// {x, y, expiresAt, durationMs, maxRadius, debrisCount}, where expiresAt is a
// local performance.now()-timeline value (see Game.js for how it's created,
// and GuestView's _hydrateSnapshot for how a guest re-anchors the host's
// remaining-time value to its own clock). Every field is always present
// (never optional) so a snapshot round-trip never has to smuggle `undefined`
// through Firebase, which rejects it outright.
//
// The same shape covers both a small character-death burst and a much bigger
// grenade explosion — only the numbers differ (see Game.js's _onUnitDeath vs
// _explodeGrenade), so this one renderer scales to either.
export function drawDeathEffects(ctx, effects, nowMs) {
  for (const effect of effects) {
    const remaining = effect.expiresAt - nowMs;
    if (remaining <= 0) continue;
    const progress = 1 - clamp(remaining / effect.durationMs, 0, 1);
    drawBurst(ctx, effect.x, effect.y, progress, effect.maxRadius, effect.debrisCount);
  }
}

function drawBurst(ctx, x, y, progress, maxRadius, debrisCount) {
  ctx.save();

  // Expanding shockwave ring.
  ctx.globalAlpha = Math.max(0, 0.8 * (1 - progress));
  ctx.strokeStyle = "#ffb347";
  ctx.lineWidth = Math.max(2, maxRadius * 0.06);
  ctx.beginPath();
  ctx.arc(x, y, maxRadius * 0.22 + progress * maxRadius * 0.78, 0, Math.PI * 2);
  ctx.stroke();

  // Debris flying outward in fixed directions (deterministic, so host and
  // guest render an identical burst without needing to sync random state).
  const debrisDist = progress * maxRadius * 0.85;
  const debrisRadius = maxRadius * 0.06;
  ctx.globalAlpha = Math.max(0, 1 - progress * 1.2);
  ctx.fillStyle = "#ff5b3d";
  for (let i = 0; i < debrisCount; i++) {
    const angle = (i / debrisCount) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(x + Math.cos(angle) * debrisDist, y + Math.sin(angle) * debrisDist, debrisRadius * (1 - progress * 0.5), 0, Math.PI * 2);
    ctx.fill();
  }

  // Bright core flash that fades fastest.
  const flashAlpha = Math.max(0, 1 - progress * 3);
  if (flashAlpha > 0) {
    ctx.globalAlpha = flashAlpha;
    ctx.fillStyle = "#fff5c2";
    ctx.beginPath();
    ctx.arc(x, y, maxRadius * 0.25, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}
