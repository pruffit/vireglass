import { describe, expect, it } from 'vitest';
import { diffraction, interference, spectralHue, surfaceCosine, surfaceSlope } from '../spectral';
import { renderSpectralPixels } from '../dom/spectral-map';
import { roundedRectGeometry, bevelDp } from '../geometry';
import { MATERIAL_PRESETS, resolveOptics } from '../material';

const mean = (v: readonly number[]) => (v[0]! + v[1]! + v[2]!) / 3;

describe('the spectral edge (docs/reference.md §1)', () => {
  it('colours without brightening — every hue averages to one', () => {
    // This is the property that makes dispersion, diffraction and interference one cause rather
    // than three brightness knobs: they tint the reflection, they do not add light to it.
    expect(mean(interference(0.9, 620))).toBeCloseTo(1, 6);
    expect(mean(interference(0.2, 380))).toBeCloseTo(1, 6);
    expect(mean(diffraction(0, 12))).toBeCloseTo(1, 6);
    expect(mean(diffraction(7, 12))).toBeCloseTo(1, 6);
  });

  it('separates the channels rather than moving them together', () => {
    const d = diffraction(3, 12);
    expect(Math.max(...d) - Math.min(...d)).toBeGreaterThan(0.05);
  });

  it('has a flat top and a sloped rim, and the normal follows', () => {
    // At the inner edge of the bevel the face is flat, so its normal points straight up.
    expect(surfaceSlope(12, 12, 4, 20)).toBe(0);
    expect(surfaceCosine(0)).toBe(1);
    // Nearer the silhouette it tips over, and the cosine falls away from one.
    const steep = surfaceSlope(0.5, 12, 4, 20);
    expect(steep).toBeGreaterThan(0);
    expect(surfaceCosine(steep)).toBeLessThan(1);
  });

  it('keeps the fringes at the edge, not across the whole bevel', () => {
    const optics = { film: 0, iridescence: 0, diffraction: 1 };
    const bevel = 12;
    const spread = (v: readonly number[]) => Math.max(...v) - Math.min(...v);
    // Inside the band the separation is NOT monotonic and should not be asserted to be: these are
    // fringes, so the phase keeps turning as the distance grows and the channels part and rejoin.
    // What the onset guarantees is where they stop existing.
    const inside = [0.2, bevel * 0.25, bevel * 0.5].map((e) => spread(spectralHue(e, bevel, 4, 20, optics)));
    expect(Math.max(...inside)).toBeGreaterThan(0.01);

    // Past 0.55 of the bevel `1 - e/bevel` falls below the onset and the term is gone outright.
    for (const e of [bevel * 0.6, bevel * 0.8, bevel]) {
      expect(spread(spectralHue(e, bevel, 4, 20, optics))).toBeCloseTo(0, 6);
    }
  });

  it('is exactly neutral where the material has no spectral edge', () => {
    const flat = spectralHue(1, 12, 4, 20, { film: 0, iridescence: 0, diffraction: 0 });
    expect(flat).toEqual([1, 1, 1]);
  });
});

describe('the baked map', () => {
  const geometry = roundedRectGeometry(200, 120, 30);
  const optics = resolveOptics(MATERIAL_PRESETS.iridescent);

  it('leaves the flat middle neutral once the headroom is undone', () => {
    const { data, width, height, headroom } = renderSpectralPixels(optics, geometry, 1);
    const i = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4;
    for (const channel of [0, 1, 2]) {
      expect((data[i + channel]! / 255) * headroom).toBeCloseTo(1, 1);
    }
  });

  it('carries headroom so a boosted channel cannot clip to white', () => {
    const { data, width, headroom } = renderSpectralPixels(optics, geometry, 1);
    // A pixel a little inside the silhouette, where the fringes live.
    const bevel = bevelDp(geometry, optics);
    expect(bevel).toBeGreaterThan(1);
    const i = (Math.floor(bevel / 2) * width + Math.floor(width / 2)) * 4;
    const largest = Math.max(data[i]!, data[i + 1]!, data[i + 2]!);
    expect(largest).toBeLessThan(255);
    expect(headroom).toBeGreaterThan(1);
  });
});
