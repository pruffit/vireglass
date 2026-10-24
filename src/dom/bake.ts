// What the DOM renderer's maps share: rows rendered in order into one buffer, and the PNG the filter reads.

/** A map rendered row by row, so its rows can be spread over several tasks. */
export type Rows<T> = { height: number; rows(from: number, to: number): void; done(): T };

/** A task's share of rows: past this the renderer yields, so a large map is never one long task. */
const SLICE_MS = 5;

/** Renders every row, yielding to the event loop each time a slice has run for `SLICE_MS`. */
export async function renderInSlices<T>(map: Rows<T>, sliceMs = SLICE_MS): Promise<T> {
  let row = 0;
  while (row < map.height) {
    const start = performance.now();
    do {
      map.rows(row, row + 1);
      row += 1;
    } while (row < map.height && performance.now() - start < sliceMs);
    // A hidden page draws no frames to protect, and clamps setTimeout to about a second.
    if (row < map.height && !(typeof document !== 'undefined' && document.hidden)) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return map.done();
}

/** Encodes RGBA pixels as a PNG data URL. */
export function pngFromPixels(data: Uint8ClampedArray, width: number, height: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  // On a canvas the GPU backs, toDataURL waits for the GPU process: 11 to 44 ms a map while the page animates, 1 to 3 here.
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('vireglass/dom: 2D canvas context unavailable');
  const image = ctx.createImageData(width, height);
  image.data.set(data);
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}
