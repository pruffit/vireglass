
/**
 * Automatic content polarity above the glass.
 *
 * The glass adjusts its own body to the backdrop — but that has a limit. When the backdrop is
 * light AND the ink over it is light, no amount of body density can separate them by contrast
 * anymore: the body hits its own ceiling, and the letters drown. Past that point the decision is
 * no longer the glass's to make but the app's — it recolors the ink to the opposite side, and all
 * of the glass's own automation reflows behind it, because it depends on that same polarity.
 *
 * The app has nowhere to get the lightness of the backdrop UNDER the glass from — only the native
 * capture can see it. That's where it comes from: the `onBackdropSample` event (a probe in
 * `GlassBackdropView`).
 *
 * The decision is made BY LIGHTNESS with hysteresis: computing body density here with the
 * shader's formula would mean keeping a second implementation of the model that silently drifts
 * from the first. Whether the body and the ink actually separate by contrast is checked by
 * `check:optics` — against a real render, not a copy of the formula.
 */

export type BackdropSample = {
  /** Average lightness of the backdrop under the glass, 0..1, on the same (sRGB-encoded) scale
   *  as the screen. */
  luma: number;
  /** Variegation: twice the mean deviation of lightness, 0 on a flat fill, 1 at the limit.
   *  Exactly the same quantity the probe computes on the web — otherwise the platforms would
   *  drift apart silently. */
  busy: number;
  /** The darkest and lightest spots under the glass. The legibility decision is made from these,
   *  not the average: right over a black/white border the average reads as "everything's fine". */
  lo: number;
  hi: number;
  r: number;
  g: number;
  b: number;
};

/** Quantization step for the ambient color — for platforms where the measurement flows through
 *  state: every probe sample would otherwise trigger a surface repaint. The shadow is tinted
 *  coarsely, it doesn't need precision either. The web draws uniforms imperatively every frame
 *  and takes the color as is. */
const AMBIENT_STEP = 32;

/** The element's ambient color from a probe sample — the one that bleeds into its shadow
 *  (docs/reference.md §7). */
export function ambientFrom(sample: { r: number; g: number; b: number }): [number, number, number] {
  const step = (v: number) => Math.round(Math.min(Math.max(v, 0), 1) * AMBIENT_STEP) / AMBIENT_STEP;
  return [step(sample.r), step(sample.g), step(sample.b)];
}

/** Ink lightness at the ends of the scale. The kit keeps light text nearly white and dark text
 *  nearly black; there's no in-between polarity state by construction. */
export const INK_LIGHT = 0.95;
export const INK_DARK = 0.08;

/**
 * Ink polarity from a backdrop sample — ONE place for every platform. A small element and its
 * glyphs switch between light and dark so that contrast is maximized (docs/reference.md §3): over
 * a yellow flower the reference already has black glyphs on light glass. Holding a light ink with
 * body density over a light backdrop just turns the element into a painted plaque.
 *
 * The decision is by lightness with a bias toward the light side — not by average (a white screen
 * with a dark stripe would otherwise never flip) and not by maximum (one light cover peeking under
 * the edge would recolor the whole panel). Hysteresis lives inside; the caller decides how many
 * confirmations it takes.
 */
export function shouldInkBeLight(sample: { luma: number; hi?: number }, wasLight: boolean): boolean {
  return decisiveLuma(sample) < (wasLight ? FLIP_LUMA : RETURN_LUMA);
}

export const decisiveLuma = (sample: { luma: number; hi?: number }) =>
  sample.luma * 0.75 + (sample.hi ?? sample.luma) * 0.25;

/** Lighter than this, a light ink flips to dark. */
export const FLIP_LUMA = 0.62;
/** The way back triggers noticeably earlier than the way forward: without the gap the ink would
 *  flicker on every light cover sliding under the glass edge. */
export const RETURN_LUMA = 0.5;
/** How many consecutive samples have to demand a change. The probe samples ~5 times a second, so
 *  three samples is roughly half a second of a stable backdrop, not a random cover flashing by
 *  under the edge. */
export const CONFIRMATIONS = 3;
/** Duration of the recolor. Slow enough not to read as an event, fast enough that the illegible
 *  in-between state doesn't linger noticeably. */
export const FADE_MS = 420;
