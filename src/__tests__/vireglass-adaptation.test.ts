import { describe, expect, it } from 'vitest';
import {
  ambientFrom,
  FLIP_LUMA,
  INK_DARK,
  INK_LIGHT,
  RETURN_LUMA,
  shouldInkBeLight,
} from '../adaptation';
import { LENS_SHADER } from '../lens-shader';
import { SURFACE_SHADER } from '../surface-shader';
import { colorPickup, diffraction, dispersion, iridescence } from '../optics';
import { resolveOptics } from '../material';

describe('spectral optics', () => {
  it('with no film there is no interference at all', () => {
    expect(iridescence(1.5, 0)).toBe(0);
    expect(iridescence(1.5, 400)).toBeGreaterThan(0);
  });

  it('iridescence is brighter for a denser medium — it lives in the reflection', () => {
    expect(iridescence(1.7, 400)).toBeGreaterThan(iridescence(1.2, 400));
  });

  it('diffraction and dispersion grow together: they share one cause', () => {
    expect(diffraction(1.7)).toBeGreaterThan(diffraction(1.3));
    expect(diffraction(1.7)).toBeLessThan(dispersion(1.7));
  });

  it('color pickup is capped from above — the tint must stay a medium, not a fill', () => {
    expect(colorPickup(2)).toBeLessThanOrEqual(0.42);
    expect(colorPickup(1)).toBe(0);
  });

  it('the product default carries a film, and therefore iridescence', () => {
    const o = resolveOptics();
    expect(o.film).toBeGreaterThan(0);
    expect(o.iridescence).toBeGreaterThan(0);
  });
});

describe('the glass body in the shader', () => {
  // Both lines that touch body lightness must be uniform across the whole element. While the
  // highlight went through a mix(0.35, 1.0, t) multiplier, the middle glowed a third as strongly
  // as the rim — and it read as a differently-toned patch at the center of the glass.
  it('body highlighting does not depend on the spot on the element', () => {
    expect(LENS_SHADER).toContain('rgb = mix(rgb, vgHue(ambient) * VG_MEDIUM_LUMA, VG_MEDIUM_PULL * u_appear);');
    expect(LENS_SHADER).toContain('rgb += ambient * u_edgeLight * VG_AMBIENT_SPILL * u_appear;');
  });

  // Scattering REPLACES rgb wholesale (its weight reaches one), so anything laid down before it
  // is lost. Doing it in the opposite order erased the reflection of the surroundings across the
  // whole element and the gate didn't catch it: the thresholds had enough slack to cover the
  // difference (issue #106).
  // "backdrop" mode is the only point where you can see WHAT REACHED the shader, separately from
  // how it was processed. Layers not tied to the lens (body, medium, scattering) used to survive
  // into it and conflate the two questions into one: the element was visible even with a perfect
  // capture (issue #112).
  it('"backdrop" mode hands back the content with not a single layer on top', () => {
    const bypass = LENS_SHADER.indexOf('if (u_debug > 5.5 && u_debug < 6.5) {');
    const medium = LENS_SHADER.indexOf('rgb = mix(rgb, vgHue(ambient) * VG_MEDIUM_LUMA');
    const scatter = LENS_SHADER.indexOf('rgb = mix(rgb, blurred, smoothstep(0.5, 2.0, adaptBlur));');
    expect(bypass).toBeGreaterThan(-1);
    expect(bypass).toBeLessThan(scatter);
    expect(bypass).toBeLessThan(medium);
  });

  it('reflection is applied AFTER scattering', () => {
    const scatter = LENS_SHADER.indexOf('rgb = mix(rgb, blurred, smoothstep(0.5, 2.0, adaptBlur));');
    const reflection = LENS_SHADER.indexOf('rgb = mix(rgb, env * spectral, fres);');
    expect(scatter).toBeGreaterThan(-1);
    expect(reflection).toBeGreaterThan(-1);
    expect(reflection).toBeGreaterThan(scatter);
  });

  // The shadow must be WEAKER right at the outline than further below it: in the reference the
  // minimum sits 17…25 px below the rim. Terms that are monotonic in distance from the silhouette
  // can't produce that profile, and the gate doesn't catch a regression here — reverting to
  // contact-only darkening even makes both of its metrics go UP (object 7.1 → 9.7, magnification
  // 1.90 → 1.92).
  it('the shadow at the outline is weakened by the gap', () => {
    expect(SURFACE_SHADER).toContain('mix(VG_GAP_LIGHT, 1.0, gap)');
    expect(SURFACE_SHADER).not.toContain('con * con');
  });
});

describe('the limit of the glass and polarity', () => {
  // Rule from the reference (docs/reference.md §3): over a yellow flower the glyphs are already
  // black, and the glass is light.
  it('over a light color the ink flips to dark', () => {
    expect(shouldInkBeLight({ luma: 0.78 }, true)).toBe(false);
    expect(shouldInkBeLight({ luma: 0.95 }, true)).toBe(false);
  });

  it('over a saturated or dark backdrop the ink stays light', () => {
    for (const l of [0.05, 0.35, 0.5, 0.58]) expect(shouldInkBeLight({ luma: l }, true)).toBe(true);
  });

  // A gap between "flip" and "return" — otherwise the ink would flicker on every light cover
  // sliding under the edge of the glass.
  it('returning to light requires a noticeably darker backdrop than leaving it', () => {
    const between = (FLIP_LUMA + RETURN_LUMA) / 2;
    expect(shouldInkBeLight({ luma: between }, true)).toBe(true);
    expect(shouldInkBeLight({ luma: between }, false)).toBe(false);
    expect(FLIP_LUMA - RETURN_LUMA).toBeGreaterThanOrEqual(0.1);
  });

  it('the decision leans toward the lightest spot under the glass', () => {
    expect(shouldInkBeLight({ luma: 0.55 }, true)).toBe(true);
    expect(shouldInkBeLight({ luma: 0.55, hi: 0.95 }, true)).toBe(false);
  });

  it('ink is described by two ends of a scale, not an arbitrary lightness', () => {
    expect(INK_LIGHT).toBeGreaterThan(0.9);
    expect(INK_DARK).toBeLessThan(0.1);
  });
});

describe('ambient color for the shadow', () => {
  // The sample arrives once every 180 ms, and on mobile every sample would otherwise trigger its own repaint.
  it('quantizes by a step rather than carrying the exact value', () => {
    expect(ambientFrom({ r: 0.501, g: 0.5, b: 0.499 })).toEqual([0.5, 0.5, 0.5]);
  });

  it('clamps into the valid range', () => {
    expect(ambientFrom({ r: -1, g: 2, b: 0.25 })).toEqual([0, 1, 0.25]);
  });
});
