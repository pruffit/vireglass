// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../dom/displacement', async (original) => {
  const real = await original<typeof import('../dom/displacement')>();
  let n = 0;
  return { ...real, buildDisplacementMap: () => ({ url: `main:${(n += 1)}`, width: 4, height: 4, scale: 10 }) };
});

vi.mock('../dom/spectral-map', async (original) => {
  const real = await original<typeof import('../dom/spectral-map')>();
  let n = 0;
  return {
    ...real,
    buildSpectralMap: () => ({ url: `hue:${(n += 1)}`, headroom: 2 }),
    buildSpectralMapInSlices: async () => ({ url: `hue:${(n += 1)}`, headroom: 2 }),
  };
});

vi.mock('../dom/probe', () => ({
  probeBackdrop: () => ({ luma: 0.5, lo: 0.4, hi: 0.6, busy: 0.1, r: 0.5, g: 0.5, b: 0.5 }),
}));

import { attachGlass, clearMapCache, renderStats, resetRenderStats, type GlassHandle } from '../dom';
import { MATERIAL_PRESETS } from '../index';
import { resetSupportCache } from '../dom/support';
import { displacementScale, renderDisplacementPixels } from '../dom/displacement';
import { browserWorker, setInterimWorker, type WorkerLike } from '../dom/interim-build';
import { renderInterim, type InterimJob, type InterimResult } from '../dom/interim-render';

class FakeWorker implements WorkerLike {
  jobs: InterimJob[] = [];
  terminated = false;
  onmessage: WorkerLike['onmessage'] = null;
  onerror: WorkerLike['onerror'] = null;
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

afterEach(() => {
  handle?.destroy();
  handle = null;
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
    expect(revoked).toEqual([urls[0]]);
    expect(decodes).toHaveLength(0);
    await worker.answer(1);
    await decodeAll();
    expect(href()).toBe(urls[1]);
    expect(renderStats().reducedBakes).toBe(3);
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

  it('starts the bundled source from a Blob URL when it can', () => {
    const g = globalThis as Record<string, unknown>;
    const had = { Worker: g.Worker, OffscreenCanvas: g.OffscreenCanvas };
    const started: string[] = [];
    try {
      g.Worker = class {
        constructor(url: string) {
          started.push(url);
        }
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
