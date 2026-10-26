// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BLEND_MS, startBlend, type Blend } from '../dom/blend';

const SVG_NS = 'http://www.w3.org/2000/svg';
const VALUE: Record<string, number> = { a: 0, b: 10, c: 100, d: 40, e: -60 };
const FRAME = 16;
const STEP = FRAME / BLEND_MS;

let queue: ((now: number) => void)[] = [];
let clock = 0;
let filter: SVGFilterElement;
let done = 0;

const frame = () => {
  clock += FRAME;
  const run = queue.splice(0);
  for (const fn of run) fn(clock);
};

function valueOf(name: string): number {
  const node = [...filter.children].find((child) => child.getAttribute('result') === name);
  if (!node) throw new Error(`no result ${name}`);
  if (node.localName === 'feImage') return VALUE[node.getAttribute('href')!]!;
  return Number(node.getAttribute('k2')) * valueOf(node.getAttribute('in')!) + Number(node.getAttribute('k3')) * valueOf(node.getAttribute('in2')!);
}

function begin(to = 'b'): Blend {
  const blend = startBlend(filter, { mapUrl: to, hueUrl: null }, () => (done += 1));
  frame();
  return blend;
}

beforeEach(() => {
  queue = [];
  clock = 0;
  done = 0;
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  vi.stubGlobal('requestAnimationFrame', (fn: (now: number) => void) => queue.push(fn));
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  filter = document.createElementNS(SVG_NS, 'filter');
  filter.innerHTML = '<feImage href="a" result="map"/><feImage href="a" result="hue"/>';
});

afterEach(() => vi.unstubAllGlobals());

function runTo(weight: number, seen: number[]): void {
  while (valueOf('map') < weight * VALUE.b! - 1e-9) {
    frame();
    seen.push(valueOf('map'));
  }
}

describe('a blend retargeted while it runs', () => {
  it('continues from what it shows: a retarget at 0.9 moves the map by no more than one ramp step', () => {
    const blend = begin('b');
    const seen: number[] = [valueOf('map')];
    runTo(0.9, seen);
    const before = valueOf('map');
    blend.retarget({ mapUrl: 'c', hueUrl: null });
    expect(valueOf('map')).toBeCloseTo(before, 9);
    while (done === 0) {
      frame();
      seen.push(valueOf('map'));
      if (queue.length === 0) break;
    }
    const shown = seen.slice(0, -1);
    for (let i = 1; i < shown.length; i += 1) {
      expect(Math.abs(shown[i]! - shown[i - 1]!)).toBeLessThanOrEqual(STEP * Math.abs(VALUE.c! - before) + 1e-9);
    }
    expect(shown.at(-1)!).toBeGreaterThan(before + 0.8 * (VALUE.c! - before));
    expect(done).toBe(1);
  });

  it('runs both stages in the filter and leaves the filter as it was when it ends', () => {
    const blend = begin('b');
    frame();
    blend.retarget({ mapUrl: 'c', hueUrl: null });
    expect(filter.querySelectorAll('feImage')).toHaveLength(4);
    expect(filter.querySelectorAll('feComposite')).toHaveLength(2);
    while (queue.length > 0) frame();
    expect(done).toBe(1);
    expect(filter.children).toHaveLength(2);
    expect([...filter.children].map((n) => n.getAttribute('result'))).toEqual(['map', 'hue']);
    expect(valueOf('map')).toBe(0);
  });

  it('ignores a retarget to the pair it already heads for', () => {
    const blend = begin('b');
    blend.retarget({ mapUrl: 'b', hueUrl: null });
    expect(filter.querySelectorAll('feComposite')).toHaveLength(1);
  });

  it('at the cap swaps the newest image while it is within 0.1 of its start, and the jump is bounded by 0.1 of the distance', () => {
    const blend = begin('b');
    for (let i = 0; i < 4; i += 1) frame();
    blend.retarget({ mapUrl: 'c', hueUrl: null });
    frame();
    const before = valueOf('map');
    blend.retarget({ mapUrl: 'd', hueUrl: null });
    expect(filter.querySelectorAll('feImage')).toHaveLength(4);
    expect(Math.abs(valueOf('map') - before)).toBeLessThanOrEqual(0.1 * Math.abs(VALUE.d! - VALUE.c!) + 1e-9);
  });

  it('at the cap queues the newest target once the newest stage is past 0.1, and it enters at weight 0 without a jump', () => {
    const blend = begin('b');
    for (let i = 0; i < 3; i += 1) frame();
    blend.retarget({ mapUrl: 'c', hueUrl: null });
    for (let i = 0; i < 3; i += 1) frame();
    const before = valueOf('map');
    blend.retarget({ mapUrl: 'd', hueUrl: null });
    blend.retarget({ mapUrl: 'e', hueUrl: null });
    expect(valueOf('map')).toBe(before);
    expect(filter.querySelectorAll('feImage')).toHaveLength(4);
    const seen = [before];
    while (done === 0 && queue.length > 0) {
      frame();
      seen.push(valueOf('map'));
    }
    const shown = seen.slice(0, -1);
    const bound = STEP * Math.max(Math.abs(VALUE.e! - VALUE.c!), Math.abs(VALUE.c! - before)) + 1e-9;
    for (let i = 1; i < shown.length; i += 1) expect(Math.abs(shown[i]! - shown[i - 1]!)).toBeLessThanOrEqual(bound);
    expect(shown.at(-1)!).toBeLessThan(0);
    expect(shown.some((v) => v === VALUE.c)).toBe(true);
    expect(done).toBe(1);
    expect(filter.children).toHaveLength(2);
  });

  it('shows the hue of a retarget on the hue image and keeps the old one when the target has none', () => {
    const blend = startBlend(filter, { mapUrl: 'b', hueUrl: 'b' }, () => (done += 1));
    frame();
    frame();
    blend.retarget({ mapUrl: 'c', hueUrl: null });
    expect(valueOf('hue')).toBeCloseTo(valueOf('hue'), 9);
    expect(filter.querySelectorAll('feImage[href="b"]')).toHaveLength(2 + 1);
    expect(blend.shows('c')).toBe(true);
    expect(blend.shows('e')).toBe(false);
  });
});
