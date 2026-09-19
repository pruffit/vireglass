/**
 * THE LAW: every calibrated number the material obeys, in one place.
 *
 * A value here is written ONCE and read by everything that needs it — the shader text interpolates
 * it, the JS twins import it. The alternative is what this file replaces: the same number typed
 * into a GLSL string and again into a TypeScript function, drifting apart the first time one side
 * is tuned. `VG_FALLOFF` already worked this way; the rest now does too.
 *
 * Each entry carries where it came from. `§N` is a section of `docs/reference.md`, which is itself
 * drawn from Apple's public sessions; `M 2:32` and the like are the timestamps those sections cite.
 * A number with no provenance is marked as such, and that marking is a debt, not a decoration.
 *
 * Structural constants — 0, 1, 0.5, 2, π — are not laws and do not belong here.
 */

/** Rim optics: the silhouette's light (§2). */
export const RIM = {
  /**
   * The key-light lobe's exponent. Two opposing arcs come out of one expression, which is why
   * they are opposed rather than placed: `pow(max(facing, 0), 3) + 0.45 * pow(max(-facing, 0), 3)`.
   */
  lobeExponent: 3,
  /** The far arc, weaker than the one facing the light (§2). */
  opposingArc: 0.45,
  /**
   * The dark edge along the whole silhouette, as a multiplicative darkening. iOS 27 made it a
   * layer of its own, and it does not rule out the highlight sitting on top of it (§2).
   */
  darkEdge: 0.22,
  /** Width of the hairline, CSS px. "About a point, not a band and not a bevel" (§2). */
  widthPx: 1,
} as const;

/** How the medium stands between the backdrop and the eye (§3). */
export const BODY = {
  /** Lightness ceiling for the body when legibility is loose. */
  capLoose: 0.62,
  /** …and when it is strict. The model is calibrated at these two, not in between (E-43). */
  capTight: 0.38,
  /** The two ends the body tints toward. Glass has no colour of its own (HIG "Color"). */
  tintDark: 0.07,
  tintLight: 0.94,
  /** How far the backdrop's spread reaches past its mean when deciding what the ink needs. */
  busyEdge: 0.75,
  /** Fine texture the body has to stop being a window for. */
  groundSpan: 0.06,
  /** Where the tint flips direction, by the element's AVERAGE lightness — a local threshold cuts
   *  a diagonal step across the body on a gradient. */
  darkSideFrom: 0.42,
  darkSideTo: 0.58,
  /** Ceiling on any single demand, so one requirement cannot make the glass opaque on its own. */
  maxDemand: 0.92,
} as const;

/** Shadow (§4). The density law lives in `geometry.ts`; these are its measured ends. */
export const SHADOW = {
  /** Measured off reference frames 711–723: 4.0% over a flat light backdrop, 19.9% over text. */
  alphaFlat: 0.04,
  alphaBusy: 0.199,
} as const;

/** Dispersion: the channels refract at different indices (§1, Cauchy). */
export const DISPERSION = {
  /** Red bends less than the base index, blue more — and not symmetrically. */
  redShift: -0.4,
  blueShift: 0.6,
} as const;

/** Response to a finger (§5). The springs and decay live in `touch-response.ts`; these shape the
 *  field the finger deforms. */
export const TOUCH = {
  /** The element grows under pressure (M 3:51; HIG: interactive "expands"). */
  pressGrow: 0.06,
  /** The ridge around the contact blob: material displaced from under the finger ends up
   *  somewhere. Without it the shape balloons, and a dense medium does not do that. */
  ridge: 0.42,
  /** How far press pulls the field toward the finger. */
  pressPull: 0.16,
  /** Wavelength and decay of the ripple, as fractions of its span. Short and quick: in a dense
   *  medium ripples are frequent and small; long shallow swells are water. */
  waveLength: 0.17,
  waveDecay: 0.7,
  /** The ripple's span, as a multiple of the contact radius. It has to reach the far edge, or it
   *  reads as jitter under the finger rather than a wave across the surface. */
  waveSpan: 2,
  /**
   * Contact radius as a fraction of the element's half-size. UNMEASURED: §5 says the response has
   * to be visible UNDER the finger, which is why the blob is wide, but gives no figure.
   */
  radiusOfHalfSize: 1.1,
  /**
   * Wave impulse as a fraction of the travel limit. UNMEASURED: the core carries the ripple's
   * decay and frequency, but nothing says how hard a finger strikes it.
   */
  waveOfTravel: 0.18,
  /** The lift-off ring is weaker than the one from touching down (§5). UNMEASURED ratio. */
  releaseWave: 0.6,
} as const;

/** The bevel's profile — spherical, like a cap: `t / sqrt(1 - t² · k)`, clamped. A plain `t²` kept
 *  the slope near zero through most of the bevel and then shot up at the edge, so the optics
 *  bunched into a ring and the element read as a puck. */
export const BEVEL = {
  sphere: 0.94,
  floor: 0.02,
  slopeMax: 3.2,
} as const;

/** Where two shapes meet head-on their normals cancel exactly and the blend lands on zero. */
export const EPSILON = 1e-5;
