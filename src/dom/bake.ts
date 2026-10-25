// What the DOM renderer's maps share: rows rendered in order into one buffer, and the PNG the filter reads.

/** A map rendered row by row, so its rows can be spread over several tasks. */
export type Rows<T> = { height: number; rows(from: number, to: number): void; done(): T };

/** A task's share of rows: past this the renderer yields, so a large map is never one long task. */
const SLICE_MS = 5;

/** Ends the task. A hidden page draws no frames to protect, and clamps setTimeout to about a second. */
export function yieldTask(): Promise<void> {
  if (typeof document !== 'undefined' && document.hidden) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Thrown by a sliced bake whose result nobody wants any more. */
export class Superseded extends Error {
  readonly silent = true;
  constructor() {
    super('vireglass/dom: the bake was superseded');
  }
}

/** `sliceMs`: the share of rows a task may take. `live`: asked before every slice; false ends the bake with `Superseded`. */
export type BakeControl = { sliceMs?: number; live?: () => boolean };

/** Renders every row, yielding to the event loop each time a slice has run for `SLICE_MS` and after the last, so the encode never shares a task with rows. */
export async function renderInSlices<T>(map: Rows<T>, sliceMs = SLICE_MS, live?: () => boolean): Promise<T> {
  let row = 0;
  while (row < map.height) {
    if (live && !live()) throw new Superseded();
    const start = performance.now();
    do {
      map.rows(row, row + 1);
      row += 1;
    } while (row < map.height && performance.now() - start < sliceMs);
    await yieldTask();
  }
  if (live && !live()) throw new Superseded();
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
