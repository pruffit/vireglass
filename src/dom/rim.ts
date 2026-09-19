// Rim light (docs/reference.md §2): a hairline along the silhouette — "not a band and not a
// bevel" — carrying two opposing arcs, the rest of it outlined by a thin dark line, and its colour
// taken from the environment.
//
// Every number here is the lens shader's own. The key-light lobe is `lens-shader.ts` line 375
// verbatim (exponent 3, opposing arc at 0.45), and the dark edge is its line 528 (a 0.22
// darkening at the silhouette). The only thing that differs is the primitive: a conic gradient
// sampled at fixed angles instead of a per-pixel normal.
import { RIM } from '../law';
import type { VireGlassOptics } from '../material';

const { lobeExponent: LOBE_EXPONENT, opposingArc: OPPOSING_ARC, darkEdge: DARK_EDGE } = RIM;

/** One stop every 7.5°. Fine enough that a cubic lobe reads as a smooth arc rather than a fan. */
const STOPS = 48;

/**
 * Screen space has y pointing down; a CSS conic gradient starts at 12 o'clock and runs clockwise.
 * A point at conic angle φ therefore has outward normal `(sin φ, -cos φ)`, which is what the lobe
 * is measured against.
 */
export function lightConicAngle(light: readonly [number, number]): number {
  const [lx, ly] = light;
  const deg = (Math.atan2(lx, -ly) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** The shader's key-light lobe, evaluated for a rim point whose normal sits `deltaDeg` away from
 *  the light. Both arcs come out of this one expression — that is why they are opposed. */
export function rimLobe(deltaDeg: number, specular: number): number {
  const facing = Math.cos((deltaDeg * Math.PI) / 180);
  const front = facing > 0 ? Math.pow(facing, LOBE_EXPONENT) : 0;
  const back = facing < 0 ? Math.pow(-facing, LOBE_EXPONENT) : 0;
  return specular * (front + OPPOSING_ARC * back);
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const to255 = (v: number) => Math.round(clamp01(v) * 255);

export type RimAmbient = readonly [number, number, number];

/**
 * The gradient for the hairline. Colour comes from the environment — "over a yellow flower the rim
 * is yellow, over sky it is blue" (§2) — lifted toward white where the key light lands. Away from
 * both arcs only the dark edge remains.
 *
 * The opposing arc carries an iridescent fringe (§2), so `iridescence` pulls its channels apart
 * rather than lifting them together.
 */
export function rimGradientCss(
  optics: VireGlassOptics,
  ambient: RimAmbient,
  light: readonly [number, number],
): string {
  const start = lightConicAngle(light);
  const [ar, ag, ab] = ambient;
  const stops: string[] = [];

  for (let i = 0; i <= STOPS; i += 1) {
    const angle = (i / STOPS) * 360;
    const key = rimLobe(angle, optics.specular);
    const facing = Math.cos((angle * Math.PI) / 180);
    // The far arc is where dispersion shows as a fringe; the near one is a clean specular.
    const fringe = facing < 0 ? optics.iridescence * OPPOSING_ARC : 0;
    const lift = clamp01(key * optics.fresnel);

    const r = ar + (1 - ar) * clamp01(lift + fringe);
    const g = ag + (1 - ag) * lift;
    const b = ab + (1 - ab) * clamp01(lift - fringe);

    const alpha = clamp01(DARK_EDGE + lift * (1 - DARK_EDGE));
    // Below the arcs the line is the dark edge itself, not a dim copy of the environment.
    const colour = lift > 0.001 ? `rgba(${to255(r)},${to255(g)},${to255(b)},${alpha.toFixed(3)})` : `rgba(0,0,0,${DARK_EDGE})`;
    stops.push(`${colour} ${angle.toFixed(1)}deg`);
  }

  return `conic-gradient(from ${start.toFixed(1)}deg, ${stops.join(', ')})`;
}

export const RIM_WIDTH_PX = RIM.widthPx;
