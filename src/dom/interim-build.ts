// Interim map pairs built off the main thread: one worker for the page, created on the first build.
import type { VireGlassGeometry } from '../geometry';
import type { VireGlassOptics } from '../material';
import type { DisplacementState, DisplacementMap } from './displacement';
import type { SpectralMap } from './spectral-map';
import type { InterimJob, InterimResult } from './interim-render';
import workerSource from './interim-worker?source';

export type WorkerLike = {
  postMessage(job: InterimJob): void;
  terminate(): void;
  onmessage: ((event: { data: InterimResult }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessageerror?: ((event: unknown) => void) | null;
};

const JOB_TIMEOUT_FLOOR_MS = 2000;
const TIMEOUT_MS_PER_MEGAPIXEL = 1500;
const STRIKES_BEFORE_OFF = 2;

/** A job's allowance grows with the pixels it renders (the hue doubles them), so a big sheet is not mistaken for a hang. */
export function jobTimeoutMs(job: Pick<InterimJob, 'geometry' | 'dpr' | 'hue'>): number {
  const pixels = Math.ceil(job.geometry.width * job.dpr) * Math.ceil(job.geometry.height * job.dpr) * (job.hue ? 2 : 1);
  return Math.max(JOB_TIMEOUT_FLOOR_MS, Math.round((pixels / 1e6) * TIMEOUT_MS_PER_MEGAPIXEL));
}

export type InterimPair = { map: DisplacementMap; hue: SpectralMap | null };

/** A destination ahead of its landing goes to the worker before an interim map of a motion in progress. */
export type BuildPriority = 'destination' | 'interim';

/** A build that can be taken back while it still waits for the worker: false once the worker has it. */
export type PendingPair = Promise<InterimPair> & { cancel(): boolean };

/** `silent`: the worker itself failed (a refused blob worker, a crash) rather than one job, which is not worth a report. */
export type WorkerFailure = Error & { silent?: boolean; superseded?: boolean; timedOut?: boolean };

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

const silent = (message: string): WorkerFailure => Object.assign(new Error(message), { silent: true });

export function createInterimBuilder(make: () => WorkerLike | null) {
  let worker: WorkerLike | null = null;
  let off = false;
  let nextId = 0;
  type Entry = {
    job: InterimJob;
    priority: BuildPriority;
    resolve: (pair: InterimPair) => void;
    reject: (error: WorkerFailure) => void;
    timer?: ReturnType<typeof setTimeout>;
  };
  const waiting = new Map<number, Entry>();
  // One job at a time reaches the worker, so a job's timeout counts the worker's own work and not the jobs queued ahead of it.
  const queue: number[] = [];
  let active: number | null = null;
  // Consecutive jobs that hung: one falls back to the main thread on a fresh worker, a second turns the worker off.
  let strikes = 0;

  function disable(error: WorkerFailure): void {
    off = true;
    worker?.terminate();
    worker = null;
    const all = [...waiting.values()];
    waiting.clear();
    queue.length = 0;
    active = null;
    for (const entry of all) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
  }

  function timedOut(id: number): void {
    strikes += 1;
    if (strikes >= STRIKES_BEFORE_OFF) {
      disable(silent('vireglass/dom: the interim worker did not answer'));
      return;
    }
    const entry = waiting.get(id);
    waiting.delete(id);
    active = null;
    worker?.terminate();
    worker = null;
    entry?.reject(Object.assign(silent('vireglass/dom: the interim worker did not answer'), { timedOut: true }));
    dispatch();
  }

  function dispatch(): void {
    if (active !== null) return;
    const first = queue.findIndex((queued) => waiting.get(queued)?.priority === 'destination');
    const id = queue.splice(first < 0 ? 0 : first, 1)[0];
    if (id === undefined) return;
    const entry = waiting.get(id);
    if (!entry) return;
    const target = start();
    if (!target) {
      disable(silent('vireglass/dom: no interim worker'));
      return;
    }
    active = id;
    entry.timer = setTimeout(() => timedOut(id), jobTimeoutMs(entry.job));
    try {
      target.postMessage(entry.job);
    } catch (error) {
      waiting.delete(id);
      clearTimeout(entry.timer);
      active = null;
      entry.reject(error instanceof Error ? error : new Error(String(error)));
      disable(silent('vireglass/dom: the interim worker refused a job'));
    }
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
      clearTimeout(entry.timer);
      if (active === data.id) active = null;
      if ('error' in data) {
        entry.reject(new Error(data.error));
        disable(silent('vireglass/dom: the interim worker failed on another job'));
        return;
      }
      strikes = 0;
      entry.resolve({
        map: { url: URL.createObjectURL(data.blob), width: data.width, height: data.height, scale: data.scale },
        hue: data.hue
          ? { url: URL.createObjectURL(data.hue.blob), width: data.hue.width, height: data.hue.height, headroom: data.hue.headroom }
          : null,
      });
      dispatch();
    };
    worker.onerror = () => disable(silent('vireglass/dom: the interim worker failed'));
    worker.onmessageerror = () => disable(silent('vireglass/dom: the interim worker sent an unreadable message'));
    return worker;
  }

  return {
    /** Whether a build can go to the worker; false for good once it cannot. */
    ready(): boolean {
      return start() !== null;
    },
    build(
      optics: VireGlassOptics,
      geometry: VireGlassGeometry,
      dpr: number,
      state: DisplacementState,
      hue: boolean,
      priority: BuildPriority = 'interim',
    ): PendingPair {
      if (!start()) return Object.assign(Promise.reject(silent('vireglass/dom: no interim worker')), { cancel: () => false });
      const id = (nextId += 1);
      const pending = new Promise<InterimPair>((resolve, reject) => {
        waiting.set(id, { job: { id, optics, geometry, dpr, state, hue }, priority, resolve, reject });
        queue.push(id);
        dispatch();
      });
      const cancel = () => {
        const entry = waiting.get(id);
        if (!entry || active === id) return false;
        waiting.delete(id);
        queue.splice(queue.indexOf(id), 1);
        entry.reject(Object.assign(silent('vireglass/dom: the build was taken back'), { superseded: true }));
        return true;
      };
      return Object.assign(pending, { cancel });
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
