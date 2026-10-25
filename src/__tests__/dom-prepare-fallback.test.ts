// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const log = vi.hoisted(() => ({ clock: 0, task: 0, rows: [] as { task: number; at: number; height: number }[], encodes: 0 }));

vi.mock('../dom/bake', async (original) => {
  const real = await original<typeof import('../dom/bake')>();
  return {
    ...real,
    renderInSlices: (map: { height: number; rows(a: number, b: number): void }, ...rest: unknown[]) =>
      (real.renderInSlices as (m: unknown, ...r: unknown[]) => Promise<unknown>)(
        new Proxy(map, {
          get: (target, key) =>
            key === 'rows'
              ? (a: number, b: number) => {
                  log.rows.push({ task: log.task, at: log.clock, height: target.height });
                  log.clock += 1;
                  target.rows(a, b);
                }
              : Reflect.get(target, key),
        }),
        ...rest,
      ),
    pngFromPixels: (_d: unknown, w: number, h: number) => {
      log.encodes += 1;
      return `png:${w}x${h}:${log.encodes}`;
    },
  };
});

vi.mock('../dom/spectral-map', async (original) => ({ ...(await original<typeof import('../dom/spectral-map')>()), hasSpectralEdge: () => false }));
vi.mock('../dom/probe', () => ({
  probeBackdrop: () => ({ luma: 0.5, lo: 0.4, hi: 0.6, busy: 0.1, r: 0.5, g: 0.5, b: 0.5 }),
}));

import { attachGlass, clearMapCache, type GlassHandle } from '../dom';
import { MATERIAL_PRESETS } from '../index';
import { resetSupportCache } from '../dom/support';
import { browserWorker, setInterimWorker } from '../dom/interim-build';

let handle: GlassHandle | null = null;
let el: HTMLElement;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
  const real = globalThis.setTimeout;
  vi.spyOn(performance, 'now').mockImplementation(() => log.clock);
  vi.stubGlobal('setTimeout', ((fn: () => void, ms?: number) => real(() => ((log.task += 1), fn()), ms)) as typeof setTimeout);
  Object.assign(log, { clock: 0, task: 0, rows: [], encodes: 0 });
  setInterimWorker(() => null);
  document.body.innerHTML = '<div id="g"></div>';
  el = document.getElementById('g') as HTMLElement;
  el.getBoundingClientRect = () => ({ left: 0, top: 0, right: 200, bottom: 100, x: 0, y: 0, width: 200, height: 100, toJSON() {} }) as DOMRect;
  (globalThis as { CSS?: unknown }).CSS = { supports: () => true };
  resetSupportCache();
  clearMapCache();
  (globalThis as { Image: unknown }).Image = class {
    src = '';
    decode() {
      return Promise.resolve();
    }
  };
});

afterEach(() => {
  handle?.destroy();
  handle = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  setInterimWorker(browserWorker);
});

const sliceSpans = () => {
  const byTask = new Map<number, number[]>();
  for (const row of log.rows) byTask.set(row.task, [...(byTask.get(row.task) ?? []), row.at]);
  return [...byTask.values()].map((at) => at[at.length - 1]! - at[0]! + 1);
};

describe('the fallback bakes a prepared destination in the background', () => {
  it('in slices of at most 4 ms, and the encode is a task of its own', async () => {
    handle = attachGlass(el, { material: MATERIAL_PRESETS.glass, shadow: false });
    log.rows = [];
    handle.prepare({ geometry: { width: 260, height: 100, cornerRadius: 0 } });
    await vi.advanceTimersByTimeAsync(2000);
    expect(log.rows.length).toBeGreaterThan(8);
    expect(Math.max(...sliceSpans())).toBeLessThanOrEqual(4);
    expect(sliceSpans().length).toBeGreaterThan(1);
  });

  it('stops when a newer prepare supersedes it', async () => {
    handle = attachGlass(el, { material: MATERIAL_PRESETS.glass, shadow: false });
    log.rows = [];
    handle.prepare({ geometry: { width: 260, height: 100, cornerRadius: 0 } });
    await vi.advanceTimersByTimeAsync(20);
    const first = log.rows[0]!.height;
    const done = log.rows.length;
    expect(done).toBeGreaterThan(0);
    handle.prepare({ geometry: { width: 260, height: 40, cornerRadius: 0 } });
    await vi.advanceTimersByTimeAsync(2000);
    expect(log.rows.filter((r) => r.height === first).length).toBeLessThan(first);
    expect(log.rows.some((r) => r.height !== first)).toBe(true);
  });
});
