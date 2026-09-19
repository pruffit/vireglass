import { describe, expect, it } from 'vitest';
import { concentricInset, concentricRadius } from '../concentric';

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
