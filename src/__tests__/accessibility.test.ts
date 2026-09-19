import { describe, expect, it } from 'vitest';
import { applyAccessibility, contrastRimLuma, elasticAllowed, NO_ACCESSIBILITY } from '../accessibility';
import { contrastRimCss } from '../dom/rim';
import { BODY } from '../law';
import { createDeform } from '../touch-response';
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

// 219 @18:29: "Increased contrast, makes elements predominantly black or white and highlights them
// with a contrasting border."
describe('the contrasting border (docs/reference.md §9)', () => {
  it('sits on the far side of the body from its own pole', () => {
    expect(contrastRimLuma(BODY.tintDark)).toBeGreaterThan(0.5);
    expect(contrastRimLuma(BODY.tintLight)).toBeLessThan(0.5);
  });

  it('stays inside the range the body itself uses', () => {
    for (const luma of [0, 0.2, 0.5, 0.8, 1]) {
      const rim = contrastRimLuma(luma);
      expect(rim).toBeGreaterThanOrEqual(BODY.tintDark);
      expect(rim).toBeLessThanOrEqual(BODY.tintLight);
    }
  });

  it('is a flat ring, not the two arcs of a reflection', () => {
    // The ordinary rim reports where the key light is and falls back to a dim dark line facing
    // away from it. A border that vanishes on one side does not separate anything.
    const css = contrastRimCss(BODY.tintDark, contrastRimLuma(BODY.tintDark));
    const colours = new Set(css.match(/rgb\([^)]*\)/g) ?? []);
    expect(colours.size).toBe(1);
    expect(css).not.toContain('rgba');
  });
});

// 219 @18:35: "Reduced Motion decreases the intensity of some effects and disables any elastic
// properties for the material."
describe('reduced motion (docs/reference.md §9)', () => {
  it('reads as no elastic properties, not as no response', () => {
    expect(elasticAllowed(NO_ACCESSIBILITY)).toBe(true);
    expect(elasticAllowed({ ...NO_ACCESSIBILITY, reduceMotion: true })).toBe(false);
  });

  it('turns off the spring and the ripple', () => {
    const still = createDeform({ elastic: false });
    still.grab(10, 0, 4);
    still.drag(40, 0, 20);
    still.step(0.1);
    const s = still.sample();
    expect(s.pullX).toBe(0);
    expect(s.pullY).toBe(0);
    expect(s.waveAmp).toBe(0);
  });

  it('keeps the press that lights the element, at reduced intensity', () => {
    const still = createDeform({ elastic: false });
    const moving = createDeform();
    still.grab(0, 0, 4);
    moving.grab(0, 0, 4);
    for (let i = 0; i < 40; i += 1) {
      still.step(1 / 60);
      moving.step(1 / 60);
    }
    expect(still.sample().press).toBeGreaterThan(0);
    expect(still.sample().press).toBeLessThan(moving.sample().press);
  });

  it('settles rather than latching, so a release still ends the interaction', () => {
    const still = createDeform({ elastic: false });
    still.grab(5, 5, 4);
    still.step(1 / 60);
    expect(still.idle()).toBe(false);
    still.release(2);
    for (let i = 0; i < 120; i += 1) still.step(1 / 60);
    expect(still.idle()).toBe(true);
  });

  it('stops a deformation already in flight when the setting comes on mid-gesture', () => {
    const d = createDeform();
    d.grab(10, 0, 4);
    d.drag(30, 0, 20);
    for (let i = 0; i < 10; i += 1) d.step(1 / 60);
    expect(Math.abs(d.sample().pullX)).toBeGreaterThan(0.5);
    d.setElastic(false);
    expect(d.sample().pullX).toBe(0);
    expect(d.sample().waveAmp).toBe(0);
  });
});
