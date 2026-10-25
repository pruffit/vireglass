// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const gate = vi.hoisted(() => ({ hue: null as Promise<void> | null }));

vi.mock('../dom/displacement', async (original) => {
  const real = await original<typeof import('../dom/displacement')>();
  let n = 0;
  const build = (_o: unknown, g: { width: number }) => ({ url: `map:${(n += 1)}:w${g.width}`, width: 4, height: 4, scale: 10 });
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
import { browserWorker, setInterimWorker } from '../dom/interim-build';

let decodes: { url: string; resolve: () => void }[] = [];
let box = { width: 200, height: 100 };
let handle: GlassHandle | null = null;
let el: HTMLElement;

const hrefs = () => [...document.querySelectorAll('svg[data-vireglass-filters] filter feImage')].map((n) => n.getAttribute('href') ?? '');
const decodeAll = async () => {
  for (let i = 0; i < 4; i += 1) {
    for (const d of decodes.splice(0)) d.resolve();
    await vi.advanceTimersByTimeAsync(0);
  }
};

const decodeNow = async () => {
  for (let round = 0; round < 3; round += 1) {
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
    for (const d of decodes.splice(0)) d.resolve();
  }
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
};

beforeEach(() => {
  decodes = [];
  gate.hue = null;
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
      return new Promise<void>((resolve) => decodes.push({ url: this.src, resolve }));
    }
  };
});

afterEach(() => {
  handle?.destroy();
  handle = null;
  vi.useRealTimers();
  setInterimWorker(browserWorker);
});

describe('without a worker, an interim pair of a lens with a hue', () => {
  it('does not claim its key while the hue on the filter is the previous box', async () => {
    handle = attachGlass(el, { material: MATERIAL_PRESETS.glass, shadow: false });
    handle.setInterim(true);
    let release = () => {};
    gate.hue = new Promise<void>((resolve) => (release = resolve));
    box = { width: 260, height: 100 };
    handle.update();
    await decodeNow();
    expect(hrefs()[0]).toContain('w260');
    expect(hrefs()[1]).toContain('w200');
    expect(handle.land()).toBe('blend');
    release();
    await vi.advanceTimersByTimeAsync(100);
    await decodeAll();
    await vi.advanceTimersByTimeAsync(400);
    await decodeAll();
    expect(hrefs()).toEqual([expect.stringContaining('w260'), expect.stringContaining('w260')]);
    expect(document.querySelectorAll('svg[data-vireglass-filters] filter feImage')).toHaveLength(2);
  });

  it('builds the hue in slices once the key holds still, and then lands exactly with it', async () => {
    handle = attachGlass(el, { material: MATERIAL_PRESETS.glass, shadow: false });
    handle.setInterim(true);
    box = { width: 260, height: 100 };
    handle.update();
    await decodeAll();
    await vi.advanceTimersByTimeAsync(50);
    await decodeAll();
    expect(hrefs()).toEqual([expect.stringContaining('w260'), expect.stringContaining('w260')]);
    expect(handle.land()).toBe('exact');
    expect(hrefs()).toEqual([expect.stringContaining('w260'), expect.stringContaining('w260')]);
  });

  it('builds no hue for a key that moved on before the slices ran', async () => {
    handle = attachGlass(el, { material: MATERIAL_PRESETS.glass, shadow: false });
    handle.setInterim(true);
    for (const width of [230, 240, 250]) {
      box = { width, height: 100 };
      handle.update();
    }
    await decodeAll();
    await vi.advanceTimersByTimeAsync(50);
    await decodeAll();
    expect(hrefs()[0]).toContain('w250');
    expect(hrefs()[1]).toContain('w250');
    expect(decodes.some((d) => d.url.includes('hue') && d.url.includes('w230'))).toBe(false);
  });
});
