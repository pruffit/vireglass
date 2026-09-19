import { describe, expect, it } from 'vitest';
import {
  SURFACE_LENGTH_UNIFORMS,
  toDeviceSurfaceUniforms,
  toSurfaceUniforms,
} from '../adapters';
import { roundedRectGeometry } from '../geometry';
import { resolveOptics, VIREGLASS_MATERIAL } from '../material';

const optics = resolveOptics(VIREGLASS_MATERIAL);
const geometry = roundedRectGeometry(220, 120, 32);
const touch = { x: 12, y: -8, pullX: 4, pullY: 2, press: 1, radius: 40, waveAmp: 6, wavePhase: 0.25 };

const raw = () => toSurfaceUniforms(optics, geometry, { touch, shadow: 1 });

/**
 * What actually counts as a length is written here a SECOND TIME on purpose. Pull this list from
 * the module itself and the test would start checking itself: a field removed from
 * `SURFACE_LENGTH_UNIFORMS` would simply move into "dimensionless" and pass the equality check.
 * The list here is an expectation, and it must never drift from the source silently: a change
 * requires a deliberate edit on both sides.
 */
const LENGTHS = [
  'u_halfSize',
  'u_corner',
  'u_bevel',
  'u_morphOffset',
  'u_morphHalf',
  'u_morphCorner',
  'u_morphK',
  'u_morph2Offset',
  'u_morph2Half',
  'u_morph2Corner',
  'u_shadowReach',
  'u_touch',
  'u_pull',
  'u_touchRadius',
] as const;

describe('converting surface uniforms to device pixels', () => {
  // The adapter's contract is dp: that's how Android reads it, where Skia draws in the same units.
  it('at density 1 nothing changes', () => {
    expect(toDeviceSurfaceUniforms(raw(), 1)).toEqual(raw());
  });

  it('exactly the fields listed here count as lengths', () => {
    expect([...SURFACE_LENGTH_UNIFORMS].sort()).toEqual([...LENGTHS].sort());
  });

  it('lengths get multiplied, everything else stays as it was', () => {
    const before = raw();
    const after = toDeviceSurfaceUniforms(before, 2);
    const lengths = new Set<string>([...LENGTHS, 'u_wave']);

    for (const [key, value] of Object.entries(before)) {
      if (lengths.has(key)) continue;
      expect(after[key as keyof typeof after], key).toEqual(value);
    }

    for (const key of LENGTHS) {
      const was = before[key];
      const now = after[key];
      if (Array.isArray(was)) {
        expect(now, key).toEqual((was as number[]).map((v) => v * 2));
      } else {
        expect(now, key).toBe((was as number) * 2);
      }
    }
  });

  // The touch blob's radius is a length, and ink defocus under the finger is computed from it
  // (reference §6). Lose it here and on a dense screen the blur ends up half as strong as on
  // Android: visible to the eye only right next to the phone, and `check:optics` renders at
  // density 1 and won't catch it.
  it('the touch blob radius is a length', () => {
    expect(SURFACE_LENGTH_UNIFORMS).toContain('u_touchRadius');
    expect(toDeviceSurfaceUniforms(raw(), 3).u_touchRadius).toBe(touch.radius * 3);
  });

  // Of the wave, only the amplitude has a length: the phase is in turns and knows nothing about density.
  it('the wave scales its amplitude, but not its phase', () => {
    const after = toDeviceSurfaceUniforms(raw(), 2);
    expect(after.u_wave[0]).toBe(touch.waveAmp * 2);
    expect(after.u_wave[1]).toBe(touch.wavePhase);
  });

  // Fractions, lightness values and colors know nothing about density — if such a field ever
  // moved, the whole material would drift with it.
  it('dimensionless fields are left untouched', () => {
    const after = toDeviceSurfaceUniforms(raw(), 2);
    expect(after.u_thickness).toBe(raw().u_thickness);
    expect(after.u_touchPress).toBe(touch.press);
    expect(after.u_tint).toEqual(raw().u_tint);
  });
});
