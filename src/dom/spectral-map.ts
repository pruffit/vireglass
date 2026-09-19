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

  for (let py = 0; py < height; py += 1) {
    const y = (py + 0.5) / density - halfH;
    for (let px = 0; px < width; px += 1) {
      const x = (px + 0.5) / density - halfW;
      const i = (py * width + px) * 4;
      const sd = sdfRoundedRect(x, y, geometry.width, geometry.height, geometry.cornerRadius);
      const e = Math.max(-sd, 0);
      if (e >= bevel) {
        // Past the bevel the glass is plain: a neutral multiplier, not a missing one.
        data[i] = neutral;
        data[i + 1] = neutral;
        data[i + 2] = neutral;
        data[i + 3] = 255;
        continue;
      }
      const [r, g, b] = spectralHue(e, bevel, rim, thick, optics);
      data[i] = Math.round((r / HEADROOM) * 255);
      data[i + 1] = Math.round((g / HEADROOM) * 255);
      data[i + 2] = Math.round((b / HEADROOM) * 255);
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
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('vireglass/dom: 2D canvas context unavailable');
  const image = ctx.createImageData(width, height);
  image.data.set(data);
  ctx.putImageData(image, 0, 0);
  return { url: canvas.toDataURL('image/png'), width, height, headroom };
}
