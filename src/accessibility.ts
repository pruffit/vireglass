// System accessibility settings change the material's LAYERS, they don't override it (reference
// 219 @18:15). So what's adjusted here are EFFECTS, like with toggles: the shader knows nothing
// about accessibility.
import { ACCESSIBILITY, BODY } from './law';
import type { VireGlassOptics } from './material';

export type VireGlassAccessibility = {
  /** The glass becomes more frosted and hides content beneath it more strongly (219 @18:22). */
  reduceTransparency: boolean;
  /** The element moves nearly to black or white and picks up a contrasting border (219 @18:29). */
  increaseContrast: boolean;
  /** The material's springiness is turned off, effects are quieter (219 @18:35). */
  reduceMotion: boolean;
};

export const NO_ACCESSIBILITY: VireGlassAccessibility = {
  reduceTransparency: false,
  increaseContrast: false,
  reduceMotion: false,
};

/** A system setting acts on the whole glass and outranks the material preset (219 @18:45): even
 *  a transparent preset moves to the edge of the scale under contrast — the user needs contrast
 *  more than they need aesthetics. */
export function applyAccessibility(
  optics: VireGlassOptics,
  mods: VireGlassAccessibility = NO_ACCESSIBILITY,
): VireGlassOptics {
  if (!mods.reduceTransparency && !mods.increaseContrast) return optics;
  const out = { ...optics };
  if (mods.reduceTransparency) {
    out.blur = Math.max(out.blur, ACCESSIBILITY.frostMinDp);
    out.bodyDensity = Math.max(out.bodyDensity, ACCESSIBILITY.obscureMin);
  }
  if (mods.increaseContrast) {
    out.bodyDensity = Math.max(out.bodyDensity, ACCESSIBILITY.contrastDensity);
    out.presence = Math.max(out.presence, ACCESSIBILITY.contrastPresence);
    out.legibility = 1;
  }
  return out;
}

/**
 * The lightness of the contrasting border §9 asks for, for a body sitting at `tintLuma`.
 *
 * It is the one place the rim stops being an environmental thing. Everywhere else the hairline
 * takes its colour from what is around the element — "over a yellow flower the rim is yellow"
 * (§2) — and a hairline the colour of its surroundings is not a border that contrasts with the
 * element it outlines. Under this setting it is measured from the body instead.
 */
export function contrastRimLuma(tintLuma: number): number {
  const light = tintLuma < 0.5;
  return light
    ? Math.min(tintLuma + ACCESSIBILITY.contrastRim, BODY.tintLight)
    : Math.max(tintLuma - ACCESSIBILITY.contrastRim, BODY.tintDark);
}

/**
 * Whether the material may deform. §9: reduced motion "disables any elastic properties for the
 * material" — the spring and the ripple. It does NOT disable the response: the press that lights
 * an element from within (§5) is light, not motion, and survives at reduced intensity.
 */
export function elasticAllowed(mods: VireGlassAccessibility = NO_ACCESSIBILITY): boolean {
  return !mods.reduceMotion;
}
