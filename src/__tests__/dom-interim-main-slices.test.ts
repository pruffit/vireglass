// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const gate = vi.hoisted(() => ({
  sync: 0,
  jobs: [] as { width: number; finish: () => void }[],
}));

vi.mock('../dom/displacement', async (original) => {
  const real = await original<typeof import('../dom/displacement')>();
  return {
    ...real,
    buildDisplacementMap: (_o: unknown, g: { width: number }) => {
      gate.sync += 1;
      return { url: `sync:w${g.width}`, width: 4, height: 4, scale: 10 };
    },
    buildDisplacementMapInSlices: (_o: unknown, g: { width: number }) =>
      new Promise((resolve) => {
        gate.jobs.push({ width: g.width, finish: () => resolve({ url: `sliced:w${g.width}`, width: 4, height: 4, scale: 10 }) });
      }),
  };
});

vi.mock('../dom/spectral-map', async (original) => {
  const real = await original<typeof import('../dom/spectral-map')>();
  const build = () => ({ url: 'hue', width: 4, height: 4, headroom: 2 });
  return { ...real, hasSpectralEdge: () => false, buildSpectralMap: build, buildSpectralMapInSlices: async () => build() };
});

vi.mock('../dom/probe', () => ({
  probeBackdrop: () => ({ luma: 0.5, lo: 0.4, hi: 0.6, busy: 0.1, r: 0.5, g: 0.5, b: 0.5 }),
}));

import { attachGlass, clearMapCache, type GlassHandle } from '../dom';
import { MATERIAL_PRESETS } from '../index';
import { resetSupportCache } from '../dom/support';
import { browserWorker, setInterimWorker } from '../dom/interim-build';

let box = { width: 200, height: 100 };
let handle: GlassHandle | null = null;
let el: HTMLElement;
let decodes: (() => void)[] = [];

const href = () => document.querySelector('svg[data-vireglass-filters] filter feImage')?.getAttribute('href') ?? '';
const flush = async () => {
  for (let round = 0; round < 3; round += 1) {
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
    for (const resolve of decodes.splice(0)) resolve();
  }
};

beforeEach(() => {
  gate.sync = 0;
  gate.jobs = [];
  decodes = [];
  box = { width: 200, height: 100 };
  setInterimWorker(() => null);
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

describe('without a worker, an interim map', () => {
  it('is rendered in slices, never in the task that asked for it', async () => {
    handle = attachGlass(el, { material: MATERIAL_PRESETS.glass, shadow: false });
    await flush();
    handle.setInterim(true);
    gate.sync = 0;
    gate.jobs = [];
    box = { width: 260, height: 100 };
    handle.update();
    expect(gate.sync).toBe(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(gate.jobs.map((j) => j.width)).toEqual([260]);
    gate.jobs[0]!.finish();
    await flush();
    expect(href()).toBe('sliced:w260');
  });

  it('lets the build in flight finish and then builds only the newest key', async () => {
    handle = attachGlass(el, { material: MATERIAL_PRESETS.glass, shadow: false });
    await flush();
    handle.setInterim(true);
    gate.jobs = [];
    for (const width of [220, 240, 260]) {
      box = { width, height: 100 };
      handle.update();
    }
    await vi.advanceTimersByTimeAsync(0);
    expect(gate.jobs.map((j) => j.width)).toEqual([220]);
    gate.jobs[0]!.finish();
    await flush();
    expect(gate.jobs.map((j) => j.width)).toEqual([220, 260]);
    gate.jobs[1]!.finish();
    await flush();
    expect(href()).toBe('sliced:w260');
  });
});
