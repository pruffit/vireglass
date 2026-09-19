import { describe, expect, it } from 'vitest';
import { shadowTint } from '../shadow-tint';
import { boxShadowCss } from '../dom/shadow';
import { roundedRectGeometry } from '../geometry';
import type { BackdropSample } from '../adaptation';

const sample = (r: number, g: number, b: number, busy = 0.2): BackdropSample => ({
  luma: 0.2126 * r + 0.7152 * g + 0.0722 * b,
  lo: 0,
  hi: 1,
  busy,
  r,
  g,
  b,
});

// 219 @8:22: "the light reflects, scatters, and bleeds into the shadow as well — much like it
// would in the physical world."
describe('light bleeding into the shadow (docs/reference.md §4)', () => {
  it('has nothing to spill over a backdrop with no light in it', () => {
    const [r, g, b] = shadowTint([0, 0, 0]);
    expect(r).toBeCloseTo(0, 6);
    expect(g).toBeCloseTo(0, 6);
    expect(b).toBeCloseTo(0, 6);
  });

  it('stays neutral under a grey backdrop rather than inventing a colour', () => {
    const [r, g, b] = shadowTint([0.6, 0.6, 0.6]);
    expect(r).toBeCloseTo(g, 6);
    expect(g).toBeCloseTo(b, 6);
  });

  it('carries the hue of what is around it', () => {
    const warm = shadowTint([0.9, 0.5, 0.1]);
    expect(warm[0]).toBeGreaterThan(warm[2]);
    const cool = shadowTint([0.1, 0.4, 0.9]);
    expect(cool[2]).toBeGreaterThan(cool[0]);
  });

  it('spills more where there is more light to spill', () => {
    const dim = shadowTint([0.2, 0.1, 0.02]);
    const bright = shadowTint([1, 0.5, 0.1]);
    expect(Math.abs(bright[0])).toBeGreaterThan(Math.abs(dim[0]));
  });

  it('does not pale the shadow: lightness is taken out of the hue', () => {
    // Left in, a light backdrop would lift every channel and the shadow would lose its depth
    // instead of warming up. The sum of the tint is zero by construction.
    const [r, g, b] = shadowTint([0.95, 0.95, 0.95]);
    expect(r + g + b).toBeCloseTo(0, 5);
  });
});

describe('the shadow the DOM renderer writes', () => {
  const geometry = roundedRectGeometry(240, 76, 26);

  it('is not a black hole over colourful content', () => {
    const over = boxShadowCss(geometry, sample(0.9, 0.5, 0.1));
    const channels = /rgba\((\d+), (\d+), (\d+)/.exec(over);
    expect(channels).not.toBeNull();
    const [r, , b] = [Number(channels![1]), Number(channels![2]), Number(channels![3])];
    expect(r).toBeGreaterThan(b);
  });

  it('falls back to plain black when given only a density, with no colour to read', () => {
    expect(boxShadowCss(geometry, { busy: 0.2 })).toContain('rgba(0, 0, 0,');
  });
});
