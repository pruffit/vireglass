import { describe, expect, it } from 'vitest';
import { applyAccessibility, NO_ACCESSIBILITY } from '../accessibility';
import { applyGlassScale, GLASS_SCALE_DEFAULT } from '../glass-scale';
import { MATERIAL_PRESETS, resolveOptics } from '../material';

// `useResolvedOptics` needs React to exercise and this suite runs under plain Node, so what is
// pinned here is the CHAIN it applies. The order is the thing worth pinning: the web renderer and
// the native surface have to agree, or the same material looks different on two platforms for a
// reason no measurement would ever explain.
describe('the order optics resolve in, shared by every renderer (§3, §9)', () => {
  const base = resolveOptics(MATERIAL_PRESETS.glass);
  const chain = (scale: number, mods = NO_ACCESSIBILITY) =>
    applyAccessibility(applyGlassScale(base, scale), mods);

  it('leaves the material alone at the default point with nothing set', () => {
    expect(chain(GLASS_SCALE_DEFAULT)).toEqual(base);
  });

  // The two halves of the scale move different things, which is the point: toward clear it
  // RELAXES what the material demands, toward tinted it ADDS medium. Reducing density toward clear
  // would be a different material, not a clearer one.
  it('relaxes the demands toward clear and adds medium toward tinted', () => {
    expect(chain(0).legibility).toBeLessThan(base.legibility);
    expect(chain(1).bodyDensity).toBeGreaterThan(base.bodyDensity);

    // Dimming is the Clear variant's own darkening layer and is zero on Regular glass, so it only
    // has anything to relax where the material actually has one.
    const clearVariant = resolveOptics({ ...MATERIAL_PRESETS.glass, dimming: 0.35 });
    expect(clearVariant.dimming).toBeGreaterThan(0);
    expect(applyGlassScale(clearVariant, 0).dimming).toBeLessThan(clearVariant.dimming);
  });

  it('a system setting outranks the clarity the user asked for, not the reverse', () => {
    const clear = chain(0);
    const underContrast = chain(0, { ...NO_ACCESSIBILITY, increaseContrast: true });
    // Contrast holds the element by its silhouette, and clarity must not talk it out of that.
    expect(underContrast.presence).toBeGreaterThan(clear.presence);
    expect(underContrast.bodyDensity).toBeGreaterThan(clear.bodyDensity);

    // Reversed, the scale runs last and strips the legibility contrast had just raised — which is
    // exactly the failure this order exists to prevent.
    const scaleLast = applyGlassScale(
      applyAccessibility(base, { ...NO_ACCESSIBILITY, increaseContrast: true }),
      0,
    );
    expect(scaleLast.legibility).toBeLessThan(underContrast.legibility);
  });
});
