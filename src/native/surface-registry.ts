import { useEffect } from 'react';

/**
 * Budget of simultaneous glass surfaces.
 *
 * Measured on the reference device (Xiaomi 2311DRK48G, Android 16, release, 120 Hz — an 8.33 ms
 * frame budget): about 0.8 ms of GPU per surface, growing linearly with no threshold — 4 ms at
 * one, 5 at two, 7 at three, 8 at six. Six is where the budget runs out, not where a measured
 * cliff is: the saturation point was never found, because the lab scene lays surfaces out in a
 * column and at six they already hit the screen edge.
 *
 * The cost also depends on the scene, not just the count: the same six surfaces over a patterned
 * canvas with motion cost 20 ms. One, two and three agree across runs.
 *
 * See docs/benchmarks.md. Anything measured before 2026-08-31 is void — the capture node had no
 * bounds and the lens was sampling emptiness.
 */
export const GLASS_GREEN_MAX = 6;

/**
 * Counter of live glass surfaces — dev only.
 *
 * A consuming app's own test can guard its **declared** budget model; this counter guards the
 * **actual** one and catches drift between the two: a new screen, one panel too many, a
 * suppression under a sheet that got forgotten.
 */
let live = 0;
let peak = 0;

export function useGlassSurfaceRegistration(active: boolean): void {
  useEffect(() => {
    if (!__DEV__ || !active) return;
    live += 1;
    if (live > peak) peak = live;
    if (live > GLASS_GREEN_MAX) {
      console.warn(
        `[vireglass] simultaneous surfaces with a live backdrop: ${live} — past the measured ` +
          `green zone (${GLASS_GREEN_MAX}), where the frame budget is already spent. Beyond it ` +
          `nothing is measured.`,
      );
    }
    return () => {
      live -= 1;
    };
  }, [active]);
}

/** For manual diagnostics from the lab and from logs. */
export function glassSurfaceStats(): { live: number; peak: number } {
  return { live, peak };
}
