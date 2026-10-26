import type { BackdropSample } from '../adaptation';
import type { VireGlassGeometry } from '../geometry';
import type { VireGlassOptics } from '../material';

/** Geometry snapped to a grid, so a morph that moves by a fraction of a pixel reuses a map. */
export function quantise(value: number, step = 2): number {
  return Math.round(value / step) * step;
}

/** The box a map is baked for: the measured one on a half-pixel grid, so interim and settled maps of one box are one map. */
export function snapGeometry(g: VireGlassGeometry): VireGlassGeometry {
  return {
    width: quantise(g.width, 0.5),
    height: quantise(g.height, 0.5),
    cornerRadius: quantise(g.cornerRadius, 0.5),
  };
}

/** What the pixels of a displacement map and of a hue map are functions of, besides the box and the morph. */
export type MapOptics = Pick<VireGlassOptics, 'refraction' | 'thicknessDp' | 'bevelDp' | 'film' | 'iridescence' | 'diffraction'>;

/**
 * The key of a pair of maps: interim and settled maps are built from the same box (snapped), morph, optics and
 * density, so the same key is the same bytes whichever path made them.
 */
export function mapKeyFor(snapped: VireGlassGeometry, morph: string, o: MapOptics, dpr: number): string {
  const { width, height, cornerRadius } = snapped;
  return `${width}x${height}r${cornerRadius}@${dpr}|${morph}|${o.refraction}:${o.thicknessDp}:${o.bevelDp}:${o.film}:${o.iridescence}:${o.diffraction}`;
}

/**
 * What a filter's structure depends on: dispersion on or off, and the hue on or off. Blur, the ior ratios and the
 * hue's weights are attributes, rewritten in place, so a filter with the same signature takes any material.
 */
export function filterSignature(iorSpread: number, hasHue: boolean): string {
  return `${iorSpread > 1e-4 ? 'd' : '-'}${hasHue ? 'h' : '-'}`;
}

/** A landing is stale when the lens is now at another key, or at the same key with another material: the live one is landed. */
export const landingDiffers = (p: { key: string; print: string }, d: { key: string; print: string }): boolean =>
  p.key !== d.key || p.print !== d.print;

/** Whether a backdrop moved enough for the body to be worth easing to, rather than a probe's noise. */
export function sampleMoved(a: BackdropSample, b: BackdropSample): boolean {
  return (
    Math.abs(a.luma - b.luma) > 0.02 ||
    Math.abs(a.r - b.r) > 0.02 ||
    Math.abs(a.g - b.g) > 0.02 ||
    Math.abs(a.b - b.b) > 0.02 ||
    Math.abs(a.busy - b.busy) > 0.05
  );
}

/** A small least-recently-used store, so a long morph cannot evict the resting maps. */
export function createLru<T>(limit: number, onEvict?: (value: T) => void) {
  const store = new Map<string, T>();
  return {
    get(key: string): T | undefined {
      const hit = store.get(key);
      if (hit === undefined) return undefined;
      store.delete(key);
      store.set(key, hit);
      return hit;
    },
    set(key: string, value: T): void {
      const old = store.get(key);
      store.delete(key);
      if (old !== undefined && old !== value) onEvict?.(old);
      store.set(key, value);
      if (store.size > limit) {
        const oldest = store.entries().next();
        if (!oldest.done) {
          store.delete(oldest.value[0]);
          onEvict?.(oldest.value[1]);
        }
      }
    },
    delete(key: string, only?: T): void {
      const old = store.get(key);
      if (old === undefined || (only !== undefined && old !== only)) return;
      store.delete(key);
      onEvict?.(old);
    },
    clear(): void {
      const all = [...store.values()];
      store.clear();
      for (const value of all) onEvict?.(value);
    },
    get size(): number {
      return store.size;
    },
  };
}
