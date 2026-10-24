// The spectral edge, baked into an image (docs/reference.md §1).
//
// Diffraction and interference are hue multipliers that vary per pixel across the bevel, and an
// SVG filter has no way to evaluate a function per pixel. But it can MULTIPLY by an image:
// `feComposite operator="arithmetic"` with k1 set is a product, so the hue can be baked and
// applied in one pass.
//
// The multiplier exceeds 1 wherever a channel is boosted, and eight bits cannot carry that, so the
// map stores the hue divided by a headroom the filter multiplies back. Without the headroom every
// boosted channel would clip to white and the fringes would read as a bright rim rather than a
// coloured one.
import { bevelDp, rimDp, thicknessDp, type VireGlassGeometry } from '../geometry';
import type { VireGlassOptics } from '../material';
import { sdfRoundedRect } from '../sdf';
import { spectralHue } from '../spectral';

export type SpectralMap = { url: string; width: number; height: number; headroom: number };

/** A hue normalised to its own mean cannot exceed the number of channels; in practice it stays
 *  well under two. Two is the smallest headroom that never clips. */
const HEADROOM = 2;

/**
 * The hue map is sampled like the displacement map — across the bevel, not across the element. It
 * needs MORE samples than the displacement does, because fringes oscillate where the displacement
 * is monotonic, and undersampling a fringe pattern aliases it into a different one.
 */
const BEVEL_SAMPLES = 24;

function mapDensity(bevel: number, dpr: number): number {
  if (bevel <= 0) return dpr;
  return Math.min(dpr, BEVEL_SAMPLES / bevel);
}

/** Intervals of the hue table along the depth, read with linear interpolation. */
const DEPTH_STEPS = 2048;

/**
 * `spectralHue` is a function of the depth alone for one element, so it is tabled along the depth.
 * The nodes sit at `(k / DEPTH_STEPS)²` of the bevel: the rim's slope turns fastest at the silhouette.
 */
function hueAlongDepth(bevel: number, rim: number, thick: number, optics: VireGlassOptics): Float64Array {
  const table = new Float64Array((DEPTH_STEPS + 1) * 3);
  for (let k = 0; k <= DEPTH_STEPS; k += 1) {
    const s = k / DEPTH_STEPS;
    const [r, g, b] = spectralHue(s * s * bevel, bevel, rim, thick, optics);
    table[k * 3] = r;
    table[k * 3 + 1] = g;
    table[k * 3 + 2] = b;
  }
  return table;
}

export function renderSpectralPixels(
  optics: VireGlassOptics,
  geometry: VireGlassGeometry,
  dpr: number,
): { data: Uint8ClampedArray; width: number; height: number; headroom: number } {
  const bevel = bevelDp(geometry, optics);
  const density = mapDensity(bevel, dpr);
  const width = Math.max(1, Math.round(geometry.width * density));
  const height = Math.max(1, Math.round(geometry.height * density));
  const rim = rimDp(geometry, optics);
  const thick = thicknessDp(geometry, optics);

  const data = new Uint8ClampedArray(width * height * 4);
  const halfW = geometry.width / 2;
  const halfH = geometry.height / 2;
  const neutral = Math.round((1 / HEADROOM) * 255);
  const table = hueAlongDepth(bevel, rim, thick, optics);
  const toByte = 255 / HEADROOM;
  // Past the bevel the glass is plain: a neutral multiplier, not a missing one.
  new Uint32Array(data.buffer).fill(new Uint32Array(new Uint8ClampedArray([neutral, neutral, neutral, 255]).buffer)[0]!);
  const corner = Math.max(geometry.cornerRadius, bevel);

  for (let py = 0; py < height; py += 1) {
    const y = (py + 0.5) / density - halfH;
    const ay = Math.abs(y);
    // Where |x| is within this, the rounded rect's distance field puts the point at least a bevel deep.
    const plain = Math.max(ay <= halfH - bevel ? halfW - corner : -1, ay <= halfH - corner ? halfW - bevel : -1);
    for (let px = 0; px < width; px += 1) {
      const x = (px + 0.5) / density - halfW;
      if (Math.abs(x) <= plain) continue;
      const i = (py * width + px) * 4;
      const sd = sdfRoundedRect(x, y, geometry.width, geometry.height, geometry.cornerRadius);
      const e = Math.max(-sd, 0);
      if (e >= bevel) continue;
      const u = Math.sqrt(e / bevel) * DEPTH_STEPS;
      const k = Math.min(Math.floor(u), DEPTH_STEPS - 1);
      const f = u - k;
      const at = k * 3;
      data[i] = Math.round((table[at] + (table[at + 3] - table[at]) * f) * toByte);
      data[i + 1] = Math.round((table[at + 1] + (table[at + 4] - table[at + 1]) * f) * toByte);
      data[i + 2] = Math.round((table[at + 2] + (table[at + 5] - table[at + 2]) * f) * toByte);
      data[i + 3] = 255;
    }
  }

  return { data, width, height, headroom: HEADROOM };
}

/** Whether this material has a spectral edge at all. Three extra filter primitives and a per-pixel
 *  bake are not worth paying for a multiplier that is flat 1. */
export function hasSpectralEdge(optics: VireGlassOptics): boolean {
  return optics.iridescence > 0.001 || optics.diffraction > 0.001;
}

export function buildSpectralMap(
  optics: VireGlassOptics,
  geometry: VireGlassGeometry,
  dpr: number,
): SpectralMap {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    throw new Error('vireglass/dom: buildSpectralMap requires a DOM (canvas)');
  }
  const { data, width, height, headroom } = renderSpectralPixels(optics, geometry, dpr);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  // On a canvas the GPU backs, toDataURL waits for the GPU process: 11 to 44 ms a map while the page animates, 1 to 3 here.
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('vireglass/dom: 2D canvas context unavailable');
  const image = ctx.createImageData(width, height);
  image.data.set(data);
  ctx.putImageData(image, 0, 0);
  return { url: canvas.toDataURL('image/png'), width, height, headroom };
}
