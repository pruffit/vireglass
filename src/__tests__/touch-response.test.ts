import { describe, expect, it } from 'vitest';
import { createDeform } from '../touch-response';
import {
  activeMaterial,
  materialForInk,
  resolveOptics,
  VIREGLASS_CLEAR_MATERIAL,
  VIREGLASS_CONTROL_MATERIAL,
  VIREGLASS_MATERIAL,
} from '../material';

/** Run the response for N seconds in 60 Hz frame steps. */
function settle(d: ReturnType<typeof createDeform>, seconds: number): void {
  for (let i = 0; i < Math.round(seconds * 60); i += 1) d.step(1 / 60);
}

describe('finger response', () => {
  it('at rest everything is zero and the element counts as settled', () => {
    const d = createDeform();
    expect(d.idle()).toBe(true);
    const s = d.sample();
    expect(s.pullX).toBe(0);
    expect(s.pullY).toBe(0);
    expect(s.press).toBe(0);
    expect(s.waveAmp).toBe(0);
  });

  it('touch remembers the BLOB, not the element center: drag happens where it was grabbed', () => {
    const d = createDeform();
    d.grab(40, -12, 4);
    settle(d, 0.3);
    const s = d.sample();
    expect(s.touchX).toBeGreaterThan(20);
    expect(s.touchY).toBeLessThan(0);
  });

  it('drag follows the finger and saturates at the travel limit', () => {
    const d = createDeform();
    d.grab(0, 0, 0);
    d.drag(400, 0, 6);
    settle(d, 1);
    const s = d.sample();
    expect(s.pullX).toBeGreaterThan(0);
    expect(s.pullX).toBeLessThanOrEqual(6 + 1e-6);
  });

  it('a rightward drag does NOT pull the element left: the sign is preserved', () => {
    const d = createDeform();
    d.grab(0, 0, 0);
    d.drag(-200, 0, 6);
    settle(d, 1);
    expect(d.sample().pullX).toBeLessThan(0);
  });

  it('after release the shape snaps back with almost no overshoot', () => {
    const d = createDeform();
    d.grab(0, 0, 0);
    d.drag(300, 0, 6);
    settle(d, 0.6);
    const held = d.sample().pullX;
    d.release(0);
    // Half a second later the snap-back has already happened, and overshoot doesn't exceed a
    // tenth of the travel: a dense medium returns quickly and doesn't oscillate.
    settle(d, 0.5);
    const back = d.sample().pullX;
    expect(Math.abs(back)).toBeLessThan(Math.abs(held) * 0.1);
    // Full settling happens later than the shape snapping back: press fades at its own pace.
    settle(d, 1.5);
    expect(d.idle()).toBe(true);
  });

  it('press builds up and fades, rather than switching', () => {
    const d = createDeform();
    d.grab(0, 0, 0);
    d.step(1 / 60);
    const early = d.sample().press;
    settle(d, 0.5);
    const full = d.sample().press;
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(full);
    d.release(0);
    settle(d, 1);
    expect(d.sample().press).toBeLessThan(0.05);
  });

  it('the wave decays within a quarter second, rather than oscillating', () => {
    const d = createDeform();
    d.grab(0, 0, 4);
    const start = d.sample().waveAmp;
    settle(d, 0.25);
    expect(start).toBeGreaterThan(0);
    expect(d.sample().waveAmp).toBeLessThan(start * 0.4);
  });

  it('the step does not depend on frame rate: sparse frames give the same result', () => {
    const fast = createDeform();
    const slow = createDeform();
    fast.grab(0, 0, 0);
    slow.grab(0, 0, 0);
    fast.drag(200, 0, 6);
    slow.drag(200, 0, 6);
    for (let i = 0; i < 60; i += 1) fast.step(1 / 60);
    for (let i = 0; i < 15; i += 1) slow.step(1 / 15);
    expect(slow.sample().pullX).toBeCloseTo(fast.sample().pullX, 1);
  });
});

describe('control material', () => {
  it('thicker and clearer than the baseline: a control is an object, not a lens over a backdrop', () => {
    const c = VIREGLASS_CONTROL_MATERIAL;
    const b = VIREGLASS_MATERIAL;
    expect(c.bevel).toBeGreaterThan(b.bevel);
    expect(c.thickness).toBeGreaterThan(b.thickness);
    expect(c.ior).toBeGreaterThan(b.ior);
    expect(c.roughness).toBeLessThan(b.roughness);
    expect(c.presence).toBeGreaterThan(b.presence);
  });

  it('environment and film stay at baseline: their role does not depend on being a control', () => {
    expect(VIREGLASS_CONTROL_MATERIAL.environment).toBe(VIREGLASS_MATERIAL.environment);
    expect(VIREGLASS_CONTROL_MATERIAL.film).toBe(VIREGLASS_MATERIAL.film);
  });

  it('an element with no ink need not separate lightness; one with ink must', () => {
    expect(materialForInk(VIREGLASS_CONTROL_MATERIAL, false).legibility).toBe(0);
    expect(materialForInk(VIREGLASS_CONTROL_MATERIAL, true).legibility).toBeGreaterThan(0.9);
  });

  // Material variants don't mix: for the transparent one, legibility is held by the dimming
  // layer, and raising its requirement would silently turn it into ordinary glass.
  it("the transparent variant stays transparent even under ink", () => {
    const clear = materialForInk(VIREGLASS_CLEAR_MATERIAL, true);
    expect(clear.legibility).toBe(0);
    expect(clear.dimming).toBeGreaterThan(0);
    expect(resolveOptics(clear).dimming).toBeGreaterThan(0);
  });

  it('active is a state of the MEDIUM: denser, thicker, wider bevel, clearer', () => {
    const off = activeMaterial(VIREGLASS_CONTROL_MATERIAL, 0);
    const on = activeMaterial(VIREGLASS_CONTROL_MATERIAL, 1);
    expect(off).toEqual(VIREGLASS_CONTROL_MATERIAL);
    expect(on.ior).toBeGreaterThan(off.ior);
    expect(on.thickness).toBeGreaterThan(off.thickness);
    expect(on.bevel).toBeGreaterThan(off.bevel);
    expect(on.roughness).toBeLessThan(off.roughness);
    expect(on.presence).toBeGreaterThan(off.presence);
  });

  it('active does NOT touch environment: a state indicator must not depend on the backdrop', () => {
    expect(activeMaterial(VIREGLASS_CONTROL_MATERIAL, 1).environment).toBe(
      VIREGLASS_CONTROL_MATERIAL.environment,
    );
  });

  it('the active fraction is clamped: the state stops growing outside 0…1', () => {
    expect(activeMaterial(VIREGLASS_CONTROL_MATERIAL, 5)).toEqual(
      activeMaterial(VIREGLASS_CONTROL_MATERIAL, 1),
    );
    expect(activeMaterial(VIREGLASS_CONTROL_MATERIAL, -5)).toEqual(
      activeMaterial(VIREGLASS_CONTROL_MATERIAL, 0),
    );
  });
});
