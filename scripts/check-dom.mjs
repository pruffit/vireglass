// Proves the DOM renderer bends the page, and bends it where the reference says it should.
//
// This guards the failure that cost this project a whole phase of measurements once already: glass
// that renders, passes every unit test, and does nothing at all. On Android the capture node had no
// bounds and the lens sampled emptiness, while every noise metric happily called it clean
// (docs/material-lab.md E-34). The web has the same trap — a filter that silently fails to apply
// leaves a perfectly ordinary-looking panel.
//
// So the measurement is a PAIR, as everywhere else in this project. Three frames, in fact:
//
//   full   the material as specified
//   flat   the same material at ior = 1 — blur and body unchanged, no refraction
//   none   no glass
//   rest   the interactive variant, untouched
//
// `full` against `none` says the material does something. `full` against `flat` ISOLATES the
// displacement, which is the only way to check §1's claim that the optics live at the rim. The
// first version of this check compared full against none and failed its own assertion: roughness
// blurs the middle as much as the rim and drowned the very thing being measured.
//
// The pixels come from a screenshot rather than from the page, because `backdrop-filter` composites
// where script cannot reach — which is the whole reason this renderer exists. The screenshot goes
// back INTO the page as a same-origin image so a canvas can read it; no decoder, no dependency.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const BOX = { x: 120, y: 90, w: 240, h: 140, r: 36 };

const FIXTURE = `<!doctype html>
<meta charset="utf-8">
<style>
  html, body { margin: 0; background: #0b0d12; }
  /* Vertical hairlines: the least forgiving thing to put under a lens and the easiest to see
     displaced. A photograph would hide a two-pixel shift; a one-pixel line cannot. */
  #page { position: absolute; inset: 0;
    background-image: repeating-linear-gradient(90deg, #f4f7ff 0 1px, #0b0d12 1px 8px); }
  #glass { position: absolute; left: ${BOX.x}px; top: ${BOX.y}px;
           width: ${BOX.w}px; height: ${BOX.h}px; border-radius: ${BOX.r}px; }
  /* The reference measurements: one flat colour, so the surround is a single number. */
  body.flat #page { background-image: none; background-color: #201a15; }
  body.flat.bright #page { background-color: #5f93c8; }
  /* A saturated page, for the promise that glass does not invent colour. The hairlines cannot
     test it: they are nearly grey, so a material that saturates everything looks fine on them. */
  body.colour #page { background-image:
    radial-gradient(circle at 30% 35%, #ffd34d 0 22%, transparent 48%),
    radial-gradient(circle at 72% 68%, #ff5d8f 0 20%, transparent 46%),
    linear-gradient(140deg, #0e1220, #203055 45%, #0b1020); }
</style>
<div id="page"></div>
<div id="glass"></div>
<div id="host"></div>
<div id="orb" style="position:absolute;left:400px;top:30px;width:88px;height:88px;border-radius:44px;display:none"></div>
<div id="scroller" style="position:absolute;left:380px;top:20px;width:130px;height:300px;overflow:auto;display:none">
  <div style="height:900px;background-image:repeating-linear-gradient(90deg,#f4f7ff 0 1px,#0b0d12 1px 8px)"></div>
</div>
<div id="edge" style="position:absolute;left:380px;top:20px;width:130px;height:90px;pointer-events:none;display:none"></div>
<script type="module">
  import { attachGlass, attachScrollEdge, renderStats, resetRenderStats } from '/dist/dom.js';
  import { MATERIAL_PRESETS, VIREGLASS_CONTROL_MATERIAL, resolveOptics, REST_LIGHT } from '/dist/index.js';
  import { rimGradientCss } from '/dist/dom.js';

  // The probe would read the striped page as busy and thicken the body — correct, but it hides the
  // displacement behind a tint. This measurement is about geometry, so the backdrop is stated.
  const sample = { luma: 0.5, lo: 0.04, hi: 0.96, busy: 0.4, r: 0.5, g: 0.5, b: 0.5 };
  let live = null;
  // A widget in a shadow root is how you survive a page full of global "!important", and it is
  // where the material used to render nothing at all: "backdrop-filter: url(#id)" resolves in the
  // element's own tree, so a filter parked on the page is not found — silently, because the
  // reference is valid CSS.
  const shadow = document.getElementById('host').attachShadow({ mode: 'open' });
  // Styled from inside: a page stylesheet does not cross into a shadow root, which is the whole
  // point of one. The first version of this fixture put the class on it and measured an element of
  // no size, then reported the product broken.
  const shadowed = document.createElement('div');
  shadowed.style.cssText =
    'position:absolute;left:${BOX.x}px;top:${BOX.y}px;width:${BOX.w}px;height:${BOX.h}px;border-radius:${BOX.r}px';
  shadow.append(shadowed);

  globalThis.__mount = (which) => {
    document.body.classList.toggle('colour', which === 'colour' || which === 'colour-none');
    live?.destroy();
    live = null;
    shadowed.style.display = which === 'shadow' ? 'block' : 'none';
    if (which === 'none' || which === 'colour-none') return;
    if (which === 'shadow') {
      live = attachGlass(shadowed, { material: MATERIAL_PRESETS.glass, sample, interactive: false, shadow: false });
      return;
    }
    const material = which === 'flat'
      ? { ...MATERIAL_PRESETS.glass, ior: 1 }
      : MATERIAL_PRESETS.glass;
    live = attachGlass(document.getElementById('glass'), {
      ...(which === 'colour' ? { sample: undefined } : {}),
      material,
      sample,
      // 'rest' keeps the pointer listeners — the claim is that an ATTACHED interactive element
      // shows nothing until it is touched, and detaching them would prove a different thing.
      interactive: which === 'rest' || which === 'press',
      shadow: false,
      variant: which === 'rest' ? 'interactive' : 'present',
    });
  };

  // Every frame above is static, so nothing here ever exercised the interaction path. The
  // dispersion bug lived exactly there: three displacement passes, only the first one updated.
  globalThis.__press = () => {
    const el = document.getElementById('glass');
    const box = el.getBoundingClientRect();
    const at = { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2, pointerId: 1, bubbles: true };
    el.dispatchEvent(new PointerEvent('pointerdown', at));
  };
  globalThis.__scales = () => {
    const filter = document.querySelector('svg[data-vireglass-filters] filter');
    return filter ? [...filter.querySelectorAll('feDisplacementMap')].map((n) => Number(n.getAttribute('scale'))) : [];
  };

  // The orb is a control of the reference frames in miniature: a circle of the control material on
  // a flat page, which the probe reads from the page's declared colour.
  let orb = null;
  const WHITE_LOBE = 'conic-gradient(from 325deg, #fff 0deg, rgba(0,0,0,.22) 60deg, rgba(0,0,0,.22) 300deg, #fff 360deg)';
  globalThis.__orb = async (pageKind, variant) => {
    orb?.destroy();
    live?.destroy();
    live = null;
    document.body.classList.remove('colour');
    document.body.classList.add('flat');
    document.body.classList.toggle('bright', pageKind === 'bright');
    document.getElementById('glass').style.display = 'none';
    const el = document.getElementById('orb');
    el.style.display = 'block';
    // The shipped control carries no presence floor; a dense body is what makes the tint direction visible.
    const material = variant.startsWith('dense') ? { ...VIREGLASS_CONTROL_MATERIAL, presence: 0.176 } : VIREGLASS_CONTROL_MATERIAL;
    orb = attachGlass(el, { material, interactive: false, body: variant !== 'no-body' });
    // The resize observer repaints once after attach, which would overwrite a canary set before it.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    if (variant === 'white-lobe') el.style.setProperty('--vireglass-rim', WHITE_LOBE);
    if (variant === 'dense-old-direction') {
      const alpha = el.style.backgroundColor.split(',').pop().replace(')', '').trim();
      el.style.backgroundColor = 'rgba(18, 18, 18, ' + alpha + ')';
    }
    if (variant === 'dark-strength') {
      const faint = rimGradientCss(resolveOptics(VIREGLASS_CONTROL_MATERIAL), [0.05, 0.05, 0.05], REST_LIGHT);
      el.style.setProperty('--vireglass-rim', faint);
    }
  };
  globalThis.__orbVars = () => {
    const style = document.getElementById('orb').style;
    return ['--vireglass-ink-color', '--vireglass-body-color', '--vireglass-rim'].map((k) => style.getPropertyValue(k)).join('|');
  };
  globalThis.__orbSample = (kind) => {
    const dark = { luma: 0.1, lo: 0.1, hi: 0.1, busy: 0, r: 0.1, g: 0.09, b: 0.08 };
    const bright = { luma: 0.85, lo: 0.85, hi: 0.85, busy: 0, r: 0.8, g: 0.86, b: 0.9 };
    orb.setSample(kind === 'dark' ? dark : kind === 'bright' ? bright : null);
  };
  globalThis.__orbUpdate = () => orb.update();

  // A morph is a new geometry every frame. The element probes the page itself (no sample), so
  // the probe counter has something to count.
  let morphing = null;
  globalThis.__morphBegin = (interim) => {
    morphing?.destroy();
    live?.destroy();
    live = null;
    orb?.destroy();
    orb = null;
    document.body.classList.remove('flat', 'bright', 'colour');
    document.getElementById('orb').style.display = 'none';
    document.getElementById('glass').style.display = 'block';
    morphing = attachGlass(document.getElementById('glass'), {
      material: MATERIAL_PRESETS.glass, interactive: false, shadow: false,
    });
    if (interim) morphing.setInterim(true);
    resetRenderStats();
  };
  globalThis.__morphStep = async (i) => {
    document.getElementById('glass').style.width = (${BOX.w} + 2 * i) + 'px';
    await new Promise((r) => requestAnimationFrame(r));
  };
  globalThis.__morphShape = async (i) => {
    const href = () => document.querySelector('svg[data-vireglass-filters] filter feImage')?.getAttribute('href');
    const before = href();
    morphing.setMorph({ smoothing: 24, shape: { offsetX: 150 + 3 * i, offsetY: -60, width: 90, height: 50, cornerRadius: 20 } });
    // The new map is shown once it has decoded, so wait for the href to move rather than a fixed time.
    const started = performance.now();
    while (href() === before && performance.now() - started < 1000) await new Promise((r) => requestAnimationFrame(r));
    return { before, after: href() };
  };
  globalThis.__morphEnd = async (interim) => {
    const during = renderStats();
    if (interim) morphing.setInterim(false);
    await new Promise((r) => setTimeout(r, 300));
    return { during, after: renderStats() };
  };
  globalThis.__morphDone = () => {
    morphing?.destroy();
    morphing = null;
    document.getElementById('glass').style.width = '${BOX.w}px';
  };
  let edge = null;
  globalThis.__edge = async (mode) => {
    edge?.destroy();
    edge = null;
    const scroller = document.getElementById('scroller');
    const el = document.getElementById('edge');
    scroller.style.display = mode === 'hidden' ? 'none' : 'block';
    el.style.display = mode === 'hidden' ? 'none' : 'block';
    scroller.scrollTop = 200;
    if (mode === 'on' || mode === 'reversed') {
      edge = attachScrollEdge(scroller, el, { side: 'top', ink: () => 0 });
      if (mode === 'reversed') {
        const written = el.style.getPropertyValue('mask-image');
        // CSSOM drops the default 'to bottom' when it serialises, so the direction is read rather than replaced.
        const stops = written.slice(written.indexOf('(') + 1).replace('to top, ', '').replace('to bottom, ', '');
        const turned = 'linear-gradient(' + (written.includes('to top') ? 'to bottom' : 'to top') + ', ' + stops;
        el.style.setProperty('mask-image', turned);
        el.style.setProperty('-webkit-mask-image', turned);
      }
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  };
  globalThis.__appear = async (t) => {
    morphing.setAppear(t);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return renderStats();
  };

  globalThis.__mount('full');
  globalThis.__ready = true;
</script>`;

const MIME = { '.js': 'text/javascript', '.map': 'application/json', '.cjs': 'text/javascript' };

function serve() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const path = (req.url ?? '/').split('?')[0];
      if (path === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(FIXTURE);
        return;
      }
      const full = join(ROOT, normalize(path).replace(/^[/\\]+/, ''));
      if (!full.startsWith(ROOT)) {
        res.writeHead(403);
        res.end();
        return;
      }
      try {
        res.writeHead(200, { 'content-type': MIME[extname(full)] ?? 'application/octet-stream' });
        res.end(readFileSync(full));
      } catch {
        res.writeHead(404);
        res.end();
      }
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

/** Mean absolute difference between two frames over one rectangle, 0…255. */
const DIFF = `(a, b, rect) => {
  const load = (src) => new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
  return Promise.all([load(a), load(b)]).then(([ia, ib]) => {
    const c = document.createElement('canvas');
    c.width = rect.w; c.height = rect.h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(ia, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
    const pa = ctx.getImageData(0, 0, rect.w, rect.h).data;
    ctx.clearRect(0, 0, rect.w, rect.h);
    ctx.drawImage(ib, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
    const pb = ctx.getImageData(0, 0, rect.w, rect.h).data;
    let sum = 0;
    for (let i = 0; i < pa.length; i += 4) sum += Math.abs(pa[i] - pb[i]);
    return sum / (pa.length / 4);
  });
}`;

/**
 * The 98th percentile of pixel saturation over a rectangle, and the mean, both 0..1.
 *
 * Glass moves light around. It cannot invent colour that is not in the page, so the material's own
 * pixels must not be more saturated than the page's. The spectral overlay did exactly that — it
 * multiplied the backdrop channel by channel, and a multiplier of 1.68 on red against 0.05 on blue
 * turns a soft yellow into a neon tube. Every other gate passed while it did.
 */
const SATURATION = `(src, rect) => {
  const load = (s) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = s; });
  return load(src).then((img) => {
    const c = document.createElement('canvas');
    c.width = rect.w; c.height = rect.h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
    const d = ctx.getImageData(0, 0, rect.w, rect.h).data;
    const v = [];
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) {
      const mx = Math.max(d[i], d[i + 1], d[i + 2]);
      const mn = Math.min(d[i], d[i + 1], d[i + 2]);
      const s = mx > 8 ? (mx - mn) / mx : 0;
      v.push(s); sum += s;
    }
    v.sort((a, b) => a - b);
    return { hi: v[Math.floor(v.length * 0.98)], mean: sum / v.length };
  });
}`;

/** OKLab lightness of a circle's rim, body and surround, measured as the kit's lab measures a control. */
const ORB = `(src, c) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onerror = reject;
  img.onload = () => {
    const cv = document.createElement('canvas');
    cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const data = g.getImageData(0, 0, cv.width, cv.height).data;
    const lin = (u) => { const v = u / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const lightness = (i) => {
      const r = lin(data[i]), gg = lin(data[i + 1]), b = lin(data[i + 2]);
      return 0.2104542553 * Math.cbrt(0.4122214708 * r + 0.5363325363 * gg + 0.0514459929 * b)
        + 0.793617785 * Math.cbrt(0.2119034982 * r + 0.6806995451 * gg + 0.1073969566 * b)
        - 0.0040720468 * Math.cbrt(0.0883024619 * r + 0.2817188376 * gg + 0.6299787005 * b);
    };
    const R = c.r, BINS = 24, body = [], surround = [], rim = Array.from({ length: BINS }, () => []);
    for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
      const px = x + 0.5 - c.x, py = y + 0.5 - c.y, d = Math.hypot(px, py) - R;
      if (Math.abs(d) > R) continue;
      const i = (y * cv.width + x) * 4;
      if (d >= -0.45 * R && d <= -0.15 * R) body.push(lightness(i));
      else if (d >= 0.15 * R && d <= 0.55 * R) surround.push(lightness(i));
      else if (d >= Math.min(-0.07 * R, -1.5) && d <= Math.max(0.03 * R, 1)) {
        rim[Math.floor(((Math.atan2(py, px) + Math.PI) / (2 * Math.PI)) * BINS) % BINS].push(lightness(i));
      }
    }
    const median = (a) => [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)];
    const q90 = (a) => [...a].sort((p, q) => p - q)[Math.min(a.length - 1, Math.floor(a.length * 0.9))];
    const bins = rim.filter((a) => a.length).map(q90);
    const S = median(surround);
    resolve({ body: median(body) - S, rimPeak: Math.max(...bins) - S, rimMin: Math.min(...bins) - S });
  };
  img.src = src;
})`;

const server = await serve();
const { port } = server.address();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 520, height: 340 } });

let failed = false;
const fail = (message) => {
  console.error(`check-dom: ${message}`);
  failed = true;
};

try {
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction('globalThis.__ready === true');

  const shoot = async (which) => {
    await page.evaluate((w) => globalThis.__mount(w), which);
    // One frame for the filter to be rebuilt and composited before the shutter opens.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    return `data:image/png;base64,${(await page.screenshot()).toString('base64')}`;
  };

  const full = await shoot('full');
  const flat = await shoot('flat');
  const none = await shoot('none');
  const rest = await shoot('rest');

  const diff = (a, b, rect) =>
    page.evaluate(([x, y, r, fn]) => new Function(`return ${fn}`)()(x, y, r), [a, b, rect, DIFF]);

  // The rim band is where §1 puts the optics; the middle is where it says the backdrop passes
  // through nearly untouched. Both sit well inside the element so the silhouette itself, which
  // moves under any material, never enters the window.
  const rimBand = { x: BOX.x + 2, y: BOX.y + 2, w: 18, h: BOX.h - 4 };
  const middle = { x: BOX.x + BOX.w / 2 - 30, y: BOX.y + BOX.h / 2 - 20, w: 60, h: 40 };
  const beyond = { x: BOX.x + BOX.w + 40, y: BOX.y, w: 100, h: BOX.h };

  const alive = await diff(full, none, rimBand);
  const rimShift = await diff(full, flat, rimBand);
  const middleShift = await diff(full, flat, middle);
  const leak = await diff(full, none, beyond);
  // §7: glass that is not there until it is touched. The whole element, not a band — at rest the
  // page under it has to be the page.
  const box = { x: BOX.x, y: BOX.y, w: BOX.w, h: BOX.h };
  const atRest = await diff(rest, none, box);

  console.log(
    `check-dom: material ${alive.toFixed(2)} | displacement rim ${rimShift.toFixed(2)} ` +
      `middle ${middleShift.toFixed(2)} | outside ${leak.toFixed(2)} | untouched ${atRest.toFixed(2)} ` +
      `(mean |delta| per pixel)`,
  );

  // 1. The E-34 guard: the material has to do something at all.
  if (alive < 2) fail(`the rim is unchanged with the glass on and off (${alive.toFixed(2)}) — the material is doing nothing`);

  // 2. §1, the defining shape of this lens: the optics live in a band near the rim and the middle
  //    barely displaces the backdrop. Equal displacement everywhere is a magnifier.
  if (rimShift < 2) fail(`the rim does not refract (${rimShift.toFixed(2)}) — blur and body are all that is left`);
  if (middleShift >= rimShift * 0.5) {
    fail(`the middle displaces nearly as much as the rim (${middleShift.toFixed(2)} vs ${rimShift.toFixed(2)}) — that is a loupe, not a lens`);
  }

  // 3. A filter that leaks past its own box is the `userSpaceOnUse` failure this renderer was built
  //    around, and it stays invisible until someone looks outside the element.
  if (leak > 0.5) fail(`the page changed outside the element (${leak.toFixed(2)}) — the filter is leaking past its box`);

  // 4. A widget in a shadow root has to get the same material as one on the page. It used to get
  //    none: the filter lives on the page, the reference resolves in the shadow tree, and the
  //    failure is silent because the reference is valid CSS. Measured against 'none' — the same
  //    page with no glass anywhere — so "the same as nothing" is exactly what fails.
  const shadow = await shoot('shadow');
  const inShadow = await diff(shadow, none, rimBand);
  console.log(`check-dom: in a shadow root the rim reads ${inShadow.toFixed(2)} (on the page: ${alive.toFixed(2)})`);
  if (inShadow < alive * 0.5) {
    fail(
      `glass in a shadow root is doing ${inShadow < 2 ? 'nothing' : 'far less than on the page'} ` +
        `(${inShadow.toFixed(2)} against ${alive.toFixed(2)}) — its filter is not being found`,
    );
  }

  // 5. Under a finger every displacement pass has to keep following it. With dispersion there are
  //    three, at three scales, and only the first was being updated: red got the undispersed scale
  //    and green and blue kept whatever they had at attach time.
  // Mounted with its pointer listeners on: 'full' attaches with interactive: false, so a
  // pointerdown there lands on nothing and the check would pass whatever the code did.
  await page.evaluate((w) => globalThis.__mount(w), 'press');
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const restScales = await page.evaluate(() => globalThis.__scales());
  await page.evaluate(() => globalThis.__press());
  await page.evaluate(() => new Promise((r) => setTimeout(r, 120)));
  const pressed = await page.evaluate(() => globalThis.__scales());
  console.log(`check-dom: displacement scales at rest ${restScales.map((v) => v.toFixed(1)).join(' / ')} ` +
    `-> under a finger ${pressed.map((v) => v.toFixed(1)).join(' / ')}`);
  if (pressed.length === 0) {
    fail('no displacement pass was found under a finger — the filter is not being rebuilt');
  } else if (pressed.length !== restScales.length) {
    fail(`the filter changed shape under a finger (${restScales.length} passes -> ${pressed.length})`);
  } else if (pressed.length === 1) {
    // One pass means the fixture material has no dispersion, and everything below would pass
    // silently while proving nothing about the bug it exists for.
    fail('only one displacement pass under a finger — the fixture has no dispersion to check');
  } else {
    // The scale itself does not move under a finger — pressing changes what the map CONTAINS, not
    // how far it displaces. What must survive is the spread between the channels: the bug set one
    // pass to the undispersed scale and left the others at whatever they had, so the ratios broke
    // while every absolute value still looked plausible.
    const ratio = (all) => all.map((v) => v / all[Math.floor(all.length / 2)]);
    const before = ratio(restScales);
    const after = ratio(pressed);
    const drift = Math.max(...after.map((v, i) => Math.abs(v - before[i])));
    console.log(`check-dom: channel spread across the passes holds to ${drift.toFixed(4)} under a finger`);
    if (drift > 0.002) {
      fail(`the channels stopped diverging by the same ratios under a finger (drift ${drift.toFixed(4)}) — ` +
        'a pass is being given a scale that is not its own');
    }
    if (Math.max(...pressed) - Math.min(...pressed) <= 0.01) {
      fail('every pass ended on the same scale under a finger — dispersion switched itself off');
    }
  }

  // 6. Glass moves light, it does not make it. Over a saturated page the material's own pixels
  //    must not be more saturated than the page's — measured where the material is strongest,
  //    which is the rim band, against the same band with no glass on it.
  const colour = await shoot('colour');
  const colourNone = await shoot('colour-none');
  const sat = (img, rect) =>
    page.evaluate(([s, r, fn]) => new Function(`return ${fn}`)()(s, r), [img, rect, SATURATION]);
  const band = { x: BOX.x, y: BOX.y, w: BOX.w, h: BOX.h };
  const withGlass = await sat(colour, band);
  const bare = await sat(colourNone, band);
  console.log(
    `check-dom: saturation over a coloured page — glass ${(withGlass.hi * 100).toFixed(0)}% hi / ` +
      `${(withGlass.mean * 100).toFixed(0)}% mean, the page alone ${(bare.hi * 100).toFixed(0)}% / ` +
      `${(bare.mean * 100).toFixed(0)}%`,
  );
  if (withGlass.hi > bare.hi + 0.06) {
    fail(
      `the glass is more saturated than the page it stands on (${(withGlass.hi * 100).toFixed(0)}% vs ` +
        `${(bare.hi * 100).toFixed(0)}%) — it is inventing colour, not moving it`,
    );
  }

  // 8. The rim and the body, measured as the reference controls were: a circle of the control
  //    material on a flat page, in OKLab lightness against the surround. The reference, over dark
  //    video (A 2:17): rim 0.24 to 0.27 over the surround, body +0.05 to +0.13. Over sky (M 2:52):
  //    rim 0.25. The glass used to draw a full-white lobe, which reads 0.70 to 0.80 over dark.
  const orbRect = { x: 444, y: 74, r: 44 };
  const orbShot = async (pageKind, variant) => {
    await page.evaluate(([p, v]) => globalThis.__orb(p, v), [pageKind, variant]);
    await page.evaluate(() => new Promise((r) => setTimeout(r, 120)));
    const img = `data:image/png;base64,${(await page.screenshot()).toString('base64')}`;
    return page.evaluate(([src, c, fn]) => new Function(`return ${fn}`)()(src, c), [img, orbRect, ORB]);
  };
  const darkOrb = await orbShot('dark', 'attached');
  const brightOrb = await orbShot('bright', 'attached');
  const whiteLobe = await orbShot('dark', 'white-lobe');
  const faintOnBright = await orbShot('bright', 'dark-strength');
  const noBody = await orbShot('dark', 'no-body');
  const denseBright = await orbShot('bright', 'dense');
  const oldDirection = await orbShot('bright', 'dense-old-direction');
  const signed = (v) => (v >= 0 ? '+' : '') + v.toFixed(3);
  console.log(
    `check-dom: rim over the surround dark ${signed(darkOrb.rimPeak)} (dimmest bin ${signed(darkOrb.rimMin - darkOrb.body)} over the body), ` +
      `bright ${signed(brightOrb.rimPeak)}; body over dark ${signed(darkOrb.body)}, over mid-light ${signed(denseBright.body)}`,
  );
  const RIM_DARK_MAX = 0.32;
  const RIM_BRIGHT_MIN = 0.15;
  const RIM_FLOOR_MIN = 0.01;
  const BODY_DARK_MIN = 0.04;
  const BODY_BRIGHT_MIN = 0.03;
  // 8a. Faint over dark. The canary is the old full-white lobe.
  if (!(darkOrb.rimPeak <= RIM_DARK_MAX)) {
    fail(`the rim over a dark surround reads ${signed(darkOrb.rimPeak)}, past ${RIM_DARK_MAX} — it is drawn at full strength`);
  }
  if (!(whiteLobe.rimPeak > RIM_DARK_MAX)) {
    fail(`canary: a full-white lobe over dark read ${signed(whiteLobe.rimPeak)} and passed the faintness gate`);
  }
  // 8b. Strength follows the surroundings: plain over bright, which a rim drawn for dark is not.
  if (!(brightOrb.rimPeak >= RIM_BRIGHT_MIN)) {
    fail(`the rim over a bright surround reads only ${signed(brightOrb.rimPeak)} — its strength does not follow the surroundings`);
  }
  if (!(faintOnBright.rimPeak < RIM_BRIGHT_MIN)) {
    fail(`canary: a rim drawn for dark, over bright, read ${signed(faintOnBright.rimPeak)} and passed the gate`);
  }
  // 8c. The line goes the whole way round: its dimmest bin is still lighter than the body beside it.
  if (!(darkOrb.rimMin - darkOrb.body >= RIM_FLOOR_MIN)) {
    fail(`the rim has a gap: its dimmest bin reads ${signed(darkOrb.rimMin - darkOrb.body)} over the body beside it`);
  }
  if (!(whiteLobe.rimMin - whiteLobe.body < RIM_FLOOR_MIN)) {
    fail(`canary: a lobe with no contour had a floor of ${signed(whiteLobe.rimMin - whiteLobe.body)} over the body and passed the full-contour gate`);
  }
  // 8d. The body is drawn on the SVG path, and over a dark surround it reads lighter than it.
  if (!(darkOrb.body >= BODY_DARK_MIN)) {
    fail(`the body over a dark surround reads ${signed(darkOrb.body)}, not lighter than it`);
  }
  if (!(noBody.body < BODY_DARK_MIN)) {
    fail(`canary: with no body drawn the element still read ${signed(noBody.body)} over dark`);
  }

  // 8e. Over a mid-light surround (L about 0.55, glyph still white) a presence-carrying body is
  //    lighter than it, as in the reference; the canary is the old direction on the same material.
  if (!(denseBright.body >= BODY_BRIGHT_MIN)) {
    fail(`the body over a mid-light surround reads ${signed(denseBright.body)}, not lighter than it`);
  }
  if (!(oldDirection.body < BODY_BRIGHT_MIN)) {
    fail(`canary: the old direction over mid-light read ${signed(oldDirection.body)} and passed the gate`);
  }

  // 9. A sample from the host is a live input: setSample repaints the same element, update() alone
  //    does not change it, and null goes back to the probe.
  await page.evaluate(() => globalThis.__orb('dark', 'attached'));
  const probed = await page.evaluate(() => globalThis.__orbVars());
  await page.evaluate(() => globalThis.__orbUpdate());
  const updated = await page.evaluate(() => globalThis.__orbVars());
  await page.evaluate(() => globalThis.__orbSample('bright'));
  const supplied = await page.evaluate(() => globalThis.__orbVars());
  await page.evaluate(() => globalThis.__orbSample(null));
  const released = await page.evaluate(() => globalThis.__orbVars());
  console.log('check-dom: setSample repaints the element, update() alone does not, null goes back to the probe');
  if (probed !== updated) fail('update() changed an element whose backdrop did not change — the sample check would prove nothing');
  if (supplied === probed) fail('setSample did not change the element: the supplied backdrop is not an input');
  if (released !== probed) fail('setSample(null) did not return to probing the page');

  // 7. §7: the way to put glass on a content control is for there to be no glass until a finger
  //    arrives. An element that shows anything at rest is permanent glass in the content layer.
  if (atRest > 0.5) fail(`the interactive variant is visible untouched (${atRest.toFixed(2)}) — that is glass in the content layer`);

  // 10. A morph is a new geometry every frame, and it used to cost a probe, a full-resolution bake and
  //    a new filter element each time. Counted, not timed: a timer says nothing on a slow runner, a
  //    counter does. The canary is the same sixty frames without the interim mode.
  const FRAMES = 60;
  // The glass preset has a spectral edge, so a rebuild bakes two maps: displacement and spectral.
  const MAPS = 2;
  const run = async (interim, withShots) => {
    await page.evaluate((i) => globalThis.__morphBegin(i), interim);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.evaluate(() => globalThis.__morphStep(0));
    const shots = [];
    for (let i = 1; i <= FRAMES; i += 1) {
      await page.evaluate((n) => globalThis.__morphStep(n), i);
      if (withShots && i % 4 === 0) shots.push([i, `data:image/png;base64,${(await page.screenshot()).toString('base64')}`]);
    }
    return { stats: await page.evaluate((i) => globalThis.__morphEnd(i), interim), shots };
  };

  const interimRun = await run(true, true);
  const { during: iDuring, after: iAfter } = interimRun.stats;
  const canaryRun = await run(false, false);
  const cAfter = canaryRun.stats.after;
  console.log(
    `check-dom: ${FRAMES} frames of changing geometry — interim: ${iDuring.probes} probes, ${iDuring.fullBakes} full bakes, ` +
      `${iDuring.filterSwaps} filter swaps, then ${iAfter.probes} / ${iAfter.fullBakes} / ${iAfter.filterSwaps} after it ends; ` +
      `without interim: ${cAfter.probes} probes, ${cAfter.fullBakes} full bakes, ${cAfter.filterSwaps} filter swaps`,
  );
  if (iDuring.probes !== 0) fail(`interim probed the backdrop ${iDuring.probes} times`);
  if (iDuring.fullBakes !== 0) fail(`interim rebuilt the map at full resolution ${iDuring.fullBakes} times`);
  if (iDuring.filterSwaps !== 0) fail(`interim swapped the filter element ${iDuring.filterSwaps} times`);
  if (iAfter.probes !== 1) fail(`ending interim should probe once, probed ${iAfter.probes}`);
  if (iAfter.fullBakes !== MAPS) fail(`ending interim should bake once at full resolution (${MAPS} maps), baked ${iAfter.fullBakes}`);
  if (iAfter.filterSwaps !== 0) fail(`ending interim replaced the filter element (${iAfter.filterSwaps}); it should update in place`);
  if (!(cAfter.fullBakes >= MAPS * (FRAMES - 5) && cAfter.probes >= FRAMES - 5 && cAfter.filterSwaps >= FRAMES - 5)) {
    fail(`canary: sixty frames without interim counted ${cAfter.probes} probes, ${cAfter.fullBakes} bakes, ${cAfter.filterSwaps} swaps — the gate cannot fail`);
  }

  // 10b. The stretched map still refracts at the new box, and no frame lacks the refraction it had.
  //    Pixels are sampled across the growth: a frame drawn with a missing map shows a rim that is the page.
  const leftRim = { x: BOX.x + 2, y: BOX.y + 2, w: 18, h: BOX.h - 4 };
  const lows = [];
  let weakest = Infinity;
  for (const [n, shot] of interimRun.shots) {
    const left = await diff(shot, none, leftRim);
    const right = await diff(shot, none, { x: BOX.x + BOX.w + 2 * n - 20, y: BOX.y + 2, w: 18, h: BOX.h - 4 });
    weakest = Math.min(weakest, left, right);
    if (left < alive * 0.5 || right < alive * 0.5) lows.push(n);
  }
  console.log(`check-dom: through the interim growth the weakest rim band reads ${weakest.toFixed(2)} (at rest: ${alive.toFixed(2)}), ${lows.length} frames below half of it`);
  if (lows.length > 0) fail(`frames ${lows.join(', ')} of the interim growth have a rim with no refraction — drawn without a decoded map, or a map that does not follow the box`);

  // 10c. Changing the morph shapes during interim rebuilds the map small and updates the filter in place.
  await page.evaluate(() => globalThis.__morphBegin(true));
  let stuck = 0;
  let last = null;
  for (let i = 0; i < 20; i += 1) {
    last = await page.evaluate((n) => globalThis.__morphShape(n), i);
    if (last.after === last.before) stuck += 1;
  }
  // Right after the last change: the filter carries the latest key's map (asking for the same shape
  // again is answered from the cache and must leave the href where it is), and the rim still refracts.
  const settledHref = last.after;
  const again = await page.evaluate(() => globalThis.__morphShape(19));
  const shapeShot = `data:image/png;base64,${(await page.screenshot()).toString('base64')}`;
  const shapeRim = await diff(shapeShot, none, { x: BOX.x + 2, y: BOX.y + 2, w: 18, h: BOX.h - 4 });
  console.log(`check-dom: after the last shape change the rim reads ${shapeRim.toFixed(2)} (at rest: ${alive.toFixed(2)}); ${stuck} of 20 changes left the href where it was`);
  if (stuck > 0) fail(`${stuck} shape changes inside interim never reached the filter`);
  if (again.after !== settledHref) fail('asking for the latest shape again moved the href: the filter was not showing the latest map');
  if (shapeRim < alive * 0.5) fail(`the rim has no refraction right after a shape change in interim (${shapeRim.toFixed(2)})`);
  const morphed = await page.evaluate(() => globalThis.__morphEnd(true));
  await page.evaluate(() => globalThis.__morphDone());
  console.log(
    `check-dom: 20 morph changes inside interim — ${morphed.during.reducedBakes} reduced bakes, ${morphed.during.fullBakes} full bakes, ${morphed.during.filterSwaps} filter swaps`,
  );
  if (morphed.during.reducedBakes < 1) fail('a morph change during interim did not rebuild the map');
  if (morphed.during.fullBakes !== 0 || morphed.during.filterSwaps !== 0 || morphed.during.probes !== 0) {
    fail('a morph change during interim did full-resolution work, swapped the filter or probed');
  }

  // 10d. Appear is the lens's strength written in place (§1, materialise by bending light): thirty
  //    steps cost no bake and no swap, absent reads as the page, half as less than present. The canary
  //    is thirty steps of a morph, which the map is keyed by.
  await page.evaluate(() => globalThis.__morphBegin(false));
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const appearShot = async () => `data:image/png;base64,${(await page.screenshot()).toString('base64')}`;
  let appearStats = null;
  const appearAt = { start: await appearShot() };
  for (let i = 29; i >= 0; i -= 1) {
    appearStats = await page.evaluate((t) => globalThis.__appear(t), i / 29);
    if (i === 0) appearAt.absent = await appearShot();
  }
  appearStats = await page.evaluate(() => globalThis.__appear(0.5));
  appearAt.half = await appearShot();
  appearStats = await page.evaluate(() => globalThis.__appear(1));
  appearAt.present = await appearShot();
  const absent = await diff(appearAt.absent, none, rimBand);
  const half = await diff(appearAt.half, none, rimBand);
  const present = await diff(appearAt.present, none, rimBand);
  const drift = await diff(appearAt.present, appearAt.start, rimBand);
  await page.evaluate(() => globalThis.__morphDone());
  await page.evaluate(() => globalThis.__morphBegin(false));
  for (let i = 0; i < 30; i += 1) await page.evaluate((n) => globalThis.__morphShape(n), i);
  const keyed = await page.evaluate(() => globalThis.__morphEnd(false));
  await page.evaluate(() => globalThis.__morphDone());
  console.log(
    `check-dom: 31 appear steps — ${appearStats.fullBakes} full bakes, ${appearStats.reducedBakes} reduced, ${appearStats.filterSwaps} swaps; ` +
      `the rim reads ${absent.toFixed(2)} absent, ${half.toFixed(2)} at half, ${present.toFixed(2)} present, ${drift.toFixed(2)} from where it started; ` +
      `30 morph steps baked ${keyed.after.fullBakes}`,
  );
  if (appearStats.fullBakes !== 0 || appearStats.reducedBakes !== 0 || appearStats.filterSwaps !== 0) {
    fail('a change of appear rebuilt the map or swapped the filter; it is an attribute');
  }
  if (absent > alive * 0.15) fail(`at appear 0 the rim still reads ${absent.toFixed(2)}: the element has not gone`);
  if (!(half > absent && half < present)) fail(`appear 0.5 reads ${half.toFixed(2)}, not between absent and present`);
  if (drift > alive * 0.05) fail(`back at appear 1 the rim differs from where it started by ${drift.toFixed(2)}`);
  if (keyed.after.fullBakes < 30) fail(`canary: 30 morph steps baked ${keyed.after.fullBakes} times — the appear gate cannot fail`);

  // 11. §10: the scroll edge dissolves the content most at the edge the panel sits at, and less away from it. Read as how
  //    much the edge changes the hairlines under it, at the top of the band and at its far end. The canary is the ramp
  //    turned round, which the first version of this effect shipped while its unit test checked only the CSS it wrote.
  const edgeShot = async (mode) => {
    await page.evaluate((m) => globalThis.__edge(m), mode);
    return `data:image/png;base64,${(await page.screenshot()).toString('base64')}`;
  };
  const unedged = await edgeShot('plain');
  const soft = await edgeShot('on');
  const turned = await edgeShot('reversed');
  await page.evaluate(() => globalThis.__edge('hidden'));
  const atEdge = { x: 384, y: 22, w: 112, h: 12 };
  const farEnd = { x: 384, y: 94, w: 112, h: 12 };
  const edgeNear = await diff(soft, unedged, atEdge);
  const edgeFar = await diff(soft, unedged, farEnd);
  const turnedNear = await diff(turned, unedged, atEdge);
  const turnedFar = await diff(turned, unedged, farEnd);
  console.log(
    `check-dom: the scroll edge changes the content by ${edgeNear.toFixed(2)} at the panel's edge and ${edgeFar.toFixed(2)} at the far end of its band; ` +
      `turned round, ${turnedNear.toFixed(2)} and ${turnedFar.toFixed(2)}`,
  );
  if (!(edgeNear > 2 * edgeFar)) fail(`the scroll edge is not strongest at the panel's edge (${edgeNear.toFixed(2)} there, ${edgeFar.toFixed(2)} at the far end)`);
  if (edgeNear < 5) fail(`the scroll edge hardly changes the content at the panel's edge (${edgeNear.toFixed(2)})`);
  if (turnedNear > 2 * turnedFar) fail('canary: a ramp turned round still read as strongest at the edge — the scroll edge gate cannot fail');

  if (!failed) {
    console.log('check-dom: the glass bends live DOM at its rim, leaves its middle alone, touches nothing outside itself, and the interactive variant is absent until touched');
  }
} catch (error) {
  fail(String(error?.message ?? error));
} finally {
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
}
