import { WEAPONS, MELEE_SWING_MS } from "../utils/constants.js";
import { clamp } from "../utils/math.js";

// Renders any "unit-like" object — a real Player/Bot instance, or a plain
// snapshot-derived object with the same fields — so the host's live simulation
// and a guest's network-driven view can share identical visuals. Draws directly
// in world-space; the caller has already applied the camera's zoom/pan transform.
export function drawUnit(ctx, unit, colorAlive, colorDead) {
  if (unit.falling) {
    drawFalling(ctx, unit, colorAlive);
    return;
  }

  const weapon = WEAPONS[unit.weaponKey] ?? WEAPONS.fist;

  // A hidden unit (standing in a bush) still renders for its own viewer — that's
  // how a human notices they're tucked into cover — just faded, unlike other
  // viewers who don't get drawn at all unless they're close enough to spot it.
  const prevAlpha = ctx.globalAlpha;
  if (unit.hidden) ctx.globalAlpha = prevAlpha * 0.45;

  ctx.save();
  ctx.translate(unit.x, unit.y);
  ctx.rotate(unit.facing);

  ctx.fillStyle = unit.alive ? colorAlive : colorDead;
  ctx.beginPath();
  ctx.arc(0, 0, unit.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#111";
  ctx.lineWidth = 2;
  ctx.stroke();

  if (weapon.melee) {
    drawFists(ctx, unit);
  } else {
    const reach = unit.radius + 14;
    ctx.strokeStyle = "#222";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(reach, 0);
    ctx.stroke();
  }

  ctx.restore();

  if (unit.alive) {
    ctx.fillStyle = "#000a";
    ctx.fillRect(unit.x - 18, unit.y - unit.radius - 14, 36, 5);
    ctx.fillStyle = "#4caf50";
    ctx.fillRect(unit.x - 18, unit.y - unit.radius - 14, 36 * (unit.health / unit.maxHealth), 5);

    ctx.fillStyle = "#fff";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(unit.name, unit.x, unit.y - unit.radius - 18);
  }

  ctx.globalAlpha = prevAlpha;
}

// Two small fists in front of the body, standing in for the "no weapon" look.
// They rest near the chest and punch forward when a melee swing is active.
function drawFists(ctx, unit) {
  const now = performance.now();
  let swingT = 0;
  if (unit.meleeSwingUntil > now) {
    const remain = unit.meleeSwingUntil - now;
    swingT = 1 - clamp(remain / MELEE_SWING_MS, 0, 1);
  }
  const punch = Math.sin(swingT * Math.PI); // 0 -> 1 -> 0 across the swing

  const restX = unit.radius * 0.55;
  const sideY = unit.radius * 0.55;
  const fistRadius = unit.radius * 0.42;
  const reachDistance = unit.radius * 0.9;

  const leadOffset = punch * reachDistance;
  const followOffset = punch * reachDistance * 0.3;
  const fistA = unit.punchHand === 0 ? leadOffset : followOffset;
  const fistB = unit.punchHand === 1 ? leadOffset : followOffset;

  ctx.fillStyle = "#f2b48c";
  ctx.strokeStyle = "#a5673f";
  ctx.lineWidth = 1.5;

  ctx.beginPath();
  ctx.arc(restX + fistA, -sideY, fistRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(restX + fistB, sideY, fistRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

// Simple top-down parachute illusion: a fixed ground shadow plus a body that
// starts small/high and grows as it drops, with a canopy shown above it.
function drawFalling(ctx, unit, colorAlive) {
  const t = clamp(unit.fallElapsed / unit.fallDurationMs, 0, 1);
  const heightOffset = (1 - t) * 90;
  const scale = 0.55 + 0.45 * t;

  ctx.save();
  ctx.globalAlpha = 0.35 + 0.25 * t;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.ellipse(unit.x, unit.y, unit.radius * 0.9 * t + 4, unit.radius * 0.5 * t + 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const drawY = unit.y - heightOffset;

  if (t < 0.92) {
    ctx.save();
    ctx.translate(unit.x, drawY - unit.radius * 2.2 * scale);
    ctx.fillStyle = "#e0a800";
    ctx.beginPath();
    ctx.ellipse(0, 0, unit.radius * 1.6 * scale, unit.radius * 0.9 * scale, 0, Math.PI, 0);
    ctx.fill();
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-unit.radius * 1.6 * scale, 0);
    ctx.lineTo(0, unit.radius * 1.8 * scale);
    ctx.moveTo(unit.radius * 1.6 * scale, 0);
    ctx.lineTo(0, unit.radius * 1.8 * scale);
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  ctx.translate(unit.x, drawY);
  ctx.scale(scale, scale);
  ctx.rotate(unit.facing);
  ctx.fillStyle = colorAlive;
  ctx.beginPath();
  ctx.arc(0, 0, unit.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#111";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}
