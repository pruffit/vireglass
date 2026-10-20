import { describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ n: 0 }));

vi.mock('../spectral', async (original) => {
  const real = await original<typeof import('../spectral')>();
  return {
    ...real,
    spectralHue: (...args: Parameters<typeof real.spectralHue>) => {
      calls.n += 1;
      return real.spectralHue(...args);
    },
  };
});

import { renderSpectralPixels } from '../dom/spectral-map';
import { bevelDp, roundedRectGeometry } from '../geometry';
import { MATERIAL_PRESETS, resolveOptics } from '../material';

// Counted, not timed: a timer says nothing on a slow runner. The hue is a function of the depth into the bevel,
// so what a bake evaluates must not grow with the pixels.
describe('what a spectral bake costs', () => {
  const optics = resolveOptics(MATERIAL_PRESETS.glass);

  it('evaluates the hue a few hundred times whatever the size of the element', () => {
    const counts = [];
    for (const [w, h, dpr] of [[40, 40, 1], [390, 520, 1], [390, 520, 2], [88, 640, 2]] as const) {
      calls.n = 0;
      const { width, height } = renderSpectralPixels(optics, roundedRectGeometry(w, h, 24), dpr);
      counts.push({ n: calls.n, pixels: width * height });
    }
    for (const c of counts) expect(c.n).toBeLessThanOrEqual(24 * 32 + 1);
    expect(Math.max(...counts.map((c) => c.pixels))).toBeGreaterThan(100 * Math.max(...counts.map((c) => c.n)));
  });

  it('canary: the pixels inside the bevel, which a per-pixel bake evaluated, are far more', () => {
    const g = roundedRectGeometry(390, 520, 24);
    const { width, height } = renderSpectralPixels(optics, g, 2);
    const bevel = bevelDp(g, optics);
    const band = width * height - Math.max(0, width - 4 * bevel) * Math.max(0, height - 4 * bevel);
    expect(band).toBeGreaterThan(20 * (24 * 32 + 1));
  });
});
