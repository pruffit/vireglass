import { describe, expect, it } from 'vitest';
import { applyAccessibility, NO_ACCESSIBILITY } from '../accessibility';
import { resolveOptics, VIREGLASS_CLEAR_MATERIAL } from '../material';

const optics = resolveOptics();

describe('accessibility modifiers', () => {
  it('optics stay unchanged with no settings', () => {
    expect(applyAccessibility(optics, NO_ACCESSIBILITY)).toEqual(optics);
    expect(applyAccessibility(optics)).toEqual(optics);
  });

  // Motion isn't optics: it's computed by whoever draws it.
  it('reduced motion does not touch optics', () => {
    expect(applyAccessibility(optics, { ...NO_ACCESSIBILITY, reduceMotion: true })).toEqual(optics);
  });

  it('reduced transparency makes the glass more frosted and duller', () => {
    const out = applyAccessibility(optics, { ...NO_ACCESSIBILITY, reduceTransparency: true });
    expect(out.blur).toBeGreaterThan(optics.blur);
    expect(out.bodyDensity).toBeGreaterThan(optics.bodyDensity);
  });

  it('increased contrast holds the element with a border, not a fill alone', () => {
    const out = applyAccessibility(optics, { ...NO_ACCESSIBILITY, increaseContrast: true });
    expect(out.presence).toBeGreaterThan(optics.presence);
    expect(out.bodyDensity).toBeGreaterThan(optics.bodyDensity);
    expect(out.legibility).toBe(1);
  });

  // The reference applies settings to all glass: a material variant doesn't override them.
  it('contrast outranks the transparent variant', () => {
    const clear = resolveOptics(VIREGLASS_CLEAR_MATERIAL);
    const out = applyAccessibility(clear, { ...NO_ACCESSIBILITY, increaseContrast: true });
    expect(out.legibility).toBe(1);
    expect(out.presence).toBeGreaterThanOrEqual(0.5);
    expect(out.bodyDensity).toBeGreaterThanOrEqual(0.9);
  });

  // Settings stack: with both enabled, the material must satisfy both requirements.
  it('settings do not cancel each other out', () => {
    const both = applyAccessibility(optics, {
      reduceTransparency: true,
      increaseContrast: true,
      reduceMotion: true,
    });
    expect(both.blur).toBeGreaterThan(optics.blur);
    expect(both.presence).toBeGreaterThan(optics.presence);
  });
});
