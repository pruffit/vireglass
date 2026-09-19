import { CONFIRMATIONS, FLIP_LUMA, RETURN_LUMA, type BackdropSample } from './adaptation';

/**
 * GLASS GROUP ESTIMATE — the pure part of the surface group (`glass-group.tsx`).
 *
 * Everything that decides lives here: the lightness plane from members' samples, the group's
 * aggregates, the polarity requirement and its hysteresis. None of these rules need React or the
 * native layer, so they live apart from the component and are checked by a unit test.
 */

export type GroupMember = { x: number; y: number; sample: BackdropSample; legibility: number };

/** Group estimate: center and average lightness, slope along x, the lightest spot, and the
 *  measurement values shared by everyone — [variegation, lo, hi, r, g, b]. */
export type GroupPlane = {
  mx: number;
  ml: number;
  slope: number;
  base: number;
  rest: number[];
};

/** Input to the polarity decision: the lightness the group judges by, and the strictest of the requirements. */
export type GroupDecision = { decisive: number; legibility: number };

/** Fraction of a new sample in the smoothed estimate. Samples come in from every member, so the
 *  group collects roughly twenty a second — a quarter is enough for a response within ~200 ms. */
export const SMOOTH = 0.25;

/** The remainder below which smoothing snaps the value to the sample. An exponential never
 *  actually reaches its target, and the estimate kept "changing" by denormals for two more
 *  minutes after the backdrop had settled. */
export const SETTLE = 1e-6;

/**
 * Fraction of the slope that reaches the members.
 *
 * A plane through four points nearly interpolates them: right at a black/white border, buttons
 * were getting 0.0, 0.3, 0.7 and 1.0 — that is, exactly their own individual values, and the
 * group fell apart into independent elements again. Density is set by the group's LIGHTEST spot;
 * the slope only lets it off slightly at the dark end.
 */
export const GRADIENT = 0.35;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Lightness plane from members' samples. The slope is a least-squares fit along x: the group's
 * members stand in a row, and one axis is enough — there's no vertical spread among them. The
 * coordinates are centered, so the normal equations decouple.
 */
function fitLuma(members: readonly GroupMember[]): {
  mx: number;
  ml: number;
  slope: number;
} {
  const n = members.length;
  let mx = 0;
  let ml = 0;
  for (const m of members) {
    mx += m.x;
    ml += m.sample.luma;
  }
  mx /= n;
  ml /= n;
  let sxx = 0;
  let sxl = 0;
  for (const m of members) {
    const dx = m.x - mx;
    sxx += dx * dx;
    sxl += dx * m.sample.luma;
  }
  return { mx, ml, slope: sxx > 1e-6 ? sxl / sxx : 0 };
}

/** Group estimate from its members. An empty group has nothing to estimate — that's `null`. */
export function aggregate(
  members: readonly GroupMember[],
): { plane: GroupPlane; decision: GroupDecision } | null {
  if (members.length === 0) return null;

  const { mx, ml, slope } = fitLuma(members);
  let busy = 0;
  let lo = 1;
  let hi = 0;
  // The group's lightest SPOT: density for everyone is computed from it. Otherwise, right at a
  // black/white border the group would hold to the average, a light ink would never darken
  // against anything, and it would drown over the light half.
  let base = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  // The legibility requirement is the group's strictest: polarity is one for all, and going by
  // the weakest requirement would leave a neighbor with pickier optics illegible.
  let legibility = 0;
  for (const m of members) {
    busy = Math.max(busy, m.sample.busy);
    lo = Math.min(lo, m.sample.lo);
    hi = Math.max(hi, m.sample.hi);
    base = Math.max(base, m.sample.luma);
    r += m.sample.r;
    g += m.sample.g;
    b += m.sample.b;
    legibility = Math.max(legibility, m.legibility);
  }
  const k = members.length;
  return {
    plane: { mx, ml, slope, base, rest: [busy, lo, hi, r / k, g / k, b / k] },
    // The polarity decision is one per group, by its AVERAGE lightness. Deciding on its own,
    // each button used to end up a different color over a busy backdrop.
    decision: { decisive: ml * 0.75 + hi * 0.25, legibility },
  };
}

/**
 * Smoothing runs over samples, not frames: the native lens smooths ITS OWN estimate, and the
 * group estimate overrides it with an already-finished value. Without this the group's tone
 * changed in steps — the probe's 180 ms cadence is too coarse for the adaptation to read as
 * unnoticeable.
 */
export function smoothPlane(prev: GroupPlane | null, next: GroupPlane): GroupPlane {
  if (!prev) return next;
  const e = (was: number, now: number) =>
    Math.abs(now - was) < SETTLE ? now : was + (now - was) * SMOOTH;
  const ml = e(prev.ml, next.ml);
  const slope = e(prev.slope, next.slope);
  const base = e(prev.base, next.base);
  const rest = next.rest.map((v, i) => e(prev.rest[i], v));
  // A converged estimate is handed back as the same object: otherwise `setPlane` would repaint
  // the group on every sample — twenty times a second, even on a still screen.
  const same =
    next.mx === prev.mx &&
    ml === prev.ml &&
    slope === prev.slope &&
    base === prev.base &&
    rest.every((v, i) => v === prev.rest[i]);
  return same ? prev : { mx: next.mx, ml, slope, base, rest };
}

/** The sample a member at position `x` hands its own lens — in the order of its prop. */
export function probeValuesAt(plane: GroupPlane, x: number): number[] {
  // Down from the group's lightest spot — by exactly as much as that spot is darker along the
  // plane, and even then only a GRADIENT fraction of it. This lets the dark end off on density,
  // without canceling it: the group stays a single material.
  const here = plane.ml + plane.slope * (x - plane.mx);
  const luma = clamp01(plane.base - (plane.base - here) * GRADIENT);
  // The slope doesn't carry over into the lens: the group's is measured in screen dp, while the
  // shader multiplies `u_probeSlope` by a normalized position within the element — different
  // units.
  return [luma, plane.rest[0], plane.rest[1], plane.rest[2], 0, 0, plane.rest[3], plane.rest[4], plane.rest[5]];
}

/** Whether the group needs to flip ink polarity given the current one (1 light, 0 dark). */
function wantsPolarityChange(decision: GroupDecision, polarity: number): boolean {
  return polarity === 1 ? decision.decisive >= FLIP_LUMA : decision.decisive < RETURN_LUMA;
}

export type GroupSink = {
  /** The group estimate has been recomputed: members take their values from it. */
  plane: (plane: GroupPlane | null) => void;
  /** The group flips ink polarity for everyone at once. */
  flip: (polarity: number) => void;
};

export type GroupState = {
  report: (
    id: string,
    x: number,
    y: number,
    sample: BackdropSample,
    legibility: number,
  ) => void;
  release: (id: string) => void;
  plane: () => GroupPlane | null;
  polarity: () => number;
  confirmations: () => number;
};

/** Group state: members, the smoothed estimate, and polarity hysteresis. */
export function createGroupState(sink: GroupSink): GroupState {
  const members = new Map<string, GroupMember>();
  let plane: GroupPlane | null = null;
  let pending = 0;
  let polarity = 1;

  const measure = (): GroupDecision | null => {
    const next = aggregate([...members.values()]);
    if (!next) {
      pending = 0;
      plane = null;
      sink.plane(null);
      return null;
    }
    plane = smoothPlane(plane, next.plane);
    sink.plane(plane);
    return next.decision;
  };

  return {
    report(id, x, y, sample, legibility) {
      members.set(id, { x, y, sample, legibility });
      const decision = measure();
      if (!decision) return;
      if (!wantsPolarityChange(decision, polarity)) {
        pending = 0;
        return;
      }
      pending += 1;
      if (pending < CONFIRMATIONS) return;
      pending = 0;
      polarity = polarity === 1 ? 0 : 1;
      sink.flip(polarity);
    },
    // Only recomputes the estimate: losing a member isn't a backdrop sample and can't count as a
    // polarity confirmation — unmounting the group used to rack up CONFIRMATIONS instantly and
    // trigger a recolor nobody was left to cancel.
    release(id) {
      if (members.delete(id)) measure();
    },
    plane: () => plane,
    polarity: () => polarity,
    confirmations: () => pending,
  };
}
