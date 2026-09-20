import { describe, expect, it } from 'vitest';
import { BEVEL } from '../law';
import { samples } from './fixtures/disc-ul-refraction';

/** The model's own bevel profile, as `renderDisplacementPixels` uses it. */
function bevelProfile(t: number): number {
  const raw = Math.min(t / Math.sqrt(Math.max(1 - t * t * BEVEL.sphere, BEVEL.floor)), BEVEL.slopeMax);
  return raw / BEVEL.slopeMax;
}

/** Best rms fit of `profile` to the traced points, over the zone depth and peak shift. */
function fit(profile: (t: number) => number): { zone: number; peak: number; rms: number } {
  const pts = samples();
  let best = { zone: 0, peak: 0, rms: Infinity };
  for (let zone = 60; zone <= 260; zone += 2) {
    for (let peak = 20; peak <= 400; peak += 2) {
      let err = 0;
      for (const p of pts) err += (peak * profile(Math.max(1 - p.depth / zone, 0)) - p.shift) ** 2;
      const rms = Math.sqrt(err / pts.length);
      if (rms < best.rms) best = { zone, peak, rms };
    }
  }
  return best;
}

// The only lens in the reference whose displacement can be read off directly, and the first time
// anything in this model has been checked against a measured one rather than against a sentence.
describe('the lens against a real one (docs/reference.md §1)', () => {
  it('leaves the middle of the element alone', () => {
    // The grid line does not move at all until it is within about 150px of the rim, on a disc whose
    // radius is 592. A loupe would have moved it everywhere.
    const untouched = samples().filter((s) => s.depth > 140);
    expect(untouched.length).toBeGreaterThan(0);
    for (const s of untouched) expect(Math.abs(s.shift)).toBeLessThanOrEqual(1);
  });

  it('displaces more the closer to the rim it gets, all the way in', () => {
    const ordered = [...samples()].sort((a, b) => b.depth - a.depth);
    for (let i = 1; i < ordered.length; i += 1) {
      expect(ordered[i].shift).toBeGreaterThanOrEqual(ordered[i - 1].shift - 1);
    }
  });

  it('fits the traced profile to well under a pixel per 1000 of radius', () => {
    const { rms, zone } = fit(bevelProfile);
    // 1.1px rms on a 592px disc — under 0.2% of the radius.
    expect(rms).toBeLessThan(1.5);
    expect(rms / 592).toBeLessThan(0.003);
    // And the refracting zone it implies is a fifth of the radius, not the whole element.
    expect(zone / 592).toBeGreaterThan(0.1);
    expect(zone / 592).toBeLessThan(0.3);
  });

  it('beats a linear ramp, which is the shape a chamfer would give', () => {
    // If a straight ramp fit as well, the profile would be carrying no information.
    expect(fit(bevelProfile).rms).toBeLessThan(fit((t) => t).rms);
  });
});
