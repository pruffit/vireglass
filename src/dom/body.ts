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
 * disappears — right for a piece of background, wrong for a control. It is a MINIMUM, not an
 * addition, so a body that already stands apart is left alone.
 *
 * The direction is the body's own. The previous version decided "lighter over dark, darker over
 * light" from the backdrop alone, and then, when the body disagreed, clamped `tintLuma` to the
 * backdrop's mean — the one value that separates from nothing. Light ink over a dark backdrop puts
 * the body at 0.07 against a backdrop of 0.12: already separating, downward, and the clamp pulled
 * it back onto the backdrop. Measured on the default material at presence 0.08: exactly 0.0000 at
 * backdrops of 0.12, 0.20 and 0.35.
 *
 * What the demand is DIVIDED by is deliberately the distance to the tint's pole rather than to the
 * body's own tint. Dividing by the latter is arithmetically tighter and asks for far more density
 * wherever the two are close — enough to drive it to the ceiling over a dark backdrop and stop the
 * glass being a window at all, which check:optics says plainly. Presence is a floor on visibility,
 * not a licence to go opaque.
 */
export function withPresence(body: GlassBody, optics: VireGlassOptics, sample: BodyBackdrop): GlassBody {
  if (optics.presence <= 0) return body;
  const mean = clamp(sample.luma, 0, 1);
  // Whichever side the body is already on; with nothing to go on, the side with more room.
  const above = Math.abs(body.tintLuma - mean) > 1e-4 ? body.tintLuma > mean : mean < 0.5;
  const pole = above ? TINT_LIGHT : TINT_DARK;
  const separation = Math.min(optics.presence, Math.abs(pole - mean));
  const reached = Math.abs(body.tintLuma - mean) * body.density;
  if (reached >= separation) return body;
  const needed = separation / Math.max(Math.abs(pole - mean), 1e-4);
  return {
    density: Math.max(body.density, Math.min(needed, BODY.presenceDemand)),
    // Left where the tint law put it, unless it landed exactly on the backdrop — which is the
    // case that used to be created here rather than avoided.
    tintLuma: Math.abs(body.tintLuma - mean) > 1e-4 ? body.tintLuma : pole,
  };
}
