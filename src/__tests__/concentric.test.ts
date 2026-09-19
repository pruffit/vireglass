import { describe, expect, it } from 'vitest';
import { concentricFit, concentricInset, concentricRadius, resolveShape } from '../concentric';

describe('concentricity of nested shapes', () => {
  // Reference 219 @7:53: nested shapes share the center of curvature, so the radius shrinks by
  // exactly the inset. Otherwise the corners don't run parallel and the gap between the shapes
  // either gets eaten or spreads apart.
  it('the inner shape radius is smaller than the outer by exactly the inset', () => {
    expect(concentricRadius(34, 12)).toBe(22);
    expect(concentricRadius(26, 8)).toBe(18);
  });

  it('an inset larger than the outer radius gives a right angle, not a negative radius', () => {
    expect(concentricRadius(10, 24)).toBe(0);
  });

  it('the inverse problem returns the same inset', () => {
    const outer = 34;
    const inset = 12;
    expect(concentricInset(outer, concentricRadius(outer, inset))).toBe(inset);
  });

  // The radius floor is the way out of the same case SwiftUI has concentric(minimum:) for.
  it('the radius floor keeps the nested shape from getting a right angle', () => {
    expect(concentricRadius(10, 24, 6)).toBe(6);
    expect(concentricRadius(14, 14, 4)).toBe(4);
  });

  it('the floor does not touch a radius that is already above it', () => {
    expect(concentricRadius(34, 12, 6)).toBe(22);
  });

  it('without a floor the behavior is unchanged', () => {
    expect(concentricRadius(10, 24)).toBe(concentricRadius(10, 24, 0));
    expect(concentricRadius(10, 24, -5)).toBe(0);
  });

  // Nesting holds at any depth: a button in a tile, a tile on a screen.
  it('nesting chains correctly', () => {
    const screen = 44;
    const plate = concentricRadius(screen, 10);
    const button = concentricRadius(plate, 6);
    expect(plate).toBe(34);
    expect(button).toBe(28);
    expect(concentricRadius(screen, 16)).toBe(button);
  });
});

// 356 @3:42: "We use three shape types to build concentric layouts: fixed shapes have a constant
// corner radius. Capsules use a radius that's half the height of the container. And concentric
// shapes calculate their radius by subtracting padding from the parent's."
describe('the three shape types (docs/reference.md §11)', () => {
  it('holds a fixed radius wherever it is put', () => {
    expect(resolveShape({ type: 'fixed', radius: 12 }, 44)).toBe(12);
    expect(resolveShape({ type: 'fixed', radius: 12 }, 44, { cornerRadius: 40 })).toBe(12);
  });

  it('gives a capsule half its own height', () => {
    expect(resolveShape({ type: 'capsule' }, 44)).toBe(22);
    expect(resolveShape({ type: 'capsule' }, 96)).toBe(48);
    // Its own height, not the container's: a capsule inside a big panel is still a capsule.
    expect(resolveShape({ type: 'capsule' }, 44, { cornerRadius: 40 })).toBe(22);
  });

  it('subtracts the padding from the parent when nested', () => {
    expect(resolveShape({ type: 'concentric', inset: 8 }, 44, { cornerRadius: 28 })).toBe(20);
  });

  it('chains: an inner shape is computed from its own parent, not the screen', () => {
    const tile = resolveShape({ type: 'concentric', inset: 12 }, 200, { cornerRadius: 48 });
    const cover = resolveShape({ type: 'concentric', inset: 8 }, 120, { cornerRadius: tile });
    expect(tile).toBe(36);
    expect(cover).toBe(28);
  });
});

// 356 @6:00: "a neat trick for managing components that need to work both inside a container and
// on their own: use a concentric shape with a fallback radius. The concentric value adapts when
// nested, and the fallback kicks in when the component stands alone."
describe('the fallback radius (docs/reference.md §11)', () => {
  const spec = { type: 'concentric', inset: 10, fallback: 16 } as const;

  it('kicks in when the component stands alone', () => {
    expect(resolveShape(spec, 44)).toBe(16);
  });

  it('gives way to concentricity as soon as there is a parent', () => {
    expect(resolveShape(spec, 44, { cornerRadius: 40 })).toBe(30);
  });

  it('does not override a parent whose corner is tighter than the fallback', () => {
    // This is what makes it a fallback rather than a minimum: nested, the parent always wins.
    expect(resolveShape(spec, 44, { cornerRadius: 14 })).toBe(4);
  });

  it('is a square corner when there is neither a parent nor a fallback', () => {
    expect(resolveShape({ type: 'concentric', inset: 10 }, 44)).toBe(0);
  });

  it('is not a minimum, and a minimum is not it', () => {
    const floored = { type: 'concentric', inset: 10, minimum: 16 } as const;
    // A minimum holds the radius up while nested, which is breaking concentricity on purpose.
    expect(resolveShape(floored, 44, { cornerRadius: 14 })).toBe(16);
    expect(resolveShape(spec, 44, { cornerRadius: 14 })).toBe(4);
  });
});

// 356 @5:19: "keep an eye out for corners that feel too pinched — or flared."
describe('naming the defect (docs/reference.md §11)', () => {
  it('calls a correct pair concentric', () => {
    expect(concentricFit(28, 8, 20)).toBe('concentric');
  });

  it('calls too small a radius pinched, and too large flared', () => {
    expect(concentricFit(28, 8, 12)).toBe('pinched');
    expect(concentricFit(28, 8, 26)).toBe('flared');
  });

  it('lets a rounding error pass', () => {
    expect(concentricFit(28, 8, 20.3)).toBe('concentric');
    expect(concentricFit(28, 8, 19.7)).toBe('concentric');
  });

  it('holds at the floor: past the outer radius the honest answer is a square corner', () => {
    expect(concentricFit(10, 30, 0)).toBe('concentric');
    expect(concentricFit(10, 30, 8)).toBe('flared');
  });
});
