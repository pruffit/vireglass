import { describe, expect, it } from 'vitest';
import { CONFIRMATIONS, FLIP_LUMA, RETURN_LUMA, type BackdropSample } from '../adaptation';
import {
  aggregate,
  createGroupState,
  GRADIENT,
  probeValuesAt,
  SETTLE,
  smoothPlane,
  type GroupMember,
  type GroupPlane,
} from '../group-model';

const LEGIBILITY = 0.26;

/** Backdrop under a member: flat by default (lo and hi equal lightness). A separate `hi` is a
 *  highlight under the glass edge, used to check the decision's lean toward the light side. */
const sample = (luma: number, hi = luma): BackdropSample => ({
  luma,
  busy: 0,
  lo: luma,
  hi,
  r: luma,
  g: luma,
  b: luma,
});

const member = (x: number, luma: number, legibility = LEGIBILITY, hi = luma): GroupMember => ({
  x,
  y: 0,
  sample: sample(luma, hi),
  legibility,
});

function makeState() {
  const planes: (GroupPlane | null)[] = [];
  const flips: number[] = [];
  const state = createGroupState({
    plane: (p) => planes.push(p),
    flip: (p) => flips.push(p),
  });
  const report = (id: string, x: number, luma: number, legibility = LEGIBILITY, hi = luma) =>
    state.report(id, x, 0, sample(luma, hi), legibility);
  return { state, planes, flips, report };
}

describe('group estimate from its members', () => {
  it('an empty group has nothing to estimate', () => {
    expect(aggregate([])).toBeNull();
  });

  it('losing a member recomputes the group estimate', () => {
    const { state, planes, report } = makeState();
    report('a', 0, 0.2);
    report('b', 100, 0.8);
    const before = state.plane();
    expect(before).not.toBeNull();

    state.release('b');
    const after = state.plane();
    expect(planes.length).toBe(3);
    // The estimate moves toward the remaining member: the one that left no longer pulls it toward the light side.
    expect(after?.base).toBeLessThan(before?.base ?? 0);
    expect(after?.ml).toBeLessThan(before?.ml ?? 0);
  });

  it('losing the last member resets the estimate', () => {
    const { state, planes, report } = makeState();
    report('a', 0, 0.8);
    expect(state.plane()).not.toBeNull();

    state.release('a');
    expect(state.plane()).toBeNull();
    expect(planes.at(-1)).toBeNull();
  });

  it('releasing someone not in the group changes nothing', () => {
    const { state, planes, report } = makeState();
    report('a', 0, 0.8);
    state.release('b');
    expect(planes.length).toBe(1);
    expect(state.plane()).not.toBeNull();
  });

  it('the estimate moves toward a new sample by a SMOOTH fraction, not a jump', () => {
    const first = aggregate([member(0, 0)])?.plane as GroupPlane;
    const second = aggregate([member(0, 1)])?.plane as GroupPlane;
    // There's nothing to smooth the first sample from — it is the estimate.
    expect(smoothPlane(null, first)).toBe(first);
    const smoothed = smoothPlane(first, second);
    expect(smoothed.ml).toBeGreaterThan(first.ml);
    expect(smoothed.ml).toBeLessThan(second.ml);
  });

  // An exponential never actually reaches its target: without a snap, the estimate kept
  // "changing" at the level of denormals for two more minutes after the backdrop had settled,
  // and dragged the lens mapper along the whole time.
  it('the estimate reaches the sample in a handful of steps, not forever', () => {
    const target = aggregate([member(0, 0.05)])?.plane as GroupPlane;
    let plane = aggregate([member(0, 0.9)])?.plane as GroupPlane;
    let steps = 0;
    let prev: GroupPlane;
    do {
      prev = plane;
      plane = smoothPlane(plane, target);
      steps += 1;
    } while (plane.base !== prev.base && steps < 1000);
    expect(steps).toBeLessThan(100);
    expect(plane.base).toBe(target.base);
    expect(SETTLE).toBeLessThan(1 / 255 / 100);
  });

  // A converged estimate must not produce a new object: React would otherwise repaint the group
  // on every sample, including on a still screen.
  it('a converged estimate is handed back as the same object', () => {
    const target = aggregate([member(0, 0.05)])?.plane as GroupPlane;
    let plane = aggregate([member(0, 0.9)])?.plane as GroupPlane;
    for (let i = 0; i < 200; i += 1) plane = smoothPlane(plane, target);
    expect(smoothPlane(plane, target)).toBe(plane);
  });
});

describe('group polarity', () => {
  // A real find from review: `release` shared a path with the polarity decision, and unmounting
  // the group racked up confirmations instantly.
  it('losing a member does not move the confirmation counter', () => {
    const { state, flips, report } = makeState();
    report('a', 0, 0.95);
    report('b', 100, 0.95);
    expect(state.confirmations()).toBe(2);

    state.release('b');
    expect(state.confirmations()).toBe(2);
    expect(state.polarity()).toBe(1);
    expect(flips).toEqual([]);
  });

  it('a recolor requires CONFIRMATIONS consecutive samples', () => {
    const { state, flips, report } = makeState();
    for (let i = 1; i < CONFIRMATIONS; i += 1) report('a', 0, 0.95);
    expect(flips).toEqual([]);

    report('a', 0, 0.95);
    expect(flips).toEqual([0]);
    expect(state.polarity()).toBe(0);
    expect(state.confirmations()).toBe(0);
  });

  it('a sample within the glass zeroes out accumulated confirmations', () => {
    const { state, report } = makeState();
    report('a', 0, 0.95);
    expect(state.confirmations()).toBe(1);
    report('a', 0, 0.3);
    expect(state.confirmations()).toBe(0);
  });

  // Member order is checked both ways: a requirement keyed to the last member in the list would
  // leave the group with light ink exactly where a pickier neighbor can no longer read it.
  it('the legibility requirement is the strictest among members, not the last in order', () => {
    const lax = member(0, 0.72, 0.05);
    const strict = member(100, 0.72, 0.6);
    expect(aggregate([lax, strict])?.decision.legibility).toBe(0.6);
    expect(aggregate([strict, lax])?.decision.legibility).toBe(0.6);
  });

  // The group flips as a whole based on the lightness beneath it, with a gap: the way back is
  // noticeably earlier.
  it('the group flips to dark ink above the threshold and only returns below the reverse one', () => {
    const block = makeState();
    for (let i = 0; i < CONFIRMATIONS; i += 1) block.report('a', 0, FLIP_LUMA + 0.02);
    expect(block.flips).toEqual([0]);
    for (let i = 0; i < CONFIRMATIONS; i += 1) block.report('a', 0, (FLIP_LUMA + RETURN_LUMA) / 2);
    expect(block.flips).toEqual([0]);
    for (let i = 0; i < CONFIRMATIONS; i += 1) block.report('a', 0, RETURN_LUMA - 0.02);
    expect(block.flips).toEqual([0, 1]);
  });

  // A highlight under the glass edge: the group average is still dark, but the lightest spot no
  // longer is.
  it('the decision leans toward the group\'s lightest spot, not the average', () => {
    const flat = aggregate([member(0, 0.6), member(100, 0.6)])?.decision;
    const lit = aggregate([member(0, 0.6), member(100, 0.6, LEGIBILITY, 1)])?.decision;
    expect(flat?.decisive).toBeCloseTo(0.6, 5);
    expect(lit?.decisive).toBeGreaterThan(0.6);
    expect(lit?.decisive).toBeLessThan(1);
  });

  it('a highlight recolors the group; a flat backdrop of the same lightness does not', () => {
    const flat = makeState();
    const lit = makeState();
    for (let i = 0; i < CONFIRMATIONS; i += 1) {
      flat.report('a', 0, 0.6, 0.6);
      lit.report('a', 0, 0.6, 0.6, 1);
    }
    expect(flat.flips).toEqual([]);
    expect(lit.flips).toEqual([0]);
  });
});

describe('the lightness plane across members', () => {
  // A black/white border across the group: without damping, members get exactly their own
  // values, and the group falls apart into independent elements.
  const edge = [member(0, 0), member(1, 0.3), member(2, 0.7), member(3, 1)];
  const plane = aggregate(edge)?.plane as GroupPlane;
  const at = edge.map((m) => probeValuesAt(plane, m.x)[0]);

  it('density is set by the group\'s lightest spot', () => {
    expect(plane.base).toBe(1);
    expect(at[3]).toBeCloseTo(plane.base, 5);
    // Both orderings: a sample keyed to the last one in the list would give the group a black
    // edge on the reversed row.
    expect(aggregate([...edge].reverse())?.plane.base).toBe(1);
  });

  it('across a black/white border, members do not get their own values', () => {
    // Each one moved from its own sample toward the group's lightest spot by more than half.
    for (const [i, m] of edge.entries()) {
      const own = m.sample.luma;
      if (own < plane.base) expect(at[i]).toBeGreaterThan(own + 0.6 * (plane.base - own));
    }
    expect(at[0]).toBeGreaterThan(0.6);
  });

  it('the spread across the group is squeezed to a GRADIENT fraction', () => {
    const own = 1 - 0;
    expect(Math.max(...at) - Math.min(...at)).toBeLessThanOrEqual(GRADIENT * own * 1.05);
  });

  it('lightness decreases toward the dark end — the group tints as a gradient, not in steps', () => {
    for (let i = 1; i < at.length; i += 1) expect(at[i]).toBeGreaterThan(at[i - 1] - 1e-9);
    expect(at[0]).toBeLessThan(at[3]);
  });

  // The group slope is measured in screen dp, while the shader multiplies `u_probeSlope` by a
  // position within the element: passing it through as-is would shift tinting by orders of
  // magnitude.
  it('the plane\'s slope does not carry over into the lens', () => {
    expect(plane.slope).toBeGreaterThan(0);
    const values = probeValuesAt(plane, 0);
    expect(values).toHaveLength(9);
    expect(values[4]).toBe(0);
    expect(values[5]).toBe(0);
  });

  it('the remaining measurement values are shared across the group', () => {
    const calm: GroupMember = {
      ...member(0, 0.2),
      sample: { luma: 0.2, busy: 0.1, lo: 0.1, hi: 0.3, r: 0.2, g: 0.2, b: 0.2 },
    };
    const loud: GroupMember = {
      ...member(1, 0.6),
      sample: { luma: 0.6, busy: 0.8, lo: 0.4, hi: 0.9, r: 0.6, g: 0.6, b: 0.6 },
    };
    // Both orderings: a sample keyed to the last one in the list would make the group pick up
    // variegation sometimes and its absence other times.
    for (const order of [
      [calm, loud],
      [loud, calm],
    ]) {
      const mixed = aggregate(order)?.plane as GroupPlane;
      // Variegation and the extremes are the group's heaviest; color is the members' average.
      expect(mixed.rest[0]).toBe(0.8);
      expect(mixed.rest[1]).toBe(0.1);
      expect(mixed.rest[2]).toBe(0.9);
      expect(mixed.rest[3]).toBeCloseTo(0.4, 5);
    }
  });
});
