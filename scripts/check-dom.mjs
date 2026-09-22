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
<script type="module">
  import { attachGlass } from '/dist/dom.js';
  import { MATERIAL_PRESETS } from '/dist/index.js';

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

  // 7. §7: the way to put glass on a content control is for there to be no glass until a finger
  //    arrives. An element that shows anything at rest is permanent glass in the content layer.
  if (atRest > 0.5) fail(`the interactive variant is visible untouched (${atRest.toFixed(2)}) — that is glass in the content layer`);

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
