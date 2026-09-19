import { describe, expect, it, vi } from 'vitest';
import { createGlassGroup } from '../dom/group';
import type { BackdropSample } from '../adaptation';
import type { GlassHandle } from '../dom/index';

const sample = (luma: number): BackdropSample => ({ luma, lo: luma, hi: luma, busy: 0, r: luma, g: luma, b: luma });

function member(x: number, width = 44) {
  const handle: GlassHandle = { update: vi.fn(), setAppear: vi.fn(), setMorph: vi.fn(), destroy: vi.fn() };
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
