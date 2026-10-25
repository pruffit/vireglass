import { describe, expect, it } from 'vitest';
import { createLru, filterSignature, mapKeyFor, quantise, snapGeometry } from '../dom/interim';
import { resolveOptics } from '../material';
import { MATERIAL_PRESETS } from '../index';
import { bump, renderStats, resetRenderStats } from '../dom/stats';

describe('map keys', () => {
  const optics = resolveOptics(MATERIAL_PRESETS.glass);
  const key = (w: number, h: number, r: number, morph = 'm', dpr = 2, o = optics) => mapKeyFor(snapGeometry({ width: w, height: h, cornerRadius: r }), morph, o, dpr);

  it('snaps geometry to half a pixel, the same for every path', () => {
    expect(quantise(100.4)).toBe(100);
    expect(quantise(101.2)).toBe(102);
    expect(snapGeometry({ width: 100.2, height: 50.3, cornerRadius: 12.1 })).toEqual({ width: 100, height: 50.5, cornerRadius: 12 });
    expect(key(100.1, 50.9, 12)).toBe(key(99.9, 51.1, 12.2));
    expect(key(100, 50, 12)).not.toBe(key(101, 50, 12));
  });

  it('separates morphs, densities and the optics the pixels depend on, and not the rest', () => {
    expect(key(100, 50, 12, 'a')).not.toBe(key(100, 50, 12, 'b'));
    expect(key(100, 50, 12, 'm', 1)).not.toBe(key(100, 50, 12, 'm', 2));
    expect(key(100, 50, 12, 'm', 2, { ...optics, bevelDp: optics.bevelDp + 1 })).not.toBe(key(100, 50, 12));
    expect(key(100, 50, 12, 'm', 2, { ...optics, diffraction: optics.diffraction + 0.1 })).not.toBe(key(100, 50, 12));
    expect(key(100, 50, 12, 'm', 2, { ...optics, blur: optics.blur + 3, ior: optics.ior + 0.1 })).toBe(key(100, 50, 12));
  });

  it('tells filter structures apart by dispersion and hue being on or off, and by nothing else', () => {
    expect(filterSignature(0.1, true)).toBe(filterSignature(0.4, true));
    expect(filterSignature(0.1, true)).not.toBe(filterSignature(0.1, false));
    expect(filterSignature(0.1, false)).not.toBe(filterSignature(0, false));
    expect(filterSignature(0, false)).toBe(filterSignature(1e-6, false));
  });
});

describe('the interim store', () => {
  it('evicts the least recently used', () => {
    const lru = createLru<number>(2);
    lru.set('a', 1);
    lru.set('b', 2);
    lru.get('a');
    lru.set('c', 3);
    expect(lru.get('b')).toBeUndefined();
    expect(lru.get('a')).toBe(1);
    expect(lru.size).toBe(2);
  });

  it('hands an evicted or cleared value to the hook', () => {
    const gone: number[] = [];
    const lru = createLru<number>(2, (v) => gone.push(v));
    lru.set('a', 1);
    lru.set('b', 2);
    lru.set('c', 3);
    expect(gone).toEqual([1]);
    lru.clear();
    expect(gone).toEqual([1, 2, 3]);
    expect(lru.size).toBe(0);
  });
});

describe('deleting from the store', () => {
  it('removes a value only when it is the one stored under the key', () => {
    const gone: string[] = [];
    const lru = createLru<string>(4, (v) => gone.push(v));
    lru.set('k', 'old');
    lru.set('k', 'new');
    lru.delete('k', 'old');
    expect(lru.get('k')).toBe('new');
    expect(gone).toEqual(['old']);
    lru.delete('k', 'new');
    expect(lru.get('k')).toBeUndefined();
    expect(gone).toEqual(['old', 'new']);
  });
});

describe('render counters', () => {
  it('count and reset', () => {
    resetRenderStats();
    bump('probes');
    bump('probes');
    bump('filterSwaps');
    expect(renderStats()).toEqual({ probes: 2, fullBakes: 0, reducedBakes: 0, mainThreadBakes: 0, workerBakes: 0, filterSwaps: 1, landedExact: 0, landedBlend: 0, probesAtLand: 0, syncSwaps: 0 });
    resetRenderStats();
    expect(renderStats().probes).toBe(0);
  });
});
