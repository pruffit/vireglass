// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spectral = vi.hoisted(() => ({ on: false }));
const settled = vi.hoisted(() => ({ displacement: [] as unknown[][], hue: [] as unknown[][] }));

vi.mock('../dom/displacement', async (original) => {
  const real = await original<typeof import('../dom/displacement')>();
  let n = 0;
  return {
    ...real,
    buildDisplacementMap: (...args: unknown[]) => {
      settled.displacement.push(args);
      return { url: `main:${(n += 1)}`, width: 4, height: 4, scale: 10 };
    },
    buildDisplacementMapInSlices: async (...args: unknown[]) => {
      settled.displacement.push(args);
      return { url: `main:${(n += 1)}`, width: 4, height: 4, scale: 10 };
    },
  };
});

vi.mock('../dom/spectral-map', async (original) => {
  const real = await original<typeof import('../dom/spectral-map')>();
  let n = 0;
  return {
    ...real,
    hasSpectralEdge: () => spectral.on,
    buildSpectralMap: (...args: unknown[]) => {
      settled.hue.push(args);
      return { url: `hue:${(n += 1)}`, headroom: 2 };
    },
    buildSpectralMapInSlices: async () => ({ url: `hue:${(n += 1)}`, headroom: 2 }),
  };
});

vi.mock('../dom/probe', () => ({
  probeBackdrop: () => ({ luma: 0.5, lo: 0.4, hi: 0.6, busy: 0.1, r: 0.5, g: 0.5, b: 0.5 }),
}));

import { attachGlass, clearMapCache, renderStats, resetRenderStats, type GlassHandle } from '../dom';
import { MATERIAL_PRESETS, resolveOptics } from '../index';
import { resetSupportCache } from '../dom/support';
import { displacementScale, renderDisplacementPixels } from '../dom/displacement';
import { browserWorker, createInterimBuilder, setInterimWorker, type WorkerLike } from '../dom/interim-build';
import { renderSpectralPixels } from '../dom/spectral-map';
import { renderInterim, type InterimJob, type InterimResult } from '../dom/interim-render';

class FakeWorker implements WorkerLike {
  jobs: InterimJob[] = [];
  terminated = false;
  onmessage: WorkerLike['onmessage'] = null;
  onerror: WorkerLike['onerror'] = null;
  onmessageerror: WorkerLike['onmessageerror'] = null;
  postMessage(job: InterimJob): void {
    this.jobs.push(structuredClone(job));
  }
  terminate(): void {
    this.terminated = true;
  }
  async answer(index: number): Promise<InterimResult> {
    const result = await renderInterim(this.jobs[index]!, async (data, width, height) => {
      const blob = new Blob([data.slice(0, 4)]);
      pixels.set(blob, { data: data.slice(), width, height });
      return blob;
    });
    this.onmessage?.({ data: result });
    await flush();
    return result;
  }
}

const pixels = new Map<Blob, { data: Uint8ClampedArray; width: number; height: number }>();

let worker: FakeWorker;
let decodes: { url: string; resolve: () => void }[] = [];
let made = 0;
let urls: string[] = [];
let revoked: string[] = [];
let handle: GlassHandle | null = null;
let el: HTMLElement;
let reported: unknown[] = [];

const href = () => document.querySelector('svg[data-vireglass-filters] filter feImage')?.getAttribute('href');
const flush = async () => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
};
const decodeAll = async () => {
  for (const d of decodes.splice(0)) d.resolve();
  await flush();
};
const shape = (x: number) => ({ smoothing: 10, shape: { offsetX: x, offsetY: 0, width: 40, height: 40, cornerRadius: 8 } });

function attach(extra: Parameters<typeof attachGlass>[1] = {}): GlassHandle {
  handle = attachGlass(el, { material: MATERIAL_PRESETS.glass, shadow: false, ...extra });
  resetRenderStats();
  return handle;
}

beforeEach(() => {
  spectral.on = false;
  settled.displacement = [];
  settled.hue = [];
  decodes = [];
  made = 0;
  urls = [];
  revoked = [];
  reported = [];
  pixels.clear();
  worker = new FakeWorker();
  setInterimWorker(() => {
    made += 1;
    return worker;
  });
  (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = () => {
    const url = `blob:test/${urls.length + 1}`;
    urls.push(url);
    return url;
  };
  (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = (u) => void revoked.push(u);
  (globalThis as { reportError?: unknown }).reportError = (e: unknown) => void reported.push(e);
  document.body.innerHTML = '<div id="g"></div>';
  el = document.getElementById('g') as HTMLElement;
  el.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 200, bottom: 100, x: 0, y: 0, width: 200, height: 100, toJSON() {} }) as DOMRect;
  (globalThis as { CSS?: unknown }).CSS = { supports: () => true };
  resetSupportCache();
  clearMapCache();
  (globalThis as { Image: unknown }).Image = class {
    src = '';
    decode() {
      return new Promise<void>((resolve) => decodes.push({ url: this.src, resolve }));
    }
  };
});

let second: GlassHandle | null = null;
let el2: HTMLElement;
const hrefOf = (target: HTMLElement) =>
  document.querySelectorAll('svg[data-vireglass-filters] filter')[target === el ? 0 : 1]?.querySelector('feImage')?.getAttribute('href');
function attachSecond(): GlassHandle {
  document.body.insertAdjacentHTML('beforeend', '<div id="g2"></div>');
  el2 = document.getElementById('g2') as HTMLElement;
  el2.getBoundingClientRect = el.getBoundingClientRect;
  second = attachGlass(el2, { material: MATERIAL_PRESETS.glass, shadow: false });
  return second;
}

afterEach(() => {
  vi.useRealTimers();
  second?.destroy();
  second = null;
  handle?.destroy();
  handle = null;
  delete (globalThis as { matchMedia?: unknown }).matchMedia;
  setInterimWorker(browserWorker);
});

describe('an interim map is built in the worker', () => {
  it('posts the job, keeps the shown map until the built one has decoded, then retargets', async () => {
    const g = attach();
    g.setInterim(true);
    const before = href();
    g.setMorph(shape(10));
    expect(worker.jobs).toHaveLength(1);
    expect(href()).toBe(before);
    await worker.answer(0);
    expect(href()).toBe(before);
    await decodeAll();
    expect(href()).toBe(urls[0]);
    expect(renderStats()).toMatchObject({ reducedBakes: 1, workerBakes: 1, mainThreadBakes: 0 });
  });

  it('renders the pixels the main thread would, and the job survives a structured clone', async () => {
    const g = attach();
    g.setInterim(true);
    g.setMorph(shape(10));
    const job = worker.jobs[0]!;
    expect(job.dpr).toBe(1);
    expect(job.geometry).toMatchObject({ width: 200, height: 100 });
    expect(job.state).toEqual({ smoothing: 10, morph: shape(10).shape });
    const result = await worker.answer(0);
    const sync = renderDisplacementPixels(job.optics, job.geometry, job.dpr, job.state);
    const sent = pixels.get((result as { blob: Blob }).blob)!;
    expect(sent.width).toBe(sync.width);
    expect(sent.height).toBe(sync.height);
    expect(Array.from(sent.data)).toEqual(Array.from(sync.data));
    expect((result as { scale: number }).scale).toBe(displacementScale(job.optics, job.geometry));
    expect(sync.data.some((v) => v !== 128)).toBe(true);
  });
});

describe('one build in flight, the newest key wins', () => {
  it('skips the keys asked for while a build ran and builds only the newest', async () => {
    const g = attach();
    g.setInterim(true);
    g.setMorph(shape(10));
    g.setMorph(shape(20));
    g.setMorph(shape(30));
    expect(worker.jobs).toHaveLength(1);
    await worker.answer(0);
    expect(worker.jobs).toHaveLength(2);
    expect(worker.jobs[1]!.state.morph?.offsetX).toBe(30);
    expect(revoked).toEqual([]);
    await decodeAll();
    expect(href()).toBe(urls[0]);
    await worker.answer(1);
    await decodeAll();
    expect(href()).toBe(urls[1]);
    expect(renderStats().reducedBakes).toBe(3);
  });

  it('shows a superseded key that is newer than the shown map, so a motion faster than its builds still moves', async () => {
    const g = attach();
    g.setInterim(true);
    const before = href();
    for (let x = 1; x <= 4; x += 1) {
      g.setMorph(shape(x * 10));
      g.setMorph(shape(x * 10 + 5));
      await worker.answer(worker.jobs.length - 1);
      await decodeAll();
      expect(href()).not.toBe(before);
      expect(href()).toBe(urls[urls.length - 1]);
    }
  });
});

describe('a stale result never lands', () => {
  it('after interim was left', async () => {
    const g = attach();
    g.setInterim(true);
    g.setMorph(shape(10));
    g.setInterim(false);
    const settled = href();
    await worker.answer(0);
    await decodeAll();
    expect(href()).toBe(settled);
    expect(revoked).toEqual([urls[0]]);
  });

  it('after the lens was destroyed', async () => {
    const g = attach();
    g.setInterim(true);
    g.setMorph(shape(10));
    g.destroy();
    await worker.answer(0);
    expect(revoked).toEqual([urls[0]]);
    expect(decodes).toHaveLength(0);
  });

  it('once its filter was replaced', async () => {
    vi.useFakeTimers();
    try {
      const g = attach({ interactive: true });
      g.setInterim(true);
      g.setMorph(shape(10));
      el.dispatchEvent(new MouseEvent('pointerdown', { clientX: 100, clientY: 50, bubbles: true }));
      await vi.advanceTimersByTimeAsync(40);
      const touched = href();
      expect(touched).toMatch(/^main:/);
      await worker.answer(0);
      for (const d of decodes.splice(0)) d.resolve();
      await vi.advanceTimersByTimeAsync(0);
      expect(href()).toBe(touched);
      expect(revoked).toContain(urls[0]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not build the queued key of a filter that was replaced', async () => {
    let transparent = false;
    const handlers: (() => void)[] = [];
    (globalThis as { matchMedia?: unknown }).matchMedia = (query: string) => ({
      get matches() {
        return transparent && query.includes('transparency');
      },
      addEventListener: (_: string, h: () => void) => void handlers.push(h),
      removeEventListener: () => {},
    });
    const g = attach();
    g.setInterim(true);
    g.setMorph(shape(10));
    g.setMorph(shape(20));
    transparent = true;
    for (const h of handlers) h();
    g.setInterim(false);
    g.setInterim(true);
    const posted = worker.jobs.length;
    await worker.answer(0);
    expect(worker.jobs).toHaveLength(posted);
  });

  it('when the decode of its map ends after a newer map was shown', async () => {
    const g = attach();
    g.setInterim(true);
    g.setMorph(shape(10));
    await worker.answer(0);
    g.setMorph(shape(20));
    await worker.answer(1);
    const first = decodes.find((d) => d.url === urls[0])!;
    const second = decodes.find((d) => d.url === urls[1])!;
    second.resolve();
    await flush();
    first.resolve();
    await flush();
    expect(href()).toBe(urls[1]);
  });
});

describe('two lenses share the worker', () => {
  function both(): [GlassHandle, GlassHandle] {
    const a = attach();
    const b = attachSecond();
    a.setInterim(true);
    b.setInterim(true);
    a.setMorph(shape(10));
    b.setMorph(shape(10));
    expect(worker.jobs).toHaveLength(1);
    return [a, b];
  }

  it('posts the second lens job once the first is answered, and lands each answer on the lens that asked', async () => {
    both();
    await worker.answer(0);
    expect(worker.jobs).toHaveLength(2);
    await worker.answer(1);
    await decodeAll();
    expect(hrefOf(el)).toBe(urls[0]);
    expect(hrefOf(el2)).toBe(urls[1]);
  });

  it('drops the answer of a lens destroyed mid-build and leaves the other alone', async () => {
    const [a] = both();
    a.destroy();
    await worker.answer(0);
    expect(revoked).toEqual([urls[0]]);
    expect(worker.jobs).toHaveLength(2);
    await worker.answer(1);
    await decodeAll();
    expect(href()).toBe(urls[1]);
    expect(reported).toHaveLength(0);
  });

  it('gives both a map from the main thread when the worker errors, and reports nothing', async () => {
    both();
    worker.onerror?.({});
    await flush();
    await decodeAll();
    expect(hrefOf(el)).toMatch(/^main:/);
    expect(hrefOf(el2)).toMatch(/^main:/);
    expect(reported).toHaveLength(0);
    expect(worker.terminated).toBe(true);
  });

  it('gives both a map from the main thread when the worker stays silent past the timeout', async () => {
    vi.useFakeTimers();
    try {
      const lenses = both();
      await vi.advanceTimersByTimeAsync(1000);
      expect(worker.terminated).toBe(false);
      for (const lens of lenses) lens.setInterim(true);
      await vi.advanceTimersByTimeAsync(1000);
      expect(worker.terminated).toBe(true);
      await decodeAll();
      expect(hrefOf(el)).toMatch(/^main:/);
      expect(hrefOf(el2)).toMatch(/^main:/);
      expect(reported).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives both a map from the main thread when a message cannot be read', async () => {
    both();
    worker.onmessageerror?.({});
    await flush();
    await decodeAll();
    expect(worker.terminated).toBe(true);
    expect(hrefOf(el)).toMatch(/^main:/);
    expect(hrefOf(el2)).toMatch(/^main:/);
    expect(reported).toHaveLength(0);
  });

  it('reports a failed job once, by the lens whose job it was, and the other falls back silently', async () => {
    both();
    worker.onmessage?.({ data: { id: 1, error: 'convertToBlob failed' } });
    await flush();
    await decodeAll();
    expect(reported).toHaveLength(1);
    expect(hrefOf(el)).toMatch(/^main:/);
    expect(hrefOf(el2)).toMatch(/^main:/);
  });
});

describe('the interim store owns the blob URLs', () => {
  it('revokes the URL of a map the store evicts, and the rest when the lens is destroyed', async () => {
    const g = attach();
    g.setInterim(true);
    for (let i = 0; i < 9; i += 1) {
      g.setMorph(shape(10 + i));
      await worker.answer(i);
      await decodeAll();
    }
    expect(revoked).toEqual([urls[0]]);
    g.destroy();
    expect(revoked).toEqual(urls);
  });

  it('answers a key it still holds at once, with no job', async () => {
    const g = attach();
    g.setInterim(true);
    g.setMorph(shape(10));
    await worker.answer(0);
    await decodeAll();
    g.setMorph(shape(20));
    await worker.answer(1);
    await decodeAll();
    expect(href()).toBe(urls[1]);
    resetRenderStats();
    g.setMorph(shape(10));
    expect(href()).toBe(urls[0]);
    expect(worker.jobs).toHaveLength(2);
    expect(renderStats().reducedBakes).toBe(0);
  });
});

describe('without a worker, the main thread builds', () => {
  it('when there is none', () => {
    setInterimWorker(() => null);
    const g = attach();
    g.setInterim(true);
    g.setMorph(shape(10));
    expect(href()).toMatch(/^main:/);
    expect(renderStats()).toMatchObject({ reducedBakes: 1, mainThreadBakes: 1, workerBakes: 0 });
  });

  it('when constructing it throws, and it is not tried again', () => {
    let tries = 0;
    setInterimWorker(() => {
      tries += 1;
      throw new Error('blocked by CSP');
    });
    const g = attach();
    g.setInterim(true);
    g.setMorph(shape(10));
    g.setMorph(shape(20));
    expect(href()).toMatch(/^main:/);
    expect(tries).toBe(1);
    expect(renderStats().mainThreadBakes).toBe(2);
    expect(reported).toHaveLength(0);
  });

  it('when the worker fails to start, the lens still gets its map and the worker is not used again', async () => {
    const g = attach();
    g.setInterim(true);
    g.setMorph(shape(10));
    worker.onerror?.({});
    await flush();
    expect(worker.terminated).toBe(true);
    expect(href()).toMatch(/^main:/);
    expect(renderStats()).toMatchObject({ mainThreadBakes: 1, workerBakes: 0 });
    g.setMorph(shape(20));
    expect(worker.jobs).toHaveLength(1);
    expect(renderStats().mainThreadBakes).toBe(2);
  });

  it('when the worker reports an error, which is reported too', async () => {
    const g = attach();
    g.setInterim(true);
    g.setMorph(shape(10));
    worker.onmessage?.({ data: { id: 1, error: 'convertToBlob failed' } });
    await flush();
    expect(reported).toHaveLength(1);
    expect(href()).toMatch(/^main:/);
    g.setMorph(shape(20));
    expect(worker.jobs).toHaveLength(1);
    expect(href()).toMatch(/^main:/);
  });

  it('when the browser has no Worker, OffscreenCanvas or convertToBlob', () => {
    const g = globalThis as Record<string, unknown>;
    const had = { Worker: g.Worker, OffscreenCanvas: g.OffscreenCanvas };
    try {
      g.Worker = undefined;
      g.OffscreenCanvas = undefined;
      expect(browserWorker()).toBeNull();
      g.Worker = class {};
      expect(browserWorker()).toBeNull();
      g.OffscreenCanvas = class {};
      expect(browserWorker()).toBeNull();
    } finally {
      g.Worker = had.Worker;
      g.OffscreenCanvas = had.OffscreenCanvas;
    }
  });

  it('revokes the Blob URL of the worker source once the worker is disabled, and not before', async () => {
    const g = globalThis as Record<string, unknown>;
    const had = { Worker: g.Worker, OffscreenCanvas: g.OffscreenCanvas };
    const real: { onerror?: () => void; terminated: boolean }[] = [];
    try {
      g.Worker = class {
        terminated = false;
        onerror?: () => void;
        postMessage() {}
        terminate() {
          this.terminated = true;
        }
        constructor() {
          real.push(this);
        }
      };
      g.OffscreenCanvas = class {
        convertToBlob() {}
      };
      setInterimWorker(browserWorker);
      const lens = attach();
      lens.setInterim(true);
      lens.setMorph(shape(10));
      expect(urls).toHaveLength(1);
      expect(revoked).toEqual([]);
      real[0]!.onerror?.();
      await flush();
      expect(real[0]!.terminated).toBe(true);
      expect(revoked).toEqual([urls[0]]);
    } finally {
      g.Worker = had.Worker;
      g.OffscreenCanvas = had.OffscreenCanvas;
    }
  });

  it('starts the bundled source from a Blob URL when it can', () => {
    const g = globalThis as Record<string, unknown>;
    const had = { Worker: g.Worker, OffscreenCanvas: g.OffscreenCanvas };
    const started: string[] = [];
    try {
      g.Worker = class {
        constructor(url: string) {
          started.push(url);
        }
        terminate() {}
      };
      g.OffscreenCanvas = class {
        convertToBlob() {}
      };
      expect(browserWorker()).not.toBeNull();
      expect(started).toEqual([urls[0]]);
    } finally {
      g.Worker = had.Worker;
      g.OffscreenCanvas = had.OffscreenCanvas;
    }
  });
});

describe('an interim job is a pair: the displacement map and the hue', () => {
  const hueHref = () => document.querySelectorAll('svg[data-vireglass-filters] filter feImage')[1]?.getAttribute('href');

  it('asks for the hue when the filter has one, and shows both only once both have decoded', async () => {
    spectral.on = true;
    const g = attach();
    g.setInterim(true);
    const before = { map: href(), hue: hueHref() };
    g.setMorph(shape(10));
    expect(worker.jobs[0]!.hue).toBe(true);
    const result = await worker.answer(0);
    expect((result as { hue: unknown }).hue).not.toBeNull();
    expect(urls).toHaveLength(2);
    expect(decodes.map((d) => d.url)).toEqual(urls);
    decodes[0]!.resolve();
    await flush();
    expect(href()).toBe(before.map);
    expect(hueHref()).toBe(before.hue);
    await decodeAll();
    expect(href()).toBe(urls[0]);
    expect(hueHref()).toBe(urls[1]);
    expect(renderStats().workerBakes).toBe(1);
  });

  it('asks for no hue when the material has none, and the pair has no hue', async () => {
    const g = attach();
    g.setInterim(true);
    g.setMorph(shape(10));
    expect(worker.jobs[0]!.hue).toBe(false);
    expect(((await worker.answer(0)) as { hue: unknown }).hue).toBeNull();
    expect(urls).toHaveLength(1);
  });

  it('revokes both URLs of a pair that arrives too late', async () => {
    spectral.on = true;
    const g = attach();
    g.setInterim(true);
    g.setMorph(shape(10));
    g.setInterim(false);
    await worker.answer(0);
    expect(revoked).toEqual(urls);
    expect(urls).toHaveLength(2);
  });

  it('renders the hue pixels the main thread would, on the morph silhouette', async () => {
    spectral.on = true;
    const g = attach();
    g.setInterim(true);
    g.setMorph({ smoothing: 14, shape: { offsetX: 0, offsetY: 70, width: 60, height: 60, cornerRadius: 30 } });
    const job = worker.jobs[0]!;
    const result = (await worker.answer(0)) as { hue: { blob: Blob; width: number; headroom: number } };
    const sync = renderSpectralPixels(job.optics, job.geometry, job.dpr, job.state);
    const sent = pixels.get(result.hue.blob)!;
    expect(sent.width).toBe(sync.width);
    expect(Array.from(sent.data)).toEqual(Array.from(sync.data));
    expect(Array.from(sent.data)).not.toEqual(Array.from(renderSpectralPixels(job.optics, job.geometry, job.dpr).data));
  });
});

describe('the worker timeout counts from the start of a job', () => {
  const optics = resolveOptics(MATERIAL_PRESETS.glass);
  const box = { width: 100, height: 60, cornerRadius: 10 };
  const ask = (builder: ReturnType<typeof createInterimBuilder>) => builder.build(optics, box, 1, {}, false);

  it('does not fire while jobs wait in the queue', async () => {
    vi.useFakeTimers();
    try {
      const builder = createInterimBuilder(() => worker);
      const done: number[] = [];
      for (let i = 0; i < 3; i += 1) void ask(builder).then(() => done.push(i));
      expect(worker.jobs).toHaveLength(1);
      for (let i = 0; i < 3; i += 1) {
        await vi.advanceTimersByTimeAsync(1500);
        await worker.answer(i);
      }
      expect(done).toEqual([0, 1, 2]);
      expect(worker.terminated).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fires for a job that started and hangs, and rejects the jobs behind it', async () => {
    vi.useFakeTimers();
    try {
      const builder = createInterimBuilder(() => worker);
      const outcomes: string[] = [];
      for (let i = 0; i < 2; i += 1) ask(builder).then(() => outcomes.push('done'), (e: Error) => outcomes.push(e.message));
      await vi.advanceTimersByTimeAsync(1999);
      expect(worker.terminated).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      expect(worker.terminated).toBe(true);
      expect(outcomes).toHaveLength(2);
      expect(worker.jobs).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('interim and settled maps are one family', () => {
  const hueHref = () => document.querySelectorAll('svg[data-vireglass-filters] filter feImage')[1]?.getAttribute('href');
  const bridge = { smoothing: 14, shape: { offsetX: 0, offsetY: 70, width: 60, height: 60, cornerRadius: 30 } };

  afterEach(() => {
    Reflect.deleteProperty(window, 'devicePixelRatio');
  });

  it('builds the pair from the same inputs the settled bake takes, down to the bytes', async () => {
    Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
    spectral.on = true;
    el.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 200.3, bottom: 100.2, x: 0, y: 0, width: 200.3, height: 100.2, toJSON() {} }) as DOMRect;
    const g = attach();
    g.setInterim(true);
    g.setMorph(bridge);
    const job = worker.jobs[0]!;
    const result = (await worker.answer(0)) as { blob: Blob; hue: { blob: Blob } };

    settled.displacement = [];
    settled.hue = [];
    const other = attachSecond();
    other.setMorph(bridge);
    const [optics, geometry, dpr, state] = settled.displacement[0] as [unknown, unknown, number, unknown];
    expect({ optics, geometry, dpr, state }).toEqual({ optics: job.optics, geometry: job.geometry, dpr: job.dpr, state: job.state });
    expect(job.dpr).toBe(2);
    expect(settled.hue[0]).toEqual([job.optics, job.geometry, job.dpr, job.state]);

    const main = renderDisplacementPixels(optics as never, geometry as never, dpr, state as never);
    expect(Array.from(pixels.get(result.blob)!.data)).toEqual(Array.from(main.data));
    const mainHue = renderSpectralPixels(job.optics, job.geometry, job.dpr, job.state);
    expect(Array.from(pixels.get(result.hue.blob)!.data)).toEqual(Array.from(mainHue.data));
  });

  it('keeps the pair it showed when the lens lands on its key, and bakes and swaps nothing', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    spectral.on = true;
    const g = attach();
    g.setInterim(true);
    g.setMorph(bridge);
    await worker.answer(0);
    await decodeAll();
    const shown = [href(), hueHref()];
    expect(shown).toEqual(urls);
    resetRenderStats();
    g.setInterim(false);
    expect([href(), hueHref()]).toEqual(shown);
    await vi.advanceTimersByTimeAsync(300);
    await decodeAll();
    expect([href(), hueHref()]).toEqual(shown);
    expect(renderStats()).toMatchObject({ fullBakes: 0, filterSwaps: 0, probes: 1 });
    expect(revoked).toEqual([]);
  });

  it('keeps it also when the pair is still decoding as the lens lands', async () => {
    const g = attach();
    g.setInterim(true);
    g.setMorph(bridge);
    await worker.answer(0);
    resetRenderStats();
    g.setInterim(false);
    await decodeAll();
    await flush();
    expect(href()).toBe(urls[0]);
    expect(renderStats().fullBakes).toBe(0);
  });

  it('does not revoke the URLs on screen when the store drops their record', async () => {
    const g = attach();
    g.setInterim(true);
    g.setMorph(bridge);
    await worker.answer(0);
    await decodeAll();
    g.setInterim(false);
    g.setInterim(true);
    for (let i = 0; i < 9; i += 1) {
      g.setMorph(shape(10 + i));
      await worker.answer(worker.jobs.length - 1);
    }
    expect(revoked).not.toContain(urls[0]);
    g.destroy();
    handle = null;
    expect(revoked).toContain(urls[0]);
  });
});

describe('geometry-only motion gets interim pairs', () => {
  it('requests a pair for the live box when the box changes in interim, and shows it', async () => {
    const g = attach();
    g.setInterim(true);
    const before = href();
    el.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 260, bottom: 100, x: 0, y: 0, width: 260, height: 100, toJSON() {} }) as DOMRect;
    g.update();
    expect(worker.jobs).toHaveLength(1);
    expect(worker.jobs[0]!.geometry).toMatchObject({ width: 260, height: 100 });
    expect(href()).toBe(before);
    await worker.answer(0);
    await decodeAll();
    expect(href()).toBe(urls[0]);
    expect(renderStats()).toMatchObject({ reducedBakes: 1, workerBakes: 1, mainThreadBakes: 0 });
  });

  it('builds one for the newest box and skips the boxes in between, with one job in flight', async () => {
    const g = attach();
    g.setInterim(true);
    for (const width of [210, 220, 230, 240]) {
      el.getBoundingClientRect = () =>
        ({ left: 0, top: 0, right: width, bottom: 100, x: 0, y: 0, width, height: 100, toJSON() {} }) as DOMRect;
      g.update();
    }
    expect(worker.jobs).toHaveLength(1);
    await worker.answer(0);
    expect(worker.jobs).toHaveLength(2);
    expect(worker.jobs[1]!.geometry.width).toBe(240);
  });

  it('asks for nothing again while the box stays put', async () => {
    const g = attach();
    g.setInterim(true);
    g.update();
    g.update();
    expect(worker.jobs).toHaveLength(0);
    expect(renderStats().reducedBakes).toBe(0);
  });

  it('builds on the main thread for a box change when there is no worker', () => {
    setInterimWorker(() => null);
    const g = attach();
    g.setInterim(true);
    el.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 260, bottom: 100, x: 0, y: 0, width: 260, height: 100, toJSON() {} }) as DOMRect;
    g.update();
    expect(href()).toMatch(/^main:/);
    expect(renderStats().mainThreadBakes).toBe(1);
  });
});
