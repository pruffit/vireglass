#!/usr/bin/env node
/**
 * Gate on the material's MAIN PROMISES. The first two used to break silently and live for days:
 * the shader compiles, tests are green, and the screen shows a flat plate instead of glass.
 *
 *   1. WINDOW. The element has to let through what's beneath it. Over a striped canvas, the
 *      brightness range INSIDE the element is a noticeable fraction of the range outside it.
 *   2. OBJECT. The element has to be visible over a FLAT canvas, otherwise the control
 *      disappears: neither the body nor the rim stand off from the backdrop.
 *   3. INK UNDER THE FINGER. A glyph has to lose sharpness on press (reference §6): without this
 *      the element under the finger only lightens, and the ink stays glued on top of the glass.
 *   4. RISING INTO GLASS. For an element that rises under the finger instead of sinking in
 *      (reference §5), the shadow has to PULL AWAY: rising with no gap under the element isn't
 *      rising.
 *   5. BUSY CANVAS — FROM BOTH SIDES. Over cover art, the element has to both keep its ink
 *      legible and not erase what's beneath it. The requirements pull in opposite directions and
 *      break separately: a fill saves the ink and kills the content, skipping the fill does the
 *      opposite.
 *   6. THE RIM GATHERS CONTENT. At the silhouette, the lens has to gather whatever lies past the
 *      rim and magnify its image — that's exactly what distinguishes glass from a film. The other
 *      five promises look at the middle of the element, where the slope is zero and there's no
 *      refraction at all, so nothing else checks the stripe right at the rim.
 *   7. THE TRANSPARENCY SCALE ACTUALLY MOVES THE MATERIAL. The user-facing scale, ultra clear →
 *      fully tinted, has to genuinely change the glass: toward the tinted end the window closes
 *      and the element becomes more noticeable. What's measured is the MOVEMENT along the scale —
 *      thresholds at a single point can't see that.
 *
 * The check runs across the WHOLE RANGE of canvas lightness, not at a couple of points. The
 * defect this gate was written for wasn't a threshold, it was a SINGULARITY: the required offset
 * was divided by the distance from the tint to the backdrop, and when the backdrop's lightness
 * passed near the tint, the quotient shot into the clamp — the glass turned opaque in a narrow
 * band of values and stayed normal at the edges. Two spot checks would miss this; a sweep across
 * the range doesn't.
 *
 * Polarity at every step is WHATEVER THE AUTOMATION SETS (shouldInkBeLight): the material's
 * default `ink` never occurs in the product, and it's specifically the real mode that's dangerous.
 *
 * Thresholds, not a reference screenshot: a screenshot breaks on any optics edit, a promise only
 * breaks when it's actually violated.
 *
 * Run: pnpm --filter @vire/vireglass check:optics
 * Without the sweep across canvas lightness (seconds instead of minutes): ... check:optics --
 * --ink. Everything stays except the first two promises: the finger, rising, the busy canvas and
 * the rim.
 */
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORE = resolve(HERE, '../src/index.ts').replace(/\\/g, '/');
const WEB = resolve(HERE, '../src/web/index.ts').replace(/\\/g, '/');

/** Below this transmission it's no longer a window: you can't see what's under the glass. */
const MIN_TRANSMISSION = 0.25;
/** Below this, the element's offset from a flat backdrop can't be found by eye — the control is invisible. */
const MIN_PRESENCE = 5;
/** Steps across canvas lightness. Denser than it looks like it needs to be: the singularity sits
 *  wherever the canvas's lightness passes near the tint's lightness, and a coarse step steps right
 *  over it. */
const STEPS = 41;
/** Steps across the user-facing transparency scale, and the canvas it's measured on. */
const SCALE_STEPS = 7;
const SCALE_LEVEL = 0.5;
/**
 * How much the scale must ACTUALLY move the material from end to end. The thresholds are half
 * the measured range (window 89% → 10%, presence 24.9 → 84.0): the scale's first version adjusted
 * medium thickness and gave 1 pp and 0.7 — exactly the case this promise was written for.
 */
const MIN_SCALE_TRANSMISSION_DROP = 0.4;
const MIN_SCALE_PRESENCE_GAIN = 20;
/** A reversal within a step that's inside the probe's noise floor isn't a failure; more than that
 *  means the scale isn't monotonic. */
const SCALE_REVERSAL = 0.02;
const SCALE_PRESENCE_REVERSAL = 1;
/** Steps across the busy canvas's lightness. Sparser than the flat one: there's no singularity between steps here. */
const BUSY_STEPS = 9;
/**
 * How much softer the ink's edge must get under the finger.
 *
 * The threshold sits ABOVE what press alone gives. Sinking in already softens the edge: the
 * element under the finger lightens and shifts by a fraction of a pixel, and a measurement with no
 * defocus at all (`VG_INK_DEFOCUS = 0`) shows 32%. With defocus — 55%. The threshold sits between
 * them: turn defocus off and the gate fails, exactly what it's written to catch. Both numbers were
 * taken with this same probe.
 */
const MIN_INK_SOFTENING = 0.45;
/**
 * How much farther the shadow must fall for an element rising into glass, compared to a sunken
 * button under the same press. Three points, taken with this same probe: 109% with the rule, 55%
 * with the rise halved, exactly 0% with it off. The threshold sits ABOVE the halfway case —
 * otherwise halving the effect would pass silently, and the gate would only catch it being fully
 * disabled.
 */
const MIN_LIFT_SPREAD = 0.75;
/**
 * Contrast between the ink and the body right next to it over a busy canvas, in lightness units
 * 0..255. The worst measured value is 89; if the legibility requirement is computed from the
 * spot's average lightness instead of the edge of the spread closest to the ink (`VG_BUSY_EDGE` =
 * 0), the same measurement gives 50, and light ink drowns in a light spot on the cover art. The
 * threshold sits between these two numbers.
 */
const MIN_INK_ON_BUSY = 70;
/**
 * How much of the canvas's structure must SURVIVE inside the element, at the same spot. The worst
 * measured value is 40; reverting to the old fill and scattering (backing 0.15/0.70, scatter 0.35)
 * leaves 18, meaning the cover art under the glass gets smeared out. The threshold sits between
 * them.
 */
const MIN_CONTENT_ON_BUSY = 28;
/**
 * How many times the image of the stripe lying under the element must magnify at the rim,
 * compared to its own width outside it. The measurement gives 2.02; with the old medium thickness,
 * under which the element read as a film, it gives 1.73. The threshold sits between these numbers.
 *
 * The number is tied to this scene: magnification is a ratio, and on a stripe of different
 * thickness or an element of a different shape it comes out different. It can't be compared
 * against measurements from reference screenshots — this is a safeguard against reverting to thin
 * glass, not a check against Apple.
 */
const MIN_EDGE_GAIN = 1.88;

const ENTRY = `
import { createVireGlassRenderer, drawReferenceScene } from '${WEB}';
import {
  capsuleGeometry,
  applyGlassScale,
  circleGeometry,
  GLASS_SCALE_DEFAULT,
  INK_DARK,
  INK_LIGHT,
  materialForInk,
  referenceScene,
  resolveOptics,
  roundedRectGeometry,
  shouldInkBeLight,
  VIREGLASS_CONTROL_MATERIAL,
  VIREGLASS_MATERIAL,
} from '${CORE}';

// CANVASES SHARED WITH THE BENCHES. They each used to live right here, and the gate ended up
// measuring one thing while the eye at the bench looked at another; the mismatch only turned up
// by accident. The gate needs the canvas to fill the whole frame (it reads pixels, and the
// surrounding field only gets in the way); the benches need a fixed-size panel — the layers and
// their content in dp are the same either way.
const canvasScene = (name, level, density = 1) => (ctx, w, h) =>
  drawReferenceScene(ctx, referenceScene(name), w, h, { density, level, fit: 'frame' });

// YIELDING TO THE EVENT LOOP BETWEEN FRAMES IS MANDATORY. The probe reads the lightness grid
// through a PBO with a fence, and a fence inside a tight synchronous loop never fires: no matter
// how many frames you draw, the read never becomes ready. The gate would then measure the
// shader's FALLBACK path (u_probeLuma = -1) instead of the one that runs in the product — and the
// thresholds would get tuned against the wrong material.
const settle = async (draw) => {
  for (let i = 0; i < 40; i += 1) {
    draw();
    await new Promise((r) => setTimeout(r, 0));
  }
};

let stage = null;

globalThis.vgProbe = async ({ level, striped, control, scale }) => {
  if (!stage) {
    const canvas = document.createElement('canvas');
    canvas.width = 520;
    canvas.height = 300;
    document.body.append(canvas);
    const renderer = createVireGlassRenderer(canvas);
    renderer.resize(canvas.width, canvas.height);
    stage = { canvas, renderer };
  }
  const { canvas, renderer } = stage;

  const scene = canvasScene(striped ? 'stripes' : 'flat', level);

  // Two cases, both mandatory. A PIECE OF BACKGROUND — the baseline material on a large element.
  // A CONTROL — button glass on a small element with ink over it: it's thicker, its bevel is
  // wider and hits its ceiling at that small size, meaning it behaves completely differently.
  // While the gate only knew the first case, the button material change slipped past it entirely.
  const base = control ? materialForInk(VIREGLASS_CONTROL_MATERIAL, true) : VIREGLASS_MATERIAL;
  const light = shouldInkBeLight({ luma: level, hi: level }, level < 0.5);
  // At the default point the scale is the identity, so the other promises are measured as before.
  const optics = applyGlassScale(
    resolveOptics({ ...base, ink: light ? INK_LIGHT : INK_DARK }),
    scale ?? GLASS_SCALE_DEFAULT,
  );
  const geometry = control ? circleGeometry(56) : roundedRectGeometry(220, 120, 32);
  const piece = { optics, geometry, centerX: canvas.width / 2, centerY: canvas.height / 2 };

  // The probe reports with a lag, and the estimate takes a few frames to catch up.
  await settle(() => renderer.render({ density: 1, debug: 'normal', scene, pieces: [piece] }));

  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true });
  const row = (cy, halfW) => {
    const n = halfW * 2;
    const buf = new Uint8Array(n * 8 * 4);
    gl.readPixels(canvas.width / 2 - halfW, canvas.height - cy - 4, n, 8, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const v = [];
    for (let i = 0; i < n * 8; i += 1) {
      v.push(0.2126 * buf[i * 4] + 0.7152 * buf[i * 4 + 1] + 0.0722 * buf[i * 4 + 2]);
    }
    v.sort((a, b) => a - b);
    const at = (q) => v[Math.min(v.length - 1, Math.floor(v.length * q))];
    return [at(0.05), at(0.95), at(0.5)];
  };

  const halfW = control ? 12 : 60;
  // Inside is the flat middle, clear of the bevel. Outside is the same canvas above the element.
  // The rim is a strip along the top edge: over a flat backdrop, presence can specifically live
  // there.
  return {
    inside: row(canvas.height / 2, halfW),
    outside: row(canvas.height / 2 - 110, halfW),
    rim: row(canvas.height / 2 - (control ? 26 : 58), halfW),
  };
};

let inkStage = null;

// Third promise: INK UNDER THE FINGER LOSES SHARPNESS. Measured across a bar: a row through the
// element's center is taken, sharpness is the steepest jump between neighboring pixels.
globalThis.vgInkProbe = async ({ press }) => {
  if (!stage) {
    const canvas = document.createElement('canvas');
    canvas.width = 520;
    canvas.height = 300;
    document.body.append(canvas);
    const renderer = createVireGlassRenderer(canvas);
    renderer.resize(canvas.width, canvas.height);
    stage = { canvas, renderer };
  }
  const { canvas, renderer } = stage;
  if (!inkStage) {
    // Ink mask: a white bar on BLACK, as the frame's contract requires.
    const mask = document.createElement('canvas');
    mask.width = canvas.width;
    mask.height = canvas.height;
    const mctx = mask.getContext('2d');
    mctx.fillStyle = '#000000';
    mctx.fillRect(0, 0, mask.width, mask.height);
    mctx.fillStyle = '#ffffff';
    mctx.fillRect(canvas.width / 2 - 5, canvas.height / 2 - 18, 10, 36);
    inkStage = { mask };
  }
  const { mask } = inkStage;

  const level = 0.2;
  const scene = canvasScene('flat', level);
  const optics = resolveOptics({ ...materialForInk(VIREGLASS_CONTROL_MATERIAL, true), ink: INK_LIGHT });
  const piece = {
    optics,
    geometry: roundedRectGeometry(220, 120, 32),
    centerX: canvas.width / 2,
    centerY: canvas.height / 2,
    icon: true,
    appear: 1,
    inkIdle: [1, 1, 1, 1],
    inkActive: [1, 1, 1, 1],
    // The finger is placed in a corner: the field's local distortion doesn't reach the bar, and
    // defocus doesn't depend on distance. The element's uniform stretch under press remains — and
    // that's exactly what gives the 32% the threshold must not drop below. The blob radius is the
    // same one the product uses.
    touch: { x: 104, y: 52, pullX: 0, pullY: 0, press, radius: 0.72 * 60, waveAmp: 0, wavePhase: 0 },
  };

  await settle(() => renderer.render({ density: 1, debug: 'normal', scene, pieces: [piece], iconMask: mask }));

  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true });
  const n = 48;
  const buf = new Uint8Array(n * 4);
  gl.readPixels(canvas.width / 2 - n / 2, canvas.height / 2, n, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  const line = [];
  for (let i = 0; i < n; i += 1) {
    line.push(0.2126 * buf[i * 4] + 0.7152 * buf[i * 4 + 1] + 0.0722 * buf[i * 4 + 2]);
  }

  let sharp = 0;
  for (let i = 1; i < n; i += 1) sharp = Math.max(sharp, Math.abs(line[i] - line[i - 1]));

  // The row's extreme values are needed to express steepness AS A FRACTION of the jump — the
  // division itself happens outside. The bar's width at half-height isn't part of the score: it
  // shows whether the field stretched, and gets printed on failure to tell blur apart from
  // stretching.
  const lo = Math.min(...line);
  const hi = Math.max(...line);
  const half = (lo + hi) / 2;
  let width = 0;
  for (let i = 0; i < n; i += 1) if (line[i] > half) width += 1;
  return { sharp, lo, hi, width };
};

let rimStage = null;

// Sixth promise: THE RIM GATHERS CONTENT. A stripe lies under the element; its image is measured
// by columns of width "mass divided by peak" — no threshold, because right at the rim the stripe
// breaks into pieces and any boundary-based threshold jumps over the gaps.
globalThis.vgRimProbe = async () => {
  // Device density, not one: medium thickness is set in dp, and at density 1 the element comes
  // out half the real size — the buildup stripe at the rim would then also be half as wide.
  const D = 2;
  if (!rimStage) {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 400;
    document.body.append(canvas);
    const renderer = createVireGlassRenderer(canvas);
    renderer.resize(canvas.width, canvas.height);
    rimStage = { canvas, renderer };
  }
  const { canvas, renderer } = rimStage;

  // A 20 dp bar — the same proportion to the element as under the reference control. The
  // proportion is part of the measurement's definition: magnification is a ratio, and a bar of a
  // different thickness gives a different number.
  const scene = canvasScene('bar', undefined, D);

  const optics = resolveOptics(materialForInk(VIREGLASS_CONTROL_MATERIAL, false));
  const piece = {
    optics,
    // A capsule, not a rectangle: on the reference control the stripe crosses a rounded end, and
    // on a straight edge the buildup at the rim comes out different.
    geometry: capsuleGeometry(300, 110),
    centerX: canvas.width / 2,
    centerY: canvas.height / 2,
    appear: 1,
  };
  await settle(() => renderer.render({ density: D, debug: 'normal', scene, pieces: [piece] }));

  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true });
  // A 300x110 dp capsule at density 2 spans 100..700 horizontally: the window starts outside it
  // and reaches to the middle of the buildup stripe.
  const x0 = 40;
  const w = 160;
  const y0 = 100;
  const h = 200;
  const buf = new Uint8Array(w * h * 4);
  gl.readPixels(x0, canvas.height - y0 - h, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  const lum = (i) => 0.2126 * buf[i * 4] + 0.7152 * buf[i * 4 + 1] + 0.0722 * buf[i * 4 + 2];

  // Width of the stripe's image in a column: the mass of darkness divided by its peak. For an
  // untouched stripe it equals its thickness; for one gathered at the rim it's larger.
  const widthAt = (c) => {
    const col = [];
    for (let r = 0; r < h; r += 1) col.push(lum(r * w + c));
    const sorted = [...col].sort((a, b) => a - b);
    const base = sorted[sorted.length - 1];
    let mass = 0;
    let peak = 0;
    for (const v of col) {
      const t = base - v;
      if (t > 0) {
        mass += t;
        if (t > peak) peak = t;
      }
    }
    return peak > 4 ? mass / peak : 0;
  };

  let outside = 0;
  let best = 0;
  for (let c = 0; c < 40; c += 1) outside = Math.max(outside, widthAt(c));
  for (let c = 60; c < w; c += 1) best = Math.max(best, widthAt(c));
  return { outside, best, gain: outside > 1 ? best / outside : 0 };
};

let busyStage = null;

// Fifth promise: BOTH SURVIVE OVER A BUSY CANVAS. The canvas is a mosaic of tiles LARGER than the
// gather radius: structure smaller than that gets erased by the glass as a matter of physics, and
// requiring it to survive isn't reasonable. The tiles are laid out by the generator, not a
// checkerboard order: on a periodic canvas the spread estimate would lock onto its own period and
// the numbers would jump from level to level.
// Ink contrast is scored by the worst edges — the ink by its weakest, the body by the edge
// closest to it: the text drowns wherever a light spot ends up under it, not in the element's
// average.
globalThis.vgBusyProbe = async ({ level }) => {
  // Its OWN renderer, not the shared one: the ambient estimate carries over between frames, and
  // the checkered canvas, passed through the shared canvas, would throw off both its own numbers
  // and the shadow measurement for the next promise.
  if (!busyStage) {
    const canvas = document.createElement('canvas');
    canvas.width = 520;
    canvas.height = 300;
    document.body.append(canvas);
    const renderer = createVireGlassRenderer(canvas);
    renderer.resize(canvas.width, canvas.height);
    const mask = document.createElement('canvas');
    mask.width = canvas.width;
    mask.height = canvas.height;
    const m = mask.getContext('2d');
    m.fillStyle = '#000000';
    m.fillRect(0, 0, mask.width, mask.height);
    m.fillStyle = '#ffffff';
    m.fillRect(canvas.width / 2 - 3, canvas.height / 2 - 18, 6, 36);
    busyStage = { canvas, renderer, mask };
  }
  const { canvas, renderer } = busyStage;

  const scene = canvasScene('busy', level);

  // The upper edge of the spread is taken from the canvas itself: the checkerboard's amplitude is
  // set by the package, and keeping a second copy of it here would eventually drift from what's
  // actually drawn.
  const amp = referenceScene('busy').bands(level)[0].layer.amp;
  const light = shouldInkBeLight({ luma: level, hi: level + amp }, level < 0.5);
  const optics = resolveOptics({
    ...materialForInk(VIREGLASS_CONTROL_MATERIAL, true),
    ink: light ? INK_LIGHT : INK_DARK,
  });
  const v = light ? 1 : 0;
  const piece = {
    optics,
    geometry: roundedRectGeometry(220, 120, 32),
    centerX: canvas.width / 2,
    centerY: canvas.height / 2,
    icon: true,
    appear: 1,
    inkIdle: [v, v, v, 1],
    inkActive: [v, v, v, 1],
  };
  await settle(() => renderer.render({ density: 1, debug: 'normal', scene, pieces: [piece], iconMask: busyStage.mask }));

  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true });
  const W = 64;
  const H = 24;
  const buf = new Uint8Array(W * H * 4);
  gl.readPixels(canvas.width / 2 - W / 2, canvas.height / 2 - H / 2, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  const lum = (i) => 0.2126 * buf[i * 4] + 0.7152 * buf[i * 4 + 1] + 0.0722 * buf[i * 4 + 2];
  const glyph = [];
  const body = [];
  for (let r = 0; r < H; r += 1) {
    for (let c = 0; c < W; c += 1) {
      const dx = c - W / 2;
      if (Math.abs(dx) <= 2) glyph.push(lum(r * W + c));
      else if (Math.abs(dx) >= 6 && Math.abs(dx) <= 28) body.push(lum(r * W + c));
    }
  }
  const q = (a, p) => {
    const sorted = [...a].sort((x, y) => x - y);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  };
  return {
    contrast: light ? q(glyph, 0.1) - q(body, 0.9) : q(body, 0.1) - q(glyph, 0.9),
    content: q(body, 0.9) - q(body, 0.1),
  };
};

// Fourth promise: A CONTROL RISING INTO GLASS SEPARATES FROM THE BACKDROP. Its shadow has to fall
// farther than under a sunken button at the same press. Measured by the area of darkening in a
// column under the element's bottom edge, over a flat light canvas.
globalThis.vgLiftProbe = async ({ lift }) => {
  if (!stage) {
    const canvas = document.createElement('canvas');
    canvas.width = 520;
    canvas.height = 300;
    document.body.append(canvas);
    const renderer = createVireGlassRenderer(canvas);
    renderer.resize(canvas.width, canvas.height);
    stage = { canvas, renderer };
  }
  const { canvas, renderer } = stage;

  const level = 0.78;
  const scene = canvasScene('flat', level);
  const optics = resolveOptics({ ...materialForInk(VIREGLASS_CONTROL_MATERIAL, true), ink: INK_DARK });
  const piece = {
    optics,
    geometry: circleGeometry(56),
    centerX: canvas.width / 2,
    centerY: canvas.height / 2,
    press: 1,
    lift,
  };

  await settle(() => renderer.render({ density: 1, debug: 'normal', scene, pieces: [piece] }));

  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true });
  const rows = 46;
  const buf = new Uint8Array(rows * 4);
  // A column going down from the bottom edge: GL coordinates count from the bottom, so we read below the center.
  gl.readPixels(canvas.width / 2, canvas.height / 2 - 28 - rows, 1, rows, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  const ground = 255 * level;
  let area = 0;
  for (let i = 0; i < rows; i += 1) {
    const v = 0.2126 * buf[i * 4] + 0.7152 * buf[i * 4 + 1] + 0.0722 * buf[i * 4 + 2];
    area += Math.max(ground - v, 0);
  }
  return area;
};
`;

async function main() {
  const bundle = await build({
    stdin: { contents: ENTRY, resolveDir: HERE, loader: 'ts' },
    bundle: true,
    format: 'iife',
    write: false,
    logLevel: 'silent',
  });

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('about:blank');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });

  const spread = ([lo, hi]) => hi - lo;
  const failed = [];
  let worstWindow = { value: Infinity, level: 0, name: '' };
  let worstPresence = { value: Infinity, level: 0, name: '' };

  // `--ink` runs only the ink promise: the sweep across canvas lightness takes minutes, and an
  // ink change doesn't touch it.
  const inkOnly = process.argv.includes("--ink");
  for (const { control, name } of inkOnly ? [] : [{ control: false, name: "background piece" }, { control: true, name: "control" }]) {
  console.log(`--- ${name} ---`);
  for (let i = 0; i < STEPS; i += 1) {
    const level = 0.04 + (0.9 * i) / (STEPS - 1);
    const striped = await page.evaluate((a) => globalThis.vgProbe(a), { level, striped: true, control });
    const flat = await page.evaluate((a) => globalThis.vgProbe(a), { level, striped: false, control });

    const transmission = spread(striped.inside) / Math.max(spread(striped.outside), 1e-6);
    // Offset is scored in BOTH DIRECTIONS: over a light canvas the element offsets DOWNWARD, and
    // a metric that only looks at the brightest value would miss that rim entirely. Body is
    // printed alongside with its sign: from the largest of the three alone you can't tell what
    // holds the element up, or which way the body drifts.
    const body = flat.inside[2] - flat.outside[2];
    const presence = Math.max(
      Math.abs(body),
      Math.abs(flat.rim[1] - flat.outside[2]),
      Math.abs(flat.rim[0] - flat.outside[2]),
    );
    if (transmission < worstWindow.value) worstWindow = { value: transmission, level, name };
    if (presence < worstPresence.value) worstPresence = { value: presence, level, name };

    const ok = transmission >= MIN_TRANSMISSION && presence >= MIN_PRESENCE;
    console.log(
      `${ok ? ' ' : '!'} canvas ${level.toFixed(2)}: window ${(transmission * 100).toFixed(0)}%, ` +
        `object ${presence.toFixed(1)} (body ${body >= 0 ? '+' : ''}${body.toFixed(0)})`,
    );
    if (!(transmission >= MIN_TRANSMISSION)) {
      failed.push(`${name}, canvas ${level.toFixed(2)}: stopped being a window`);
    }
    if (!(presence >= MIN_PRESENCE)) {
      failed.push(`${name}, canvas ${level.toFixed(2)}: disappeared over a flat backdrop`);
    }
  }
  }

  // THE TRANSPARENCY SCALE IS MEASURED BY MOVEMENT, NOT A POINT. The same thresholds can't be
  // required at both ends: ultra clear has to be less noticeable, fully tinted has to hide the
  // content. So what's checked is direction, while today's thresholds are held at the default
  // point.
  console.log('--- transparency scale ---');
  const scalePoints = [];
  for (let i = 0; i < SCALE_STEPS; i += 1) {
    const scale = i / (SCALE_STEPS - 1);
    const a = { level: SCALE_LEVEL, control: false, scale };
    const striped = await page.evaluate((x) => globalThis.vgProbe(x), { ...a, striped: true });
    const flat = await page.evaluate((x) => globalThis.vgProbe(x), { ...a, striped: false });
    const transmission = spread(striped.inside) / Math.max(spread(striped.outside), 1e-6);
    const presence = Math.max(
      Math.abs(flat.inside[2] - flat.outside[2]),
      Math.abs(flat.rim[1] - flat.outside[2]),
      Math.abs(flat.rim[0] - flat.outside[2]),
    );
    scalePoints.push({ scale, transmission, presence });
    console.log(`  scale ${scale.toFixed(2)}: window ${(transmission * 100).toFixed(0)}%, object ${presence.toFixed(1)}`);
  }
  const clearEnd = scalePoints[0];
  const tintedEnd = scalePoints[scalePoints.length - 1];
  const drop = clearEnd.transmission - tintedEnd.transmission;
  const gain = tintedEnd.presence - clearEnd.presence;
  console.log(`  range: window −${(drop * 100).toFixed(0)} pp, object +${gain.toFixed(1)}`);
  if (!(drop >= MIN_SCALE_TRANSMISSION_DROP)) {
    failed.push(`scale: tinting does not hide the content (window dropped by ${(drop * 100).toFixed(0)} pp)`);
  }
  if (!(gain >= MIN_SCALE_PRESENCE_GAIN)) {
    failed.push(`scale: tinting does not make the element more noticeable (object grew by ${gain.toFixed(1)})`);
  }
  for (let i = 1; i < scalePoints.length; i += 1) {
    const at = scalePoints[i].scale.toFixed(2);
    const back = scalePoints[i].transmission - scalePoints[i - 1].transmission;
    if (back > SCALE_REVERSAL) {
      failed.push(`scale: at step ${at} the window GREW by ${(back * 100).toFixed(0)} pp`);
    }
    // Both ends can converge with a dip in the middle — that's the only way to see this regression.
    const dip = scalePoints[i - 1].presence - scalePoints[i].presence;
    if (dip > SCALE_PRESENCE_REVERSAL) {
      failed.push(`scale: at step ${at} the object DROPPED by ${dip.toFixed(1)}`);
    }
  }

  console.log('--- ink under the finger ---');
  const idle = await page.evaluate((a) => globalThis.vgInkProbe(a), { press: 0 });
  const pressed = await page.evaluate((a) => globalThis.vgInkProbe(a), { press: 1 });
  // Edge steepness as a fraction of the row's full range: under the finger the element lightens,
  // and absolute steepness drops even with no blur at all — dividing is mandatory, otherwise
  // what's measured is the highlight.
  const rel = (m) => m.sharp / Math.max(m.hi - m.lo, 1e-6);
  const sharpIdle = rel(idle);
  const sharpPressed = rel(pressed);
  const softening = sharpIdle > 0 ? 1 - sharpPressed / sharpIdle : 0;
  console.log(
    `${softening >= MIN_INK_SOFTENING ? ' ' : '!'} bar edge: idle ${sharpIdle.toFixed(1)}, ` +
      `under finger ${sharpPressed.toFixed(1)} — softer by ${(softening * 100).toFixed(0)}%`,
  );
  if (!(softening >= MIN_INK_SOFTENING)) {
    console.log(`  idle ${JSON.stringify(idle)}, pressed ${JSON.stringify(pressed)}`);
    failed.push(`ink under the finger did not defocus (softer by only ${(softening * 100).toFixed(0)}%)`);
  }

  console.log('--- the rim gathers content ---');
  const rim = await page.evaluate(() => globalThis.vgRimProbe());
  console.log(
    `${rim.gain >= MIN_EDGE_GAIN ? ' ' : '!'} stripe under the element: outside ${rim.outside.toFixed(1)}, ` +
      `at the rim ${rim.best.toFixed(1)} — magnified ${rim.gain.toFixed(2)}x`,
  );
  if (!(rim.gain >= MIN_EDGE_GAIN)) {
    failed.push(`the rim does not gather content (magnified ${rim.gain.toFixed(2)}x)`);
  }

  console.log('--- busy canvas ---');
  let worstInk = { value: Infinity, level: 0 };
  let worstContent = { value: Infinity, level: 0 };
  for (let i = 0; i < BUSY_STEPS; i += 1) {
    const level = 0.18 + (0.64 * i) / (BUSY_STEPS - 1);
    // The tile and amplitude are set by the "busy" canvas in the package: the tile is larger than
    // the gather radius, and the amplitude is the same at every step — otherwise the steps aren't
    // comparable.
    const busy = await page.evaluate((a) => globalThis.vgBusyProbe(a), { level });
    if (busy.contrast < worstInk.value) worstInk = { value: busy.contrast, level };
    if (busy.content < worstContent.value) worstContent = { value: busy.content, level };
    const ok = busy.contrast >= MIN_INK_ON_BUSY && busy.content >= MIN_CONTENT_ON_BUSY;
    console.log(
      `${ok ? ' ' : '!'} canvas ${level.toFixed(2)}: ink ${busy.contrast.toFixed(0)}, ` +
        `content ${busy.content.toFixed(0)}`,
    );
    if (!(busy.contrast >= MIN_INK_ON_BUSY)) {
      failed.push(`canvas ${level.toFixed(2)}: ink drowned in the cover art (${busy.contrast.toFixed(0)})`);
    }
    if (!(busy.content >= MIN_CONTENT_ON_BUSY)) {
      failed.push(`canvas ${level.toFixed(2)}: cover art under the element got erased (${busy.content.toFixed(0)})`);
    }
  }

  console.log('--- rising into glass ---');
  const pressedDown = await page.evaluate((a) => globalThis.vgLiftProbe(a), { lift: 0 });
  const liftedUp = await page.evaluate((a) => globalThis.vgLiftProbe(a), { lift: 1 });
  const spread2 = pressedDown > 0 ? liftedUp / pressedDown - 1 : 0;
  console.log(
    `${spread2 >= MIN_LIFT_SPREAD ? ' ' : '!'} shadow under the element: sunken ${pressedDown.toFixed(0)}, ` +
      `risen ${liftedUp.toFixed(0)} — farther by ${(spread2 * 100).toFixed(0)}%`,
  );
  if (!(spread2 >= MIN_LIFT_SPREAD)) {
    failed.push(`the risen element did not separate from the backdrop (shadow farther by only ${(spread2 * 100).toFixed(0)}%)`);
  }

  await browser.close();

  console.log(
    `worst on busy: ink ${worstInk.value.toFixed(0)} at ${worstInk.level.toFixed(2)} ` +
      `(need ≥ ${MIN_INK_ON_BUSY}), content ${worstContent.value.toFixed(0)} at ` +
      `${worstContent.level.toFixed(2)} (need ≥ ${MIN_CONTENT_ON_BUSY})`,
  );
  if (!inkOnly) console.log(
    `worst: window ${(worstWindow.value * 100).toFixed(0)}% at ${worstWindow.level.toFixed(2)} ` +
      `(${worstWindow.name}, need ≥ ${MIN_TRANSMISSION * 100}%), object ${worstPresence.value.toFixed(1)} ` +
      `at ${worstPresence.level.toFixed(2)} (${worstPresence.name}, need ≥ ${MIN_PRESENCE})`,
  );

  if (failed.length) {
    console.error(`check-optics: ${failed.join('; ')}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    'check-optics: the glass stays both a window and an object across the whole canvas range, ' +
      'ink under the finger defocuses, a risen element separates from the backdrop, ' +
      'both ink and content survive over a busy canvas, the rim gathers content',
  );
}

await main();
