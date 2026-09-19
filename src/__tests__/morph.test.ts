import { describe, expect, it } from 'vitest';
import { morphBetween, morphOutOf } from '../adapters';
import { roundedRectGeometry } from '../geometry';
import { neckToBridge, sceneDistance } from '../sdf';

const pill = roundedRectGeometry(80, 44, 22);
const button = roundedRectGeometry(80, 80, 20);
const menu = roundedRectGeometry(220, 160, 28);

/** Negative means the point is inside the material — one body rather than two. */
function atMidpoint(a: typeof pill, m: NonNullable<ReturnType<typeof morphBetween>>): number {
  return sceneDistance(m.offsetX / 2, m.offsetY / 2, a.width, a.height, a.cornerRadius, m.smoothing, m);
}

describe('the bridge width (docs/reference.md §5)', () => {
  it('is exactly twice the gap, which is algebra rather than calibration', () => {
    // At the midpoint both distances are gap/2, so h = 0.5 and smin returns gap/2 − k/4.
    for (const gap of [1, 7, 30, 128]) expect(neckToBridge(gap)).toBe(gap * 2);
  });

  it('is nothing to bridge when the shapes already overlap', () => {
    expect(neckToBridge(0)).toBe(0);
    expect(neckToBridge(-40)).toBe(0);
  });
});

// S 1:25:30, the Apple design team on their own model: "it's called mitosis and meiosis. When
// these things are coming together or materialization and dematerialization and morphing." A
// dividing cell is one body throughout — it never has a frame of being two that touch, and it
// never pops a second body into existence beside the first.
describe('a lobe growing out of another (docs/reference.md §5)', () => {
  it('is the parent itself on the first frame, in the parent´s place', () => {
    const m = morphOutOf(button, menu, 0, 130, 0.0001)!;
    expect(m.width).toBeCloseTo(button.width, 1);
    expect(m.height).toBeCloseTo(button.height, 1);
    expect(m.offsetX).toBeCloseTo(0, 1);
    expect(m.offsetY).toBeCloseTo(0, 1);
  });

  it('has no second lobe at all before it starts', () => {
    expect(morphOutOf(button, menu, 0, 130, 0)).toBeUndefined();
    expect(morphOutOf(button, menu, 0, 130, -1)).toBeUndefined();
  });

  it('arrives at the shape and the place it was asked for', () => {
    const m = morphOutOf(button, menu, 0, 130, 1)!;
    expect(m.width).toBe(menu.width);
    expect(m.height).toBe(menu.height);
    expect(m.offsetY).toBe(130);
  });

  it('grows and travels together, with no jump in either', () => {
    // Starting from the state at t = 0, which is the parent itself: the first step has to be
    // small too, and measuring it from zero would only be measuring the parent's own width.
    let lastW = button.width;
    let lastY = 0;
    for (let t = 0.02; t <= 1; t += 0.02) {
      const m = morphOutOf(button, menu, 0, 130, t)!;
      expect(m.width).toBeGreaterThanOrEqual(lastW);
      expect(m.offsetY).toBeGreaterThanOrEqual(lastY);
      // A step no larger than the smallest feature: anything bigger reads as a pop.
      expect(m.width - lastW).toBeLessThan(button.cornerRadius);
      lastW = m.width;
      lastY = m.offsetY;
    }
  });

  it('stays one body at every point of the transition', () => {
    for (let t = 0.01; t <= 1; t += 0.01) {
      const m = morphOutOf(button, menu, 0, 130, t)!;
      expect(atMidpoint(button, m)).toBeLessThan(0);
    }
  });
});

describe('two shapes fusing in place (docs/reference.md §5)', () => {
  // The contract said t = 1 "gives a single shared medium" and it did not: the neck was a fraction
  // of the element's own half-size, which has nothing to do with the distance it has to span, so a
  // segmented control stayed a row of separate pills at every t.
  it('really is one body once fused, at the gaps a bar actually uses', () => {
    for (const gap of [0, 4, 8, 16]) {
      const m = morphBetween(pill, pill, 80 + gap, 0, 1)!;
      expect(atMidpoint(pill, m)).toBeLessThan(0);
    }
  });

  it('is still two bodies while it is only part-way there', () => {
    const m = morphBetween(pill, pill, 88, 0, 0.1)!;
    expect(atMidpoint(pill, m)).toBeGreaterThan(0);
  });

  it('leaves shapes too far apart alone instead of growing a blob between them', () => {
    // Being separate is a legitimate state. Joining these would take a neck wider than either
    // shape, and a neck wider than what it joins is not a neck.
    const m = morphBetween(pill, pill, 200, 0, 1)!;
    expect(atMidpoint(pill, m)).toBeGreaterThan(0);
    expect(m.smoothing).toBeLessThanOrEqual(Math.min(pill.width, pill.height));
  });

  it('never grows a neck wider than the narrower of the two bodies', () => {
    for (const offset of [80, 120, 200, 600]) {
      for (const t of [0.3, 0.7, 1]) {
        const m = morphBetween(pill, menu, offset, 0, t)!;
        expect(m.smoothing).toBeLessThanOrEqual(Math.min(pill.width, pill.height));
      }
    }
  });
});
