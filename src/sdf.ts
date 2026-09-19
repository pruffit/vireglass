// The single description of VireGlass geometry. Both shaders draw it from here: the SKSL surface
// (`surface-shader.ts`) and the AGSL lens (`lens-shader.ts`, shipped as a string into the native
// view). AGSL and SKSL are the same language, so the SDF no longer needs duplicating in Kotlin:
// before, the surface's circle and the lens's rounded rectangle described different pieces of
// glass, and the bevel constant had to be kept in sync by hand (docs/adr-001-rendering.md §3).
import { BEVEL, EPSILON, TOUCH } from './law';

/** 2π. Structural, not a law — but the shader has no built-in for it. */
const VG_TAU = 6.28318530718;

export const VG_SDF = `
float vgRoundRect(float2 p, float2 halfSize, float corner) {
  float2 q = abs(p) - halfSize + corner;
  return min(max(q.x, q.y), 0.0) + length(max(q, float2(0.0))) - corner;
}

float vgSmin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// A scene is a single shape, and when k > 0 a smooth union with one or two neighbors. A third
// shape exists to break the control into pieces (docs/reference.md §5): there are two bridges
// there. It's turned off with a zero size, not its own k: the fused body shares one bridge.
float vgScene(float2 p, float2 halfSize, float corner,
              float2 offsetB, float2 halfB, float cornerB, float k,
              float2 offsetC, float2 halfC, float cornerC) {
  float a = vgRoundRect(p, halfSize, corner);
  if (k <= 0.0) { return a; }
  float ab = vgSmin(a, vgRoundRect(p - offsetB, halfB, cornerB), k);
  if (halfC.x <= 0.0) { return ab; }
  return vgSmin(ab, vgRoundRect(p - offsetC, halfC, cornerC), k);
}

// Response to a finger. It's the FIELD around the touch point that deforms, not the shape's
// bounding box: scaling width to pull the right edge would also pull the left one — liquid
// doesn't behave that way. Here the displacement falls off with distance from the finger, so the
// far edge stays put.
//
// The order of the terms matters: drag shifts the field, press pulls it toward the finger, the
// wave rides on top of the already-shifted field — otherwise the ripple decouples from the
// deformation and lives a life of its own.
float2 vgTouchWarp(float2 p, float2 touch, float2 pull, float press, float radius,
                   float waveAmp, float wavePhase) {
  if (radius <= 0.0) { return p; }
  // Under the finger the whole element grows (M 3:51; HIG: interactive "expands").
  p /= 1.0 + ${TOUCH.pressGrow} * press;
  float2 d = p - touch;
  float r = length(d);

  // The finger is a BLOB, not a point, but not a hard stamp either: a wide peak, soft edges. A
  // flat plateau with a sharp cutoff at the edge shifts the region as a block, and a straight
  // line under the glass breaks into a step — the deformation reads as rectangular even though
  // the finger is round. A double smoothstep gives the same contact width without that step.
  //
  // The influence cuts off at the radius rather than fading into an infinite tail like a
  // Gaussian: with a tail the deformation spreads into a "rubber mattress" bulge.
  float k = clamp((radius - r) / radius, 0.0, 1.0);
  float s = k * k * (3.0 - 2.0 * k);
  float core = s * s * (3.0 - 2.0 * s);
  // A ring around the blob: material displaced from under the finger has to end up somewhere.
  // Without this ridge the shape just balloons, and a dense medium doesn't behave that way.
  float rim = k * k * (1.0 - k) * 4.0;

  float2 q = p - pull * (core - ${TOUCH.ridge} * rim);
  q -= d * (press * ${TOUCH.pressPull} * core);

  // The wave has its own scale, twice the drag radius: the ripple has to reach the far edge,
  // otherwise it reads as jitter under the finger rather than a wave across the surface. The
  // wavelength is short: in a dense medium ripples are frequent and small, long shallow swells
  // are water.
  if (waveAmp > 0.0 && r > 0.0001) {
    float span = radius * ${TOUCH.waveSpan}.0;
    float ring = sin(r / (span * ${TOUCH.waveLength}) - wavePhase * ${VG_TAU}) * exp(-r / (span * ${TOUCH.waveDecay}));
    q -= (d / r) * ring * waveAmp;
  }
  return q;
}

// Analytical normal of a single shape: radial on the rounded part, axis-aligned on the straight
// segments.
float2 vgRoundRectNormal(float2 p, float2 halfSize, float corner) {
  float2 q = abs(p) - halfSize + corner;
  float2 g = (q.x > 0.0 && q.y > 0.0)
    ? normalize(max(q, float2(0.0001)))
    : (q.x > q.y ? float2(1.0, 0.0) : float2(0.0, 1.0));
  return g * sign(p);
}

// Normal of the union — ANALYTICAL, no more finite differences here.
//
// Derivation: smin has two terms, mix(b,a,h) and −k·h·(1−h). Their derivatives with respect to h
// contain a factor of (1−2h) with opposite signs and cancel exactly, because h is linear in
// (b−a)/k. What's left is mix(∇b, ∇a, h) — that is, the two shapes' normals, blended with the
// same weight that blends the distances themselves.
//
// The previous version took four ADDITIONAL scene evaluations per pixel (each one — two shapes
// plus smin) and was still an approximation. Here there are two shapes, exactly.
float2 vgSceneNormal(float2 p, float2 halfSize, float corner,
                     float2 offsetB, float2 halfB, float cornerB, float k,
                     float2 offsetC, float2 halfC, float cornerC) {
  float2 na = vgRoundRectNormal(p, halfSize, corner);
  if (k <= 0.0) { return na; }
  float2 q = p - offsetB;
  float a = vgRoundRect(p, halfSize, corner);
  float b = vgRoundRect(q, halfB, cornerB);
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  float2 nab = normalize(mix(vgRoundRectNormal(q, halfB, cornerB), na, h) + float2(${EPSILON}, ${EPSILON}));
  if (halfC.x <= 0.0) { return nab; }
  // Same derivation as for the pair: normals blend with the same weight as the distances.
  float2 qc = p - offsetC;
  float ab = vgSmin(a, b, k);
  float c = vgRoundRect(qc, halfC, cornerC);
  float hc = clamp(0.5 + 0.5 * (c - ab) / k, 0.0, 1.0);
  return normalize(mix(vgRoundRectNormal(qc, halfC, cornerC), nab, hc) + float2(${EPSILON}, ${EPSILON}));
}

// Position within the bevel: 0 is the flat middle, 1 is the very edge. This one value feeds the
// mask, thickness, refraction, aberrations and the width of the light rim.
float vgBevelT(float sd, float bevel) {
  return clamp((sd + bevel) / bevel, 0.0, 1.0);
}

// Slope of the bevel profile — spherical: t / sqrt(1 - t²), like a spherical cap. The previous t²
// kept the slope near zero through almost the whole bevel and then shot up right at the edge, so
// all the optics bunched into a narrow ring and the element read as a PUCK — a flat top and a
// wall around the rim. Here curvature is spread across the bevel, and the rim stops being a line.
//
// This still doesn't control the field of view: only the bevel bends, the middle stays flat,
// otherwise the surface reads as a soap bubble.
float vgBevelSlope(float t) {
  return min(t * inversesqrt(max(1.0 - t * t * ${BEVEL.sphere}, ${BEVEL.floor})), ${BEVEL.slopeMax});
}

// PROGRESS FRACTION. Progress is an active state turned into a FIELD: to the left of the boundary
// the element is active, to the right it stays regular glass, and the boundary moves. A negative
// value turns the field off entirely — zero is taken by the start of the track and can't also
// mean off.
//
// The boundary is SOFT. A hard seam reads as two different materials glued together rather than
// two states of one; the transition width is a fraction of the half-width, so it doesn't read as
// a thread on a large element and doesn't swallow a small one whole.
float vgProgress(float2 p, float2 halfSize, float progress) {
  if (progress < 0.0) { return 0.0; }
  float edge = mix(-halfSize.x, halfSize.x, clamp(progress, 0.0, 1.0));
  float soft = max(halfSize.x * 0.05, 1.0);
  return 1.0 - smoothstep(edge - soft, edge + soft, p.x);
}
`;

/** Rate at which the offset builds toward the rim. Shared between the lens (actual sampling
 *  offset) and the surface (visualizing the displacement field in debug mode) — otherwise they'd
 *  drift apart. */
export const VG_FALLOFF = 2.6;

// JS twin of `vgRoundRect`/`vgRoundRectNormal` above, for targets with no GPU to run the shader on
// (the DOM displacement map). Term-for-term against the GLSL text: a second geometry that behaves
// differently is exactly the class of bug `check:optics` exists to catch on the shader side, and
// there is no such gate for this one.

/** Signed distance from `(x, y)` to a rounded rect of size `w`×`h` centered on the origin. */
export function sdfRoundedRect(x: number, y: number, w: number, h: number, r: number): number {
  const qx = Math.abs(x) - w / 2 + r;
  const qy = Math.abs(y) - h / 2 + r;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
}

/**
 * Closed-form gradient of `sdfRoundedRect`, unit length everywhere except the exact center (where
 * it's genuinely undefined — the medial axis of the shape). NOT finite differences: differencing
 * quantizes the gradient to the sampling step, and the displacement map needs sub-pixel accuracy
 * right at the rim.
 */
export function sdfRoundedRectGradient(x: number, y: number, w: number, h: number, r: number): [number, number] {
  const qx = Math.abs(x) - w / 2 + r;
  const qy = Math.abs(y) - h / 2 + r;
  let gx: number;
  let gy: number;
  if (qx > 0 && qy > 0) {
    const cx = Math.max(qx, 0.0001);
    const cy = Math.max(qy, 0.0001);
    const len = Math.hypot(cx, cy);
    gx = cx / len;
    gy = cy / len;
  } else if (qx > qy) {
    gx = 1;
    gy = 0;
  } else {
    gx = 0;
    gy = 1;
  }
  return [gx * Math.sign(x), gy * Math.sign(y)];
}

// ---------------------------------------------------------------------------
// JS twins of the shader functions above. The DOM renderer needs this geometry
// as numbers, not as a string it hands to a compiler. Each mirrors its `vg*`
// counterpart term for term — a second geometry that drifts is the failure the
// platform-parity gate exists to catch.
// ---------------------------------------------------------------------------

/** Mirrors `vgSmin`. */
export function smin(a: number, b: number, k: number): number {
  const h = Math.min(Math.max(0.5 + (0.5 * (b - a)) / k, 0), 1);
  return b + (a - b) * h - k * h * (1 - h);
}

export type MorphShape = {
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  cornerRadius: number;
};

/** Mirrors the scene distance: one shape, smoothly unioned with up to two neighbours when
 *  `smoothing` is positive. §5's merging and splitting are this union opening and closing. */
export function sceneDistance(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  smoothing = 0,
  b?: MorphShape,
  c?: MorphShape,
): number {
  const a = sdfRoundedRect(x, y, w, h, r);
  if (smoothing <= 0 || !b || b.width <= 0) return a;
  const db = sdfRoundedRect(x - b.offsetX, y - b.offsetY, b.width, b.height, b.cornerRadius);
  const ab = smin(a, db, smoothing);
  if (!c || c.width <= 0) return ab;
  const dc = sdfRoundedRect(x - c.offsetX, y - c.offsetY, c.width, c.height, c.cornerRadius);
  return smin(ab, dc, smoothing);
}

/** Mirrors `vgSceneNormal`: normals blend with the same weight that blends the distances, which
 *  the shader derives rather than approximates. */
export function sceneGradient(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  smoothing = 0,
  b?: MorphShape,
  c?: MorphShape,
): [number, number] {
  const na = sdfRoundedRectGradient(x, y, w, h, r);
  if (smoothing <= 0 || !b || b.width <= 0) return na;
  const bx = x - b.offsetX;
  const by = y - b.offsetY;
  const da = sdfRoundedRect(x, y, w, h, r);
  const db = sdfRoundedRect(bx, by, b.width, b.height, b.cornerRadius);
  const hb = Math.min(Math.max(0.5 + (0.5 * (db - da)) / smoothing, 0), 1);
  const nb = sdfRoundedRectGradient(bx, by, b.width, b.height, b.cornerRadius);
  let gx = nb[0] + (na[0] - nb[0]) * hb;
  let gy = nb[1] + (na[1] - nb[1]) * hb;
  if (c && c.width > 0) {
    const cx = x - c.offsetX;
    const cy = y - c.offsetY;
    const dab = smin(da, db, smoothing);
    const dc = sdfRoundedRect(cx, cy, c.width, c.height, c.cornerRadius);
    const hc = Math.min(Math.max(0.5 + (0.5 * (dc - dab)) / smoothing, 0), 1);
    const nc = sdfRoundedRectGradient(cx, cy, c.width, c.height, c.cornerRadius);
    gx = nc[0] + (gx - nc[0]) * hc;
    gy = nc[1] + (gy - nc[1]) * hc;
  }
  // The shader's `+ float2(${EPSILON}, ${EPSILON})` before normalising, and it is not decoration: where two
  // shapes meet head-on their normals cancel exactly and the blend lands on zero.
  gx += EPSILON;
  gy += EPSILON;
  const len = Math.hypot(gx, gy) || 1;
  return [gx / len, gy / len];
}

export type TouchWarp = {
  x: number;
  y: number;
  pullX: number;
  pullY: number;
  press: number;
  radius: number;
  waveAmp: number;
  wavePhase: number;
};

/**
 * Mirrors `vgTouchWarp`. The FIELD around the finger deforms, not the bounding box: scaling the
 * width to pull the right edge would pull the left one too, and liquid does not do that.
 *
 * Term order is load-bearing — drag shifts the field, press pulls it toward the finger, the wave
 * rides on the already-shifted field. Reordered, the ripple decouples and lives its own life.
 */
export function touchWarp(x: number, y: number, t: TouchWarp): [number, number] {
  if (t.radius <= 0) return [x, y];
  const grow = 1 + TOUCH.pressGrow * t.press;
  let px = x / grow;
  let py = y / grow;
  const dx = px - t.x;
  const dy = py - t.y;
  const r = Math.hypot(dx, dy);

  const k = Math.min(Math.max((t.radius - r) / t.radius, 0), 1);
  const s = k * k * (3 - 2 * k);
  const core = s * s * (3 - 2 * s);
  // The ridge around the blob: material pushed out from under the finger has to go somewhere.
  const rim = k * k * (1 - k) * 4;

  px -= t.pullX * (core - TOUCH.ridge * rim);
  py -= t.pullY * (core - TOUCH.ridge * rim);
  px -= dx * (t.press * TOUCH.pressPull * core);
  py -= dy * (t.press * TOUCH.pressPull * core);

  if (t.waveAmp > 0 && r > 0.0001) {
    const span = t.radius * TOUCH.waveSpan;
    const ring = Math.sin(r / (span * TOUCH.waveLength) - t.wavePhase * VG_TAU) * Math.exp(-r / (span * TOUCH.waveDecay));
    px -= (dx / r) * ring * t.waveAmp;
    py -= (dy / r) * ring * t.waveAmp;
  }
  return [px, py];
}
