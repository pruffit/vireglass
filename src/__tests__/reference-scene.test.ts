import { describe, expect, it } from 'vitest';

import {
  REFERENCE_SCENES,
  REFERENCE_SCENE_HEIGHT,
  REFERENCE_SCENE_WIDTH,
  REFERENCE_SHAPES,
  refCheckerCells,
  refGradientSteps,
  refGray,
  referenceScene,
} from '../reference-scene';

/**
 * The tightest stage: the mobile lab's zone is 0.42 of screen height, and the shortest screen the
 * lab ever runs on is 600 dp; the narrowest is 360 dp.
 *
 * The numbers are duplicated on purpose: this package can't import from the mobile app — the
 * layers run the other way. The real guard test lives in the mobile app's own material-lab test
 * suite: it computes the zone height with the same formula as the product and checks it against
 * the canvas height.
 */
const TIGHTEST_STAGE_H = Math.round(600 * 0.42);
const TIGHTEST_STAGE_W = 360;

describe('reference canvases', () => {
  it('the canvas fits inside the tightest stage entirely', () => {
    expect(REFERENCE_SCENE_HEIGHT).toBeLessThanOrEqual(TIGHTEST_STAGE_H);
    expect(REFERENCE_SCENE_WIDTH).toBeLessThan(TIGHTEST_STAGE_W);
  });

  // Canvases stack on the same stage: if the heights don't match, the element's parking spot
  // drifts too, and with it the whole profile.
  it('every canvas adds up to exactly the stage height', () => {
    for (const scene of REFERENCE_SCENES) {
      const sum = scene.bands(scene.level).reduce((acc, b) => acc + b.heightDp, 0);
      expect(`${scene.name}: ${sum}`).toBe(`${scene.name}: ${REFERENCE_SCENE_HEIGHT}`);
    }
  });

  it('the set covers the material promises and every canvas states what it checks', () => {
    expect(REFERENCE_SCENES.length).toBeGreaterThanOrEqual(6);
    for (const scene of REFERENCE_SCENES) {
      expect(scene.what.length).toBeGreaterThan(20);
    }
    for (const required of ['flat', 'stripes', 'busy', 'bar', 'steps']) {
      expect(() => referenceScene(required)).not.toThrow();
    }
  });

  it('canvas names do not repeat — benches use them to pick a zone', () => {
    const names = REFERENCE_SCENES.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('the largest shape fits inside the canvas', () => {
    const shapes = Object.values(REFERENCE_SHAPES);
    expect(Math.max(...shapes.map((g) => g.height))).toBeLessThan(REFERENCE_SCENE_HEIGHT);
    expect(Math.max(...shapes.map((g) => g.width))).toBeLessThan(REFERENCE_SCENE_WIDTH);
  });

  // Both platforms lay out checkerboard cells with the same generator: Math.random would give
  // different canvases, and then the screenshots would be incomparable again.
  it('the checkerboard lays out the same way for the same input', () => {
    const layer = referenceScene('busy').bands(0.5)[0].layer;
    if (layer.kind !== 'checker') throw new Error('the "busy" canvas must be a checkerboard');
    const a = refCheckerCells(layer, REFERENCE_SCENE_WIDTH, REFERENCE_SCENE_HEIGHT);
    const b = refCheckerCells(layer, REFERENCE_SCENE_WIDTH, REFERENCE_SCENE_HEIGHT);
    expect(a.length).toBe(Math.ceil(REFERENCE_SCENE_WIDTH / layer.cellDp) * Math.ceil(REFERENCE_SCENE_HEIGHT / layer.cellDp));
    expect(b).toEqual(a);
  });

  it('the gradient runs edge to edge', () => {
    const layer = referenceScene('gradient').bands(0.5)[0].layer;
    if (layer.kind !== 'gradient') throw new Error('the "gradient" canvas must be a gradient');
    const steps = refGradientSteps(layer);
    expect(steps).toHaveLength(layer.steps);
    expect(steps[0]).toBeCloseTo(layer.from);
    expect(steps[steps.length - 1]).toBeCloseTo(layer.to);
  });

  it('a level converts to gray the same way on both platforms', () => {
    expect(refGray(0)).toBe('#000000');
    expect(refGray(1)).toBe('#ffffff');
    expect(refGray(0.5)).toBe('#808080');
  });
});
