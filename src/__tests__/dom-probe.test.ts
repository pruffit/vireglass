import { describe, expect, it } from 'vitest';
import { compositeLayers, parseColor, statsFromSamples, type RgbColor } from '../dom/probe';

describe('parseColor', () => {
  it('parses rgb()', () => {
    expect(parseColor('rgb(255, 0, 128)')).toEqual({ r: 255, g: 0, b: 128, a: 1 });
  });

  it('parses rgba() with alpha', () => {
    expect(parseColor('rgba(10, 20, 30, 0.5)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
  });

  it('returns null for a malformed string', () => {
    expect(parseColor('not-a-color')).toBeNull();
    expect(parseColor('')).toBeNull();
    expect(parseColor('rgb(1, 2)')).toBeNull();
  });
});

describe('statsFromSamples', () => {
  const gray = (v: number): RgbColor => ({ r: v, g: v, b: v, a: 1 });

  it('reads near-zero busy on a flat backdrop', () => {
    const flat = Array.from({ length: 9 }, () => gray(128));
    const stats = statsFromSamples(flat);
    expect(stats.busy).toBeCloseTo(0, 6);
    expect(stats.lo).toBeCloseTo(stats.hi, 6);
    expect(stats.luma).toBeCloseTo(128 / 255, 3);
  });

  it('reads high busy and separated percentiles on a half-black, half-white backdrop', () => {
    const halves = [gray(0), gray(0), gray(0), gray(0), gray(255), gray(255), gray(255), gray(255)];
    const stats = statsFromSamples(halves);
    expect(stats.busy).toBeGreaterThan(0.8);
    expect(stats.hi - stats.lo).toBeGreaterThan(0.8);
    expect(stats.lo).toBeLessThan(stats.hi);
  });

  it('returns a neutral sample for an empty grid rather than dividing by zero', () => {
    const stats = statsFromSamples([]);
    expect(stats.busy).toBe(0);
    expect(Number.isFinite(stats.luma)).toBe(true);
  });

  it('averages r/g/b on the same 0..1 scale as luma', () => {
    const stats = statsFromSamples([{ r: 255, g: 0, b: 0, a: 1 }]);
    expect(stats.r).toBeCloseTo(1, 6);
    expect(stats.g).toBeCloseTo(0, 6);
    expect(stats.b).toBeCloseTo(0, 6);
  });
});

// A translucent list row over a near-black page used to be read as pure white, because the walk
// returned the first layer with any alpha at all. The glass then adapted to a backdrop that was
// not there: dark ink over a dark page, and the label vanished.
describe('compositing the stack', () => {
  const black = { r: 17, g: 20, b: 28, a: 1 };

  it('a barely-there overlay barely moves the result', () => {
    const out = compositeLayers([{ r: 255, g: 255, b: 255, a: 0.028 }, black]);
    expect(out).not.toBeNull();
    expect(out!.r).toBeLessThan(30);
  });

  it('an opaque layer hides everything beneath it', () => {
    const out = compositeLayers([{ r: 240, g: 240, b: 240, a: 1 }, black]);
    expect(out!.r).toBeCloseTo(240, 5);
  });

  it('a half-transparent white over black lands between them', () => {
    const out = compositeLayers([{ r: 255, g: 255, b: 255, a: 0.5 }, { r: 0, g: 0, b: 0, a: 1 }]);
    expect(out!.r).toBeCloseTo(127.5, 1);
  });

  it('nothing but transparency yields nothing', () => {
    expect(compositeLayers([{ r: 255, g: 255, b: 255, a: 0 }])).toBeNull();
    expect(compositeLayers([])).toBeNull();
  });
});

// Reported from an integration: a widget pinned past the end of the body's box read a white page
// as black, and the material dressed itself for a dark backdrop over a light one.
describe('the page floor (docs/reference.md §3)', () => {
  it('composites a translucent page background over white, not over nothing', () => {
    const over = compositeLayers([{ r: 0, g: 0, b: 0, a: 0.1 }, { r: 255, g: 255, b: 255, a: 1 }]);
    expect(over).not.toBeNull();
    expect(over!.r).toBeCloseTo(229.5, 0);
    expect(over!.a).toBeCloseTo(1, 6);
  });

  it('reports nothing for a stack that is entirely transparent', () => {
    // `compositeLayers` itself must stay honest — the floor is applied by its caller, which knows
    // which document it is looking at.
    expect(compositeLayers([{ r: 0, g: 0, b: 0, a: 0 }])).toBeNull();
    expect(compositeLayers([])).toBeNull();
  });
});
