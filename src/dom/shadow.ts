// Adaptive shadow (docs/reference.md §4). The law itself — density keyed to what is behind the
// element, size keyed to its own half-size — lives in `../geometry` as `shadowOpacityFrom` and
// `shadowReachDp`; this turns those into a CSS `box-shadow`.
import { ambientFrom, type BackdropSample } from '../adaptation';
import { shadowOpacity, shadowOpacityFrom, shadowReachDp, type VireGlassGeometry } from '../geometry';
import { SHADOW, SHADOW_GAP } from '../law';
import { shadowTint } from '../shadow-tint';

/**
 * The model carries shadow density as a multiplier the shader applies to its own per-pixel term,
 * so the DOM path has to convert it to one flat alpha. That conversion is not a taste constant:
 * §4 records both ends measured off reference frames 711–723 — 19.9% over text, 4.0% over a flat
 * light backdrop — and `shadowOpacity` spans exactly those two cases. Two measured points, one line.
 */
const FLAT_DENSITY = shadowOpacity(0);
const BUSY_DENSITY = shadowOpacity(1);

export function shadowAlphaFrom(sample: { busy: number }): number {
  const t = (shadowOpacityFrom(sample) - FLAT_DENSITY) / (BUSY_DENSITY - FLAT_DENSITY);
  const alpha = SHADOW.alphaFlat + t * (SHADOW.alphaBusy - SHADOW.alphaFlat);
  return Math.min(Math.max(alpha, 0), 1);
}

const to255 = (v: number) => Math.round(Math.min(Math.max(v, 0), 1) * 255);

/**
 * Symmetric and blur-only: §4 gives a density and a size, never a direction. The reference calls
 * the shadow "soft, small" — blur carries both.
 *
 * The colour is NOT black. "The light reflects, scatters, and bleeds into the shadow as well —
 * much like it would in the physical world" (219 @8:22). A black shadow leaves an element over
 * colourful content hanging above a grey blob, which is the one thing that reads as pasted on.
 */
/**
 * `appear` is the same gate the surface shader puts on the shadow (`u_shadow * u_appear`, line
 * 176). An element that is not there yet does not cast: a shadow under nothing is the one part of
 * materialising that gives the trick away.
 */
export function boxShadowCss(
  geometry: VireGlassGeometry,
  sample: BackdropSample | { busy: number },
  appear = 1,
): string {
  const reach = shadowReachDp(geometry);
  const present = appear < 0 ? 0 : appear > 1 ? 1 : appear;
  const alpha = shadowAlphaFrom(sample) * present;
  const ambient = 'luma' in sample ? ambientFrom(sample as BackdropSample) : null;
  if (!ambient) return `0 0 ${reach.toFixed(1)}px rgba(0, 0, 0, ${alpha.toFixed(3)})`;

  const [r, g, b] = shadowTint(ambient);
  const spill = SHADOW_GAP.tint;
  return (
    `0 0 ${reach.toFixed(1)}px ` +
    `rgba(${to255(r * spill)}, ${to255(g * spill)}, ${to255(b * spill)}, ${alpha.toFixed(3)})`
  );
}
