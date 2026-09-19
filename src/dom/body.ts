// The glass BODY (docs/reference.md §3): how dense the medium has to be over this particular
// backdrop, and which way it tints.
//
// The law is the lens shader's, lines 444–482, ported to one value per element instead of one per
// pixel — the DOM path has a single backdrop sample, not a plane. Constants keep their names from
// the shader so the two stay comparable.
import { BODY } from '../law';
import type { VireGlassOptics } from '../material';

const {
  capLoose: BODY_CAP_LOOSE,
  capTight: BODY_CAP_TIGHT,
  tintDark: TINT_DARK,
  tintLight: TINT_LIGHT,
  groundSpan: GROUND_SPAN,
  busyEdge: BUSY_EDGE,
  darkSideFrom: DARK_SIDE_FROM,
  darkSideTo: DARK_SIDE_TO,
  maxDemand: MAX_DEMAND,
} = BODY;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Only the two figures the law reads — the same narrowing `shadowOpacityFrom` uses. */
export type BodyBackdrop = { luma: number; busy: number };

export type GlassBody = {
  /** How much medium stands between the backdrop and the eye, 0…1. */
  density: number;
  /** Lightness the body tints toward. */
  tintLuma: number;
};

/**
 * `ink` is POLARITY, 1 light and 0 dark, matching the shader's uniform. The requirements are
 * evaluated at both ends and blended by it — computing at the current polarity alone makes the
 * glass dip toward the middle while a recolor is in flight.
 */
export function resolveBody(optics: VireGlassOptics, sample: BodyBackdrop, ink: number): GlassBody {
  const strict = clamp(optics.legibility * 2, 0, 1);
  const capLight = mix(BODY_CAP_LOOSE, BODY_CAP_TIGHT, strict);
  const floorDark = 1 - capLight;
  const pol = clamp(ink, 0, 1);
  // With no ink on it, the model promises transparent glass: the requirement fades out with
  // legibility rather than standing at a floor.
  const demand = clamp(optics.legibility * 4, 0, 1);

  const mean = clamp(sample.luma, 0, 1);
  const busy = Math.max(sample.busy, 0);

  // Direction of the tint follows the element's AVERAGE lightness, not a local spot: on a
  // gradient a local threshold cuts a diagonal step across the body.
  const darkSide = smoothstep(DARK_SIDE_FROM, DARK_SIDE_TO, mean);
  const away = mix(TINT_LIGHT, TINT_DARK, darkSide);
  const tintLuma = mix(away, mix(TINT_LIGHT, TINT_DARK, pol), demand);

  // How much medium it takes to push the lightness under the ink past its threshold, measured
  // from whichever edge of the backdrop's spread is closer to the ink — a light ink drowns in a
  // light patch right beneath it, and the average knows nothing about that patch.
  const edge = busy * BUSY_EDGE;
  const inkHi = Math.min(mean + edge, 1);
  const inkLo = Math.max(mean - edge, 0);
  const needForLight = inkHi > capLight ? clamp((inkHi - capLight) / Math.max(inkHi - TINT_DARK, 1e-4), 0, MAX_DEMAND) : 0;
  const needForDark = inkLo < floorDark ? clamp((floorDark - inkLo) / Math.max(TINT_LIGHT - inkLo, 1e-4), 0, MAX_DEMAND) : 0;
  const needForInk = mix(needForDark, needForLight, pol) * demand;

  // Fine texture the body has to stop being a window for, the same way roughness does it.
  const ground = busy * optics.legibility * GROUND_SPAN;

  return { density: Math.max(Math.max(optics.bodyDensity, ground), needForInk), tintLuma };
}

/**
 * PRESENCE (§3): over a uniform backdrop there is nothing to refract and the glass honestly
 * disappears — right for a piece of background, wrong for a control. The sign comes from the
 * BACKDROP, not from ink polarity: lighter over dark, darker over light. It is a minimum, not an
 * addition, so a body that is already dense enough is left alone.
 */
export function withPresence(body: GlassBody, optics: VireGlassOptics, sample: BodyBackdrop): GlassBody {
  if (optics.presence <= 0) return body;
  const mean = clamp(sample.luma, 0, 1);
  const lighter = mean < 0.5;
  const target = lighter ? Math.min(mean + optics.presence, 1) : Math.max(mean - optics.presence, 0);
  const separation = Math.abs(target - mean);
  const reached = Math.abs(body.tintLuma - mean) * body.density;
  if (reached >= separation) return body;
  const needed = separation / Math.max(Math.abs((lighter ? TINT_LIGHT : TINT_DARK) - mean), 1e-4);
  return {
    density: Math.max(body.density, Math.min(needed, MAX_DEMAND)),
    tintLuma: lighter ? Math.max(body.tintLuma, mean) : Math.min(body.tintLuma, mean),
  };
}
