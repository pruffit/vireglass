// The React binding for backdrop adaptation. It lives behind its own entry point (`vireglass/react`)
// so that the core stays dependency-free: the decision itself is a pure function in
// `adaptation.ts`, and only the confirmation policy and the fade need hooks.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { VireGlassOptics } from './material';
import {
  CONFIRMATIONS,
  FADE_MS,
  shouldInkBeLight,
  type BackdropSample,
} from './adaptation';
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
