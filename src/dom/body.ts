// The glass BODY (docs/reference.md §3): how dense the medium has to be over this particular
// backdrop, and which way it tints.
//
// The law is the lens shader's, ported to one value per element instead of one per
// pixel — the DOM path has a single backdrop sample, not a plane. Constants keep their names from
// the shader so the two stay comparable.
import { BODY, MEDIUM } from '../law';
import type { VireGlassOptics } from '../material';

const {
  capLoose: BODY_CAP_LOOSE,
  capTight: BODY_CAP_TIGHT,
  tintDark: TINT_DARK,
  tintLight: TINT_LIGHT,
  groundSpan: GROUND_SPAN,
  busyEdge: BUSY_EDGE,
  inkBusyFrom: INK_BUSY_FROM,
  inkBusyTo: INK_BUSY_TO,
  inkPoleTo: INK_POLE_TO,
  presenceDemand: PRESENCE_DEMAND,
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
  /** The part of the density the ink's legibility asked for, and the pole it asked toward. */
  need: number;
  pole: number;
};

/**
 * The body is lighter than its surroundings whatever the glyph on it is: glass concentrates light
 * (M 2:29), and the reference keeps a lighter body under a white glyph over sky as much as over
 * dark. It goes to the ink's own pole only where the ink's legibility is what holds the density —
 * or a system setting has raised it past anything a presence floor asks for.
 */
function tintFor(density: number, need: number, pole: number): number {
  const asked = Math.max(clamp(need / Math.max(density, 1e-4), 0, 1), smoothstep(PRESENCE_DEMAND, INK_POLE_TO, density));
  return mix(TINT_LIGHT, pole, asked);
}

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

  const pole = mix(TINT_LIGHT, TINT_DARK, pol);

  // How much medium it takes to push the lightness under the ink past its threshold, measured
  // from whichever edge of the backdrop's spread is closer to the ink — a light ink drowns in a
  // light patch right beneath it, and the average knows nothing about that patch.
  const edge = busy * BUSY_EDGE;
  const inkHi = Math.min(mean + edge, 1);
  const inkLo = Math.max(mean - edge, 0);
  const needForLight = inkHi > capLight ? clamp((inkHi - capLight) / Math.max(inkHi - TINT_DARK, 1e-4), 0, MAX_DEMAND) : 0;
  const needForDark = inkLo < floorDark ? clamp((floorDark - inkLo) / Math.max(TINT_LIGHT - inkLo, 1e-4), 0, MAX_DEMAND) : 0;
  // Over a flat backdrop the ink asks for nothing: polarity flips before it drowns. It is spread
  // under the ink that the body has to answer.
  const structured = smoothstep(INK_BUSY_FROM, INK_BUSY_TO, busy);
  const needForInk = mix(needForDark, needForLight, pol) * demand * structured;

  // Fine texture the body has to stop being a window for, the same way roughness does it.
  const ground = busy * optics.legibility * GROUND_SPAN;

  const density = Math.max(Math.max(optics.bodyDensity, ground), needForInk);
  return { density, tintLuma: tintFor(density, needForInk, pole), need: needForInk, pole };
}

/**
 * PRESENCE (§3): over a uniform backdrop there is nothing to refract and the glass honestly
 * disappears — right for a piece of background, wrong for a control. It is a MINIMUM, not an
 * addition, so a body that already stands apart is left alone.
 *
 * The direction is toward light, whatever the ink: the reference body is lighter than its
 * surroundings across the whole range, and only as far as the range allows — over a backdrop at
 * 0.96 there is no room to go lighter. The previous version took the body's own side, which put a
 * dark body under a light glyph over dark and over sky, where the reference is lighter.
 *
 * What the demand is DIVIDED by is deliberately the distance to the light pole rather than to the
 * body's own tint: dividing by the latter is arithmetically tighter and asks for far more density
 * wherever the two are close — enough to take the density to the ceiling and stop the glass being a
 * window at all, which check:optics says plainly. Presence is a floor on visibility, not a licence
 * to go opaque.
 */
export function withPresence(body: GlassBody, optics: VireGlassOptics, sample: BodyBackdrop): GlassBody {
  if (optics.presence <= 0) return body;
  const mean = clamp(sample.luma, 0, 1);
  const room = Math.max(TINT_LIGHT - mean, 0);
  const separation = Math.min(optics.presence, room);
  const reached = Math.max(body.tintLuma - mean, 0) * body.density;
  if (reached >= separation) return body;
  const density = Math.max(body.density, Math.min(separation / Math.max(room, 1e-4), PRESENCE_DEMAND));
  return { ...body, density, tintLuma: tintFor(density, body.need, body.pole) };
}

export type BodyLayer = {
  /** Straight (not premultiplied) colour, 0…1 per channel. */
  r: number;
  g: number;
  b: number;
  alpha: number;
};

/** The lens's `vgHue`: colour without lightness, and white below the lightness it has none at. */
function hueOf(c: readonly [number, number, number]): [number, number, number] {
  const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  if (l < 0.02) return [1, 1, 1];
  return [clamp(c[0] / l, 0, 2), clamp(c[1] / l, 0, 2), clamp(c[2] / l, 0, 2)];
}

/**
 * The body as ONE translucent layer over the backdrop, which is the form the DOM can draw it in.
 *
 * The lens does not paint a body, it transforms what it refracts, in a chain that stays affine in
 * the backdrop: a mix toward the tint at `density`, the matte lift, the medium's pull toward its
 * own lightness, the ambient spill and the concentration of light (§3, `MEDIUM`). Composing it
 * gives `out = A * backdrop + B` per channel, and a layer of colour `B / (1 - A)` at opacity
 * `1 - A` over the backdrop is exactly that.
 *
 * This is what lifts the body over a dark backdrop. The tint alone, under light ink, is darker
 * than the dark it sits on; the medium's pull, the matte lift and the concentration are what make
 * it read lighter, as in the reference (M 2:29, A 2:17).
 *
 * `appear` multiplies the layers exactly where the lens's `u_appear` does, so `optics` is the
 * element's optics BEFORE `applyAppear`: scaling both would count it twice.
 */
export function bodyLayer(
  optics: VireGlassOptics,
  sample: BodyBackdrop,
  ink: number,
  ambient: readonly [number, number, number],
  appear = 1,
): BodyLayer {
  const a = clamp(appear, 0, 1);
  const body = withPresence(resolveBody(optics, sample, ink), optics, sample);
  const hue = hueOf(ambient);
  const pickup = clamp(optics.colorPickup, 0, 1);
  const density = clamp(body.density * a, 0, 1);
  const matte = optics.legibility * MEDIUM.matteLift * a;
  const pull = MEDIUM.pull * a;
  const spill = optics.edgeLight * MEDIUM.ambientSpill * a;
  const lift = MEDIUM.concentrate * a;

  const alpha = 1 - (1 - lift) * (1 - pull) * (1 - density);
  const channel = (i: 0 | 1 | 2): number => {
    const tintHue = mix(1, hue[i], pickup);
    const added =
      (1 - pull) * (density * tintHue * body.tintLuma + matte * tintHue) +
      pull * hue[i] * MEDIUM.luma +
      ambient[i] * spill;
    return alpha > 1e-6 ? clamp(((1 - lift) * added + lift) / alpha, 0, 1) : 0;
  };
  return { r: channel(0), g: channel(1), b: channel(2), alpha };
}
