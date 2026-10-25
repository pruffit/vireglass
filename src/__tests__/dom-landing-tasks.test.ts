// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const log = vi.hoisted(() => ({ events: [] as string[] }));

vi.mock('../dom/bake', async (original) => {
  const real = await original<typeof import('../dom/bake')>();
  return {
    ...real,
    renderInSlices: (map: { rows(a: number, b: number): void }, ...rest: unknown[]) =>
      (real.renderInSlices as (m: unknown, ...r: unknown[]) => Promise<unknown>)(
        new Proxy(map, {
          get: (target, key) =>
            key === 'rows'
              ? (a: number, b: number) => {
                  if (log.events.at(-1) !== 'rows') log.events.push('rows');
                  target.rows(a, b);
                }
              : Reflect.get(target, key),
        }),
        ...rest,
      ),
    pngFromPixels: (_d: unknown, w: number, h: number) => {
      log.events.push('encode');
      return `png:${w}x${h}:${log.events.length}`;
    },
  };
});

vi.mock('../dom/spectral-map', async (original) => ({ ...(await original<typeof import('../dom/spectral-map')>()), hasSpectralEdge: () => true }));
vi.mock('../dom/probe', () => ({
  probeBackdrop: () => ({ luma: 0.5, lo: 0.4, hi: 0.6, busy: 0.1, r: 0.5, g: 0.5, b: 0.5 }),
}));

import { attachGlass, clearMapCache, type GlassHandle } from '../dom';
import { MATERIAL_PRESETS } from '../index';
import { resetSupportCache } from '../dom/support';
import { buildDisplacementMapInSlices } from '../dom/displacement';
import { buildSpectralMapInSlices } from '../dom/spectral-map';
import { resolveOptics } from '../material';
import { roundedRectGeometry } from '../geometry';

const SHAPE = ['rows', 'yield', 'encode', 'yield', 'rows', 'yield', 'encode', 'yield'];
let decodes: { url: string; resolve: () => void }[] = [];
let handle: GlassHandle | null = null;
let el: HTMLElement;
let box = { width: 200, height: 100 };

const hrefs = () => [...document.querySelectorAll('svg[data-vireglass-filters] filter feImage')].map((n) => n.getAttribute('href'));

beforeEach(() => {
  log.events = [];
  decodes = [];
  box = { width: 200, height: 100 };
  vi.spyOn(performance, 'now').mockReturnValue(0);
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
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
});

afterEach(() => {
  handle?.destroy();
  handle = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, 'hidden');
});

const trackYields = () => {
  const real = globalThis.setTimeout;
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
    if (ms === 0) log.events.push('yield');
    return real(fn, ms);
  }) as typeof setTimeout);
};

describe('a landing runs at most one slice of rows or one encode per task', () => {
  it('yields after the last slice of a map, after each encode, and between the maps', async () => {
    trackYields();
    const geometry = roundedRectGeometry(60, 40, 8);
    const optics = resolveOptics();
    const pending = buildDisplacementMapInSlices(optics, geometry, 1).then(() => buildSpectralMapInSlices(optics, geometry, 1));
    await vi.runAllTimersAsync();
    await pending;
    expect(log.events).toEqual(SHAPE);
  });

  it('keeps that shape through a whole landing and still lands both maps together', async () => {
    trackYields();
    const g = attachGlass(el, { material: MATERIAL_PRESETS.glass, shadow: false });
    g.setInterim(true);
    box = { width: 260, height: 100 };
    g.update();
    log.events = [];
    const before = hrefs();
    g.setInterim(false);
    handle = g;
    await vi.advanceTimersByTimeAsync(100);
    expect(log.events.slice(log.events.indexOf('rows'))).toEqual(SHAPE);
    expect(hrefs()).toEqual(before);
    for (const d of decodes.splice(0)) d.resolve();
    await vi.advanceTimersByTimeAsync(0);
    const after = hrefs();
    expect(after[0]).not.toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
  });

  it('renders and encodes at once without a timer while the page is hidden', async () => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    trackYields();
    const geometry = roundedRectGeometry(60, 40, 8);
    const optics = resolveOptics();
    await buildDisplacementMapInSlices(optics, geometry, 1);
    await buildSpectralMapInSlices(optics, geometry, 1);
    expect(log.events).toEqual(['rows', 'encode', 'rows', 'encode']);
    expect(vi.getTimerCount()).toBe(0);
  });
});
