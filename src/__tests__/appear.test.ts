import { describe, expect, it } from 'vitest';
import { applyAppear } from '../appear';
import { MATERIAL_PRESETS, resolveOptics } from '../material';

// 219 @2:55: "Instead of fading, Liquid Glass objects materialize in and out by gradually
// modulating the light bending and lensing, ensuring a graceful transition that preserves the
// optical integrity of the material."
describe('materialising, not fading (docs/reference.md §1)', () => {
  const base = resolveOptics({ ...MATERIAL_PRESETS.glass, dimming: 0.2 });

  it('is the material untouched once it is fully present', () => {
    expect(applyAppear(base, 1)).toEqual(base);
  });

  it('turns the lens down rather than turning the element transparent', () => {
    const half = applyAppear(base, 0.5);
    expect(half.refraction).toBeCloseTo(base.refraction * 0.5, 10);
    expect(half.blur).toBeCloseTo(base.blur * 0.5, 10);
    expect(half.bodyDensity).toBeCloseTo(base.bodyDensity * 0.5, 10);
    expect(half.edgeLight).toBeCloseTo(base.edgeLight * 0.5, 10);
  });

  it('leaves an absent element indistinguishable from the backdrop', () => {
    const none = applyAppear(base, 0);
    expect(none.refraction).toBe(0);
    expect(none.blur).toBe(0);
    expect(none.bodyDensity).toBe(0);
    expect(none.dimming).toBe(0);
  });

  it('does not touch the shape, only the optics', () => {
    const half = applyAppear(base, 0.5);
    // Geometry-derived values stay put: an arriving element is not a smaller one.
    expect(half.bevelDp).toBe(base.bevelDp);
    expect(half.ior).toBe(base.ior);
  });

  it('clamps rather than inverting past the ends', () => {
    expect(applyAppear(base, -1).refraction).toBe(0);
    expect(applyAppear(base, 5)).toEqual(base);
  });
});
