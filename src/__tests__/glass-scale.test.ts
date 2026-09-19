import { describe, expect, it } from 'vitest';
import { applyAccessibility, NO_ACCESSIBILITY } from '../accessibility';
import { applyGlassScale, GLASS_SCALE_DEFAULT } from '../glass-scale';
import { resolveOptics, VIREGLASS_CLEAR_MATERIAL, VIREGLASS_MATERIAL } from '../material';

const base = resolveOptics(VIREGLASS_MATERIAL);

describe('user-facing transparency scale', () => {
  // The scale's main promise: its existence doesn't move anything until the user moves it.
  it('at the default point optics do not change at all', () => {
    expect(applyGlassScale(base, GLASS_SCALE_DEFAULT)).toEqual(base);
    const clear = resolveOptics(VIREGLASS_CLEAR_MATERIAL);
    expect(applyGlassScale(clear, GLASS_SCALE_DEFAULT)).toEqual(clear);
  });

  it('toward the transparent end, the legibility requirement and dimming are relaxed', () => {
    const ultra = applyGlassScale(base, 0);
    expect(ultra.legibility).toBe(0);
    expect(applyGlassScale(resolveOptics(VIREGLASS_CLEAR_MATERIAL), 0).dimming).toBe(0);
  });

  it('toward the tinted end, the body hides the content', () => {
    expect(applyGlassScale(base, 1).bodyDensity).toBeGreaterThan(0.8);
  });

  it('the curve is monotonic across the whole scale', () => {
    let prevLeg = -Infinity;
    let prevBody = -Infinity;
    for (let s = 0; s <= 1.0001; s += 0.05) {
      const o = applyGlassScale(base, s);
      expect(o.legibility).toBeGreaterThanOrEqual(prevLeg);
      expect(o.bodyDensity).toBeGreaterThanOrEqual(prevBody);
      prevLeg = o.legibility;
      prevBody = o.bodyDensity;
    }
  });

  it('does not go past the ends of the scale', () => {
    expect(applyGlassScale(base, -3)).toEqual(applyGlassScale(base, 0));
    expect(applyGlassScale(base, 7)).toEqual(applyGlassScale(base, 1));
  });

  // Reference: system settings outrank both the material variant and the user's chosen clarity.
  it('accessibility on top of the scale restores legibility', () => {
    const ultra = applyGlassScale(base, 0);
    const out = applyAccessibility(ultra, { ...NO_ACCESSIBILITY, increaseContrast: true });
    expect(out.legibility).toBe(1);
    expect(out.bodyDensity).toBeGreaterThanOrEqual(0.9);
  });
});
