export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

export function randRange(min, max) {
  return min + Math.random() * (max - min);
}

export function randInt(min, max) {
  return Math.floor(randRange(min, max + 1));
}

export function angleTo(fromX, fromY, toX, toY) {
  return Math.atan2(toY - fromY, toX - fromX);
}

// Circle vs axis-aligned rect collision: returns push vector to resolve overlap, or null.
export function circleRectPush(cx, cy, radius, rect) {
  const closestX = clamp(cx, rect.x, rect.x + rect.w);
  const closestY = clamp(cy, rect.y, rect.y + rect.h);
  const dx = cx - closestX;
  const dy = cy - closestY;
  const distSq = dx * dx + dy * dy;
  if (distSq >= radius * radius) return null;

  const d = Math.sqrt(distSq) || 0.0001;
  const overlap = radius - d;
  return { x: (dx / d) * overlap, y: (dy / d) * overlap };
}

// Liang-Barsky style segment vs rect intersection test (for bullet-obstacle hits).
export function segmentIntersectsRect(x1, y1, x2, y2, rect) {
  const { x, y, w, h } = rect;
  const minX = x, maxX = x + w;
  const minY = y, maxY = y + h;

  let t0 = 0, t1 = 1;
  const dx = x2 - x1, dy = y2 - y1;
  const p = [-dx, dx, -dy, dy];
  const q = [x1 - minX, maxX - x1, y1 - minY, maxY - y1];

  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
    }
  }
  return true;
}
