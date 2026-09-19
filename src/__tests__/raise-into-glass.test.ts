import { describe, expect, it } from 'vitest';
import { raiseIntoGlass } from '../touch-response';

describe('raising a control into glass', () => {
  it('at rest the control is frosted', () => {
    expect(raiseIntoGlass(0)).toEqual({ glass: 0, solid: 1 });
  });

  it('under full press only the lens remains', () => {
    expect(raiseIntoGlass(1)).toEqual({ glass: 1, solid: 0 });
  });

  // Lifting off the backdrop is deliberately not part of this: the shader's `u_lift` is a
  // direction, and the magnitude comes from press, which it's multiplied by. A third fraction
  // here would mean press squared.
  it('does not return a lift fraction — press itself plays that role', () => {
    expect(Object.keys(raiseIntoGlass(0.5)).sort()).toEqual(['glass', 'solid']);
  });

  // The fractions are split across curves specifically for this overlap: if they summed to
  // exactly one, midway through the transition the backdrop would flash through the knob for an
  // instant — a hole where the control should be.
  it('glass and frost overlap throughout the whole transition', () => {
    for (let i = 0; i <= 20; i += 1) {
      const t = i / 20;
      const { glass, solid } = raiseIntoGlass(t);
      expect(glass + solid, `press ${t}`).toBeGreaterThanOrEqual(1);
    }
  });

  it('glass arrives faster than frost leaves', () => {
    const { glass, solid } = raiseIntoGlass(0.5);
    expect(glass).toBeGreaterThan(0.5);
    expect(solid).toBeGreaterThan(0.5);
  });

  it('both fractions move monotonically', () => {
    let glassWas = -1;
    let solidWas = 2;
    for (let i = 0; i <= 20; i += 1) {
      const { glass, solid } = raiseIntoGlass(i / 20);
      expect(glass).toBeGreaterThanOrEqual(glassWas);
      expect(solid).toBeLessThanOrEqual(solidWas);
      glassWas = glass;
      solidWas = solid;
    }
  });

  it('clamps past the ends of the scale', () => {
    expect(raiseIntoGlass(-1)).toEqual(raiseIntoGlass(0));
    expect(raiseIntoGlass(4)).toEqual(raiseIntoGlass(1));
  });
});
