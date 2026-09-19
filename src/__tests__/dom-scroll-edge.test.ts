import { describe, expect, it } from 'vitest';
import { SCROLL_EDGE_ENGAGE_DP, scrollEdgeStrength, scrollEdgeStyle } from '../scroll-edge';

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
