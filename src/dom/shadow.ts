// Adaptive shadow (docs/reference.md §4). The law itself — density keyed to what's behind the
// element, size keyed to its own half-size — lives in `../geometry` as `shadowOpacityFrom` and
// `shadowReachDp`; this only turns those two numbers into a CSS `box-shadow`.
import { shadowOpacity, shadowOpacityFrom, shadowReachDp, type VireGlassGeometry } from '../geometry';

/**
 * The model carries shadow density as a multiplier the shader applies to its own per-pixel term,
 * so the DOM path has to convert it to one flat alpha. That conversion is not a taste constant:
 * §4 records both ends measured off reference frames 711–723 — 19.9% over text, 4.0% over a flat
 * light backdrop — and `shadowOpacity` spans exactly those two cases. Two measured points, one line.
 */
const FLAT_DENSITY = shadowOpacity(0);
const BUSY_DENSITY = shadowOpacity(1);
const FLAT_ALPHA = 0.04;
const BUSY_ALPHA = 0.199;

export function shadowAlphaFrom(sample: { busy: number }): number {
  const t = (shadowOpacityFrom(sample) - FLAT_DENSITY) / (BUSY_DENSITY - FLAT_DENSITY);
  const alpha = FLAT_ALPHA + t * (BUSY_ALPHA - FLAT_ALPHA);
  return Math.min(Math.max(alpha, 0), 1);
}

/**
 * Symmetric, blur-only: §4 specifies density and size, never a direction, so there is no derived
 * offset to reach for. The reference calls the shadow "soft, small" — blur carries both.
 */
export function boxShadowCss(geometry: VireGlassGeometry, sample: { busy: number }): string {
  const reach = shadowReachDp(geometry);
  const alpha = shadowAlphaFrom(sample);
  return `0 0 ${reach.toFixed(1)}px rgba(0, 0, 0, ${alpha.toFixed(3)})`;
}
