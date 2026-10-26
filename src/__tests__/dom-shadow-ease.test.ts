// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackdropSample } from '../adaptation';

vi.mock('../dom/displacement', async (original) => {
  const real = await original<typeof import('../dom/displacement')>();
  let n = 0;
  return {
    ...real,
    buildDisplacementMap: () => ({ url: `main:${(n += 1)}`, width: 4, height: 4, scale: 10 }),
    buildDisplacementMapInSlices: async () => ({ url: `main:${(n += 1)}`, width: 4, height: 4, scale: 10 }),
  };
});
vi.mock('../dom/probe', async (original) => ({
  ...(await original<typeof import('../dom/probe')>()),
  probeBackdrop: () => ({ luma: 0.08, lo: 0.08, hi: 0.08, busy: 0.05, r: 0.08, g: 0.08, b: 0.08 }),
}));
vi.mock('../dom/spectral-map', async (original) => ({ ...(await original<typeof import('../dom/spectral-map')>()), hasSpectralEdge: () => false }));

import { attachGlass, clearMapCache, type GlassHandle } from '../dom';
import { MATERIAL_PRESETS } from '../index';
import { resetSupportCache } from '../dom/support';
import { setInterimWorker, browserWorker } from '../dom/interim-build';
import { shadowParts } from '../dom/shadow';

const sampleOf = (luma: number, busy: number): BackdropSample => ({ luma, lo: luma, hi: luma, busy, r: luma, g: luma, b: luma });
let el: HTMLElement;
let handle: GlassHandle | null = null;
let box = { width: 200, height: 100 };

beforeEach(() => {
  box = { width: 200, height: 100 };
  setInterimWorker(() => null);
  document.head.innerHTML = '';
  document.body.innerHTML = '<div id="g"></div>';
  el = document.getElementById('g') as HTMLElement;
  el.getBoundingClientRect = () => ({ left: 0, top: 0, right: box.width, bottom: box.height, x: 0, y: 0, ...box, toJSON() {} }) as DOMRect;
  (globalThis as { CSS?: unknown }).CSS = { supports: () => true };
  resetSupportCache();
  clearMapCache();
  (globalThis as { Image: unknown }).Image = class {
    src = '';
    decode() {
      return Promise.resolve();
    }
  };
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
  handle = attachGlass(el, { material: MATERIAL_PRESETS.glass });
});

afterEach(() => {
  handle?.destroy();
  handle = null;
  vi.useRealTimers();
  setInterimWorker(browserWorker);
});

describe('the shadow of a lens whose colours ease during interim', () => {
  it('never transitions box-shadow itself, only its registered colour', () => {
    const css = [...document.querySelectorAll('style')].map((s) => s.textContent).join('');
    expect(css).not.toMatch(/transition:[^}]*box-shadow/);
    expect(css).toMatch(/transition:[^}]*--vireglass-shadow-color/);
    expect(css).toMatch(/@property --vireglass-shadow-color/);
  });

  it('writes the geometry of every frame into box-shadow while its colour eases to the prepared sample', () => {
    const geometry = (width: number) => ({ width, height: 100, cornerRadius: 0 });
    handle!.setInterim(true);
    const from = el.style.getPropertyValue('--vireglass-shadow-color');
    handle!.prepare({ geometry: geometry(400), sample: sampleOf(0.95, 0.9) });
    expect(el.hasAttribute('data-vireglass-ease')).toBe(true);
    const to = el.style.getPropertyValue('--vireglass-shadow-color');
    expect(to).not.toBe(from);
    for (const width of [230, 280, 340, 400]) {
      box = { width, height: 100 };
      handle!.update();
      const expected = shadowParts(geometry(width), sampleOf(0.95, 0.9));
      expect(el.style.boxShadow).toBe(`0 0 ${expected.reachPx} var(--vireglass-shadow-color)`);
      expect(el.style.getPropertyValue('--vireglass-shadow-color')).toBe(to);
    }
  });
});
