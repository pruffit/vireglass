// The colour that bleeds into a shadow (docs/reference.md §4, 219 @8:22): "the light reflects,
// scatters, and bleeds into the shadow as well — much like it would in the physical world."
//
// JS twin of the lens surface's `vgShadowTint`. A shadow that is simply black leaves an element
// over colourful content hanging above a grey blob, which reads as pasted on rather than resting
// there.

const LUMA: readonly [number, number, number] = [0.2126, 0.7152, 0.0722];

const luma = (c: readonly [number, number, number]) => c[0] * LUMA[0] + c[1] * LUMA[1] + c[2] * LUMA[2];

/**
 * Hue without lightness, scaled by how much light there is to bleed. Lightness is subtracted out
 * of the hue on purpose: left in, the shadow PALES and loses its depth instead of warming up. And
 * over a nearly black backdrop there is nothing to spill, so the result goes to zero on its own.
 */
export function shadowTint(ambient: readonly [number, number, number]): [number, number, number] {
  const peak = Math.max(ambient[0], ambient[1], ambient[2], 0.001);
  const hue: [number, number, number] = [ambient[0] / peak, ambient[1] / peak, ambient[2] / peak];
  const grey = luma(hue);
  const available = luma(ambient);
  return [(hue[0] - grey) * available, (hue[1] - grey) * available, (hue[2] - grey) * available];
}
