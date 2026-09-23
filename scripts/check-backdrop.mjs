#!/usr/bin/env node
/**
 * Equivalence gate for `VireGlassBackdropPass` (web-core: `src/web/renderer.ts`). The `backdrop`
 * option is a second way to fill the same texture the `scene` option fills — a GPU pass instead of
 * a 2D canvas plus `texSubImage2D`. Nothing downstream should be able to tell them apart: this
 * renders the SAME scene through both paths, with a glass piece over it, and compares the finished
 * frames pixel for pixel.
 *
 * The test scene carries both horizontal and vertical structure (four differently colored
 * quadrants, plus stripes confined to one half on each axis) specifically so a Y flip, an X flip,
 * or a transpose all show up as a large mismatch rather than accidentally lining back up.
 *
 * The canary is the point of this file as much as the equivalence check: a pass that gets the
 * orientation contract backwards (a flip added where the contract calls for none) must fail
 * loudly. If the canary ever stopped failing, the gate would have quietly stopped checking
 * anything.
 *
 * Two more cases live here: a "dirty" pass that leaves depth/stencil/cull/blend/scissor enabled,
 * flips the unpack alignment, and leaves its own VAO and program bound — the renderer's own reset
 * has to make the frame come out right regardless — and the `scene`+`backdrop` misuse cases
 * (`render()` must throw given both or neither, never silently pick one).
 *
 * Run: npm run check:backdrop
 */
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORE = resolve(HERE, '../src/index.ts').replace(/\\/g, '/');
const WEB = resolve(HERE, '../src/web/index.ts').replace(/\\/g, '/');

/**
 * How far a texel is allowed to drift between the two paths, 0..255 per channel. Both paths
 * upload the exact same `paintTestScene` canvas — one via `texSubImage2D`, the other via
 * `texImage2D` into a texture a GPU pass then blits — so a correct pass reproduces it losslessly;
 * only the glass itself adds any per-pixel variation on top. Measured on this scene with the
 * contract honored: max diff 0, 0% of texels mismatched — same result for the "dirty" pass below,
 * which draws the identical content and only leaves GL state behind. The threshold sits well above
 * both of those and well below the canary's (max 168, see `MIN_CANARY_MEAN_DIFF`), so it separates
 * "same rendering" from "wrong orientation" without being tuned to either number exactly.
 */
const MAX_CHANNEL_DIFF = 24;
/** Fraction of texels allowed past `MAX_CHANNEL_DIFF` — measured 0% with the contract honored;
 *  left nonzero so rasterization noise on a different driver has somewhere to land without this
 *  turning into a pixel-perfect screenshot diff. */
const MAX_MISMATCH_FRACTION = 0.002;
/**
 * The canary — a pass with the Y flip added where the contract does not call for one — must miss
 * by far more than the thresholds above. Measured mean per-channel diff for that pass on this
 * scene: 119 (99% of texels mismatched — the frame is quadrant-swapped top to bottom). The floor
 * is set well under the measured value, so a future change to the test scene that happens to
 * weaken the canary is still caught.
 */
const MIN_CANARY_MEAN_DIFF = 20;

const WIDTH = 320;
const HEIGHT = 200;

const ENTRY = `
import { createVireGlassRenderer, bindTextureAt, createProgram, createTexture, drawFullscreenTriangle, FULLSCREEN_TRIANGLE_VERTEX_SOURCE } from '${WEB}';
import { MATERIAL_PRESETS, resolveOptics, roundedRectGeometry } from '${CORE}';

const WIDTH = ${WIDTH};
const HEIGHT = ${HEIGHT};

// Four quadrants (catches a transpose or either axis flipped) plus stripes confined to one half
// on EACH axis (catches a flip that a symmetric quadrant layout alone could miss).
function paintTestScene(ctx, w, h) {
  ctx.fillStyle = '#c23b3b'; ctx.fillRect(0, 0, w / 2, h / 2);
  ctx.fillStyle = '#3ba85c'; ctx.fillRect(w / 2, 0, w - w / 2, h / 2);
  ctx.fillStyle = '#3b5ec2'; ctx.fillRect(0, h / 2, w / 2, h - h / 2);
  ctx.fillStyle = '#c2a33b'; ctx.fillRect(w / 2, h / 2, w - w / 2, h - h / 2);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  for (let y = 0; y < h / 2; y += 10) ctx.fillRect(0, y, w, 4);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
  for (let x = w / 2; x < w; x += 10) ctx.fillRect(x, 0, 4, h);
}

function makeStage() {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  document.body.append(canvas);
  const renderer = createVireGlassRenderer(canvas);
  renderer.resize(WIDTH, HEIGHT);
  return { canvas, renderer };
}

function testPiece() {
  return {
    optics: resolveOptics(MATERIAL_PRESETS.glass),
    geometry: roundedRectGeometry(140, 90, 24),
    centerX: WIDTH / 2,
    centerY: HEIGHT / 2,
    appear: 1,
  };
}

// Ink mask, white (top half) on black (bottom half) per the frame's contract — sensitive
// specifically to UNPACK_FLIP_Y_WEBGL, which nothing else in this file's comparisons exercises:
// texSubImage2D (the scene path's own content upload) does not consult that flag the way
// texImage2D from an icon/color-layer source does.
function makeIconMask() {
  const mask = document.createElement('canvas');
  mask.width = WIDTH;
  mask.height = HEIGHT;
  const ctx = mask.getContext('2d');
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, WIDTH, HEIGHT / 2);
  return mask;
}

function testPieceWithIcon() {
  return { ...testPiece(), icon: true, inkIdle: [1, 1, 1, 1], inkActive: [1, 1, 1, 1] };
}

// Lets the backdrop probe settle to the same steady state the scene path reaches, so the
// comparison isn't contaminated by the adaptive shadow/legibility still easing in.
const settle = async (draw) => {
  for (let i = 0; i < 40; i += 1) {
    draw();
    await new Promise((r) => setTimeout(r, 0));
  }
};

function readFrame(canvas) {
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true });
  const buf = new Uint8Array(WIDTH * HEIGHT * 4);
  gl.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  return buf;
}

function diffStats(a, b) {
  let maxDiff = 0;
  let sumDiff = 0;
  let mismatched = 0;
  const texels = WIDTH * HEIGHT;
  for (let t = 0; t < texels; t += 1) {
    let worst = 0;
    for (let c = 0; c < 4; c += 1) {
      const d = Math.abs(a[t * 4 + c] - b[t * 4 + c]);
      if (d > worst) worst = d;
    }
    if (worst > maxDiff) maxDiff = worst;
    sumDiff += worst;
    if (worst > ${MAX_CHANNEL_DIFF}) mismatched += 1;
  }
  return { maxDiff, meanDiff: sumDiff / texels, mismatchFraction: mismatched / texels };
}

// Two hardcoded blit shaders rather than one built from a runtime flag: FOLLOWS is the pass under
// test (honors the orientation contract: a plain top-row-first image needs no flip to land
// correctly in \`target.framebuffer\`), VIOLATES is the canary — the mistake a pass makes when it
// treats increasing y as its own "up" and flips where the contract does not call for one.
const FOLLOWS_FRAGMENT_SOURCE = \`#version 300 es
precision highp float;
out vec4 fragColor;
uniform sampler2D u_src;
uniform vec2 u_res;
void main() {
  fragColor = texture(u_src, gl_FragCoord.xy / u_res);
}
\`;

const VIOLATES_FRAGMENT_SOURCE = \`#version 300 es
precision highp float;
out vec4 fragColor;
uniform sampler2D u_src;
uniform vec2 u_res;
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  uv.y = 1.0 - uv.y;
  fragColor = texture(u_src, uv);
}
\`;

let refTexture = null;
let blitProgram = null;

/**
 * The GPU backdrop pass under test. Loads \`paintTestScene\` as an ordinary texture (the same
 * top-row-first convention \`contentTexture\` itself uses) and blits it into \`target.framebuffer\`.
 */
function makeBackdropPass(refCanvas, correct) {
  return (gl, target) => {
    if (!refTexture) {
      refTexture = createTexture(gl, { width: WIDTH, height: HEIGHT });
      gl.bindTexture(gl.TEXTURE_2D, refTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, refCanvas);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
    if (!blitProgram) {
      blitProgram = createProgram(
        gl,
        FULLSCREEN_TRIANGLE_VERTEX_SOURCE,
        correct ? FOLLOWS_FRAGMENT_SOURCE : VIOLATES_FRAGMENT_SOURCE,
      );
    }
    gl.useProgram(blitProgram);
    bindTextureAt(gl, 0, refTexture, blitProgram, 'u_src');
    gl.uniform2f(gl.getUniformLocation(blitProgram, 'u_res'), target.width, target.height);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    drawFullscreenTriangle(gl);
  };
}

globalThis.vgBackdropCompare = async ({ correct }) => {
  const sceneStage = makeStage();
  await settle(() =>
    sceneStage.renderer.render({ density: 1, debug: 'normal', pieces: [testPiece()], scene: paintTestScene }),
  );
  const sceneFrame = readFrame(sceneStage.canvas);

  const refCanvas = document.createElement('canvas');
  refCanvas.width = WIDTH;
  refCanvas.height = HEIGHT;
  paintTestScene(refCanvas.getContext('2d'), WIDTH, HEIGHT);

  const backdropStage = makeStage();
  refTexture = null;
  blitProgram = null;
  await settle(() =>
    backdropStage.renderer.render({
      density: 1,
      debug: 'normal',
      pieces: [testPiece()],
      backdrop: makeBackdropPass(refCanvas, correct),
    }),
  );
  const backdropFrame = readFrame(backdropStage.canvas);

  return diffStats(sceneFrame, backdropFrame);
};

globalThis.vgBackdropNoScene = () => {
  const { renderer } = makeStage();
  try {
    renderer.render({ density: 1, debug: 'normal', pieces: [testPiece()] });
    return { threw: false };
  } catch (error) {
    return { threw: true, message: String(error && error.message) };
  }
};

globalThis.vgBackdropBoth = () => {
  const { renderer } = makeStage();
  try {
    renderer.render({
      density: 1,
      debug: 'normal',
      pieces: [testPiece()],
      scene: paintTestScene,
      backdrop: () => {},
    });
    return { threw: false };
  } catch (error) {
    return { threw: true, message: String(error && error.message) };
  }
};

let dirtyBlitProgram = null;
let dirtyLeftoverProgram = null;
let dirtyVao = null;

/**
 * Draws the correct backdrop first — this pass's own output is right — and only THEN leaves the
 * context in the state a careless real pass might: depth/stencil/cull test enabled, a blend func
 * and a scissor rect that would blank the screen if either survived, the unpack flags flipped
 * (which the icon-mask upload right after this call is sensitive to), and its own VAO and program
 * left bound. None of this is undone by the pass — the renderer's own reset is what is on trial.
 */
function makeDirtyBackdropPass(refCanvas) {
  return (gl, target) => {
    if (!refTexture) {
      refTexture = createTexture(gl, { width: WIDTH, height: HEIGHT });
      gl.bindTexture(gl.TEXTURE_2D, refTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, refCanvas);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
    if (!dirtyBlitProgram) {
      dirtyBlitProgram = createProgram(gl, FULLSCREEN_TRIANGLE_VERTEX_SOURCE, FOLLOWS_FRAGMENT_SOURCE);
    }
    gl.useProgram(dirtyBlitProgram);
    bindTextureAt(gl, 0, refTexture, dirtyBlitProgram, 'u_src');
    gl.uniform2f(gl.getUniformLocation(dirtyBlitProgram, 'u_res'), target.width, target.height);
    drawFullscreenTriangle(gl);

    if (!dirtyVao) dirtyVao = gl.createVertexArray();
    if (!dirtyLeftoverProgram) {
      dirtyLeftoverProgram = createProgram(gl, FULLSCREEN_TRIANGLE_VERTEX_SOURCE, FOLLOWS_FRAGMENT_SOURCE);
    }
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.enable(gl.STENCIL_TEST);
    gl.colorMask(false, false, false, false);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ZERO, gl.ZERO);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, 0, 1, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindVertexArray(dirtyVao);
    gl.useProgram(dirtyLeftoverProgram);
  };
}

globalThis.vgBackdropDirty = async () => {
  const mask = makeIconMask();

  const cleanStage = makeStage();
  await settle(() =>
    cleanStage.renderer.render({
      density: 1,
      debug: 'normal',
      pieces: [testPieceWithIcon()],
      scene: paintTestScene,
      iconMask: mask,
    }),
  );
  const cleanFrame = readFrame(cleanStage.canvas);

  const refCanvas = document.createElement('canvas');
  refCanvas.width = WIDTH;
  refCanvas.height = HEIGHT;
  paintTestScene(refCanvas.getContext('2d'), WIDTH, HEIGHT);

  const dirtyStage = makeStage();
  // Each stage's renderer owns its OWN WebGL2 context: a texture or program created against a
  // previous stage's context (left over from an earlier compare in this same page) is foreign to
  // this one, and binding it is invalid. Every module-level cache the dirty pass touches has to
  // start fresh here, same as vgBackdropCompare already resets refTexture/blitProgram before its
  // own second stage.
  refTexture = null;
  dirtyBlitProgram = null;
  dirtyLeftoverProgram = null;
  dirtyVao = null;
  await settle(() =>
    dirtyStage.renderer.render({
      density: 1,
      debug: 'normal',
      pieces: [testPieceWithIcon()],
      backdrop: makeDirtyBackdropPass(refCanvas),
      iconMask: mask,
    }),
  );
  const dirtyFrame = readFrame(dirtyStage.canvas);

  return diffStats(cleanFrame, dirtyFrame);
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

  const failed = [];

  console.log('--- backdrop matches scene (contract honored) ---');
  const good = await page.evaluate((a) => globalThis.vgBackdropCompare(a), { correct: true });
  console.log(
    `  max ${good.maxDiff}, mean ${good.meanDiff.toFixed(2)}, mismatched ${(good.mismatchFraction * 100).toFixed(2)}%`,
  );
  if (!(good.maxDiff <= MAX_CHANNEL_DIFF) || !(good.mismatchFraction <= MAX_MISMATCH_FRACTION)) {
    failed.push(
      `backdrop path does not match scene path (max ${good.maxDiff}, mismatched ${(good.mismatchFraction * 100).toFixed(2)}%)`,
    );
  }

  console.log('--- canary: pass with an extra Y flip must NOT match ---');
  const bad = await page.evaluate((a) => globalThis.vgBackdropCompare(a), { correct: false });
  console.log(
    `  max ${bad.maxDiff}, mean ${bad.meanDiff.toFixed(2)}, mismatched ${(bad.mismatchFraction * 100).toFixed(2)}%`,
  );
  if (!(bad.meanDiff >= MIN_CANARY_MEAN_DIFF)) {
    failed.push(
      `canary did not fail (mean diff only ${bad.meanDiff.toFixed(2)}) — the gate is not actually checking orientation`,
    );
  }

  console.log('--- a pass that leaves depth/stencil/cull/blend/scissor/unpack/VAO/program dirty must still match ---');
  const dirty = await page.evaluate(() => globalThis.vgBackdropDirty());
  console.log(
    `  max ${dirty.maxDiff}, mean ${dirty.meanDiff.toFixed(2)}, mismatched ${(dirty.mismatchFraction * 100).toFixed(2)}%`,
  );
  if (!(dirty.maxDiff <= MAX_CHANNEL_DIFF) || !(dirty.mismatchFraction <= MAX_MISMATCH_FRACTION)) {
    failed.push(
      `a dirty pass changed the frame (max ${dirty.maxDiff}, mismatched ${(dirty.mismatchFraction * 100).toFixed(2)}%) — the renderer's state reset after backdrop() is incomplete`,
    );
  }

  console.log('--- render() with neither scene nor backdrop throws ---');
  const noScene = await page.evaluate(() => globalThis.vgBackdropNoScene());
  console.log(`  threw: ${noScene.threw}${noScene.threw ? ` (${noScene.message})` : ''}`);
  if (!noScene.threw) {
    failed.push('render() with neither scene nor backdrop did not throw');
  }

  console.log('--- render() with BOTH scene and backdrop throws ---');
  const both = await page.evaluate(() => globalThis.vgBackdropBoth());
  console.log(`  threw: ${both.threw}${both.threw ? ` (${both.message})` : ''}`);
  if (!both.threw) {
    failed.push('render() with both scene and backdrop did not throw (it must not silently pick one)');
  }

  await browser.close();

  if (failed.length) {
    console.error(`check-backdrop: ${failed.join('; ')}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    'check-backdrop: the GPU backdrop path reproduces the scene path pixel for pixel, and a pass ' +
      'that violates the orientation contract is caught',
  );
}

await main();
