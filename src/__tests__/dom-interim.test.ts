import { describe, expect, it } from 'vitest';
import { createLru, filterSignature, interimKey, quantise } from '../dom/interim';
import { bump, renderStats, resetRenderStats } from '../dom/stats';

describe('interim keys', () => {
  it('snaps geometry to 2 px', () => {
    expect(quantise(100.4)).toBe(100);
    expect(quantise(101.2)).toBe(102);
    expect(interimKey(100.4, 50.9, 12, 'm', 'x')).toBe(interimKey(99.6, 50.4, 12.4, 'm', 'x'));
    expect(interimKey(100, 50, 12, 'm', 'x')).not.toBe(interimKey(104, 50, 12, 'm', 'x'));
  });

  it('separates morphs', () => {
    expect(interimKey(100, 50, 12, 'a', 'x')).not.toBe(interimKey(100, 50, 12, 'b', 'x'));
  });

  it('tells filter structures apart', () => {
    expect(filterSignature(2, 1.5, 0.1, true)).toBe(filterSignature(2, 1.5, 0.1, true));
    expect(filterSignature(2, 1.5, 0.1, true)).not.toBe(filterSignature(2, 1.5, 0.1, false));
    expect(filterSignature(2, 1.5, 0, false)).toBe(filterSignature(2, 1.5, 1e-6, false));
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

describe('render counters', () => {
  it('count and reset', () => {
    resetRenderStats();
    bump('probes');
    bump('probes');
    bump('filterSwaps');
    expect(renderStats()).toEqual({ probes: 2, fullBakes: 0, reducedBakes: 0, filterSwaps: 1 });
    resetRenderStats();
    expect(renderStats().probes).toBe(0);
  });
});
