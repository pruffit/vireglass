// Interim maps built off the main thread: one worker for the page, created on the first build.
import type { VireGlassGeometry } from '../geometry';
import type { VireGlassOptics } from '../material';
import type { DisplacementState, DisplacementMap } from './displacement';
import type { InterimJob, InterimResult } from './interim-render';
import workerSource from './interim-worker?source';

export type WorkerLike = {
  postMessage(job: InterimJob): void;
  terminate(): void;
  onmessage: ((event: { data: InterimResult }) => void) | null;
  onerror: ((event: unknown) => void) | null;
};

/** `silent`: the worker itself failed (a refused blob worker, a crash) rather than one job, which is not worth a report. */
export type WorkerFailure = Error & { silent?: boolean };

export function browserWorker(): WorkerLike | null {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return null;
  if (typeof OffscreenCanvas.prototype.convertToBlob !== 'function' || typeof URL.createObjectURL !== 'function') return null;
  const url = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
  try {
    const made = new Worker(url);
    const terminate = made.terminate.bind(made);
    made.terminate = () => {
      terminate();
      URL.revokeObjectURL(url);
    };
    return made as unknown as WorkerLike;
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

export function createInterimBuilder(make: () => WorkerLike | null) {
  let worker: WorkerLike | null = null;
  let off = false;
  let nextId = 0;
  const waiting = new Map<number, { resolve: (map: DisplacementMap) => void; reject: (error: WorkerFailure) => void }>();

  function disable(error: WorkerFailure): void {
    off = true;
    worker?.terminate();
    worker = null;
    const all = [...waiting.values()];
    waiting.clear();
    for (const entry of all) entry.reject(error);
  }

  function start(): WorkerLike | null {
    if (off) return null;
    if (worker) return worker;
    try {
      worker = make();
    } catch {
      worker = null;
    }
    if (!worker) {
      off = true;
      return null;
    }
    worker.onmessage = ({ data }) => {
      const entry = waiting.get(data.id);
      if (!entry) return;
      waiting.delete(data.id);
      if ('error' in data) {
        entry.reject(new Error(data.error));
        disable(new Error(data.error));
        return;
      }
      entry.resolve({ url: URL.createObjectURL(data.blob), width: data.width, height: data.height, scale: data.scale });
    };
    worker.onerror = () => disable(Object.assign(new Error('vireglass/dom: the interim worker failed'), { silent: true }));
    return worker;
  }

  return {
    /** Whether a build can go to the worker; false for good once it cannot. */
    ready(): boolean {
      return start() !== null;
    },
    build(optics: VireGlassOptics, geometry: VireGlassGeometry, dpr: number, state: DisplacementState): Promise<DisplacementMap> {
      const target = start();
      if (!target) return Promise.reject(Object.assign(new Error('vireglass/dom: no interim worker'), { silent: true }));
      const id = (nextId += 1);
      return new Promise((resolve, reject) => {
        waiting.set(id, { resolve, reject });
        try {
          target.postMessage({ id, optics, geometry, dpr, state });
        } catch (error) {
          waiting.delete(id);
          reject(error instanceof Error ? error : new Error(String(error)));
          disable(Object.assign(new Error('vireglass/dom: the interim worker refused a job'), { silent: true }));
        }
      });
    },
  };
}

export type InterimBuilder = ReturnType<typeof createInterimBuilder>;

let builder = createInterimBuilder(browserWorker);

export const interimBuilder = (): InterimBuilder => builder;

/** Test-only: swaps the page's worker for another, and forgets a permanent fallback. */
export function setInterimWorker(make: () => WorkerLike | null): void {
  builder = createInterimBuilder(make);
}

/** Frees a map URL made by the worker path; a data URL needs nothing. */
export function releaseMap(url: string): void {
  if (url.startsWith('blob:')) URL.revokeObjectURL(url);
}
