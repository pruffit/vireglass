import { useCallback, useEffect, useRef, useState } from 'react';
import type { VireGlassOptics } from './material';

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

export type GlassAdaptation = {
  /** Ink polarity: 1 light, 0 dark. Travels smoothly between the ends. */
  ink: number;
  /** The latest backdrop sample — used for the accent and for debug hints. */
  sample: BackdropSample | null;
  /** Pass to `VireGlassSurface`. */
  onBackdropSample: (e: { nativeEvent: BackdropSample }) => void;
};

/**
 * Content polarity that follows the backdrop under the glass on its own.
 *
 * `initial` — the polarity the screen starts with (usually light ink on a dark theme).
 * `enabled = false` freezes it: a screen that already knows its own content is entitled to not
 * hand the decision to the automation.
 */
export function useGlassAdaptation(
  optics: Pick<VireGlassOptics, 'legibility' | 'bodyDensity' | 'ink' | 'edgeLight'>,
  options: { enabled?: boolean } = {},
): GlassAdaptation {
  const enabled = options.enabled ?? true;
  const [ink, setInk] = useState(optics.ink);
  const [sample, setSample] = useState<BackdropSample | null>(null);

  const target = useRef(optics.ink > 0.5 ? 1 : 0);
  // The current value also lives in a ref: without it the callback would depend on state and get
  // recreated on EVERY frame of the fade, meaning the native view's prop would change identity 60
  // times a second for no reason but that.
  const current = useRef(optics.ink);
  const lastSample = useRef<BackdropSample | null>(null);
  const pending = useRef(0);
  const from = useRef(optics.ink);
  const startedAt = useRef(0);
  const raf = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);

  // The fade runs frame by frame, not on a worklet spring: the value feeds not only text color
  // but also the lens uniform, and that's set through a prop — i.e. from a React render.
  const animate = useCallback(() => {
    const step = () => {
      const t = Math.min((Date.now() - startedAt.current) / FADE_MS, 1);
      // Cosine easing: a linear transition reads as motion, this one doesn't.
      const e = 0.5 - 0.5 * Math.cos(Math.PI * t);
      current.current = from.current + (target.current - from.current) * e;
      setInk(current.current);
      raf.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(step);
  }, []);

  useEffect(() => () => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
  }, []);

  const onBackdropSample = useCallback(
    (e: { nativeEvent: BackdropSample }) => {
      const next = e.nativeEvent;
      // The sample arrives several times a second. It only lands in state when it actually
      // moved: otherwise every sample would drag a consumer repaint behind it.
      const prev = lastSample.current;
      if (
        prev === null ||
        Math.abs(prev.luma - next.luma) > 0.01 ||
        Math.abs(prev.busy - next.busy) > 0.02
      ) {
        lastSample.current = next;
        setSample(next);
      }
      if (!enabled) return;

      const wasLight = target.current === 1;
      // The actual decision lives in `shouldInkBeLight`: one place for every platform. What's
      // left here is just the confirmation policy, and that's the app's own.
      const wants = shouldInkBeLight(next, wasLight) !== wasLight;
      if (!wants) {
        pending.current = 0;
        return;
      }
      pending.current += 1;
      if (pending.current < CONFIRMATIONS) return;
      pending.current = 0;
      from.current = current.current;
      target.current = wasLight ? 0 : 1;
      startedAt.current = Date.now();
      animate();
    },
    [enabled, animate],
  );

  return { ink, sample, onBackdropSample };
}
