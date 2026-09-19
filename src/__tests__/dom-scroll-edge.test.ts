import { describe, expect, it } from 'vitest';
import { SCROLL_EDGE_ENGAGE_DP, scrollEdgeStrength, scrollEdgeStyle } from '../scroll-edge';
import { paintFor } from '../dom/scroll-edge';

// The DOM binding needs a layout engine to exercise; what is testable without one is the law it
// binds — and that law is what decides whether the effect appears at all.
describe('scroll edge (docs/reference.md §10)', () => {
  it('is absent at the top of an unscrolled view', () => {
    // A mail screen at the top: the header sits on a clean background, nothing is under it yet.
    expect(scrollEdgeStrength('top', 0, 1000)).toBe(0);
  });

  it('engages over the reference distance and then stops growing', () => {
    expect(scrollEdgeStrength('top', SCROLL_EDGE_ENGAGE_DP / 2, 1000)).toBeCloseTo(0.5, 6);
    expect(scrollEdgeStrength('top', SCROLL_EDGE_ENGAGE_DP, 1000)).toBe(1);
    expect(scrollEdgeStrength('top', 5000, 1000)).toBe(1);
  });

  it('holds at the bottom for as long as there is room left to scroll', () => {
    expect(scrollEdgeStrength('bottom', 0, 1000)).toBe(1);
    expect(scrollEdgeStrength('bottom', 1000, 1000)).toBe(0);
  });

  it('follows the style of the nearest glass, and a pinned view overrides both', () => {
    expect(scrollEdgeStyle(true)).toBe('dim');
    expect(scrollEdgeStyle(false)).toBe('dissolve');
    expect(scrollEdgeStyle(true, true)).toBe('hard');
    expect(scrollEdgeStyle(false, true)).toBe('hard');
  });
});

// What the effect IS, which nothing tested — and so a black scrim lived here as the default style
// through every green run. 356 @11:32: "they don't block or darken like overlays. They simply
// clarify where UI and content meet."
describe('what the scroll edge paints (docs/reference.md §10)', () => {
  const alphas = (css: string) => [...css.matchAll(/rgba\([^)]*,\s*([\d.]+)\)/g)].map((m) => Number(m[1]));

  it('dissolves the content with a blur rather than covering it', () => {
    // 219 @9:16: "the effect gently dissolves the content into the background."
    const paint = paintFor('dissolve', 'top');
    expect(paint.filter).toMatch(/blur\(\d/);
    expect(paint.tone).toBe('none');
  });

  it('ramps rather than steps, so there is no visible line where it starts', () => {
    const paint = paintFor('dissolve', 'top');
    expect(paint.mask).toContain('linear-gradient');
    const stops = alphas(paint.mask);
    expect(Math.max(...stops)).toBe(1);
    expect(Math.min(...stops)).toBe(0);
  });

  it('runs toward the edge the panel sits at, not away from it', () => {
    expect(paintFor('dissolve', 'top').mask).toContain('to top');
    expect(paintFor('dissolve', 'bottom').mask).toContain('to bottom');
  });

  it('dims by darkening, which is what dimming is', () => {
    // 219 @9:33: over darker content the glass turns dark and the effect "switches to apply a
    // subtle dimming instead". This painted white — it lightened the content it was pushing down.
    const paint = paintFor('dim', 'top');
    const channels = /rgba\((\d+),\s*(\d+),\s*(\d+)/.exec(paint.tone);
    expect(channels).not.toBeNull();
    expect(Number(channels![1])).toBe(0);
    expect(Number(channels![2])).toBe(0);
    expect(Number(channels![3])).toBe(0);
    expect(Math.max(...alphas(paint.tone))).toBeGreaterThan(0);
  });

  it('still dissolves while it dims: the tone is on top of the blur, not instead of it', () => {
    expect(paintFor('dim', 'top').filter).toMatch(/blur\(\d/);
  });

  it('is a flat band when a view is pinned under the panel, with no ramp', () => {
    // 219 @9:41: "instead of a gradual fade" — the whole height at one strength.
    const paint = paintFor('hard', 'top');
    expect(paint.mask).toBe('');
    const stops = alphas(paint.tone);
    expect(new Set(stops).size).toBe(1);
    expect(stops[0]).toBeGreaterThan(0);
  });

  it('draws a stronger boundary when hard than when soft', () => {
    // 356 @12:12: hard "creates a stronger, more opaque boundary".
    const hard = Math.max(...alphas(paintFor('hard', 'top').tone));
    const soft = Math.max(...alphas(paintFor('dim', 'top').tone));
    expect(hard).toBeGreaterThan(soft);
  });
});
