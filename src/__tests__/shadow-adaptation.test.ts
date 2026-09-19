import { describe, expect, it } from 'vitest';
import { shadowOpacity, shadowOpacityFrom } from '../geometry';

describe('shadow density by content under the element', () => {
  // 219 @11:47: over a flat light backdrop the shadow is WEAKER, over text it's DENSER.
  it('the shadow is weakest over a flat backdrop', () => {
    expect(shadowOpacity(0)).toBeCloseTo(0.8, 6);
    expect(shadowOpacity(-1)).toBe(shadowOpacity(0));
  });

  it('variegation under the element raises the shadow', () => {
    let prev = -Infinity;
    for (const busy of [0, 0.02, 0.05, 0.1, 0.2, 0.5, 1]) {
      const k = shadowOpacity(busy);
      expect(k).toBeGreaterThanOrEqual(prev);
      prev = k;
    }
    expect(shadowOpacity(0.3)).toBeGreaterThan(shadowOpacity(0));
  });

  // A ceiling is needed: without it, right at a black/white border the shadow would go into a
  // black hole.
  it('growth hits a ceiling', () => {
    expect(shadowOpacity(0.2)).toBeCloseTo(2, 6);
    expect(shadowOpacity(1)).toBeCloseTo(2, 6);
  });

  // Quantization is only for platforms where the measurement flows through state; the law is the same.
  it('the quantized version never drifts from the exact one by more than a step', () => {
    for (const busy of [0, 0.03, 0.07, 0.11, 0.19, 0.4]) {
      expect(Math.abs(shadowOpacityFrom({ busy }) - shadowOpacity(busy))).toBeLessThanOrEqual(0.025);
    }
  });
});
