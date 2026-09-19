import { afterEach, describe, expect, it } from 'vitest';
import { applyAccessibility, NO_ACCESSIBILITY } from '../accessibility';
import { applyGlassScale, GLASS_SCALE_DEFAULT } from '../glass-scale';
import { MATERIAL_PRESETS, resolveOptics } from '../material';
import { systemAccessibility, watchAccessibility } from '../dom/preferences';

const original = (globalThis as { matchMedia?: unknown }).matchMedia;

afterEach(() => {
  (globalThis as { matchMedia?: unknown }).matchMedia = original;
});

function stubMedia(on: string[]) {
  (globalThis as { matchMedia?: unknown }).matchMedia = (query: string) => ({
    matches: on.includes(query),
    addEventListener() {},
    removeEventListener() {},
  });
}

describe('system accessibility on the web (docs/reference.md §9)', () => {
  it('answers "nothing set" where there are no media queries at all', () => {
    (globalThis as { matchMedia?: unknown }).matchMedia = undefined;
    expect(systemAccessibility()).toEqual(NO_ACCESSIBILITY);
    // And watching must be a no-op rather than a crash, since the DOM entry is imported in SSR.
    expect(() => watchAccessibility(() => {})()).not.toThrow();
  });

  it('reads each of the three settings the reference names', () => {
    stubMedia(['(prefers-reduced-transparency: reduce)']);
    expect(systemAccessibility().reduceTransparency).toBe(true);
    expect(systemAccessibility().increaseContrast).toBe(false);

    stubMedia(['(prefers-contrast: more)', '(prefers-reduced-motion: reduce)']);
    expect(systemAccessibility()).toEqual({
      reduceTransparency: false,
      increaseContrast: true,
      reduceMotion: true,
    });
  });

  it('treats an engine that rejects an unknown query as "not set", not as a failure', () => {
    (globalThis as { matchMedia?: unknown }).matchMedia = (query: string) => {
      if (query.includes('contrast')) throw new SyntaxError('unknown feature');
      return { matches: true, addEventListener() {}, removeEventListener() {} };
    };
    expect(() => systemAccessibility()).not.toThrow();
    expect(systemAccessibility().increaseContrast).toBe(false);
    expect(systemAccessibility().reduceMotion).toBe(true);
  });
});

describe('the order the two preferences apply in (§3, §9)', () => {
  const base = resolveOptics(MATERIAL_PRESETS.glass);

  it('a system setting outranks the user\'s clarity, not the other way round', () => {
    // Ultra clear is as transparent as the user can ask for.
    const clear = applyGlassScale(base, 0);
    const clearThenContrast = applyAccessibility(clear, {
      ...NO_ACCESSIBILITY,
      increaseContrast: true,
    });
    // Contrast has to survive the request for clarity: the user needs contrast more than the look.
    expect(clearThenContrast.presence).toBeGreaterThan(clear.presence);
    expect(clearThenContrast.bodyDensity).toBeGreaterThan(clear.bodyDensity);
  });

  it('leaves optics untouched at the default point with nothing set', () => {
    const through = applyAccessibility(applyGlassScale(base, GLASS_SCALE_DEFAULT), NO_ACCESSIBILITY);
    expect(through).toEqual(base);
  });

  it('reduced transparency frosts the glass whatever the user asked for', () => {
    const clear = applyGlassScale(base, 0);
    const frosted = applyAccessibility(clear, { ...NO_ACCESSIBILITY, reduceTransparency: true });
    expect(frosted.blur).toBeGreaterThan(clear.blur);
    expect(frosted.bodyDensity).toBeGreaterThan(clear.bodyDensity);
  });
});
