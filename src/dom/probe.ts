// Backdrop sample for the DOM renderer — the web-DOM counterpart to the WebGL downsample probe
// (`web/probe.ts`) and the native capture on Android. The web canvas can read the pixels it just
// drew; a page CANNOT read what's actually rendered behind an arbitrary element — that boundary
// is the whole reason `backdrop-filter` exists as a browser primitive rather than a pixel API. So
// this probes DECLARED STYLES instead: walk the stacking order under a grid of sample points and
// read `background-color` (falling back to `color`) rather than any real pixel.
import type { BackdropSample } from '../adaptation';

/** A modest grid: this runs on scroll, not per frame. `elementsFromPoint` walks the whole
 *  stacking context at every sample point — a fine grid shows up in a profiler, a coarse one is
 *  still plenty to tell "flat" from "busy" for the adaptation decision. */
const GRID_COLS = 5;
const GRID_ROWS = 5;

export type RgbColor = { r: number; g: number; b: number; a: number };

/**
 * Parses `rgb()`/`rgba()` exactly as `getComputedStyle` emits them — every engine normalizes a
 * resolved color to one of these two forms, so there's nothing here worth a dependency for.
 * Returns `null` for anything else (a keyword that didn't resolve, a malformed value).
 */
export function parseColor(value: string): RgbColor | null {
  const match = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\s*\)/i.exec(value);
  if (!match) return null;
  const r = Number(match[1]);
  const g = Number(match[2]);
  const b = Number(match[3]);
  const a = match[4] === undefined ? 1 : Number(match[4]);
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b) || !Number.isFinite(a)) return null;
  return { r, g, b, a };
}

function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Same statistic the WebGL probe computes on its downsample grid (`web/probe.ts`, `rectStats`):
 * mean luma, twice the mean deviation for `busy`, 10th/90th percentile for `lo`/`hi`. A different
 * formula here would mean the ink-polarity decision quietly drifts between renderers on the same
 * page. `samples` are 0..255 per channel, matching what `parseColor` returns.
 */
export function statsFromSamples(samples: readonly RgbColor[]): BackdropSample {
  const n = samples.length;
  if (n === 0) return { luma: 0.5, busy: 0, lo: 0.5, hi: 0.5, r: 0.5, g: 0.5, b: 0.5 };

  const lumas: number[] = [];
  let sr = 0;
  let sg = 0;
  let sb = 0;
  for (const s of samples) {
    const r = s.r / 255;
    const g = s.g / 255;
    const b = s.b / 255;
    lumas.push(luma(r, g, b));
    sr += r;
    sg += g;
    sb += b;
  }

  let mean = 0;
  for (const v of lumas) mean += v;
  mean /= n;

  let busy = 0;
  for (const v of lumas) busy += Math.abs(v - mean);
  busy = Math.min((busy / n) * 2, 1);

  const sorted = [...lumas].sort((a, b) => a - b);
  const percentile = (p: number) => {
    const idx = p * (n - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  };

  return {
    luma: mean,
    busy,
    lo: percentile(0.1),
    hi: percentile(0.9),
    r: sr / n,
    g: sg / n,
    b: sb / n,
  };
}

/**
 * Composites a stack of backgrounds front to back, the way the compositor does.
 *
 * Taking the first layer with any alpha at all instead is wrong by a lot, not a little: a list row
 * tinted `rgba(255,255,255,0.028)` over a near-black page reads as pure WHITE, and the glass then
 * adapts to a backdrop that does not exist. That is most real interfaces.
 */
export function compositeLayers(layers: readonly RgbColor[]): RgbColor | null {
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  for (const layer of layers) {
    const share = layer.a * (1 - a);
    if (share <= 0) continue;
    r += layer.r * share;
    g += layer.g * share;
    b += layer.b * share;
    a += share;
    if (a >= 0.999) break;
  }
  if (a <= 0.001) return null;
  // Normalised by coverage: what reached the eye, as an opaque colour. A stack that never became
  // opaque sits over the page's own background, which is the caller's floor layer.
  return { r: r / a, g: g / a, b: b / a, a };
}

/** Walks the stack at one point, skipping the glass element itself (it would otherwise probe its
 *  own background) and its descendants. */
function sampleColorAt(el: HTMLElement, x: number, y: number): RgbColor | null {
  const stack = document.elementsFromPoint(x, y);
  const behind = stack.filter((node) => node !== el && !el.contains(node));
  const layers: RgbColor[] = [];
  for (const node of behind) {
    const bg = parseColor(getComputedStyle(node).backgroundColor);
    // `rgba(0, 0, 0, 0)` is what "transparent" resolves to almost everywhere: it contributes
    // nothing and must not shadow a real colour further down.
    if (bg && bg.a > 0.001) layers.push(bg);
  }
  const composited = compositeLayers(layers);
  if (composited) return composited;
  const topmost = behind[0];
  if (!topmost) return null;
  return parseColor(getComputedStyle(topmost).color);
}

export type ProbeOptions = {
  /** Grid density override — wider for a hero element, narrower for a tight control. */
  cols?: number;
  rows?: number;
};

/**
 * Backdrop sample for the glass element from its live surroundings, blind to images/video/canvas
 * by construction (the caller overrides with its own sample there — cover art already knows its
 * own accent; see `attachGlass`'s `sample` option).
 */
export function probeBackdrop(el: HTMLElement, opts: ProbeOptions = {}): BackdropSample {
  const cols = opts.cols ?? GRID_COLS;
  const rows = opts.rows ?? GRID_ROWS;
  const rect = el.getBoundingClientRect();
  // A hidden or not-yet-laid-out element has no backdrop to speak of. Sampling it anyway collapses
  // the whole grid onto one corner point and reports whatever unrelated thing sits there as a
  // confident, perfectly flat reading.
  if (rect.width <= 0 || rect.height <= 0) return statsFromSamples([]);
  const samples: RgbColor[] = [];
  for (let j = 0; j < rows; j += 1) {
    const y = rect.top + ((j + 0.5) / rows) * rect.height;
    for (let i = 0; i < cols; i += 1) {
      const x = rect.left + ((i + 0.5) / cols) * rect.width;
      const color = sampleColorAt(el, x, y);
      if (color) samples.push(color);
    }
  }
  return statsFromSamples(samples);
}
