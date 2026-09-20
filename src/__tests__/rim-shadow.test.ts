import { describe, expect, it } from 'vitest';
import { roundedRectGeometry } from '../geometry';
import { MATERIAL_PRESETS, resolveOptics } from '../material';
import { lightConicAngle, rimGradientCss, rimLobe } from '../dom/rim';
import { boxShadowCss, shadowAlphaFrom } from '../dom/shadow';
import { resolveBody, withPresence } from '../dom/body';
import { RIM } from '../law';

describe('adaptive shadow (docs/reference.md §4)', () => {
  it('lands on the two densities measured off the reference frames', () => {
    // 4.0% over a flat light backdrop, 19.9% over text — frames 711–723.
    expect(shadowAlphaFrom({ busy: 0 })).toBeCloseTo(0.04, 3);
    expect(shadowAlphaFrom({ busy: 1 })).toBeCloseTo(0.199, 3);
  });

  it('is denser over text than over a flat backdrop, never the other way round', () => {
    const flat = shadowAlphaFrom({ busy: 0 });
    const some = shadowAlphaFrom({ busy: 0.1 });
    const busy = shadowAlphaFrom({ busy: 0.4 });
    expect(some).toBeGreaterThan(flat);
    expect(busy).toBeGreaterThan(some);
  });

  it('grows its blur with the element, and carries no offset', () => {
    const small = boxShadowCss(roundedRectGeometry(44, 44, 22), { busy: 0.2 });
    const large = boxShadowCss(roundedRectGeometry(320, 180, 40), { busy: 0.2 });
    const reach = (css: string) => Number(/ ([\d.]+)px/.exec(css)![1]);
    expect(reach(large)).toBeGreaterThan(reach(small));
    // §4 gives a density and a size, never a direction.
    expect(small.startsWith('0 0 ')).toBe(true);
  });
});

/** Every alpha in a conic-gradient string, in order. */
function alphas(css: string): number[] {
  return [...css.matchAll(/rgba\([^)]*,\s*([\d.]+)\)/g)].map((m) => Number(m[1]));
}

describe('rim light (docs/reference.md §2)', () => {
  it('points the gradient at the light', () => {
    expect(lightConicAngle([0, -1])).toBeCloseTo(0, 5); // straight up
    expect(lightConicAngle([1, 0])).toBeCloseTo(90, 5); // right
    expect(lightConicAngle([0, 1])).toBeCloseTo(180, 5); // down
    expect(lightConicAngle([-1, 0])).toBeCloseTo(270, 5); // left
  });

  it('puts two opposing arcs on the silhouette, the far one weaker', () => {
    const near = rimLobe(0, 1);
    const far = rimLobe(180, 1);
    const side = rimLobe(90, 1);
    expect(near).toBeCloseTo(1, 6);
    // The lens shader's own ratio, not a taste value.
    expect(far).toBeCloseTo(0.45, 6);
    expect(side).toBeCloseTo(0, 6);
    expect(far).toBeLessThan(near);
  });

  it('takes its colour from the environment', () => {
    const optics = resolveOptics(MATERIAL_PRESETS.glass);
    const overWarm = rimGradientCss(optics, [0.9, 0.7, 0.2], [0, -1]);
    const overCool = rimGradientCss(optics, [0.2, 0.5, 0.9], [0, -1]);
    expect(overWarm).not.toEqual(overCool);
    expect(overWarm.startsWith('conic-gradient(')).toBe(true);
  });

  it('outlines the rest of the silhouette with a dark line rather than leaving it bare', () => {
    const optics = resolveOptics(MATERIAL_PRESETS.glass);
    const css = rimGradientCss(optics, [0.5, 0.5, 0.5], [0, -1]);
    // The side of the ring, away from both arcs, is the dark edge iOS 27 made its own layer.
    // Matched on the value, not its spelling: the alpha is formatted, and a test that pins the
    // formatting fails on a change that moved nothing.
    const darkest = Math.min(...alphas(css));
    expect(darkest).toBeCloseTo(RIM.darkEdge, 3);
    expect(css).toContain('rgba(0,0,0,');
  });

  // §1: an element that is not fully there yet is not yet outlined either. The dark edge is the
  // part that survives facing away from the light, so a rim left unscaled draws a hairline around
  // nothing — which is what the browser gate caught.
  it('fades with the element rather than outlining an absent one', () => {
    const optics = resolveOptics(MATERIAL_PRESETS.glass);
    const present = alphas(rimGradientCss(optics, [0.5, 0.5, 0.5], [0, -1], 1));
    const half = alphas(rimGradientCss(optics, [0.5, 0.5, 0.5], [0, -1], 0.5));
    const absent = alphas(rimGradientCss(optics, [0.5, 0.5, 0.5], [0, -1], 0));
    expect(Math.max(...half)).toBeCloseTo(Math.max(...present) * 0.5, 3);
    expect(Math.max(...absent)).toBe(0);
  });
});

describe('body (docs/reference.md §3)', () => {
  const flatDark = { luma: 0.1, lo: 0.08, hi: 0.12, busy: 0.01 };
  const flatLight = { luma: 0.92, lo: 0.9, hi: 0.94, busy: 0.01 };
  const busyMid = { luma: 0.5, lo: 0.1, hi: 0.9, busy: 0.5 };

  it('tints toward light over a dark backdrop and toward dark over a light one', () => {
    const optics = resolveOptics({ ...MATERIAL_PRESETS.glass, legibility: 0 });
    // With no ink on it the direction comes from the backdrop, not from polarity.
    expect(resolveBody(optics, flatDark, 1).tintLuma).toBeGreaterThan(0.5);
    expect(resolveBody(optics, flatLight, 1).tintLuma).toBeLessThan(0.5);
  });

  it('asks for more medium over a busy backdrop than over a flat one', () => {
    const optics = resolveOptics(MATERIAL_PRESETS.glass);
    expect(resolveBody(optics, busyMid, 1).density).toBeGreaterThan(resolveBody(optics, flatDark, 1).density);
  });

  it('promises transparent glass to an element carrying no ink', () => {
    const inked = resolveOptics({ ...MATERIAL_PRESETS.glass, legibility: 0.95 });
    const bare = resolveOptics({ ...MATERIAL_PRESETS.glass, legibility: 0 });
    expect(resolveBody(bare, flatLight, 1).density).toBeLessThan(resolveBody(inked, flatLight, 1).density);
  });

  it('lifts a vanishing element off a uniform backdrop, and leaves a dense one alone', () => {
    const optics = resolveOptics({ ...MATERIAL_PRESETS.glass, legibility: 0, presence: 0.2 });
    const plain = resolveBody(optics, flatDark, 1);
    const present = withPresence(plain, optics, flatDark);
    expect(present.density).toBeGreaterThan(plain.density);

    const dense = { density: 0.9, tintLuma: 0.94 };
    expect(withPresence(dense, optics, flatDark).density).toBeCloseTo(0.9, 6);
  });

  it('takes the sign of the lift from the backdrop, not from the ink', () => {
    const optics = resolveOptics({ ...MATERIAL_PRESETS.glass, legibility: 0, presence: 0.2 });
    // Same ink polarity both times; only the backdrop changes.
    expect(withPresence(resolveBody(optics, flatDark, 1), optics, flatDark).tintLuma).toBeGreaterThan(0.5);
    expect(withPresence(resolveBody(optics, flatLight, 1), optics, flatLight).tintLuma).toBeLessThan(0.5);
  });
});

// Measured off frames/crops/cap158-left and cap158-right: the bright arc's full width at half its
// peak is 53 degrees in the first and 30 in the second. The model's own width is the exponent's:
// 2*acos(0.5^(1/n)). It was 3, whose arc is 75 degrees wide — broader than both measurements.
describe('how wide the key-light arc is (docs/reference.md §2)', () => {
  /** Full width at half maximum of the lobe, in degrees, read off the function itself. */
  function lobeWidth(): number {
    const peak = rimLobe(0, 1);
    let edge = 0;
    for (let d = 0; d <= 180; d += 0.05) {
      if (rimLobe(d, 1) < peak / 2) break;
      edge = d;
    }
    return edge * 2;
  }

  it('matches the arc the reference frame shows', () => {
    expect(lobeWidth()).toBeGreaterThan(50);
    expect(lobeWidth()).toBeLessThan(57);
  });

  it('is narrower than the cubic lobe it replaced', () => {
    // 2*acos(0.5^(1/3)) is 74.9 degrees. The old value was broader than either measurement.
    expect(lobeWidth()).toBeLessThan(74.9);
  });

  it('still opposes: the far arc is weaker, not absent', () => {
    expect(rimLobe(180, 1)).toBeCloseTo(RIM.opposingArc, 6);
    expect(rimLobe(180, 1)).toBeLessThan(rimLobe(0, 1));
    expect(rimLobe(180, 1)).toBeGreaterThan(0);
  });

  it('is dark where neither arc reaches', () => {
    expect(rimLobe(90, 1)).toBeCloseTo(0, 6);
  });
});
