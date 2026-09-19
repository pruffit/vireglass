import { describe, expect, it } from 'vitest';
import { SCROLL_EDGE_ENGAGE_DP, scrollEdgeStrength, scrollEdgeStyle } from '../scroll-edge';

describe('scroll edge effect', () => {
  // Reference 219 @9:28: dark glass gets a light dimming, light glass dissolves into the background.
  it('style follows the glass style', () => {
    expect(scrollEdgeStyle(true)).toBe('dim');
    expect(scrollEdgeStyle(false)).toBe('dissolve');
  });

  it('a pinned view under the panel gets a flat band', () => {
    expect(scrollEdgeStyle(true, true)).toBe('hard');
    expect(scrollEdgeStyle(false, true)).toBe('hard');
  });

  it('with no scroll, there is no effect at the top', () => {
    expect(scrollEdgeStrength('top', 0, 400)).toBe(0);
    expect(scrollEdgeStrength('top', SCROLL_EDGE_ENGAGE_DP, 400)).toBe(1);
  });

  it('at the bottom the effect holds for as long as content has room to scroll', () => {
    expect(scrollEdgeStrength('bottom', 0, 400)).toBe(1);
    expect(scrollEdgeStrength('bottom', 400, 400)).toBe(0);
  });
});
