// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spectral = vi.hoisted(() => ({ on: false }));
const bake = vi.hoisted(() => ({ started: 0, fail: false, mapGate: null as Promise<void> | null, hueGate: null as Promise<void> | null }));

vi.mock('../dom/displacement', async (original) => {
  const real = await original<typeof import('../dom/displacement')>();
  let n = 0;
  const build = (_o: unknown, g: { width: number }, dpr: number) => ({ url: `map:${(n += 1)}:w${g.width}:d${dpr}`, width: 4, height: 4, scale: 10 });
  return { ...real, buildDisplacementMap: build, buildDisplacementMapInSlices: async (o: unknown, g: { width: number }, dpr: number) => {
      bake.started += 1;
      await bake.mapGate;
      if (bake.fail) {
        bake.fail = false;
        throw new Error('bake failed');
      }
      return build(o, g, dpr);
    },
  };
});

vi.mock('../dom/spectral-map', async (original) => {
  const real = await original<typeof import('../dom/spectral-map')>();
  let n = 0;
  return {
    ...real,
    hasSpectralEdge: () => spectral.on,
    buildSpectralMap: (_o: unknown, _g: unknown, dpr: number) => ({ url: `hue:${(n += 1)}:d${dpr}`, headroom: 2 }),
    buildSpectralMapInSlices: async (_o: unknown, _g: unknown, dpr: number) => {
      await bake.hueGate;
      return { url: `hue:${(n += 1)}:d${dpr}`, headroom: 2 };
    },
  };
});

vi.mock('../dom/probe', () => ({
  probeBackdrop: () => ({ luma: 0.5, lo: 0.4, hi: 0.6, busy: 0.1, r: 0.5, g: 0.5, b: 0.5 }),
}));

import { renderInSlices } from '../dom/bake';
import { attachGlass, clearMapCache, renderStats, resetRenderStats, type GlassHandle } from '../dom';
import { MATERIAL_PRESETS, resolveOptics } from '../index';
import { resetSupportCache } from '../dom/support';
import { renderDisplacementPixels } from '../dom/displacement';
import { systemAccessibility } from '../dom/preferences';
import { applyAccessibility } from '../accessibility';
import { applyGlassScale, GLASS_SCALE_DEFAULT } from '../glass-scale';
import { applyAppear } from '../appear';
import { roundedRectGeometry } from '../geometry';

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
  Object.assign(bake, { started: 0, fail: false, mapGate: null, hueGate: null });
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

describe('a landing bakes its maps in tasks of their own, a frame apart, and lands them together', () => {
  const hueHref = () => document.querySelectorAll('svg[data-vireglass-filters] filter feImage')[1]?.getAttribute('href');
  const resolve = async (prefix: string) => {
    for (const d of decodes.filter((d) => d.url.startsWith(prefix))) d.resolve();
    decodes = decodes.filter((d) => !d.url.startsWith(prefix));
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
  };
  const land = () => {
    const g = attach();
    g.setInterim(true);
    box = { width: 260, height: 100 };
    resetRenderStats();
    g.setInterim(false);
    return g;
  };

  beforeEach(() => {
    spectral.on = true;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'devicePixelRatio');
  });

  it('bakes nothing in the task that lands, and both maps after the next frame, well before the fallback', async () => {
    land();
    expect(renderStats().fullBakes).toBe(0);
    expect(decodes.some((d) => d.url.includes('w260'))).toBe(false);
    await vi.advanceTimersByTimeAsync(20);
    expect(renderStats().fullBakes).toBe(2);
    expect(decodes.some((d) => d.url.includes('w260'))).toBe(true);
  });

  it('sends the displacement map and the hue map out in the same retarget', async () => {
    land();
    const before = [href(), hueHref()];
    await vi.advanceTimersByTimeAsync(40);
    await resolve('map:');
    expect([href(), hueHref()]).toEqual(before);
    await resolve('hue:');
    expect(href()).toContain('w260');
    expect(hueHref()).not.toBe(before[1]);
    expect(renderStats().filterSwaps).toBe(0);
  });

  it('bakes the hue map at the density the landing was keyed for', async () => {
    Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true });
    land();
    Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
    await vi.advanceTimersByTimeAsync(40);
    expect(decodes.find((d) => d.url.startsWith('map:'))?.url).toContain(':d1');
    expect(decodes.find((d) => d.url.startsWith('hue:'))?.url).toContain(':d1');
  });

  it('lands nothing when the lens is destroyed after its bake started', async () => {
    const g = land();
    let release = () => {};
    bake.mapGate = new Promise<void>((resolve) => (release = resolve));
    await vi.advanceTimersByTimeAsync(20);
    expect(bake.started).toBe(1);
    g.destroy();
    handle = null;
    release();
    await vi.advanceTimersByTimeAsync(120);
    await settle();
    expect(renderStats().fullBakes).toBe(1);
    expect(decodes.some((d) => d.url.startsWith('hue:'))).toBe(false);
  });

  it('starts no bake when the lens is destroyed during the wait', async () => {
    const g = land();
    g.destroy();
    handle = null;
    await vi.advanceTimersByTimeAsync(120);
    expect(bake.started).toBe(0);
  });

  it('bakes after 100 ms where no frame comes', async () => {
    vi.stubGlobal('requestAnimationFrame', () => 0);
    land();
    await vi.advanceTimersByTimeAsync(90);
    expect(bake.started).toBe(0);
    await vi.advanceTimersByTimeAsync(20);
    expect(bake.started).toBe(1);
    vi.unstubAllGlobals();
  });

  it('lands nothing when a new key takes over between the displacement slice and the hue slice', async () => {
    const g = land();
    let release = () => {};
    bake.mapGate = new Promise<void>((resolve) => (release = resolve));
    await vi.advanceTimersByTimeAsync(20);
    box = { width: 300, height: 100 };
    g.update();
    release();
    await vi.advanceTimersByTimeAsync(120);
    await settle();
    expect(href()).toContain('w300');
    expect(renderStats().fullBakes).toBe(3);
    expect(decodes.filter((d) => d.url.startsWith('hue:'))).toHaveLength(0);
  });

  it('lands nothing when the lens re-enters interim during the displacement bake', async () => {
    const g = land();
    let release = () => {};
    bake.mapGate = new Promise<void>((resolve) => (release = resolve));
    await vi.advanceTimersByTimeAsync(20);
    g.setInterim(true);
    release();
    await vi.advanceTimersByTimeAsync(120);
    await settle();
    expect(href()).not.toContain('w260');
    expect(decodes.some((d) => d.url.startsWith('hue:'))).toBe(false);
  });

  it('lands nothing while the element is out of the document, and lands once it is back and measured', async () => {
    let measured = () => {};
    vi.stubGlobal('ResizeObserver', class { constructor(cb: () => void) { measured = cb; } observe() {} disconnect() {} });
    const g = land();
    el.remove();
    await vi.advanceTimersByTimeAsync(120);
    await settle();
    expect(href()).not.toContain('w260');
    document.body.append(el);
    measured();
    await vi.advanceTimersByTimeAsync(120);
    await settle();
    expect(href()).toContain('w260');
    g.destroy();
    handle = null;
    vi.unstubAllGlobals();
  });

  it('survives a failed bake: reports it, and bakes again on the next apply and on the next landing', async () => {
    const reported: unknown[] = [];
    let measured = () => {};
    vi.stubGlobal('reportError', (e: unknown) => reported.push(e));
    vi.stubGlobal('ResizeObserver', class { constructor(cb: () => void) { measured = cb; } observe() {} disconnect() {} });
    const g = land();
    bake.fail = true;
    await vi.advanceTimersByTimeAsync(120);
    expect(reported).toHaveLength(1);
    expect(href()).not.toContain('w260');
    measured();
    await vi.advanceTimersByTimeAsync(120);
    await settle();
    expect(href()).toContain('w260');
    g.setInterim(true);
    g.setInterim(false);
    await vi.advanceTimersByTimeAsync(120);
    await settle();
    expect(href()).toContain('w260');
    vi.unstubAllGlobals();
  });

  it('drops the wait when the box takes a new size during it', async () => {
    const g = land();
    box = { width: 300, height: 100 };
    g.update();
    expect(renderStats().fullBakes).toBe(2);
    await vi.advanceTimersByTimeAsync(120);
    await settle();
    expect(renderStats().fullBakes).toBe(2);
    expect(href()).toContain('w300');
  });

  it('lands a second landing of the same maps before the frame once', async () => {
    const g = land();
    const waiting = vi.getTimerCount();
    g.setInterim(true);
    g.setInterim(false);
    expect(vi.getTimerCount()).toBe(waiting);
    await vi.advanceTimersByTimeAsync(120);
    expect(renderStats().fullBakes).toBe(2);
    expect(decodes.filter((d) => d.url.startsWith('hue:'))).toHaveLength(1);
    await settle();
    expect(href()).toContain('w260');
  });

  it('lands nothing when the lens goes back into interim during the wait', async () => {
    const g = land();
    g.setInterim(true);
    await vi.advanceTimersByTimeAsync(120);
    await settle();
    expect(renderStats().fullBakes).toBe(0);
    expect(href()).not.toContain('w260');
  });

  it('lands at once when both maps are already baked', async () => {
    const g = land();
    await vi.advanceTimersByTimeAsync(40);
    await settle();
    g.setInterim(true);
    resetRenderStats();
    g.setInterim(false);
    expect(renderStats().fullBakes).toBe(0);
    expect(decodes.some((d) => d.url.startsWith('hue:'))).toBe(true);
  });

  it('without a spectral edge bakes its one map after the next frame and lands it', async () => {
    spectral.on = false;
    land();
    expect(renderStats().fullBakes).toBe(0);
    await vi.advanceTimersByTimeAsync(20);
    expect(renderStats().fullBakes).toBe(1);
    await settle();
    expect(href()).toContain('w260');
  });
});

describe('appear is written in place, never baked', () => {
  const full = () =>
    applyAccessibility(applyGlassScale(resolveOptics(MATERIAL_PRESETS.glass), GLASS_SCALE_DEFAULT), systemAccessibility());
  const steps = Array.from({ length: 30 }, (_, i) => i / 29);
  const expectStrength = (a: number, width: number) => {
    const old = renderDisplacementPixels(applyAppear(full(), a), roundedRectGeometry(width, box.height, 0), 1).scale;
    for (const p of document.querySelectorAll('svg[data-vireglass-filters] feDisplacementMap')) {
      expect(Number(p.getAttribute('scale'))).toBeCloseTo(old * Number(p.getAttribute('data-vireglass-ratio')), 9);
    }
  };

  it('costs no bake and no swap across 30 steps at rest, and each step is what the old bake gave', () => {
    spectral.on = true;
    const g = attach();
    for (const a of [...steps].reverse()) {
      g.setAppear(a);
      expectStrength(a, box.width);
      expect(Number(document.querySelector('feGaussianBlur')?.getAttribute('stdDeviation'))).toBeCloseTo(full().blur * a, 9);
      const hue = document.querySelector('feComposite[in2="hue"]');
      expect([Number(hue?.getAttribute('k1')), Number(hue?.getAttribute('k2'))]).toEqual([2 * a, 1 - a]);
    }
    expect(renderStats()).toMatchObject({ fullBakes: 0, reducedBakes: 0, filterSwaps: 0 });
    expect(href()).toContain('map:');
  });

  it('keeps the strength at appear when the settled map lands after its decode', async () => {
    vi.useFakeTimers();
    const g = attach();
    g.setAppear(0.4);
    g.setInterim(true);
    box = { width: 260, height: 100 };
    g.update();
    expectStrength(0.4, 260);
    g.setInterim(false);
    await vi.advanceTimersByTimeAsync(120);
    await settle();
    expect(href()).toContain('w260');
    expectStrength(0.4, 260);
  });

  it('keeps the strength at appear, and at the live box, before and after a reduced map lands in interim', async () => {
    const g = attach();
    g.setInterim(true);
    g.setAppear(0.4);
    box = { width: 240, height: 100 };
    g.update();
    expectStrength(0.4, 240);
    g.setMorph(shape(90));
    await settle();
    expect(href()).toContain('w240');
    expectStrength(0.4, 240);
  });

  it('costs no bake, no swap and no probe across 30 steps in interim', () => {
    const g = attach();
    g.setInterim(true);
    for (const a of steps) g.setAppear(a);
    expect(renderStats()).toMatchObject({ fullBakes: 0, reducedBakes: 0, filterSwaps: 0, probes: 0 });
  });

  it('canary: the same 30 steps of a morph, which the map is keyed by, do bake', () => {
    const g = attach();
    steps.forEach((_, i) => g.setMorph(shape(40 + i * 3)));
    expect(renderStats().fullBakes).toBeGreaterThanOrEqual(30);
  });
});

describe('interim without its end', () => {
  it('leaves by itself after 2 s without a call, with one probe and one bake', async () => {
    vi.useFakeTimers();
    const g = attach();
    g.setInterim(true);
    clearMapCache();
    vi.advanceTimersByTime(1999);
    expect(renderStats()).toMatchObject({ probes: 0, fullBakes: 0 });
    vi.advanceTimersByTime(2);
    expect(renderStats()).toMatchObject({ probes: 1, fullBakes: 0 });
    await vi.advanceTimersByTimeAsync(120);
    expect(renderStats()).toMatchObject({ probes: 1, fullBakes: 1 });
    await vi.advanceTimersByTimeAsync(10_000);
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

  it('is kept alive by setInterim(true) again, so a gesture held still does not bake mid-way', async () => {
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
    expect(renderStats()).toMatchObject({ probes: 1, fullBakes: 0 });
    await vi.advanceTimersByTimeAsync(120);
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

describe('the map cache', () => {
  it('does not hand one material the spectral map of another that differs only in its film', () => {
    spectral.on = true;
    attach();
    const other = document.createElement('div');
    other.getBoundingClientRect = el.getBoundingClientRect;
    document.body.append(other);
    const hueOf = (n: number) => document.querySelectorAll('svg[data-vireglass-filters] filter')[n]?.querySelectorAll('feImage')[1]?.getAttribute('href');
    const second = attachGlass(other, { material: { ...MATERIAL_PRESETS.glass, film: 900 }, shadow: false });
    expect(hueOf(1)).toMatch(/^hue:/);
    expect(hueOf(1)).not.toBe(hueOf(0));
    second.destroy();
  });

  it('rebuilds the spectral map of a live element whose film is all that changed', () => {
    spectral.on = true;
    const options = { material: { ...MATERIAL_PRESETS.glass }, shadow: false };
    handle = attachGlass(el, options);
    const before = document.querySelector('svg[data-vireglass-filters] filter')?.querySelectorAll('feImage')[1]?.getAttribute('href');
    options.material = { ...MATERIAL_PRESETS.glass, film: 900 };
    handle.update();
    const after = document.querySelector('svg[data-vireglass-filters] filter')?.querySelectorAll('feImage')[1]?.getAttribute('href');
    expect(after).toMatch(/^hue:/);
    expect(after).not.toBe(before);
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

describe('slicing on a hidden page', () => {
  const rows = (height: number) => ({ height, rows: () => undefined, done: () => 'done' });

  afterEach(() => {
    Reflect.deleteProperty(document, 'hidden');
  });

  it('yields between slices while the page is shown', async () => {
    vi.useFakeTimers();
    const rendering = renderInSlices(rows(10), 0);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    await vi.runAllTimersAsync();
    await expect(rendering).resolves.toBe('done');
  });

  it('renders every row without waiting on a timer while the page is hidden', async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    const rendering = renderInSlices(rows(10), 0);
    expect(vi.getTimerCount()).toBe(0);
    await expect(rendering).resolves.toBe('done');
  });
});
