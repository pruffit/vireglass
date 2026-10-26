// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('../dom/probe', () => ({
  probeBackdrop: () => ({ luma: 0.5, lo: 0.4, hi: 0.6, busy: 0.1, r: 0.5, g: 0.5, b: 0.5 }),
}));

import { attachGlass, clearMapCache, renderStats, resetRenderStats, type GlassHandle } from '../dom';
import { MATERIAL_PRESETS } from '../index';
import { resetSupportCache } from '../dom/support';
import { setPairBudget, PAIR_BUDGET_BYTES } from '../dom/pair-budget';
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
  async answer(index: number): Promise<void> {
    const result = await renderInterim(this.jobs[index]!, async (data) => new Blob([data.slice(0, 4)]));
    this.onmessage?.({ data: result });
    await flush();
  }
}

let worker: FakeWorker;
let decodes: { url: string; resolve: () => void }[] = [];
let urls: string[] = [];
let revoked: string[] = [];
let handles: GlassHandle[] = [];
let els: HTMLElement[] = [];
let box = { width: 200, height: 100 };
let hidden = false;

const flush = async () => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
};
const decodeAll = async () => {
  for (const d of decodes.splice(0)) d.resolve();
  await flush();
};
const filter = (n = 0) => document.querySelectorAll('svg[data-vireglass-filters] filter')[n] as SVGFilterElement;
const href = (n = 0) => filter(n)?.querySelector('feImage')?.getAttribute('href');
const dest = (width: number) => ({ geometry: { width, height: 100, cornerRadius: 0 } });
const timers = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });

function attach(): GlassHandle {
  const id = els.length;
  document.body.insertAdjacentHTML('beforeend', `<div id="g${id}"></div>`);
  const el = document.getElementById(`g${id}`) as HTMLElement;
  el.getBoundingClientRect = () => ({ left: 0, top: 0, right: box.width, bottom: box.height, x: 0, y: 0, ...box, toJSON() {} }) as DOMRect;
  els.push(el);
  const handle = attachGlass(el, { material: MATERIAL_PRESETS.glass, shadow: false });
  handles.push(handle);
  resetRenderStats();
  return handle;
}

beforeEach(() => {
  decodes = [];
  urls = [];
  revoked = [];
  handles = [];
  els = [];
  box = { width: 200, height: 100 };
  hidden = false;
  worker = new FakeWorker();
  setInterimWorker(() => worker);
  (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = () => {
    const url = `blob:test/${urls.length + 1}`;
    urls.push(url);
    return url;
  };
  (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = (u) => void revoked.push(u);
  Object.defineProperty(document, 'hidden', { get: () => hidden, configurable: true });
  document.body.innerHTML = '';
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
  vi.useRealTimers();
  for (const h of handles) h.destroy();
  setPairBudget(PAIR_BUDGET_BYTES);
  setInterimWorker(browserWorker);
});

async function ready(g: GlassHandle, width: number, job: number): Promise<void> {
  g.prepare(dest(width));
  await worker.answer(job);
  await decodeAll();
}

describe('prepare and land', () => {
  it('lands a decoded pair in the task of the call: no bake, probe, swap or wait', async () => {
    const g = attach();
    g.setInterim(true);
    await ready(g, 260, 0);
    box = { width: 260, height: 100 };
    resetRenderStats();
    const result = g.land();
    expect(result).toBe('exact');
    expect(href()).toBe(urls[0]);
    expect(renderStats()).toMatchObject({ landedExact: 1, landedBlend: 0, fullBakes: 0, mainThreadBakes: 0, probes: 0, probesAtLand: 0, filterSwaps: 0, syncSwaps: 0 });
  });

  it('lands several lenses in one task', async () => {
    const a = attach();
    const b = attach();
    a.setInterim(true);
    b.setInterim(true);
    a.prepare(dest(260));
    b.prepare(dest(260));
    await worker.answer(0);
    await worker.answer(1);
    await decodeAll();
    box = { width: 260, height: 100 };
    resetRenderStats();
    expect([a.land(), b.land()]).toEqual(['exact', 'exact']);
    expect(href(0)).toBe(urls[0]);
    expect(href(1)).toBe(urls[1]);
    expect(renderStats()).toMatchObject({ landedExact: 2, probes: 0, fullBakes: 0, filterSwaps: 0 });
  });

  it('setInterim(false) is land()', async () => {
    const g = attach();
    g.setInterim(true);
    await ready(g, 260, 0);
    box = { width: 260, height: 100 };
    resetRenderStats();
    g.setInterim(false);
    expect(href()).toBe(urls[0]);
    expect(renderStats()).toMatchObject({ landedExact: 1, probes: 0 });
  });

  it('takes the rect probe only when no sample is given', async () => {
    timers();
    const g = attach();
    const sample = { luma: 0.9, lo: 0.8, hi: 1, busy: 0, r: 0.9, g: 0.9, b: 0.9 };
    g.prepare({ ...dest(260), sample, rect: { left: 0, top: 0, width: 260, height: 100 } });
    await vi.advanceTimersByTimeAsync(200);
    expect(renderStats().probes).toBe(0);
    g.prepare({ ...dest(300), rect: { left: 0, top: 0, width: 300, height: 100 } });
    await vi.advanceTimersByTimeAsync(200);
    expect(renderStats().probes).toBe(1);
  });

  it('builds a destination before an interim map that waits for the worker', async () => {
    const a = attach();
    const b = attach();
    a.setInterim(true);
    b.setInterim(true);
    a.prepare(dest(111));
    b.setMorph({ smoothing: 10, shape: { offsetX: 10, offsetY: 0, width: 40, height: 40, cornerRadius: 8 } });
    b.prepare(dest(333));
    expect(worker.jobs[0]!.geometry.width).toBe(111);
    await worker.answer(0);
    expect(worker.jobs[1]!.geometry.width).toBe(333);
  });
});

describe('superseded destinations', () => {
  it('builds only the newest of three prepares: the older queued jobs are taken back one by one', async () => {
    const g = attach();
    g.setInterim(true);
    g.setMorph({ smoothing: 10, shape: { offsetX: 10, offsetY: 0, width: 40, height: 40, cornerRadius: 8 } });
    expect(worker.jobs).toHaveLength(1);
    g.prepare(dest(111));
    g.prepare(dest(222));
    await flush();
    g.prepare(dest(333));
    await flush();
    await worker.answer(0);
    expect(worker.jobs.map((j) => j.geometry.width)).toEqual([200, 333]);
  });
});

describe('prepare(null)', () => {
  it('takes back a destination job that still waits for the worker', async () => {
    const g = attach();
    g.setInterim(true);
    g.setMorph({ smoothing: 10, shape: { offsetX: 10, offsetY: 0, width: 40, height: 40, cornerRadius: 8 } });
    g.prepare(dest(111));
    g.prepare(null);
    await worker.answer(0);
    expect(worker.jobs).toHaveLength(1);
  });

  it('drops a destination that waits behind a job the worker already has', async () => {
    const g = attach();
    g.prepare(dest(222));
    g.prepare(dest(333));
    g.prepare(null);
    await worker.answer(0);
    expect(worker.jobs).toHaveLength(1);
  });
});

describe('a landing that is not ready', () => {
  it('returns blend after a retarget, mixes through attributes and ends on the destination', async () => {
    timers();
    const g = attach();
    g.setInterim(true);
    g.prepare(dest(260));
    await worker.answer(0);
    await decodeAll();
    g.prepare(dest(300));
    box = { width: 300, height: 100 };
    const first = href();
    const node = filter();
    resetRenderStats();
    expect(g.land()).toBe('blend');
    expect(href()).toBe(first);
    await worker.answer(1);
    await decodeAll();
    await vi.advanceTimersByTimeAsync(40);
    expect(filter()).toBe(node);
    expect(href()).toBe(first);
    expect(node.querySelectorAll('feImage')).toHaveLength(2);
    const mix = node.querySelector('feComposite[result="map"]')!;
    const mid = Number(mix.getAttribute('k3'));
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(node.querySelectorAll('feImage')).toHaveLength(1);
    expect(href()).toBe(urls[1]);
    expect(renderStats()).toMatchObject({ landedBlend: 1, landedExact: 0, fullBakes: 0, filterSwaps: 0 });
  });

  it('never shows a superseded prepare', async () => {
    const g = attach();
    g.setInterim(true);
    g.prepare(dest(260));
    g.prepare(dest(300));
    await worker.answer(0);
    await decodeAll();
    expect(href()).not.toBe(urls[0]);
    await worker.answer(1);
    await decodeAll();
    box = { width: 300, height: 100 };
    expect(g.land()).toBe('exact');
    expect(href()).toBe(urls[1]);
    expect(href()).not.toBe(urls[0]);
  });

  it('blends without a worker when nothing was prepared, from the shown pair to the pair of the box', async () => {
    timers();
    setInterimWorker(() => null);
    const g = attach();
    g.setInterim(true);
    const first = href();
    box = { width: 260, height: 100 };
    expect(g.land()).toBe('blend');
    await vi.advanceTimersByTimeAsync(600);
    await decodeAll();
    await vi.advanceTimersByTimeAsync(600);
    expect(href()).not.toBe(first);
    expect(href()).toMatch(/^main:/);
  });
});

describe('the byte budget', () => {
  it('evicts pairs that are not shown or held and never revokes a shown URL', async () => {
    const g = attach();
    g.setInterim(true);
    await ready(g, 260, 0);
    box = { width: 260, height: 100 };
    g.land();
    const shown = href();
    expect(shown).toBe(urls[0]);
    setPairBudget(1);
    await ready(g, 300, 1);
    await ready(g, 340, 2);
    expect(revoked).toContain(urls[1]);
    expect(revoked).not.toContain(urls[0]);
    expect(href()).toBe(shown);
  });
});

describe('pairs that never decoded', () => {
  it('are released when the budget is over, as soon as nothing holds them', async () => {
    const g = attach();
    g.setInterim(true);
    setPairBudget(1);
    g.prepare(dest(260));
    await worker.answer(0);
    g.prepare(dest(300));
    await worker.answer(1);
    expect(revoked).toContain(urls[0]);
    expect(revoked).not.toContain(urls[1]);
  });

  it('are not shown after the budget released them while they decoded', async () => {
    const g = attach();
    g.setInterim(true);
    setPairBudget(1);
    const bridge = (x: number) => ({ smoothing: 10, shape: { offsetX: x, offsetY: 0, width: 40, height: 40, cornerRadius: 8 } });
    g.setMorph(bridge(10));
    await worker.answer(0);
    g.setMorph(bridge(20));
    await worker.answer(1);
    expect(revoked).toContain(urls[0]);
    await decodeAll();
    expect(href()).toBe(urls[1]);
  });
});

describe('a hidden page', () => {
  it('lands an undecoded pair at once and settles on visibilitychange', async () => {
    const g = attach();
    g.setInterim(true);
    g.prepare(dest(260));
    await worker.answer(0);
    hidden = true;
    box = { width: 260, height: 100 };
    resetRenderStats();
    expect(g.land()).toBe('exact');
    expect(href()).toBe(urls[0]);
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    await decodeAll();
    expect(href()).toBe(urls[0]);
  });

  it('verifies the latest of two landings made while hidden, not the first', async () => {
    const g = attach();
    hidden = true;
    for (const width of [260, 300]) {
      g.setInterim(true);
      g.prepare(dest(width));
      await worker.answer(width === 260 ? 0 : 1);
      box = { width, height: 100 };
      g.land();
    }
    decodes = [];
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(decodes.map((d) => d.url)).toEqual([urls[1]]);
  });
});

describe('a landing lands the lens as it is, never a pair for what it was', () => {
  const shape = (x: number) => ({ smoothing: 10, shape: { offsetX: x, offsetY: 0, width: 40, height: 40, cornerRadius: 8 } });
  const none = { fullBakes: 0, mainThreadBakes: 0, filterSwaps: 0, syncSwaps: 0 };

  afterEach(() => {
    Reflect.deleteProperty(window, 'devicePixelRatio');
  });

  it('a box a quarter pixel past the prepared one: the prepared pair is shown, the live one blended in', async () => {
    timers();
    const g = attach();
    g.setInterim(true);
    await ready(g, 260, 0);
    box = { width: 260.25, height: 100 };
    resetRenderStats();
    expect(g.land()).toBe('blend');
    expect(href()).toBe(urls[0]);
    expect(worker.jobs).toHaveLength(2);
    expect(worker.jobs[1]!.geometry.width).toBe(260.5);
    await worker.answer(1);
    await decodeAll();
    await vi.advanceTimersByTimeAsync(300);
    expect(href()).toBe(urls[1]);
    expect(renderStats()).toMatchObject({ ...none, landedExact: 0, landedBlend: 1 });
  });

  it('a material given to prepare and not applied is not landed as if it were', async () => {
    timers();
    const g = attach();
    g.setInterim(true);
    g.prepare({ ...dest(260), material: { thickness: 80 } });
    await worker.answer(0);
    await decodeAll();
    box = { width: 260, height: 100 };
    resetRenderStats();
    expect(g.land()).toBe('blend');
    expect(worker.jobs).toHaveLength(2);
    expect(worker.jobs[1]!.optics.thicknessDp).not.toBe(worker.jobs[0]!.optics.thicknessDp);
    expect(renderStats()).toMatchObject({ ...none, landedExact: 0 });
  });

  it('a material given to prepare and applied with setMaterial lands exactly', async () => {
    const g = attach();
    g.setInterim(true);
    const material = { thickness: 80 };
    g.prepare({ ...dest(260), material });
    g.setMaterial(material);
    await worker.answer(0);
    await decodeAll();
    box = { width: 260, height: 100 };
    resetRenderStats();
    expect(g.land()).toBe('exact');
    expect(href()).toBe(urls[0]);
    expect(renderStats()).toMatchObject({ ...none, landedExact: 1 });
  });

  it('a change of density after prepare', async () => {
    timers();
    const g = attach();
    g.setInterim(true);
    await ready(g, 260, 0);
    Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
    box = { width: 260, height: 100 };
    resetRenderStats();
    expect(g.land()).toBe('blend');
    expect(worker.jobs[1]!.dpr).toBe(2);
    expect(renderStats()).toMatchObject({ ...none, landedExact: 0 });
  });

  describe('during a blend', () => {
    async function midBlend() {
      timers();
      const g = attach();
      g.setInterim(true);
      g.prepare(dest(260));
      await worker.answer(0);
      await decodeAll();
      g.prepare(dest(300));
      box = { width: 300, height: 100 };
      expect(g.land()).toBe('blend');
      await worker.answer(1);
      await decodeAll();
      await vi.advanceTimersByTimeAsync(40);
      const node = filter();
      const mix = node.querySelector('feComposite[result="map"]')!;
      const at = Number(mix.getAttribute('k3'));
      expect(at).toBeGreaterThan(0);
      expect(at).toBeLessThan(1);
      resetRenderStats();
      return { g, node, mix, at };
    }

    it('a resize retargets the blend on the same filter and ends on the pair of the new box', async () => {
      const { g, node, mix, at } = await midBlend();
      box = { width: 340, height: 100 };
      g.update();
      expect(filter()).toBe(node);
      expect(Number(mix.getAttribute('k3'))).toBe(at);
      expect(worker.jobs[2]!.geometry.width).toBe(340);
      await vi.advanceTimersByTimeAsync(300);
      expect(filter()).toBe(node);
      expect(href()).toBe(urls[1]);
      await worker.answer(2);
      await decodeAll();
      await vi.advanceTimersByTimeAsync(300);
      expect(filter()).toBe(node);
      expect(node.querySelectorAll('feImage')).toHaveLength(1);
      expect(href()).toBe(urls[2]);
      expect(renderStats()).toMatchObject(none);
    });

    it('setInterim(true) leaves the mix where it is and lets it run out', async () => {
      const { g, node, mix, at } = await midBlend();
      g.setInterim(true);
      expect(Number(mix.getAttribute('k3'))).toBe(at);
      expect(node.querySelectorAll('feImage')).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(300);
      expect(filter()).toBe(node);
      expect(node.querySelectorAll('feImage')).toHaveLength(1);
      expect(href()).toBe(urls[1]);
      expect(renderStats()).toMatchObject(none);
    });

    it('setMorph continues the mix and ends on the pair of the new morph, without a bake', async () => {
      const { g, node, mix, at } = await midBlend();
      g.setMorph(shape(20));
      expect(Number(mix.getAttribute('k3'))).toBe(at);
      expect(node.querySelectorAll('feImage')).toHaveLength(2);
      expect(worker.jobs).toHaveLength(3);
      await worker.answer(2);
      await decodeAll();
      await vi.advanceTimersByTimeAsync(600);
      expect(filter()).toBe(node);
      expect(node.querySelectorAll('feImage')).toHaveLength(1);
      expect(href()).toBe(urls[2]);
      expect(renderStats()).toMatchObject(none);
    });

    it('a pair that arrives mid-blend enters at weight 0 over the mix that is shown, and the blend ends on it', async () => {
      const { g, node, at } = await midBlend();
      box = { width: 340, height: 100 };
      g.update();
      await worker.answer(2);
      await decodeAll();
      expect(node.querySelectorAll('feImage')).toHaveLength(3);
      const mixes = node.querySelectorAll('feComposite[result^="map"]');
      expect(mixes).toHaveLength(2);
      expect(Number(mixes[0]!.getAttribute('k3'))).toBe(at);
      expect(Number(node.querySelector('feComposite[result="map"]')!.getAttribute('k3'))).toBe(0);
      await vi.advanceTimersByTimeAsync(400);
      expect(node.querySelectorAll('feImage')).toHaveLength(1);
      expect(href()).toBe(urls[2]);
    });

    it('a pair that only the blend heads for and the store evicted is revoked once, when the blend lets go of it', async () => {
      const { g, node } = await midBlend();
      const target = urls[1]!;
      for (let i = 0; i < 10; i += 1) {
        box = { width: 340 + i * 10, height: 100 };
        g.update();
        await worker.answer(2 + i);
      }
      await decodeAll();
      expect(revoked).not.toContain(target);
      expect(node.querySelector(`feImage[href="${target}"]`)).not.toBeNull();
      await vi.advanceTimersByTimeAsync(600);
      expect(node.querySelectorAll('feImage')).toHaveLength(1);
      expect(revoked.filter((u) => u === target)).toHaveLength(1);
      expect(href()).not.toBe(target);
    });

    it('destroy removes the blend with the filter and leaves no timer', async () => {
      const { g } = await midBlend();
      g.destroy();
      expect(document.querySelectorAll('svg[data-vireglass-filters] filter')).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(300);
    });
  });

  it('destroy while the pair is built: the answer is released and nothing is shown', async () => {
    const g = attach();
    g.setInterim(true);
    g.prepare(dest(260));
    g.destroy();
    await worker.answer(0);
    expect(revoked).toContain(urls[0]);
    expect(document.querySelectorAll('svg[data-vireglass-filters] filter')).toHaveLength(0);
  });

  it('a worker that fails while a landing waits hands it to the main thread, and the landing blends to that pair', async () => {
    timers();
    const g = attach();
    const first = href();
    g.prepare(dest(260));
    box = { width: 260, height: 100 };
    expect(g.land()).toBe('blend');
    worker.onerror?.({});
    await vi.advanceTimersByTimeAsync(300);
    await decodeAll();
    await vi.advanceTimersByTimeAsync(300);
    expect(href()).toMatch(/^main:/);
    expect(href()).not.toBe(first);
    expect(filter().querySelectorAll('feImage')).toHaveLength(1);
  });
});
