import { describe, expect, it } from 'vitest';
import { sdfRoundedRect, sdfRoundedRectGradient } from '../sdf';

// Rect 100×60, corner 10 — big enough that edge midpoints and corners fall cleanly outside the
// medial-axis degeneracy of a thin/near-square shape.
const W = 100;
const H = 60;
const R = 10;
const HALF_W = W / 2;
const HALF_H = H / 2;

describe('sdfRoundedRect (JS twin of vgRoundRect)', () => {
  it('is negative at the centre, exactly -(half of the shorter side)', () => {
    expect(sdfRoundedRect(0, 0, W, H, R)).toBeCloseTo(-HALF_H, 6);
  });

  it('is zero at edge midpoints', () => {
    expect(sdfRoundedRect(HALF_W, 0, W, H, R)).toBeCloseTo(0, 6);
    expect(sdfRoundedRect(-HALF_W, 0, W, H, R)).toBeCloseTo(0, 6);
    expect(sdfRoundedRect(0, HALF_H, W, H, R)).toBeCloseTo(0, 6);
    expect(sdfRoundedRect(0, -HALF_H, W, H, R)).toBeCloseTo(0, 6);
  });

  it('is zero on the rounded corner arc', () => {
    const cx = HALF_W - R;
    const cy = HALF_H - R;
    const angle = Math.PI / 4;
    const x = cx + R * Math.cos(angle);
    const y = cy + R * Math.sin(angle);
    expect(sdfRoundedRect(x, y, W, H, R)).toBeCloseTo(0, 6);
  });

  it('is positive outside the shape', () => {
    expect(sdfRoundedRect(200, 200, W, H, R)).toBeGreaterThan(0);
    expect(sdfRoundedRect(HALF_W + 5, 0, W, H, R)).toBeCloseTo(5, 6);
  });
});

describe('sdfRoundedRectGradient (JS twin of vgRoundRectNormal)', () => {
  const cases: Array<[number, number, [number, number]]> = [
    [HALF_W, 0, [1, 0]],
    [-HALF_W, 0, [-1, 0]],
    [0, HALF_H, [0, 1]],
    [0, -HALF_H, [0, -1]],
    [HALF_W + 20, 0, [1, 0]],
  ];

  it('points outward and is unit length at edge midpoints and outside the shape', () => {
    for (const [x, y, expected] of cases) {
      const [gx, gy] = sdfRoundedRectGradient(x, y, W, H, R);
      expect(Math.hypot(gx, gy)).toBeCloseTo(1, 6);
      expect(gx).toBeCloseTo(expected[0], 6);
      expect(gy).toBeCloseTo(expected[1], 6);
    }
  });

  it('is unit length and diagonal on the rounded corner', () => {
    const cx = HALF_W - R;
    const cy = HALF_H - R;
    const angle = Math.PI / 4;
    const x = cx + R * Math.cos(angle);
    const y = cy + R * Math.sin(angle);
    const [gx, gy] = sdfRoundedRectGradient(x, y, W, H, R);
    expect(Math.hypot(gx, gy)).toBeCloseTo(1, 6);
    expect(gx).toBeGreaterThan(0);
    expect(gy).toBeGreaterThan(0);
    expect(gx).toBeCloseTo(gy, 6);
  });

  it('is the zero vector only at the exact centre', () => {
    const [gx, gy] = sdfRoundedRectGradient(0, 0, W, H, R);
    expect(gx).toBe(0);
    expect(gy).toBe(0);
  });
});
