import { describe, expect, it } from 'vitest';
import { roundedRectGeometry } from '../geometry';
import { MATERIAL_PRESETS, VIREGLASS_CONTROL_MATERIAL, VIREGLASS_MATERIAL, resolveOptics } from '../material';
import { lightConicAngle, rimGradientCss, rimLobe, rimStrength } from '../dom/rim';
import { boxShadowCss, shadowAlphaFrom } from '../dom/shadow';
import { bodyLayer, resolveBody, withPresence } from '../dom/body';
import { BODY, RIM } from '../law';
import { LENS_SHADER } from '../lens-shader';

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

/** The gradients of a rim value, the light line first and the dark edge second. */
function layers(css: string): string[] {
  return css.split(/, (?=conic-gradient)/);
}

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

  it('outlines the whole silhouette with a dark line, as a layer of its own', () => {
    const optics = resolveOptics(MATERIAL_PRESETS.glass);
    const [, dark] = layers(rimGradientCss(optics, [0.5, 0.5, 0.5], [0, -1]));
    // Matched on the value, not its spelling: the alpha is formatted, and a test that pins the
    // formatting fails on a change that moved nothing.
    expect(Math.max(...alphas(dark!))).toBeCloseTo(RIM.darkEdge, 3);
    expect(dark).toContain('rgba(0,0,0,');
  });

  it('runs a light line the whole way round, brighter toward the key light', () => {
    const optics = resolveOptics(VIREGLASS_CONTROL_MATERIAL);
    const [line] = layers(rimGradientCss(optics, [0.15, 0.13, 0.1], [0, -1]));
    const a = alphas(line!);
    const half = (a.length - 1) / 2;
    const near = a[0]!;
    const far = a[half]!;
    const side = a[half / 2]!;
    expect(Math.min(...a)).toBeGreaterThan(0.05);
    expect(side).toBeGreaterThan(0);
    expect(near).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(side);
  });

  it('follows the surroundings: faint over dark, plain over bright', () => {
    const optics = resolveOptics(VIREGLASS_CONTROL_MATERIAL);
    const peak = (ambient: [number, number, number]) => Math.max(...alphas(layers(rimGradientCss(optics, ambient, [0, -1]))[0]!));
    const dark = peak([0.08, 0.08, 0.08]);
    const bright = peak([0.7, 0.7, 0.7]);
    expect(dark).toBeCloseTo(RIM.strengthDark, 1);
    expect(bright).toBeGreaterThan(dark * 2);
    expect(rimStrength(0)).toBeCloseTo(RIM.strengthDark, 6);
    expect(rimStrength(1)).toBeCloseTo(RIM.strengthLight, 6);
  });

  // §1: an element that is not fully there yet is not yet outlined either. The dark edge is the
  // part that survives facing away from the light, so a rim left unscaled draws a hairline around
  // nothing — which is what the browser gate caught.
  it('fades with the element rather than outlining an absent one', () => {
    const optics = resolveOptics(MATERIAL_PRESETS.glass);
    const at = (appear: number) => alphas(rimGradientCss(optics, [0.5, 0.5, 0.5], [0, -1], appear));
    expect(Math.max(...at(0.5))).toBeCloseTo(Math.max(...at(1)) * 0.5, 2);
    expect(Math.max(...at(0))).toBe(0);
  });
});

describe('the lens draws the same rim', () => {
  it('reads its strength from the law and keeps no presence floor on the line', () => {
    expect(LENS_SHADER).toContain(`mix(${RIM.strengthDark}, ${RIM.strengthLight},`);
    expect(LENS_SHADER).toContain(`(${RIM.contour} + (1.0 - ${RIM.contour}) * rimKey`);
    expect(LENS_SHADER).toContain(`smoothstep(${RIM.ambientFrom}, ${RIM.ambientTo},`);
    expect(LENS_SHADER).toContain(`lineW * ${RIM.lineInset}`);
    expect(LENS_SHADER).not.toContain('u_presence * 2.0');
  });
});

describe('body as one layer over the backdrop (docs/reference.md §3)', () => {
  const dark = { luma: 0.12, lo: 0.12, hi: 0.12, busy: 0, r: 0.12, g: 0.11, b: 0.1 };
  const over = (layer: ReturnType<typeof bodyLayer>, backdrop: number) => (1 - layer.alpha) * backdrop + layer.alpha * layer.g;

  it('reads lighter than the surround over dark and over sky, under a light glyph', () => {
    const optics = resolveOptics(VIREGLASS_CONTROL_MATERIAL);
    const sky = { luma: 0.55, lo: 0.55, hi: 0.55, busy: 0, r: 0.37, g: 0.58, b: 0.75 };
    for (const backdrop of [dark, sky]) {
      const layer = bodyLayer(optics, backdrop, 1, [backdrop.r, backdrop.g, backdrop.b]);
      expect(over(layer, backdrop.g)).toBeGreaterThan(backdrop.g + 0.02);
    }
  });

  it('is absent when the element is', () => {
    const optics = resolveOptics(VIREGLASS_CONTROL_MATERIAL);
    expect(bodyLayer(optics, dark, 1, [dark.r, dark.g, dark.b], 0).alpha).toBe(0);
  });
});

describe('body (docs/reference.md §3)', () => {
  const flatDark = { luma: 0.1, lo: 0.08, hi: 0.12, busy: 0.01 };
  const flatMid = { luma: 0.55, lo: 0.55, hi: 0.55, busy: 0 };
  const busyMid = { luma: 0.5, lo: 0.1, hi: 0.9, busy: 0.5 };

  it('tints toward light over any flat backdrop, under a light glyph as much as a dark one', () => {
    const optics = resolveOptics(VIREGLASS_CONTROL_MATERIAL);
    for (const ink of [0, 1]) {
      expect(resolveBody(optics, flatDark, ink).tintLuma).toBeGreaterThan(0.5);
      expect(resolveBody(optics, flatMid, ink).tintLuma).toBeGreaterThan(0.5);
    }
  });

  it('goes to the ink pole only where the ink asks for it over texture', () => {
    const optics = resolveOptics({ ...VIREGLASS_CONTROL_MATERIAL, legibility: 0.95 });
    const light = { luma: 0.8, lo: 0.4, hi: 1, busy: 0.4 };
    const body = resolveBody(optics, light, 1);
    expect(body.need).toBeGreaterThan(0.2);
    expect(body.tintLuma).toBeLessThan(0.3);
  });

  it('asks for more medium over a busy backdrop than over a flat one', () => {
    const optics = resolveOptics(MATERIAL_PRESETS.glass);
    expect(resolveBody(optics, busyMid, 1).density).toBeGreaterThan(resolveBody(optics, flatDark, 1).density);
  });

  it('promises transparent glass to an element carrying no ink', () => {
    const inked = resolveOptics({ ...MATERIAL_PRESETS.glass, legibility: 0.95 });
    const bare = resolveOptics({ ...MATERIAL_PRESETS.glass, legibility: 0 });
    const textured = { luma: 0.8, lo: 0.4, hi: 1, busy: 0.4 };
    expect(resolveBody(bare, textured, 1).density).toBeLessThan(resolveBody(inked, textured, 1).density);
  });

  it('lifts a vanishing element off a uniform backdrop, and leaves a dense one alone', () => {
    const optics = resolveOptics({ ...MATERIAL_PRESETS.glass, legibility: 0, presence: 0.2 });
    const plain = resolveBody(optics, flatDark, 1);
    const present = withPresence(plain, optics, flatDark);
    expect(present.density).toBeGreaterThan(plain.density);

    const dense = { density: 0.9, tintLuma: 0.94, need: 0, pole: 0.94 };
    expect(withPresence(dense, optics, flatDark).density).toBeCloseTo(0.9, 6);
  });

  it('lifts toward light on every backdrop, whatever the ink', () => {
    const optics = resolveOptics({ ...MATERIAL_PRESETS.glass, presence: 0.2 });
    for (const ink of [0, 1]) {
      for (const backdrop of [flatDark, flatMid]) {
        const body = withPresence(resolveBody(optics, backdrop, ink), optics, backdrop);
        expect(body.tintLuma).toBeGreaterThan(backdrop.luma);
      }
    }
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

// Reported from an integration: over a flat dark backdrop the body came out matching the backdrop
// exactly, so a panel over a dark reading page had no separation at all.
// The floor used to ask for min(presence, room) and divide by the room: toward the light pole the
// quotient went to its ceiling, and at 0.94 the room was gone and the floor switched off. A body
// that read 0.54 opaque at #efefef read 0.10 at #f0f0f0.
describe('the body is continuous across the lightness scale', () => {
  const lumas = Array.from({ length: 101 }, (_, i) => 0.8 + i * 0.002);
  const materials = [VIREGLASS_MATERIAL, VIREGLASS_CONTROL_MATERIAL, ...Object.values(MATERIAL_PRESETS)];
  const alphaAt = (optics: ReturnType<typeof resolveOptics>, luma: number) => {
    const sample = { luma, busy: 0, r: luma, g: luma, b: luma };
    return bodyLayer(optics, sample, luma < 0.62 ? 1 : 0, [luma, luma, luma]).alpha;
  };
  const largestStep = (alpha: (luma: number) => number) =>
    Math.max(...lumas.slice(1).map((luma, i) => Math.abs(alpha(luma) - alpha(lumas[i]!))));

  it('has no step between neighbouring lightnesses from 0.80 to 1.00, for the default and every preset', () => {
    for (const material of materials) {
      const optics = { ...resolveOptics(material), presence: Math.max(material.presence, 0.05) };
      expect(largestStep((luma) => alphaAt(optics, luma))).toBeLessThan(0.012);
    }
  });

  it('canary: the old floor steps at the light pole', () => {
    const optics = resolveOptics(VIREGLASS_MATERIAL);
    const old = (luma: number) => {
      const room = Math.max(BODY.tintLight - luma, 0);
      const separation = Math.min(optics.presence, room);
      return Math.min(separation / Math.max(room, 1e-4), BODY.presenceDemand);
    };
    expect(largestStep(old)).toBeGreaterThan(0.3);
  });
});

describe('presence over a flat backdrop (docs/reference.md §3)', () => {
  const optics = { ...resolveOptics(MATERIAL_PRESETS.glass), presence: 0.08 };
  const flat = (luma: number) => ({ luma, busy: 0 });
  const separation = (luma: number) => {
    const body = withPresence(resolveBody(optics, flat(luma), 1), optics, flat(luma));
    return { reached: Math.abs(body.tintLuma - luma) * body.density, body };
  };

  it('never lands the body exactly on the backdrop', () => {
    // The bug: `tintLuma` was clamped to the backdrop's mean whenever the body leaned the other
    // way, which is the one value that separates from nothing.
    for (let luma = 0.02; luma <= 0.98; luma += 0.02) {
      expect(separation(luma).reached, `backdrop ${luma.toFixed(2)}`).toBeGreaterThan(0);
    }
  });

  it('separates by what was asked, scaled by the room under the light pole', () => {
    for (const luma of [0.2, 0.35, 0.5, 0.8]) {
      expect(separation(luma).reached).toBeCloseTo(0.08 * (1 - luma / BODY.tintLight), 3);
    }
  });

  it('does not go opaque to get there', () => {
    // Presence is a floor on visibility, not a licence to stop being a window: where the body's
    // tint sits close to the backdrop, the density that would deliver the separation is the
    // ceiling, so it separates as far as transparency allows and no further.
    //
    // Measured against what the body already had: presence raises density and never lowers it, so
    // a body that legibility has already made dense stays that dense.
    for (let luma = 0.02; luma <= 0.98; luma += 0.02) {
      const base = resolveBody(optics, flat(luma), 1).density;
      const ceiling = Math.max(base, BODY.presenceDemand);
      expect(separation(luma).body.density, `backdrop ${luma.toFixed(2)}`).toBeLessThanOrEqual(ceiling);
    }
  });

  it('leaves a body that already stands apart alone', () => {
    const weak = { ...optics, presence: 0.001 };
    const before = resolveBody(weak, flat(0.5), 1);
    expect(withPresence(before, weak, flat(0.5))).toEqual(before);
  });
});
