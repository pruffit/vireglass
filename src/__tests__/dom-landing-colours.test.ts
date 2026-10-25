// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackdropSample } from '../adaptation';

const backdrop = vi.hoisted(() => ({ sample: null as unknown as BackdropSample, rects: [] as unknown[] }));

vi.mock('../dom/displacement', async (original) => {
  const real = await original<typeof import('../dom/displacement')>();
  let n = 0;
  return {
    ...real,
    buildDisplacementMap: () => ({ url: `main:${(n += 1)}`, width: 4, height: 4, scale: 10 }),
    buildDisplacementMapInSlices: async () => ({ url: `main:${(n += 1)}`, width: 4, height: 4, scale: 10 }),
  };
});
vi.mock('../dom/spectral-map', async (original) => ({ ...(await original<typeof import('../dom/spectral-map')>()), hasSpectralEdge: () => false }));
vi.mock('../dom/probe', async (original) => ({
  ...(await original<typeof import('../dom/probe')>()),
  probeBackdrop: (_el: unknown, options?: { rect?: unknown }) => {
    backdrop.rects.push(options?.rect ?? null);
    return backdrop.sample;
  },
}));

import { attachGlass, clearMapCache, renderStats, resetRenderStats, type GlassHandle } from '../dom';
import { MATERIAL_PRESETS } from '../index';
import { resetSupportCache } from '../dom/support';
import { browserWorker, setInterimWorker, type WorkerLike } from '../dom/interim-build';
import { renderInterim, type InterimJob } from '../dom/interim-render';

const sampleOf = (luma: number): BackdropSample => ({ luma, lo: luma, hi: luma, busy: 0.05, r: luma, g: luma, b: luma });
const DARK = sampleOf(0.08);
const LIGHT = sampleOf(0.92);

class FakeWorker implements WorkerLike {
  jobs: InterimJob[] = [];
  onmessage: WorkerLike['onmessage'] = null;
  onerror: WorkerLike['onerror'] = null;
  postMessage(job: InterimJob): void {
    this.jobs.push(structuredClone(job));
  }
  terminate(): void {}
  async answer(index: number): Promise<void> {
    const result = await renderInterim(this.jobs[index]!, async (data) => new Blob([data.slice(0, 4)]));
    this.onmessage?.({ data: result });
    await flush();
  }
}

let worker: FakeWorker;
let decodes: { resolve: () => void }[] = [];
let handle: GlassHandle | null = null;
let el: HTMLElement;
let box = { width: 200, height: 100 };

const flush = async () => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
};
const decodeAll = async () => {
  for (const d of decodes.splice(0)) d.resolve();
  await flush();
};
const PROPS = ['--vireglass-ink-color', '--vireglass-tint-color', '--vireglass-body-color', '--vireglass-rim', '--vireglass-shadow'];
const colours = () => PROPS.map((name) => el.style.getPropertyValue(name));
const dest = { geometry: { width: 260, height: 100, cornerRadius: 0 } };

beforeEach(() => {
  decodes = [];
  box = { width: 200, height: 100 };
  backdrop.sample = DARK;
  backdrop.rects = [];
  worker = new FakeWorker();
  setInterimWorker(() => worker);
  (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = () => `blob:test/${Math.random()}`;
  (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = () => undefined;
  document.body.innerHTML = '<div id="g"></div>';
  el = document.getElementById('g') as HTMLElement;
  el.getBoundingClientRect = () => ({ left: 0, top: 0, right: box.width, bottom: box.height, x: 0, y: 0, ...box, toJSON() {} }) as DOMRect;
  (globalThis as { CSS?: unknown }).CSS = { supports: () => true };
  resetSupportCache();
  clearMapCache();
  (globalThis as { Image: unknown }).Image = class {
    src = '';
    decode() {
      return new Promise<void>((resolve) => decodes.push({ resolve }));
    }
  };
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
  handle = attachGlass(el, { material: MATERIAL_PRESETS.glass, shadow: false });
  resetRenderStats();
});

afterEach(() => {
  handle?.destroy();
  handle = null;
  vi.useRealTimers();
  setInterimWorker(browserWorker);
});

const eased = () => el.hasAttribute('data-vireglass-ease');

describe('the colours of a lens that crossed from a dark backdrop to a light one', () => {
  it('start easing when prepare announces the destination sample, and a landing changes none of them', async () => {
    const dark = colours();
    handle!.setInterim(true);
    handle!.prepare({ ...dest, sample: LIGHT });
    expect(colours()).not.toEqual(dark);
    expect(eased()).toBe(true);
    await worker.answer(0);
    await decodeAll();
    await vi.advanceTimersByTimeAsync(400);
    expect(eased()).toBe(false);
    const before = colours();
    box = { width: 260, height: 100 };
    resetRenderStats();
    expect(handle!.land()).toBe('exact');
    expect(colours()).toEqual(before);
    expect(eased()).toBe(false);
    expect(renderStats()).toMatchObject({ probes: 0, probesAtLand: 0 });
  });

  it('start easing when the destination is probed at its rect, off the landing', async () => {
    const dark = colours();
    handle!.setInterim(true);
    backdrop.sample = LIGHT;
    backdrop.rects = [];
    handle!.prepare({ ...dest, rect: { left: 300, top: 0, width: 260, height: 100 } });
    await vi.advanceTimersByTimeAsync(50);
    expect(backdrop.rects).toEqual([{ left: 300, top: 0, width: 260, height: 100 }]);
    expect(colours()).not.toEqual(dark);
    expect(eased()).toBe(true);
    await worker.answer(0);
    await decodeAll();
    await vi.advanceTimersByTimeAsync(400);
    const before = colours();
    box = { width: 260, height: 100 };
    resetRenderStats();
    handle!.land();
    expect(colours()).toEqual(before);
    expect(renderStats().probes).toBe(0);
  });

  it('are taken at an idle lens landing as the sample says, eased instead of jumping', async () => {
    const dark = colours();
    handle!.prepare({ ...dest, sample: LIGHT });
    expect(colours()).toEqual(dark);
    await worker.answer(0);
    await decodeAll();
    box = { width: 260, height: 100 };
    handle!.land();
    expect(colours()).not.toEqual(dark);
    expect(eased()).toBe(true);
  });

  it('are re-probed at the landing of a host that never prepared, and eased over the existing 200 ms', async () => {
    setInterimWorker(() => null);
    const dark = colours();
    handle!.setInterim(true);
    backdrop.sample = LIGHT;
    resetRenderStats();
    handle!.setInterim(false);
    expect(renderStats()).toMatchObject({ probes: 1, probesAtLand: 1 });
    expect(colours()).not.toEqual(dark);
    expect(eased()).toBe(true);
    await vi.advanceTimersByTimeAsync(300);
    expect(eased()).toBe(false);
  });

  it('are not eased at the landing of a host that never prepared when the backdrop is the same', () => {
    handle!.setInterim(true);
    resetRenderStats();
    handle!.setInterim(false);
    expect(renderStats().probes).toBe(1);
    expect(eased()).toBe(false);
  });
});
