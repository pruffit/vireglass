// Deriving optics from the medium's properties. The material describes CAUSES (index of
// refraction, thickness, bevel, roughness); the shaders need EFFECTS — this file translates one
// into the other. Pure functions: the physics is checked by tests, not on a device.
//
// The normalisations themselves are in `law.ts` under DERIVE, with the rest of the calibration.
// They are honestly labelled there: the rendering is stylised, and literal physical values (glass
// reflects 4% at normal incidence) produce effects right at the threshold of visibility. Each is
// monotonic in its own cause, so "denser medium → more visible rim" always holds, and no
// impossible combination can arise.
import { DERIVE } from './law';

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v: number) => clamp(v, 0, 1);

/** Reflectance at normal incidence: ((n−1)/(n+1))². For glass, n=1.5 gives 0.04. */
export const fresnelF0 = (ior: number) => ((ior - 1) / (ior + 1)) ** 2;

export const fresnelStrength = (ior: number) => clamp01(fresnelF0(ior) * DERIVE.fresnelGain);

/** Exponent in the Schlick approximation — a constant of the model, not a knob. */
export const FRESNEL_EXPONENT = DERIVE.fresnelExponent;

/** Strength of ray bending. As n→1 the medium is indistinguishable from air; n=1.6 is taken as
 *  full strength. */
export const refractionStrength = (ior: number) => clamp01((ior - 1) / DERIVE.iorFullBend);

export const refractionScale = (ior: number, thicknessDp: number) =>
  1 + DERIVE.magnifyPerDp * thicknessDp * (1 - 1 / Math.max(ior, 1));

export const dispersion = (ior: number) => clamp01((ior - 1) * DERIVE.dispersionPerIor);

export const iorSpread = (ior: number) => dispersion(ior) * DERIVE.iorSpreadPerDispersion;

export const absorption = (pathDp: number) =>
  1 - Math.exp(-DERIVE.absorbPerDp * Math.max(pathDp, 0));

/**
 * Density at the bevel relative to the body. Not a separate quantity: at the rim the ray travels
 * LONGER through the medium by the bevel's width, and absorption over that path is greater. This
 * used to be a separate `edgeDensity` slider, which is how a thin bevel with a milky rim got
 * built — a state that doesn't occur in real glass.
 */
export const edgeDensity = (thicknessDp: number, bevelDp: number) => {
  const body = absorption(thicknessDp);
  if (body <= 0) return 1;
  return clamp(absorption(thicknessDp + bevelDp) / body, 1, DERIVE.edgeDensityMax);
};

/**
 * Backdrop haziness — surface roughness, not a separate blur setting.
 *
 * The ceiling is deliberately low. Blur in this model is a SUPPORTING device: it helps ink sit
 * over glass, but doesn't improve the picture on its own. Past roughly a dozen dp, letters under
 * the glass stop being letters and turn into a mush of pixels — no amount of legibility justifies
 * that. Separating content from the ink is body density's job, not blur's.
 */
export const blur = (roughness: number) => clamp01(roughness) * DERIVE.blurMaxDp;

/** A smooth surface gives a narrow highlight, a rough one a spread-out one. */
export const specularPower = (roughness: number) =>
  DERIVE.specularPowerSmooth -
  clamp01(roughness) * (DERIVE.specularPowerSmooth - DERIVE.specularPowerRough);

/** Highlight brightness — the same reflectance as Fresnel, damped by roughness. */
export const specularStrength = (ior: number, roughness: number) =>
  clamp01(fresnelStrength(ior) * (1 - clamp01(roughness) * DERIVE.specularRoughDamping));

/**
 * Color of the medium. Never set by hand: in transparent media, hue is tied to density. Water
 * absorbs red and skews cool, ordinary glass is nearly neutral with a faint green, dense
 * high-index media skew warm. Lightness follows reflectance: the denser the medium, the more of
 * its surroundings it returns, and the lighter its body reads.
 */
type Hue = readonly [number, number, number];
const mixHue = (a: Hue, b: Hue, t: number): Hue => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

export function mediumTint(ior: number): { r: number; g: number; b: number } {
  const t = clamp01((ior - DERIVE.hueFromIor) / DERIVE.hueSpan);
  const hue =
    t < 0.5
      ? mixHue(DERIVE.hueCool, DERIVE.hueNeutral, t * 2)
      : mixHue(DERIVE.hueNeutral, DERIVE.hueWarm, (t - 0.5) * 2);
  const lift = DERIVE.bodyLiftBase + fresnelF0(ior) * DERIVE.bodyLiftPerF0;
  return { r: clamp01(hue[0] * lift), g: clamp01(hue[1] * lift), b: clamp01(hue[2] * lift) };
}

/**
 * How far the rim gathers light AROUND the element.
 *
 * On real glass, at a grazing angle the eye receives not what's under the glass but the
 * surroundings: an object on a black table next to a lamp catches the lamp. So the radius is
 * noticeably larger than the bevel — it's the element's vicinity, not its rim. Without this,
 * glass on an empty black background has no source at all and honestly disappears.
 */
/**
 * Ceiling on the radius. Without it, a wide bevel would gather its surroundings from fifty-odd dp
 * away, and a READABLE copy of whatever sits nearby would appear inside the glass: eight samples
 * aren't enough to blur a disc that large (E-33, E-37). Real rims also gather light mostly from
 * nearby — an unbounded radius was a modeling mistake.
 */
export const gatherRadius = (bevelDp: number) =>
  clamp(Math.max(bevelDp, 1) * DERIVE.gatherPerBevel, DERIVE.gatherMinDp, DERIVE.gatherMaxDp);

/**
 * The body's own density from absorption through its thickness. Small: glass has no color of its
 * own, the body only moves toward the tint under the legibility requirement (HIG "Color"),
 * otherwise it dims the content.
 */
export const bodyDensity = (thicknessDp: number) =>
  DERIVE.bodyDensity * absorption(thicknessDp);

/**
 * Highlight normalization. `fresnelStrength`'s ×17.5 factor is tuned for the rim highlight's
 * visibility and saturates at one for dense media; applying it to the highlight too would raise
 * body lightness harder than the glass had just separated it from the ink — eating its own
 * legibility work. This uses the physical scale instead.
 */
/** How much the rim picks up the light and color of its surroundings. The same reflectance as
 *  Fresnel: no separate knob — a dense medium returns more of its surroundings by construction. */

export const edgeLight = (ior: number) => clamp01(fresnelF0(ior) * DERIVE.edgeLightGain);

/**
 * THE SPECTRAL PART. Three phenomena — dispersion, diffraction and interference — share one
 * cause: index of refraction and phase both depend on wavelength. So there are no separate
 * "rainbow strength" knobs here: everything is derived from the medium's density and film
 * thickness.
 */

/**
 * Rim iridescence is visible exactly as much as the REFLECTION is bright: interference lives in
 * the reflected ray, not the transmitted one. Hence the tie to Fresnel — there's no strength knob
 * of its own.
 */
export const iridescence = (ior: number, filmNm: number) =>
  filmNm <= 0 ? 0 : clamp01(fresnelStrength(ior) * DERIVE.iridescencePerFresnel);

/**
 * Edge diffraction. Same λ-dependence as dispersion, so it shares its strength; the bevel sets
 * the fringe frequency — wide bevels give sparse fringes, sharp ones frequent (in the shader this
 * is divided by bevel width). The 0.5 normalization reflects the stylized render: at the physical
 * amplitude the fringes aren't visible at all.
 */
export const diffraction = (ior: number) =>
  clamp01(dispersion(ior) * DERIVE.diffractionPerDispersion);

/**
 * How much the body picks up the COLOR of its surroundings. This is multiple internal reflection:
 * the denser the medium, the more light it circulates inside itself, and the more strongly it's
 * tinted by what's around it. The ceiling is deliberately low — the tint has to stay a medium, not
 * become a flat color fill.
 */
export const colorPickup = (ior: number) =>
  clamp(fresnelStrength(ior) * DERIVE.colorPickupPerFresnel, 0, DERIVE.colorPickupMax);
