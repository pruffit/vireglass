// User-facing glass transparency scale: iOS 26.1 gave a choice between two options ("default clear
// look" or "tinted look which increases opacity of the material"), iOS 27 a continuous slider
// "ultra clear → fully tinted", and apps get it without recompiling.
//
// It adjusts EFFECTS, not causes, and that's not a compromise. The cause "medium density" is
// deliberately absent from the model: the glass has no color of its own, `bodyDensity` is derived
// from absorption through the body and never exceeds 0.03, and the visible density is held by the
// legibility requirement and scattering. A thickness scale would move a number that isn't visible
// in the frame (measured by the `check:optics` gate).
import type { VireGlassOptics } from './material';

/** The point on the scale where the material stays exactly as it is today. */
export const GLASS_SCALE_DEFAULT = 0.35;

/** Body density at the "fully tinted" end: content under the glass must be hidden. */
const TINTED_DENSITY = 0.9;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * `scale` 0 is ultra clear, 1 is fully tinted. Toward the transparent end, the legibility
 * requirement and the dimming layer are relaxed (the user chose clarity); toward the tinted end,
 * body density grows.
 *
 * Accessibility settings apply AFTER the scale: they set floors, and the user's chosen clarity
 * does not override them (219 @18:45).
 */
export function applyGlassScale(optics: VireGlassOptics, scale: number): VireGlassOptics {
  const s = clamp01(scale);
  if (s === GLASS_SCALE_DEFAULT) return optics;
  if (s < GLASS_SCALE_DEFAULT) {
    const k = s / GLASS_SCALE_DEFAULT;
    return { ...optics, legibility: optics.legibility * k, dimming: optics.dimming * k };
  }
  const k = (s - GLASS_SCALE_DEFAULT) / (1 - GLASS_SCALE_DEFAULT);
  return { ...optics, bodyDensity: Math.max(optics.bodyDensity, TINTED_DENSITY * k) };
}
