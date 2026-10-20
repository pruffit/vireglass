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
import { roundedRectGeometry } from '../geometry';
import { MATERIAL_PRESETS, resolveOptics } from '../material';

// Counted, not timed: a timer says nothing on a slow runner. The hue is a function of the depth into the bevel,
// so what a bake evaluates must not grow with the pixels.
describe('what a spectral bake costs', () => {
  const optics = resolveOptics(MATERIAL_PRESETS.glass);
  const bake = (w: number, h: number, dpr: number) => {
    calls.n = 0;
    const map = renderSpectralPixels(optics, roundedRectGeometry(w, h, 24), dpr);
    return { n: calls.n, ...map };
  };

  it('evaluates the hue the same few thousand times whatever the size of the element', () => {
    const counts = [bake(40, 40, 1), bake(390, 520, 1), bake(390, 520, 2), bake(88, 640, 3)].map((b) => b.n);
    expect(new Set(counts).size).toBe(1);
    expect(counts[0]).toBeLessThanOrEqual(2049);
  });

  it('canary: a bake that evaluated it per pixel of the bevel would evaluate it far more', () => {
    const { data, width, height } = bake(390, 520, 2);
    const neutral = data[((height >> 1) * width + (width >> 1)) * 4];
    let tinted = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] !== neutral || data[i + 1] !== neutral || data[i + 2] !== neutral) tinted += 1;
    expect(tinted).toBeGreaterThan(10 * 2049);
  });
});
