import { describe, expect, it } from 'vitest';
import { sceneDistance, sceneGradient, sdfRoundedRect, smin, touchWarp, type TouchWarp } from '../sdf';

const rest: TouchWarp = {
  x: 0,
  y: 0,
  pullX: 0,
  pullY: 0,
  press: 0,
  radius: 40,
  waveAmp: 0,
  wavePhase: 0,
};

describe('smooth union', () => {
  it('returns the smaller distance untouched once the two are further apart than the bridge', () => {
    expect(smin(1, 9, 2)).toBeCloseTo(1, 10);
    expect(smin(9, 1, 2)).toBeCloseTo(1, 10);
  });

  it('dips below both where they meet — that dip is the bridge', () => {
    expect(smin(0, 0, 2)).toBeLessThan(0);
    expect(smin(1, 2, 4)).toBeLessThan(1);
  });
});

describe('scene (docs/reference.md §5: shapes merging and splitting)', () => {
  const W = 200;
  const H = 120;
  const R = 30;

  it('is the shape alone when nothing is bridged to it', () => {
    expect(sceneDistance(10, 5, W, H, R)).toBeCloseTo(sdfRoundedRect(10, 5, W, H, R), 10);
  });

  it('pulls a neighbour in: the gap between them stops being outside', () => {
    const neighbour = { offsetX: 180, offsetY: 0, width: 120, height: 80, cornerRadius: 24 };
    const midpoint = 120;
    const apart = sceneDistance(midpoint, 0, W, H, R, 0, neighbour);
    const joined = sceneDistance(midpoint, 0, W, H, R, 40, neighbour);
    expect(apart).toBeGreaterThan(0);
    expect(joined).toBeLessThan(apart);
  });

  it('keeps its gradient a unit vector across the bridge', () => {
    const neighbour = { offsetX: 180, offsetY: 0, width: 120, height: 80, cornerRadius: 24 };
    for (const x of [-80, 0, 90, 120, 160]) {
      const [gx, gy] = sceneGradient(x, 0, W, H, R, 40, neighbour);
      expect(Math.hypot(gx, gy)).toBeCloseTo(1, 6);
    }
  });
});

describe('touch warp (docs/reference.md §5)', () => {
  it('leaves the field alone with no finger on it', () => {
    const [x, y] = touchWarp(30, 20, rest);
    expect(x).toBeCloseTo(30, 10);
    expect(y).toBeCloseTo(20, 10);
  });

  it('does nothing at all when there is no contact radius', () => {
    const [x, y] = touchWarp(30, 20, { ...rest, radius: 0, press: 1, pullX: 10 });
    expect(x).toBe(30);
    expect(y).toBe(20);
  });

  it('leaves the far edge in place while the near field follows the finger', () => {
    const pulled = { ...rest, x: -60, y: 0, pullX: 20, pullY: 0 };
    const near = touchWarp(-60, 0, pulled);
    const far = touchWarp(95, 0, pulled);
    // Scaling the width would have moved both. The field deforms, the box does not.
    expect(Math.abs(near[0] - -60)).toBeGreaterThan(1);
    expect(Math.abs(far[0] - 95)).toBeLessThan(0.5);
  });

  it('grows the element under pressure', () => {
    const pressed = touchWarp(100, 0, { ...rest, press: 1 });
    // The shader divides by (1 + 0.06 * press): a point maps from further out, so the shape reads
    // larger. M 3:51, and the HIG's "expands".
    expect(pressed[0]).toBeLessThan(100);
  });
});
