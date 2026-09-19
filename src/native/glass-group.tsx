import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { FADE_MS, type BackdropSample } from '../adaptation';
import { createGroupState, type GroupState } from '../group-model';

/**
 * SURFACE GROUP — a block of glass that adapts as one.
 *
 * Each lens sees its own patch of backdrop, and by its own measurement one nav button can drop
 * into shadow while its neighbor stays transparent; over a busy backdrop their ink polarity
 * splits apart too. The block then stops reading as a block and falls apart into separate
 * elements.
 *
 * The group collects members' measurements and hands everyone back ONE ink polarity.
 *
 * It no longer hands out an AMBIENT estimate: that now lives in the lens itself, as on the web —
 * the shared one used to override each element's own probe, and under one material the nav bar
 * and the feed screen ended up adapting to the backdrop differently. The pull bus went with it:
 * what deforms is the field around the touch point, not the element (`createDeform` in the
 * core), and there's nothing left to merge neighboring surfaces into one drop with.
 */
type GroupApi = {
  report: (
    id: string,
    x: number,
    y: number,
    sample: BackdropSample,
    legibility: number,
  ) => void;
  /** Take a member off the books on unmount: otherwise it stays in the block's estimate forever. */
  release: (id: string) => void;
  ink: number | undefined;
};

const GlassGroupContext = createContext<GroupApi | null>(null);

export function GlassGroup({ children }: { children: ReactNode }) {
  const [ink, setInk] = useState(1);

  const target = useRef(1);
  const current = useRef(1);
  const from = useRef(1);
  const startedAt = useRef(0);
  const raf = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);

  const animate = useCallback(() => {
    const step = () => {
      const t = Math.min((Date.now() - startedAt.current) / FADE_MS, 1);
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

  const flip = useCallback(
    (polarity: number) => {
      from.current = current.current;
      target.current = polarity;
      startedAt.current = Date.now();
      animate();
    },
    [animate],
  );
  // The block's state is created once, while the callback is rebuilt on every render — so what
  // goes into the state is a reference to it, not the callback itself.
  const flipRef = useRef(flip);
  flipRef.current = flip;

  const state = useRef<GroupState | null>(null);
  if (state.current === null) {
    // The core still computes the block's lightness plane, but nothing reads it anymore: each
    // lens estimates its own ambient now. What's left here is ink polarity.
    state.current = createGroupState({
      plane: () => {},
      flip: (polarity) => flipRef.current(polarity),
    });
  }
  const group = state.current;

  const api = useMemo<GroupApi>(
    () => ({ report: group.report, release: group.release, ink }),
    [group, ink],
  );

  return <GlassGroupContext.Provider value={api}>{children}</GlassGroupContext.Provider>;
}

/** Inside a group, a surface hands it a measurement and gets back the shared estimate. Outside a
 *  group — null. */
export function useGlassGroup(): GroupApi | null {
  return useContext(GlassGroupContext);
}
