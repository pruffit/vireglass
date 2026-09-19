// Materialising in and out (docs/reference.md §1, 219 @2:55): "Instead of fading, Liquid Glass
// objects materialize in and out by gradually modulating the light bending and lensing, ensuring a
// graceful transition that preserves the optical integrity of the material."
//
// So an element must not arrive by opacity. Fading it leaves a half-transparent picture OF glass;
// modulating the lens leaves glass that is not yet bending much light. The difference is visible:
// a faded element shows the backdrop through a veil, a materialising one shows it undistorted.
//
// JS twin of what `u_appear` multiplies in the lens: the lens strength itself, the frost, the
// body, the dimming layer and the rim's light. Everything that makes the material present, and
// nothing that makes it opaque.
import type { VireGlassOptics } from './material';

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * `t` of 0 is an element indistinguishable from the backdrop beneath it; 1 is the material at
 * full strength. Between them the glass bends progressively more light.
 */
export function applyAppear(optics: VireGlassOptics, t: number): VireGlassOptics {
  const a = clamp01(t);
  if (a === 1) return optics;
  return {
    ...optics,
    refraction: optics.refraction * a,
    blur: optics.blur * a,
    bodyDensity: optics.bodyDensity * a,
    dimming: optics.dimming * a,
    edgeLight: optics.edgeLight * a,
    // Legibility is a REQUIREMENT, not an effect: an element still arriving has no ink on it yet,
    // and holding a demand it cannot meet would darken the body exactly while it should be
    // clearing. It fades with the rest.
    legibility: optics.legibility * a,
  };
}
