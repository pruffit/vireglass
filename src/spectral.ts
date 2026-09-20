// The spectral edge (docs/reference.md §1). Dispersion, diffraction and interference are ONE
// cause — a dependence on wavelength — and one hue multiplier, normalised to its own mean, so they
// colour what passes through without brightening it.
//
// JS twins of the lens shader's `vgInterference`, `vgDiffraction` and the rim profile they read
// from. Same reason as the SDF's twins: the DOM path needs this geometry as numbers, and a second
// version that drifts is the defect the parity gate exists for.
import { LENS, SPECTRAL } from './law';

const TAU = 6.28318530718;
const LAMBDA: readonly [number, number, number] = [LENS.lambdaR, LENS.lambdaG, LENS.lambdaB];

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Normalises a triple to its own mean — the step that makes these hues rather than gains. */
function toHue(v: [number, number, number]): [number, number, number] {
  const mean = Math.max((v[0] + v[1] + v[2]) / 3, 0.001);
  return [v[0] / mean, v[1] / mean, v[2] / mean];
}

/** Mirrors `vgRimQd`: the derivative of the rim's height profile. */
export function rimSlopeCurve(x: number): number {
  const k = 1 - clamp01(x);
  return (k * k * k) / Math.pow(Math.max(1 - k * k * k * k, 1e-5), 0.75);
}

/** Mirrors `vgSlope`: the top face's slope at distance `e` inside the silhouette. */
export function surfaceSlope(e: number, bevel: number, rim: number, thick: number): number {
  if (e >= bevel || bevel <= 0) return 0;
  return Math.min(((thick - rim) / bevel) * rimSlopeCurve(e / bevel), LENS.slopeMax);
}

/** The normal's z, which is what both spectral terms are measured against. `N = normalize([n·s, 1])`
 *  in the shader, so its z is simply the slope resolved back to unit length. */
export function surfaceCosine(slope: number): number {
  return 1 / Math.sqrt(1 + slope * slope);
}

/** Thin-film interference: optical path difference 2·n·d·cosθt, each channel with its own λ. */
export function interference(cosI: number, filmNm: number): [number, number, number] {
  const sinT2 = (1 - cosI * cosI) / (LENS.filmIor * LENS.filmIor);
  const cosT = Math.sqrt(Math.max(1 - sinT2, 0));
  const opd = 2 * LENS.filmIor * filmNm * cosT;
  return toHue([
    0.5 + 0.5 * Math.cos((TAU * opd) / LAMBDA[0] + Math.PI),
    0.5 + 0.5 * Math.cos((TAU * opd) / LAMBDA[1] + Math.PI),
    0.5 + 0.5 * Math.cos((TAU * opd) / LAMBDA[2] + Math.PI),
  ]);
}

/** Edge diffraction: fringes get denser as the bevel sharpens. A hue, not a brightness. */
export function diffraction(distFromEdge: number, bevel: number): [number, number, number] {
  const phase = (TAU * SPECTRAL.diffractionFringes * distFromEdge) / Math.max(bevel, 1);
  const f = (lambda: number) => 0.5 + 0.5 * Math.cos((phase * SPECTRAL.referenceLambda) / lambda);
  return toHue([f(LAMBDA[0]), f(LAMBDA[1]), f(LAMBDA[2])]);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * Both terms at one point, weighted as the lens weights them: interference by `iridescence` across
 * the bevel, diffraction by its own strength but only within `diffractionOnset` of the silhouette.
 *
 * `e` is the distance inside the edge; everything else comes from the resolved optics.
 */
export function spectralHue(
  e: number,
  bevel: number,
  rim: number,
  thick: number,
  optics: { film: number; iridescence: number; diffraction: number },
): [number, number, number] {
  let r = 1;
  let g = 1;
  let b = 1;

  // `t` is 1 at the silhouette and 0 at the inner edge of the bevel, as below.
  const t = 1 - clamp01(bevel > 0 ? e / bevel : 1);

  if (optics.iridescence > 0.001) {
    // Windowed to the edge, for the same reason diffraction is: §2 puts the iridescence on the
    // opposing arc, and an arc is at the silhouette. Unwindowed, the surface angle stops changing a
    // third of the way in and the film paints the rest of the bevel one flat colour.
    const w = optics.iridescence * smoothstep(SPECTRAL.iridescenceOnset, 1, t);
    if (w > 0) {
      const cosI = clamp01(surfaceCosine(surfaceSlope(e, bevel, rim, thick)));
      const i = interference(cosI, optics.film);
      r += (i[0] - 1) * w;
      g += (i[1] - 1) * w;
      b += (i[2] - 1) * w;
    }
  }

  if (optics.diffraction > 0.001) {
    // The fringes live at the outer end of the bevel, which is what makes this an EDGE effect
    // rather than a sheen over it.
    const w = optics.diffraction * smoothstep(SPECTRAL.diffractionOnset, 1, t);
    if (w > 0) {
      const d = diffraction(e, bevel);
      r += (d[0] - 1) * w;
      g += (d[1] - 1) * w;
      b += (d[2] - 1) * w;
    }
  }

  return [r, g, b];
}
