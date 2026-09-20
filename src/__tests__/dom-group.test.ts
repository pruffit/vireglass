import { describe, expect, it, vi } from 'vitest';
import { createGlassGroup } from '../dom/group';
import type { BackdropSample } from '../adaptation';
import type { GlassHandle } from '../dom/index';

const sample = (luma: number): BackdropSample => ({ luma, lo: luma, hi: luma, busy: 0, r: luma, g: luma, b: luma });

function member(x: number, width = 44) {
  const handle: GlassHandle = { update: vi.fn(), setAppear: vi.fn(), setAccent: vi.fn(), setNeighbourGlow: vi.fn(), setMorph: vi.fn(), destroy: vi.fn() };
  const el = {
    getBoundingClientRect: () => ({ left: x, top: 0, width, height: 44 }),
  } as unknown as HTMLElement;
  return { el, handle };
}

describe('glass group (docs/reference.md §3)', () => {
  it('reads every member and reaches one answer for all of them', () => {
    const a = member(0);
    const b = member(60);
    const probe = vi.fn(() => sample(0.1));
    const group = createGlassGroup([a, b], { probe });

    // Four reads: one per member at construction, one per member on the explicit update.
    group.update();
    expect(probe).toHaveBeenCalledTimes(4);
    expect(group.ink()).toBe(1);
  });

  it('skips a member with no box instead of dragging the estimate to the page origin', () => {
    const real = member(0);
    const collapsed = member(0, 0);
    const probe = vi.fn(() => sample(0.1));
    createGlassGroup([real, collapsed], { probe });
    // The collapsed one is released, not reported — so it is never probed either.
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('flips everyone at once rather than each on its own', () => {
    const a = member(0);
    const b = member(60);
    let luma = 0.05;
    const group = createGlassGroup([a, b], { probe: () => sample(luma) });

    // Over a bright backdrop the group has to give up light ink — and both members hear about it
    // in the same breath. Hysteresis needs several agreeing readings before it moves.
    luma = 0.98;
    for (let i = 0; i < 8; i += 1) group.update();

    expect(group.ink()).toBe(0);
    expect(a.handle.update).toHaveBeenCalled();
    expect(b.handle.update).toHaveBeenCalled();
  });
});

// 219 @12:11: "Starting right under your fingertips, the glow spreads throughout the element and
// onto any Liquid Glass elements nearby, interacting with the flexible properties of the material
// in a way that feels natural and fluid."
describe('the glow leaving its element (docs/reference.md §5)', () => {
  it('reaches a neighbour and skips the element it started on', () => {
    const touched = member(0);
    const beside = member(60);
    const group = createGlassGroup([touched, beside], { probe: () => sample(0.1) });

    group.carryGlow(0, { pageX: 22, pageY: 22, strength: 1 });

    expect(touched.handle.setNeighbourGlow).not.toHaveBeenCalled();
    expect(beside.handle.setNeighbourGlow).toHaveBeenCalledWith(
      expect.objectContaining({ strength: expect.any(Number) }),
    );
  });

  it('fades with distance rather than lighting the whole row equally', () => {
    const touched = member(0);
    const near = member(60);
    const far = member(200);
    const group = createGlassGroup([touched, near, far], { probe: () => sample(0.1) });

    group.carryGlow(0, { pageX: 22, pageY: 22, strength: 1 });

    const strengthOf = (m: ReturnType<typeof member>) => {
      const call = (m.handle.setNeighbourGlow as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1);
      const arg = call?.[0] as { strength: number } | null;
      return arg?.strength ?? 0;
    };
    expect(strengthOf(near)).toBeGreaterThan(0);
    // A glow that reached the whole screen would read as the page flashing.
    expect(strengthOf(far)).toBe(0);
    expect(strengthOf(near)).toBeLessThan(1);
  });

  it('clears everyone when the touch ends', () => {
    const a = member(0);
    const b = member(60);
    const group = createGlassGroup([a, b], { probe: () => sample(0.1) });
    group.carryGlow(0, { pageX: 22, pageY: 22, strength: 1 });
    group.carryGlow(0, null);
    expect(b.handle.setNeighbourGlow).toHaveBeenLastCalledWith(null);
  });
});
