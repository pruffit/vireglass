import type { VireGlassOptics } from './material';

/** Glass shape in dp. Circle and capsule are special cases of a rounded rectangle. */
export type VireGlassGeometry = {
  width: number;
  height: number;
  cornerRadius: number;
};

export const circleGeometry = (size: number): VireGlassGeometry => ({
  width: size,
  height: size,
  cornerRadius: size / 2,
});

export const capsuleGeometry = (width: number, height: number): VireGlassGeometry => ({
  width,
  height,
  cornerRadius: Math.min(width, height) / 2,
});

export const roundedRectGeometry = (
  width: number,
  height: number,
  cornerRadius: number,
): VireGlassGeometry => ({ width, height, cornerRadius });

export const halfMinDp = (g: VireGlassGeometry) => Math.max(Math.min(g.width, g.height) / 2, 1);

/** Viewport margin for a drop that overshoots past the finger: a fraction of the element's half
 *  size beyond the drag travel itself. The drop overshoots the body by no more than `dragLimit`,
 *  and stitching adds smoothing on top of that — this term covers it too. */
export const MAX_STRETCH = 0.34;

/**
 * Bigger element, thicker glass: a stronger lens, a deeper shadow (docs/reference.md §1). Bevel
 * and material thickness are specified for an element at a reference half-size and grow as the
 * square root of size.
 */
const SIZE_REF_DP = 24;
export const sizeGain = (g: VireGlassGeometry) =>
  Math.min(Math.max(Math.sqrt(halfMinDp(g) / SIZE_REF_DP), 0.8), 2.4);

/** A bevel wider than this fraction of the half-size breaks the SDF: the roundings converge in
 *  the middle. */
export const MAX_BEVEL_FRACTION = 0.65;

export const bevelFraction = (g: VireGlassGeometry, o: VireGlassOptics) =>
  Math.min(MAX_BEVEL_FRACTION, (o.bevelDp * sizeGain(g)) / halfMinDp(g));

export const bevelDp = (g: VireGlassGeometry, o: VireGlassOptics) =>
  Math.max(bevelFraction(g, o) * halfMinDp(g), 1);

export const thicknessDp = (g: VireGlassGeometry, o: VireGlassOptics) =>
  o.thicknessDp * sizeGain(g);

/** Glass height right at the silhouette, a fraction of thickness: without it there's nothing at
 *  the edge to bend the ray. */
export const RIM_FRACTION = 0.85;

export const rimDp = (g: VireGlassGeometry, o: VireGlassOptics) => thicknessDp(g, o) * RIM_FRACTION;

/** Bigger element, deeper and wider shadow (M 7:14). */
export const shadowReachDp = (g: VireGlassGeometry) =>
  Math.min(Math.max(halfMinDp(g) * 0.65, 6), 36);

/** How far the second morph shape reaches past the first one's bounds. Without this margin the
 *  fused shape gets clipped by the canvas edge and the experiment shows the wrong thing. */
export function morphReachDp(
  g: VireGlassGeometry,
  morph?: { offsetX: number; offsetY: number; width: number; height: number; smoothing: number },
): number {
  if (!morph || morph.smoothing <= 0) return 0;
  return Math.max(
    0,
    Math.abs(morph.offsetX) + morph.width / 2 - g.width / 2,
    Math.abs(morph.offsetY) + morph.height / 2 - g.height / 2,
  );
}

/**
 * Quantization step for the margin. The margin only needs to cover the sampling — its exact value
 * doesn't matter, but changing it every frame is expensive: the native lens view gets re-laid-out
 * and re-sets its `RenderEffect`. While dragging a panel or morphing, the margin used to drift
 * continuously, and that produced visible stutter. Round up to the step — size changes rarely.
 */
const PAD_STEP = 8;
const quantise = (v: number) => Math.ceil(v / PAD_STEP) * PAD_STEP;

/**
 * Margin around the lens view on each side: beyond it, the shader has nothing to sample.
 *
 * FOUR things have to fit in here. The refraction sample with aberrations. The blur radius —
 * it also samples around the point. The gather radius — the rim picks it up from outside the
 * shape, and without the margin it goes black exactly where it should be catching the
 * surroundings. And drag travel: the lens view moves with the finger, but its bounds don't, and
 * the sample falls off the edge, which is how layers from under the glass leak through.
 */
export function lensPadDp(
  g: VireGlassGeometry,
  o: VireGlassOptics,
  morph?: Parameters<typeof morphReachDp>[1],
  dragLimit = 0,
): number {
  const sampling = Math.max(o.blur, o.gatherRadiusDp);
  const stretch = halfMinDp(g) * MAX_STRETCH;
  return quantise(sampling + dragLimit + stretch + morphReachDp(g, morph) + 2);
}

/**
 * Margin around the surface canvas: the shadow reaches outside the shape, and dragging shifts it
 * further still.
 *
 * The multiplier is smaller than the shadow's full reach: under the finger, the shader for a
 * rising element multiplies the radius by 1.55, and the very end of that tail falls outside the
 * margin. Left that way on purpose — at the margin's edge it's at 1.2% alpha (2.5% before the
 * shadow was softened), and raising the multiplier means growing every surface view's area. If
 * that tail ever shows up on a device, fix it here.
 */
export function surfacePadDp(
  g: VireGlassGeometry,
  dragLimit = 0,
  morph?: Parameters<typeof morphReachDp>[1],
): number {
  return quantise(shadowReachDp(g) * 1.2 + dragLimit + morphReachDp(g, morph) + 2);
}

/**
 * SHADOW DENSITY BY WHAT'S UNDER THE ELEMENT. Reference 219 @11:47, verbatim: "increases the
 * opacity of its shadow when it is over text… lowers the opacity of its shadow when it is over a
 * solid light background." This is about content BEHIND THE ELEMENT, so it's a single value per
 * element, not a field over the shadow's area.
 *
 * The law lives here, not at the bench: while it was baked into the web renderer, shadows on
 * Android never adapted at all. The endpoints were checked against the reference by the depth of
 * the dip under the element — docs/benchmarks.md.
 */
const SHADOW_FLAT = 0.8;
const SHADOW_BUSY_GAIN = 6;
const SHADOW_BUSY_RISE = 1.2;
const SHADOW_STEP = 0.05;

export function shadowOpacity(busy: number): number {
  return SHADOW_FLAT + Math.min(Math.max(busy, 0) * SHADOW_BUSY_GAIN, SHADOW_BUSY_RISE);
}

/** Same thing for platforms where the measurement flows through state: quantized coarsely, like
 *  the ambient color, otherwise every probe sample would trigger a surface repaint. */
export function shadowOpacityFrom(sample: { busy: number }): number {
  return Math.round(shadowOpacity(sample.busy) / SHADOW_STEP) * SHADOW_STEP;
}
