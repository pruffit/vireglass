// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spectral = vi.hoisted(() => ({ on: false }));

vi.mock('../dom/displacement', async (original) => {
  const real = await original<typeof import('../dom/displacement')>();
  let n = 0;
  return {
    ...real,
    buildDisplacementMap: (_o: unknown, g: { width: number }, dpr: number) => ({
      url: `map:${(n += 1)}:w${g.width}:d${dpr}`,
      width: 4,
      height: 4,
      scale: 10,
    }),
  };
});

vi.mock('../dom/spectral-map', async (original) => {
  const real = await original<typeof import('../dom/spectral-map')>();
  let n = 0;
  return {
    ...real,
    hasSpectralEdge: () => spectral.on,
    buildSpectralMap: () => ({ url: `hue:${(n += 1)}`, headroom: 1 }),
  };
});

vi.mock('../dom/probe', () => ({
  probeBackdrop: () => ({ luma: 0.5, lo: 0.4, hi: 0.6, busy: 0.1, r: 0.5, g: 0.5, b: 0.5 }),
}));

import { attachGlass, clearMapCache, renderStats, resetRenderStats, type GlassHandle } from '../dom';
import { MATERIAL_PRESETS } from '../index';
import { resetSupportCache } from '../dom/support';

type Decode = { url: string; resolve: () => void };
let decodes: Decode[] = [];
let box = { width: 200, height: 100 };
let handle: GlassHandle | null = null;
let el: HTMLElement;

const href = () => document.querySelector('svg[data-vireglass-filters] filter feImage')?.getAttribute('href');
const filters = () => document.querySelectorAll('svg[data-vireglass-filters] filter').length;
const settle = async () => {
  for (const d of decodes.splice(0)) d.resolve();
  await Promise.resolve();
  await Promise.resolve();
};
const shape = (x: number) => ({
  smoothing: 10,
  shape: { offsetX: x, offsetY: 0, width: 40, height: 40, cornerRadius: 8 },
});

function attach(extra: Parameters<typeof attachGlass>[1] = {}) {
  handle = attachGlass(el, { material: MATERIAL_PRESETS.glass, shadow: false, ...extra });
  resetRenderStats();
  return handle;
}

beforeEach(() => {
  decodes = [];
  box = { width: 200, height: 100 };
  spectral.on = false;
  document.body.innerHTML = '<div id="g"></div>';
  el = document.getElementById('g') as HTMLElement;
  el.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: box.width, bottom: box.height, x: 0, y: 0, ...box, toJSON() {} }) as DOMRect;
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
});

describe('a pending decode never lands on a filter it was not made for', () => {
  it('drops the decode of the map a later swap replaced', async () => {
    const g = attach();
    g.setInterim(true);
    g.setInterim(false);
    expect(decodes.length).toBeGreaterThan(0);
    box = { width: 260, height: 100 };
    g.update();
    const newer = href();
    expect(newer).toContain('w260');
    await settle();
    expect(href()).toBe(newer);
  });

  it('drops an interim decode after the finger path installed a map', async () => {
    vi.useFakeTimers();
    const g = attach({ interactive: true });
    g.setInterim(true);
    g.setMorph(shape(90));
    el.dispatchEvent(new MouseEvent('pointerdown', { clientX: 100, clientY: 50, bubbles: true }));
    await vi.advanceTimersByTimeAsync(40);
    const touched = href();
    expect(touched).toContain('d1');
    for (const d of decodes.splice(0)) d.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(href()).toBe(touched);
  });
});

describe('appear and optics changes during interim', () => {
  it('bake one reduced map and show it', async () => {
    const g = attach();
    g.setInterim(true);
    g.setAppear(0.5);
    expect(renderStats()).toMatchObject({ reducedBakes: 1, fullBakes: 0, filterSwaps: 0, probes: 0 });
    const before = href();
    await settle();
    expect(href()).not.toBe(before);
    expect(href()).toContain('d1');
  });
});

describe('interim without its end', () => {
  it('leaves by itself after 2 s without a call, with one probe and one bake', () => {
    vi.useFakeTimers();
    const g = attach();
    g.setInterim(true);
    clearMapCache();
    vi.advanceTimersByTime(1999);
    expect(renderStats()).toMatchObject({ probes: 0, fullBakes: 0 });
    vi.advanceTimersByTime(2);
    expect(renderStats()).toMatchObject({ probes: 1, fullBakes: 1 });
    vi.advanceTimersByTime(10_000);
    expect(renderStats()).toMatchObject({ probes: 1, fullBakes: 1 });
  });

  it('is kept alive by activity', () => {
    vi.useFakeTimers();
    const g = attach();
    g.setInterim(true);
    vi.advanceTimersByTime(1500);
    g.update();
    vi.advanceTimersByTime(1500);
    expect(renderStats().probes).toBe(0);
    vi.advanceTimersByTime(600);
    expect(renderStats().probes).toBe(1);
  });

  it('is kept alive by setInterim(true) again, so a gesture held still does not bake mid-way', () => {
    vi.useFakeTimers();
    const g = attach();
    g.setInterim(true);
    for (let held = 0; held < 4; held += 1) {
      vi.advanceTimersByTime(1500);
      g.setInterim(true);
    }
    expect(renderStats()).toMatchObject({ probes: 0, fullBakes: 0 });
    clearMapCache();
    vi.advanceTimersByTime(2001);
    expect(renderStats()).toMatchObject({ probes: 1, fullBakes: 1 });
  });

  it('does not fire after an explicit end or a destroy', () => {
    vi.useFakeTimers();
    const g = attach();
    g.setInterim(true);
    g.setInterim(false);
    const after = renderStats();
    vi.advanceTimersByTime(5000);
    expect(renderStats()).toEqual(after);
    g.setInterim(true);
    g.destroy();
    vi.advanceTimersByTime(5000);
    expect(renderStats()).toEqual(after);
  });
});

describe('what the counters count', () => {
  it('counts the spectral map with the displacement map', () => {
    spectral.on = true;
    attach();
    handle?.destroy();
    resetRenderStats();
    clearMapCache();
    attachGlass(el, { material: MATERIAL_PRESETS.glass, shadow: false });
    expect(renderStats().fullBakes).toBe(2);
  });

  it('bakes a finger release at reduced resolution and once at full when it settles', async () => {
    vi.useFakeTimers();
    const g = attach({ interactive: true });
    el.dispatchEvent(new MouseEvent('pointerdown', { clientX: 100, clientY: 50, bubbles: true }));
    el.dispatchEvent(new MouseEvent('pointerup', { clientX: 100, clientY: 50, bubbles: true }));
    await vi.advanceTimersByTimeAsync(300);
    const mid = renderStats();
    expect(mid.reducedBakes).toBeGreaterThan(3);
    expect(mid.fullBakes).toBe(0);
    clearMapCache();
    await vi.advanceTimersByTimeAsync(5000);
    expect(renderStats().fullBakes).toBe(1);
    g.destroy();
  });

  it('never bakes a finger at full resolution inside interim', async () => {
    vi.useFakeTimers();
    const g = attach({ interactive: true });
    g.setInterim(true);
    el.dispatchEvent(new MouseEvent('pointerdown', { clientX: 100, clientY: 50, bubbles: true }));
    el.dispatchEvent(new MouseEvent('pointerup', { clientX: 100, clientY: 50, bubbles: true }));
    await vi.advanceTimersByTimeAsync(1900);
    expect(renderStats().fullBakes).toBe(0);
    expect(renderStats().reducedBakes).toBeGreaterThan(3);
    g.destroy();
  });
});

describe('an element with no size', () => {
  it('is not baked at rest', () => {
    box = { width: 0, height: 0 };
    attach();
    handle?.update();
    expect(renderStats()).toMatchObject({ fullBakes: 0, reducedBakes: 0, filterSwaps: 0 });
    expect(filters()).toBe(0);
  });

  it('is not baked during interim, and bakes once it has a size', () => {
    const g = attach();
    g.setInterim(true);
    box = { width: 0.4, height: 100 };
    g.setMorph(shape(90));
    expect(renderStats().reducedBakes).toBe(0);
    box = { width: 200, height: 100 };
    g.setMorph(shape(91));
    expect(renderStats().reducedBakes).toBe(1);
  });
});
