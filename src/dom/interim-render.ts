// What the interim worker does with a job. Kept apart from the worker's entry so a test can run it.
import type { VireGlassGeometry } from '../geometry';
import type { VireGlassOptics } from '../material';
import { renderDisplacementPixels, type DisplacementState } from './displacement';
import { renderSpectralPixels } from './spectral-map';

/** `hue`: whether the spectral map is wanted with the displacement map. */
export type InterimJob = { id: number; optics: VireGlassOptics; geometry: VireGlassGeometry; dpr: number; state: DisplacementState; hue: boolean };
export type InterimResult =
  | {
      id: number;
      blob: Blob;
      width: number;
      height: number;
      scale: number;
      hue: { blob: Blob; width: number; height: number; headroom: number } | null;
    }
  | { id: number; error: string };
export type PixelEncoder = (data: Uint8ClampedArray, width: number, height: number) => Promise<Blob>;

export const encodeWithOffscreenCanvas: PixelEncoder = (data, width, height) => {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('vireglass/dom: 2D canvas context unavailable');
  ctx.putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
};

export async function renderInterim(job: InterimJob, encode: PixelEncoder = encodeWithOffscreenCanvas): Promise<InterimResult> {
  try {
    const map = renderDisplacementPixels(job.optics, job.geometry, job.dpr, job.state);
    const blob = await encode(map.data, map.width, map.height);
    let hue: Extract<InterimResult, { blob: Blob }>['hue'] = null;
    if (job.hue) {
      const pixels = renderSpectralPixels(job.optics, job.geometry, job.dpr, job.state);
      hue = { blob: await encode(pixels.data, pixels.width, pixels.height), width: pixels.width, height: pixels.height, headroom: pixels.headroom };
    }
    return { id: job.id, blob, width: map.width, height: map.height, scale: map.scale, hue };
  } catch (error) {
    return { id: job.id, error: error instanceof Error ? error.message : String(error) };
  }
}
