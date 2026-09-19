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
</style>
<div id="page"></div>
<div id="glass"></div>
<script type="module">
  import { attachGlass } from '/dist/dom.js';
  import { MATERIAL_PRESETS } from '/dist/index.js';

  // The probe would read the striped page as busy and thicken the body — correct, but it hides the
  // displacement behind a tint. This measurement is about geometry, so the backdrop is stated.
  const sample = { luma: 0.5, lo: 0.04, hi: 0.96, busy: 0.4, r: 0.5, g: 0.5, b: 0.5 };
  let live = null;

  globalThis.__mount = (which) => {
    live?.destroy();
    live = null;
    if (which === 'none') return;
    const material = which === 'flat'
      ? { ...MATERIAL_PRESETS.glass, ior: 1 }
      : MATERIAL_PRESETS.glass;
    live = attachGlass(document.getElementById('glass'), {
      material, sample, interactive: false, shadow: false,
    });
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

  console.log(
    `check-dom: material ${alive.toFixed(2)} | displacement rim ${rimShift.toFixed(2)} ` +
      `middle ${middleShift.toFixed(2)} | outside ${leak.toFixed(2)} (mean |delta| per pixel)`,
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

  if (!failed) {
    console.log('check-dom: the glass bends live DOM at its rim, leaves its middle alone, and touches nothing outside itself');
  }
} catch (error) {
  fail(String(error?.message ?? error));
} finally {
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
}
