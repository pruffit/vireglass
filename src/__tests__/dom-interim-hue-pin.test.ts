// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const gate = vi.hoisted(() => ({ hue: null as Promise<void> | null }));

vi.mock('../dom/displacement', async (original) => {
  const real = await original<typeof import('../dom/displacement')>();
  let n = 0;
  const build = (_o: unknown, g: { width: number }) => ({ url: `main:${(n += 1)}:w${g.width}`, width: 4, height: 4, scale: 10 });
  return { ...real, buildDisplacementMap: build, buildDisplacementMapInSlices: async (o: unknown, g: { width: number }) => build(o, g) };
});

vi.mock('../dom/spectral-map', async (original) => {
  const real = await original<typeof import('../dom/spectral-map')>();
  let n = 0;
  const build = (_o: unknown, g: { width: number }) => ({ url: `hue:${(n += 1)}:w${g.width}`, width: 4, height: 4, headroom: 2 });
  return { ...real, hasSpectralEdge: () => true, buildSpectralMap: build, buildSpectralMapInSlices: async (o: unknown, g: { width: number }) => (await gate.hue, build(o, g)) };
});

vi.mock('../dom/probe', () => ({
  probeBackdrop: () => ({ luma: 0.5, lo: 0.4, hi: 0.6, busy: 0.1, r: 0.5, g: 0.5, b: 0.5 }),
}));

import { attachGlass, clearMapCache, type GlassHandle } from '../dom';
import { MATERIAL_PRESETS } from '../index';
import { resetSupportCache } from '../dom/support';
import { browserWorker, setInterimWorker, type WorkerLike } from '../dom/interim-build';
import { renderInterim, type InterimJob } from '../dom/interim-render';

class FakeWorker implements WorkerLike {
  jobs: InterimJob[] = [];
  onmessage: WorkerLike['onmessage'] = null;
  onerror: WorkerLike['onerror'] = null;
  postMessage(job: InterimJob): void {
    this.jobs.push(structuredClone(job));
  }
  terminate(): void {}
}

let decodes: (() => void)[] = [];
let revoked: string[] = [];
let blobs = 0;
let box = { width: 200, height: 100 };
let handle: GlassHandle | null = null;
let el: HTMLElement;
let worker: FakeWorker;

const hrefs = () => [...document.querySelectorAll('svg[data-vireglass-filters] filter feImage')].map((n) => n.getAttribute('href') ?? '');
const settle = async () => {
  for (let round = 0; round < 4; round += 1) {
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
    for (const resolve of decodes.splice(0)) resolve();
  }
};

beforeEach(() => {
  decodes = [];
  revoked = [];
  blobs = 0;
  gate.hue = new Promise<void>(() => undefined);
  box = { width: 200, height: 100 };
  worker = new FakeWorker();
  setInterimWorker(() => worker);
  (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = () => `blob:test/${(blobs += 1)}`;
  (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = (u) => void revoked.push(u);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
  document.body.innerHTML = '<div id="g"></div>';
  el = document.getElementById('g') as HTMLElement;
  el.getBoundingClientRect = () => ({ left: 0, top: 0, right: box.width, bottom: box.height, x: 0, y: 0, ...box, toJSON() {} }) as DOMRect;
  (globalThis as { CSS?: unknown }).CSS = { supports: () => true };
  resetSupportCache();
  clearMapCache();
  (globalThis as { Image: unknown }).Image = class {
    src = '';
    decode() {
      return new Promise<void>((resolve) => decodes.push(resolve));
    }
  };
});

afterEach(() => {
  handle?.destroy();
  handle = null;
  vi.useRealTimers();
  setInterimWorker(browserWorker);
});

describe('the hue on the filter', () => {
  it('is not revoked by the store while a main-thread pair shown after a worker pair has not replaced it', async () => {
    handle = attachGlass(el, { material: MATERIAL_PRESETS.glass, shadow: false });
    handle.setInterim(true);
    box = { width: 260, height: 100 };
    handle.update();
    await settle();
    const result = await renderInterim(worker.jobs[0]!, async (data) => new Blob([data.slice(0, 4)]));
    worker.onmessage?.({ data: result });
    await settle();
    const [, workerHue] = hrefs();
    expect(workerHue).toMatch(/^blob:/);

    worker.onerror?.({});
    for (let i = 0; i < 10; i += 1) {
      box = { width: 270 + i * 10, height: 100 };
      handle.update();
      await settle();
    }
    expect(hrefs()[0]).toMatch(/^main:/);
    expect(hrefs()[1]).toBe(workerHue);
    expect(revoked).not.toContain(workerHue);
  });
});
