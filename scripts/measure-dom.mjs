// What the DOM renderer costs. Not a gate — a measurement, run by hand and quoted in docs.
//
// The numbers that matter are not the same as on Android. There the cost was GPU time per surface,
// because every surface carried its own blur view. Here the refraction runs in the compositor and
// costs nothing in JS once it is set up; what costs is building the maps — a per-pixel loop and a
// PNG encode — and that happens on attach, on resize, and on every frame of a finger's travel.
//
// So this measures three separate things, because they fail for different reasons:
//   attach   the one-off cost of putting glass on an element
//   rebuild  what a geometry change costs (a resize, an orientation flip)
//   frame    what one frame of interaction costs, which is the only number with a budget
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const SIZES = [
  { name: 'button', w: 44, h: 44, r: 22 },
  { name: 'bar', w: 380, h: 76, r: 26 },
  { name: 'sheet', w: 380, h: 520, r: 32 },
];

const FIXTURE = `<!doctype html>
<meta charset="utf-8">
<style>
  html, body { margin: 0; background: #0b0d12; }
  #page { position: absolute; inset: 0;
    background-image: repeating-linear-gradient(90deg, #f4f7ff 0 1px, #0b0d12 1px 8px); }
  .glass { position: absolute; left: 40px; top: 40px; }
</style>
<div id="page"></div>
<script type="module">
  import { attachGlass, buildDisplacementMap, buildSpectralMap, hasSpectralEdge, clearMapCache } from '/dist/dom.js';
  import { resolveOptics, roundedRectGeometry, MATERIAL_PRESETS } from '/dist/index.js';

  const sample = { luma: 0.5, lo: 0.04, hi: 0.96, busy: 0.4, r: 0.5, g: 0.5, b: 0.5 };

  globalThis.__measure = ({ w, h, r, preset, runs }) => {
    const el = document.createElement('div');
    el.className = 'glass';
    el.style.width = w + 'px';
    el.style.height = h + 'px';
    el.style.borderRadius = r + 'px';
    document.body.appendChild(el);

    const material = MATERIAL_PRESETS[preset];
    const optics = resolveOptics(material);
    const geometry = roundedRectGeometry(w, h, r);
    const dpr = devicePixelRatio;

    const time = (fn) => {
      const t0 = performance.now();
      for (let i = 0; i < runs; i += 1) fn();
      return (performance.now() - t0) / runs;
    };

    // Warm: the first call pays for JIT and for the canvas's first allocation, and quoting that
    // as the cost would be quoting the wrong thing.
    buildDisplacementMap(optics, geometry, dpr);

    const displacement = time(() => buildDisplacementMap(optics, geometry, dpr));
    const spectral = hasSpectralEdge(optics) ? time(() => buildSpectralMap(optics, geometry, dpr)) : 0;

    // Cold: what the first glass of this shape on a page costs.
    clearMapCache();
    const t0 = performance.now();
    const handle = attachGlass(el, { material, sample, interactive: false, shadow: false });
    const attach = performance.now() - t0;

    const update = time(() => handle.update());

    // Warm: what the second identical element costs, which is what a tab bar actually pays.
    const el2 = el.cloneNode();
    document.body.appendChild(el2);
    const t1 = performance.now();
    const second = attachGlass(el2, { material, sample, interactive: false, shadow: false });
    const warm = performance.now() - t1;
    second.destroy();
    el2.remove();

    handle.destroy();
    el.remove();
    return { displacement, spectral, attach, warm, update, pixels: Math.round(w * dpr) * Math.round(h * dpr) };
  };
  globalThis.__ready = true;
</script>`;

const MIME = { '.js': 'text/javascript', '.map': 'application/json' };

const server = await new Promise((resolve) => {
  const s = createServer((req, res) => {
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
  s.listen(0, '127.0.0.1', () => resolve(s));
});

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 640, height: 700 } });

try {
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction('globalThis.__ready === true');

  console.log('Building the maps is the whole cost; the refraction itself runs in the compositor.');
  console.log('Times are milliseconds, averaged over the runs shown.\n');
  console.log('element   preset       px      map    hue   attach   warm  update');

  for (const size of SIZES) {
    for (const preset of ['glass', 'iridescent']) {
      const runs = size.w * size.h > 40000 ? 6 : 20;
      const m = await page.evaluate((a) => globalThis.__measure(a), { ...size, preset, runs });
      console.log(
        `${size.name.padEnd(9)} ${preset.padEnd(11)} ${String(m.pixels).padStart(7)} ` +
          `${m.displacement.toFixed(2).padStart(6)} ${m.spectral.toFixed(2).padStart(6)} ` +
          `${m.attach.toFixed(2).padStart(7)} ${m.warm.toFixed(2).padStart(6)} ${m.update.toFixed(2).padStart(7)}`,
      );
    }
  }

  console.log('\n`update` is what a scroll costs: the map is cached, so it is the probe and the');
  console.log('CSS writes alone. A frame of interaction rebuilds the map at density 1 instead.');
} finally {
  await browser.close();
  server.close();
}
