// Rim light (docs/reference.md §2): a hairline along the whole silhouette — "not a band and not a
// bevel" — brighter toward the key light, with a second, weaker arc opposite it, outlined by a thin
// dark line, its colour taken from the environment and its strength from how light that is.
//
// Every number here is the lens shader's own, read from the law. The only thing that differs is
// the primitive: a conic gradient sampled at fixed angles instead of a per-pixel normal.
import { RIM } from '../law';
import type { VireGlassOptics } from '../material';

const {
  lobeExponent: LOBE_EXPONENT,
  opposingArc: OPPOSING_ARC,
  darkEdge: DARK_EDGE,
  contour: CONTOUR,
  whiteShare: WHITE_SHARE,
  reflectanceRef: REFLECTANCE_REF,
} = RIM;

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

const mixTo = (a: number, b: number, t: number) => a + (b - a) * t;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Lightness of an ambient colour, the weights the lens uses. */
export function ambientLuma(ambient: RimAmbient): number {
  return 0.2126 * ambient[0] + 0.7152 * ambient[1] + 0.0722 * ambient[2];
}

/** How strongly the line is drawn over a surround of this lightness (§2, §6). */
export function rimStrength(luma: number): number {
  return mixTo(RIM.strengthDark, RIM.strengthLight, smoothstep(RIM.ambientFrom, RIM.ambientTo, luma));
}

/**
 * The line's opacity where the rim's normal sits `deltaDeg` from the light: a floor all the way
 * round and the key-light lobe on top of it, all of it scaled by the medium's reflectance up to
 * the reference material's.
 */
export function rimLineAlpha(deltaDeg: number, optics: VireGlassOptics, luma: number): number {
  const reflect = Math.min(optics.fresnel / REFLECTANCE_REF, 1);
  const damping = optics.fresnel > 0 ? optics.specular / optics.fresnel : 0;
  const lobe = rimLobe(deltaDeg, damping);
  return clamp01(rimStrength(luma) * reflect * (CONTOUR + (1 - CONTOUR) * lobe));
}

/**
 * The gradient for the hairline: a light line round the whole contour, brighter toward the key
 * light, drawn over the dark edge. Its colour comes from the environment — "over a yellow flower
 * the rim is yellow, over sky it is blue" (§2) — lifted toward white, and its strength follows how
 * light the environment is.
 *
 * The opposing arc carries an iridescent fringe (§2), so `iridescence` pulls its channels apart
 * rather than lifting them together.
 *
 * Two layers, the line first: `--vireglass-rim` is a background list and paints as one.
 */
export function rimGradientCss(
  optics: VireGlassOptics,
  ambient: RimAmbient,
  light: readonly [number, number],
  appear = 1,
): string {
  const present = clamp01(appear);
  const start = lightConicAngle(light);
  const [ar, ag, ab] = ambient;
  const luma = ambientLuma(ambient);
  const line: string[] = [];

  for (let i = 0; i <= STOPS; i += 1) {
    const angle = (i / STOPS) * 360;
    const facing = Math.cos((angle * Math.PI) / 180);
    // The far arc is where dispersion shows as a fringe; the near one is a clean specular.
    const fringe = facing < 0 ? optics.iridescence * OPPOSING_ARC : 0;

    const r = ar + (1 - ar) * clamp01(WHITE_SHARE + fringe);
    const g = ag + (1 - ag) * WHITE_SHARE;
    const b = ab + (1 - ab) * clamp01(WHITE_SHARE - fringe);
    const alpha = rimLineAlpha(angle, optics, luma) * present;
    line.push(`rgba(${to255(r)},${to255(g)},${to255(b)},${alpha.toFixed(3)}) ${angle.toFixed(1)}deg`);
  }

  // Scaled by presence, not floored: the dark edge would otherwise outline an element that is not
  // there yet.
  const dark = `rgba(0,0,0,${(DARK_EDGE * present).toFixed(3)})`;
  return (
    `conic-gradient(from ${start.toFixed(1)}deg, ${line.join(', ')}), ` +
    `conic-gradient(${dark} 0deg, ${dark} 360deg)`
  );
}

export const RIM_WIDTH_PX = RIM.widthPx;

/**
 * The border for increased contrast (§9: elements become "predominantly black or white" and are
 * highlighted "with a contrasting border").
 *
 * Not a gradient: the two arcs above are a light source reflecting off a curved edge, and under
 * this setting the edge is not reporting where the light is, it is separating the element from
 * everything around it. It has to hold at every angle, including the one facing away from the key
 * light where the ordinary rim falls back to a dim dark line.
 */
export function contrastRimCss(bodyLuma: number, rimLuma: number, appear = 1): string {
  const v = to255(rimLuma);
  // Opaque on purpose once the element is there. A border that lets the backdrop through is the
  // thing this setting exists to replace, and the body behind it is already at its own pole.
  void bodyLuma;
  const present = clamp01(appear);
  const colour = present >= 1 ? `rgb(${v},${v},${v})` : `rgba(${v},${v},${v},${present.toFixed(3)})`;
  return `conic-gradient(${colour} 0deg, ${colour} 360deg)`;
}
