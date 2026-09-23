// The web lab's WebGL2 pipeline (per the Phase 3 plan; web-core spec §5). Four passes, and the
// ordering and layer split deliberately mirror Android — the lens and the surface are NOT
// collapsed into one pass, otherwise the lab stops predicting the phone (there they're two
// separate layers):
//
//   1. backdrop                 — fills the `content` texture one of two ways: `scene` rasterizes
//                                 into an offscreen 2D canvas (text and cover art are easier there
//                                 than in GL) and uploads it via `texSubImage2D`; `backdrop` draws
//                                 straight into `content` with its own GPU pass instead, no canvas,
//                                 no readback (see `VireGlassBackdropPass`). Either way the texture
//                                 plays the role of the spec's FBO(scene): later passes only SAMPLE
//                                 it, never redraw it.
//   2. blit backdrop to screen  — `content` is drawn as the backing; without it the screen would
//                                 show only the element, and the material is compared against
//                                 exactly what's around it.
//   3. downsample (`probe.ts`)  — stats for the lens rectangle, see there.
//   4. lens (`toGLSL(LENS_SHADER)`)      — samples `content`, draws over the backdrop.
//   5. surface (`toGLSL(SURFACE_SHADER)`) — bevel and highlight over the lens.
//
// UNITS. Everything is device-px, one coordinate space for the whole canvas (web-core spec
// §4.2): `toLensProps` already multiplies by `density`; `toSurfaceUniforms` doesn't and
// shouldn't (its contract is shared with Android), so its result gets run through
// `toDeviceSurfaceUniforms`.
//
// SHARED CENTER. On Android the lens and the surface live in THEIR OWN local spaces (different
// `lensPadDp`/`surfacePadDp` margins), and concentricity is a convention the component
// maintains. Here both shaders get screen coordinates directly (`gl_FragCoord`), so the only way
// to align them is to pass the exact SAME `u_center` in canvas pixels to both: the lens gets it
// as-is (a native uniform), the surface gets it substituted in place of the adapter's own value
// (which is only meaningful in its own local canvas, which doesn't exist here).
import {
  DYNAMIC_UNIFORMS,
  ICON_UNIFORMS,
  OVERLAY_UNIFORMS,
  toLensProps,
  toDeviceSurfaceUniforms,
  toSurfaceUniforms,
  type VireGlassAccent,
  type VireGlassMorph,
  type VireGlassTouch,
} from '../adapters';
import { lensPadDp, shadowOpacity, surfacePadDp, type VireGlassGeometry } from '../geometry';
import { LENS_SHADER } from '../lens-shader';
import type { VireGlassDebugMode, VireGlassOptics } from '../material';
import { SURFACE_SHADER } from '../surface-shader';
import { toGLSL } from '../targets/glsl';
import {
  bindTextureAt,
  createFramebuffer,
  createProgram,
  createTexture,
  drawFullscreenTriangle,
  FULLSCREEN_TRIANGLE_VERTEX_SOURCE,
  locationCache,
  setUniform,
  type UniformValue,
} from './gl';
import { createGpuTimer } from './gpu-timer';
import { createProbe, type ProbeStats } from './probe';

/** The scene draws itself with an offset: the lenses in the frame stay put while the canvas
 *  underneath them slides — only this way can you actually see what refraction does to whatever
 *  passes under the element. Offset in device-px. */
export type VireGlassSceneDrawer = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  offsetX: number,
  offsetY: number,
  /** Pixels per dp — the same value used for elements. The canvas and the glass must live at the
   *  same scale: as a fraction of canvas width, a cell on desktop came out five times larger than
   *  on a phone, and an element of the same size looked completely different on the lab bench
   *  than on a device. */
  density: number,
) => void;

/** The target a `VireGlassBackdropPass` must finish its frame in — the FBO wraps `contentTexture`
 *  itself, so drawing into it needs no readback: the very texture the lens samples gets the pixels
 *  directly. */
export type VireGlassBackdropTarget = {
  /** Owned by the renderer — the FBO wrapping `contentTexture` itself, recreated on `resize` and
   *  freed in `destroy`. The pass must not delete it, and must not hold onto it past the call:
   *  the object may be gone or pointing at a different texture by the next `render()`. */
  framebuffer: WebGLFramebuffer;
  width: number;
  height: number;
};

/**
 * Alternative to `scene`: draws the backdrop with a GPU pass, in this same WebGL2 context, straight
 * into the texture the lens samples — no offscreen 2D canvas, no `texSubImage2D` readback. The
 * renderer doesn't know or care what's drawn; a fluid sim, a video frame, anything that ends up as
 * pixels.
 *
 * ORIENTATION CONTRACT. `contentTexture` carries the same layout the `scene` path has always
 * produced: uploaded from a 2D canvas without a Y flip, so texel row 0 (`v≈0`) is the scene's TOP
 * row (see `BLIT_FRAGMENT_SOURCE` below) — and that row sits at `gl_FragCoord.y = 0` in this FBO,
 * the window-coordinate BOTTOM, not the top. A pass that copies an ordinary top-row-first image
 * (one loaded the normal way, via `texImage2D` from a canvas or an `<img>`) straight across with
 * `texture(src, gl_FragCoord.xy / vec2(target.width, target.height))` reproduces it correctly,
 * with no flip of its own. A pass that instead treats INCREASING y as its own "up" — the natural
 * convention for a physical simulation — must flip before this final write, or its top ends up
 * stored as the scene's bottom and appears upside down once the lens samples it.
 *
 * The pass may render through as many of its own FBOs first as it likes (a multi-step simulation)
 * and leave the GL context in whatever state suits it; it must finish by drawing into
 * `target.framebuffer` at `viewport(0, 0, target.width, target.height)`. The renderer puts back
 * every piece of state its own remaining steps depend on right after — framebuffer, viewport,
 * blend, scissor, depth/stencil/cull, the vertex array binding, the active texture unit, and the
 * `UNPACK_*` pixel-store flags used to upload `iconMask`/`colorLayer` — so the pass is free to
 * change any of it without arranging its own cleanup.
 */
export type VireGlassBackdropPass = (
  gl: WebGL2RenderingContext,
  target: VireGlassBackdropTarget,
) => void;

/** One glass element in the frame. Each has its own material — that's how they're compared side by side. */
export type VireGlassPiece = {
  optics: VireGlassOptics;
  geometry: VireGlassGeometry;
  /** Element center in CANVAS PIXELS (device-px). Shared between the lens and the surface. */
  centerX: number;
  centerY: number;
  morph?: VireGlassMorph;
  /** Third shape of the same body: breaking the element into pieces uses two bridges. */
  morph2?: VireGlassMorph;
  /** Local finger response: touch point, drag, press, wave. */
  touch?: VireGlassTouch;
  /** Press response, 0…1 — the highlight blooms, the body thickens slightly. */
  press?: number;
  /** Element under the finger, 0…1 — a stronger highlight and rim light. */
  active?: number;
  /** Played fraction, 0…1: an active state expressed as a field. Omitted means no progress. */
  progress?: number;
  /** Whether to draw the icon from the frame's shared mask on this element (see `iconMask` in the frame options). */
  icon?: boolean;
  /** Whether to draw the frame's colored layer on this element (see `colorLayer`). */
  overlay?: boolean;
  /** Icon color at rest and in the active state, RGBA 0…1. */
  inkIdle?: readonly number[];
  inkActive?: readonly number[];
  /** Key light direction in screen space; defaults to the light at rest. */
  light?: readonly [number, number];
  /** 0…1: the element appearing as the lens builds up (M 2:55). */
  appear?: number;
  /** 0 — the element sinks in under the finger, 1 — it rises into glass (reference §5). */
  lift?: number;
  /** Tint for the primary action — colored glass, not a fill. */
  accent?: VireGlassAccent;
};

export type VireGlassRenderOptions = {
  /** `devicePixelRatio` — passed as an argument rather than read globally, so the renderer stays
   *  testable and isn't tied to a specific window. */
  density: number;
  debug: VireGlassDebugMode;
  pieces: readonly VireGlassPiece[];
  /** CPU-side backdrop: draws into an offscreen 2D canvas, uploaded via `texSubImage2D`. Exactly
   *  one of `scene`/`backdrop` is required — `render()` throws if both or neither are given — see
   *  `backdrop` for the GPU alternative. */
  scene?: VireGlassSceneDrawer;
  /** GPU-side backdrop: draws straight into the texture the lens samples, in this context, no
   *  readback. Exactly one of `scene`/`backdrop` is required — see `VireGlassBackdropPass` for the
   *  orientation contract it must honor. */
  backdrop?: VireGlassBackdropPass | null;
  /** Canvas offset under stationary elements, device-px. */
  offsetX?: number;
  offsetY?: number;
  /**
   * Ink mask the size of the canvas, screen coordinates, read from the GREEN channel. White on
   * BLACK: antialiasing has to live in color, not alpha, otherwise green holds at one all the way
   * to the edge inside a stroke and the icon's edges tear.
   *
   * The mask does NOT carry and must not carry a calm backing under the ink: that's a property of
   * the material itself (`legibility`), the same across the whole element. While the app used to
   * supply that backing, one element had it and another didn't, with nothing to explain the
   * difference.
   */
  iconMask?: TexImageSource | null;
  /**
   * App-colored layer the size of the canvas, screen coordinates: cover art, a thumbnail —
   * anything the app puts ON the glass in color. Separate from the ink mask, because that one
   * carries a single channel colored by polarity, while this one has its own color.
   *
   * Drawn INSIDE the material, at the same coordinate as the ink: only this way does the
   * surface's deformation carry them together. As a separate layer on top of the glass, text used
   * to shake on press while the cover art stayed put.
   */
  colorLayer?: TexImageSource | null;
};

export type VireGlassRenderResult = {
  /** One backdrop sample per element, in the same order as `pieces`. */
  probes: readonly (ProbeStats | null)[];
};

export type VireGlassRenderer = {
  resize(widthPx: number, heightPx: number): void;
  render(options: VireGlassRenderOptions): VireGlassRenderResult;
  /** GPU time of the last `render()` call, milliseconds, via
   *  `EXT_disjoint_timer_query_webgl2`. `null` when the extension is unavailable or the sample
   *  came back disjoint — never an error either way. */
  getLastGpuMs(): number | null;
  destroy(): void;
};

const BLIT_FRAGMENT_SOURCE = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform sampler2D u_content;
uniform vec2 u_resolution;
void main() {
  // The same Y flip the transpiler does for the lens/surface (targets/glsl.ts): content is
  // uploaded from the 2D canvas WITHOUT flipping, so its V=0 is the scene's top row. This keeps
  // the same order here, otherwise the backdrop and what the lens refracts through it drift
  // apart vertically.
  vec2 uv = gl_FragCoord.xy / u_resolution;
  uv.y = 1.0 - uv.y;
  fragColor = texture(u_content, uv);
}
`;

/** The material arrives as ONE channel (web-core spec §4, "Uniform contract"): name/size/value
 *  as three parallel arrays — exactly the layout that used to get lost with Android Props. */
function applyChannel(
  gl: WebGL2RenderingContext,
  get: (name: string) => WebGLUniformLocation | null,
  names: readonly string[],
  sizes: readonly number[],
  values: readonly number[],
): void {
  let cursor = 0;
  for (let i = 0; i < names.length; i += 1) {
    const size = sizes[i];
    setUniform(gl, get(names[i]), values.slice(cursor, cursor + size));
    cursor += size;
  }
}

function applyObject(
  gl: WebGL2RenderingContext,
  get: (name: string) => WebGLUniformLocation | null,
  values: Record<string, UniformValue>,
): void {
  for (const name of Object.keys(values)) setUniform(gl, get(name), values[name]);
}

export function createVireGlassRenderer(canvas: HTMLCanvasElement): VireGlassRenderer {
  const context = canvas.getContext('webgl2', {
    preserveDrawingBuffer: true,
    alpha: false,
    antialias: false,
  });
  if (!context) throw new Error('vireglass/web: WebGL2 unavailable');
  // Explicit non-nullable typing — otherwise the `!context` narrowing doesn't survive the
  // closures of the nested `function resize/render/destroy` below, and tsc goes back to treating
  // `gl` as `WebGL2RenderingContext | null`.
  const gl: WebGL2RenderingContext = context;

  const blitProgram = createProgram(gl, FULLSCREEN_TRIANGLE_VERTEX_SOURCE, BLIT_FRAGMENT_SOURCE);
  const lensProgram = createProgram(gl, FULLSCREEN_TRIANGLE_VERTEX_SOURCE, toGLSL(LENS_SHADER));
  const surfaceProgram = createProgram(
    gl,
    FULLSCREEN_TRIANGLE_VERTEX_SOURCE,
    toGLSL(SURFACE_SHADER),
  );
  const probe = createProbe(gl, FULLSCREEN_TRIANGLE_VERTEX_SOURCE);

  const blitLoc = locationCache(gl, blitProgram);
  const lensLoc = locationCache(gl, lensProgram);
  const surfaceLoc = locationCache(gl, surfaceProgram);

  let width = canvas.width;
  let height = canvas.height;

  let sceneCanvas = document.createElement('canvas');
  let sceneCtx = sceneCanvas.getContext('2d');
  if (!sceneCtx) throw new Error('vireglass/web: scene 2D context unavailable');

  // Smoothed backdrop estimate per element: keyed by its position in the pieces list.
  const settled = new Map<number, ProbeStats>();
  /** Fraction of the new sample per frame. Same magnitude as SETTLE on Android. */
  const SETTLE = 0.12;

  function settleStats(index: number, fresh: ProbeStats): ProbeStats {
    const prev = settled.get(index);
    if (!prev) {
      settled.set(index, fresh);
      return fresh;
    }
    const mix = (a: number, b: number) => a + (b - a) * SETTLE;
    const next: ProbeStats = {
      luma: mix(prev.luma, fresh.luma),
      busy: mix(prev.busy, fresh.busy),
      lo: mix(prev.lo, fresh.lo),
      hi: mix(prev.hi, fresh.hi),
      slopeX: mix(prev.slopeX, fresh.slopeX),
      slopeY: mix(prev.slopeY, fresh.slopeY),
      r: mix(prev.r, fresh.r),
      g: mix(prev.g, fresh.g),
      b: mix(prev.b, fresh.b),
    };
    settled.set(index, next);
    return next;
  }

  let contentTexture = createTexture(gl, {
    width: Math.max(width, 1),
    height: Math.max(height, 1),
  });

  // FBO for the `backdrop` path, wrapping `contentTexture` itself — lazy, so a `scene`-only
  // caller never pays for it. Stale after `resize` (it points at a texture that's about to be
  // deleted); dropped there and rebuilt against the new one on next use.
  let backdropFbo: WebGLFramebuffer | null = null;
  function ensureBackdropFbo(): WebGLFramebuffer {
    if (!backdropFbo) backdropFbo = createFramebuffer(gl, contentTexture);
    return backdropFbo;
  }

  // GPU timing for `getLastGpuMs()` — the ring buffer and disjoint handling live in
  // `gpu-timer.ts`, isolated so they can be unit-tested against a fake (this extension is
  // unavailable in the headless Chromium the shader gates run in).
  const gpuTimer = createGpuTimer(gl);

  // The icon mask is ONE per frame, the size of the canvas. The shader samples it at the pixel's
  // screen coordinate (`u_center + p` is exactly `xy`), so each element's icon is simply drawn
  // into the mask at its own spot: no separate texture per button is needed here.
  const iconTexture = createTexture(gl, { width: 1, height: 1 });
  const colorTexture = createTexture(gl, { width: 1, height: 1 });
  gl.bindTexture(gl.TEXTURE_2D, iconTexture);
  gl.texSubImage2D(
    gl.TEXTURE_2D,
    0,
    0,
    0,
    1,
    1,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([0, 0, 0, 0]),
  );
  gl.bindTexture(gl.TEXTURE_2D, null);

  function resize(widthPx: number, heightPx: number): void {
    width = Math.max(1, Math.round(widthPx));
    height = Math.max(1, Math.round(heightPx));
    canvas.width = width;
    canvas.height = height;
    gl.viewport(0, 0, width, height);

    sceneCanvas = document.createElement('canvas');
    sceneCanvas.width = width;
    sceneCanvas.height = height;
    sceneCtx = sceneCanvas.getContext('2d');
    if (!sceneCtx) throw new Error('vireglass/web: scene 2D context unavailable');

    gl.deleteTexture(contentTexture);
    contentTexture = createTexture(gl, { width, height });

    if (backdropFbo) {
      gl.deleteFramebuffer(backdropFbo);
      backdropFbo = null;
    }
  }

  function render(options: VireGlassRenderOptions): VireGlassRenderResult {
    if (!sceneCtx) throw new Error('vireglass/web: renderer not initialized (resize was never called)');
    // Narrowed once, before the timed section: a `let` read from inside the closure below would
    // widen back to `| null`, since TS cannot see that nothing reassigns it in between.
    const ctx = sceneCtx;

    // Validated BEFORE the GPU timer starts, not inside it: a bad call here has to throw cleanly
    // with no query left open, which an error thrown mid-timing would risk.
    if (options.backdrop && options.scene) {
      throw new Error(
        'vireglass/web: render() needs exactly one of options.scene or options.backdrop, not both',
      );
    }
    if (!options.backdrop && !options.scene) {
      throw new Error('vireglass/web: render() needs either options.scene or options.backdrop');
    }

    // The rest of the frame, including a caller-supplied `backdrop` pass that may itself throw
    // (a shader typo, a bad uniform), runs inside `time`'s own try/finally — `endQuery` always
    // pairs with `beginQuery` no matter how this exits.
    return gpuTimer.time((): VireGlassRenderResult => {
      // 1. Backdrop. Exactly one of two paths fills `contentTexture` — everything after this only
      // SAMPLES it, never redraws it.
      if (options.backdrop) {
        // GPU pass, straight into `contentTexture` via its own FBO: no 2D canvas, no readback. See
        // `VireGlassBackdropPass` for the orientation contract the pass has to honor.
        const fbo = ensureBackdropFbo();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.viewport(0, 0, width, height);
        options.backdrop(gl, { framebuffer: fbo, width, height });
        // The pass is free to leave the context in ANY state (per its own JSDoc) — put back
        // everything the rest of this render depends on, not just the obvious framebuffer/
        // viewport pair: a pass that enables depth/stencil/face culling, binds its own VAO, or
        // changes the unpack flags used to upload `iconMask`/`colorLayer` just below would
        // otherwise corrupt a step it never touched directly.
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, width, height);
        gl.disable(gl.BLEND);
        gl.disable(gl.SCISSOR_TEST);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);
        gl.disable(gl.STENCIL_TEST);
        gl.colorMask(true, true, true, true);
        gl.depthMask(true);
        gl.bindVertexArray(null);
        gl.activeTexture(gl.TEXTURE0);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
      } else {
        // CPU-side: a 2D canvas is easier for text and "cover art" (task, item 3), and the texture
        // itself plays the role of the plan's FBO(scene).
        ctx.clearRect(0, 0, width, height);
        options.scene?.(ctx, width, height, options.offsetX ?? 0, options.offsetY ?? 0, options.density);
        gl.bindTexture(gl.TEXTURE_2D, contentTexture);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, sceneCanvas);
        gl.bindTexture(gl.TEXTURE_2D, null);
      }

      if (options.colorLayer) {
        gl.bindTexture(gl.TEXTURE_2D, colorTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, options.colorLayer);
      }
      if (options.iconMask) {
        gl.bindTexture(gl.TEXTURE_2D, iconTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, options.iconMask);
        gl.bindTexture(gl.TEXTURE_2D, null);
      }

      // 2. Backdrop to screen — the backing the element is seen against.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, width, height);
      gl.disable(gl.BLEND);
      gl.disable(gl.SCISSOR_TEST);
      gl.useProgram(blitProgram);
      bindTextureAt(gl, 0, contentTexture, blitProgram, 'u_content');
      setUniform(gl, blitLoc('u_resolution'), [width, height]);
      drawFullscreenTriangle(gl);

      const probes: (ProbeStats | null)[] = [];

      for (let index = 0; index < options.pieces.length; index += 1) {
        const piece = options.pieces[index];

        // 3. Downsample + stats for the rectangle of VISIBLE glass (no lens/surface margins — the
        // same `glassWidth`/`glassHeight` that go into toLensProps). Only the first element
        // captures the grid: it's shared for the frame, the rest just need their own rectangle out
        // of it.
        const halfWidth = (piece.geometry.width * options.density) / 2;
        const halfHeight = (piece.geometry.height * options.density) / 2;
        const rect = {
          centerX: piece.centerX,
          centerY: piece.centerY,
          halfWidth,
          halfHeight,
        };
        const fresh =
          index === 0
            ? probe.sample(contentTexture, width, height, rect)
            : probe.statsFor(width, height, rect);
        // The backdrop estimate eases toward the new value instead of jumping to it. On Android
        // the native view does this (`GlassLensView.kt`, a per-frame SETTLE); nobody did it on the
        // web: under a moving canvas, body density used to jerk with the instantaneous sample, and
        // on screen that read as lighting artifacts.
        const stats = fresh ? settleStats(index, fresh) : null;
        probes.push(stats);
        // Restore the viewport and the content texture binding — the probe pass reuses TEXTURE0
        // and its own FBO, unbinds them itself, but does change the viewport.
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, width, height);

        gl.enable(gl.BLEND);
        // Premultiplied-over: both the lens and the surface emit premultiplied alpha (see `return
        // half4(half3(...) * alpha, alpha)` in both shaders).
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

        // Both passes draw a fullscreen triangle, but the element covers only a small part of the
        // frame: without scissoring, a row of samples multiplies cost by the number of elements (on
        // a headless software renderer this pushed a frame into seconds). Margin is added on both
        // sides — the shadow, bevel and light gathering all reach past the element's own bounds.
        // The morph drop travels past the element's bounds — its travel is part of the margin,
        // otherwise scissoring would cut off the tail right where it matters.
        const reachOf = (m?: VireGlassMorph) =>
          m ? Math.hypot(m.offsetX, m.offsetY) + Math.max(m.width, m.height) / 2 + m.smoothing : 0;
        const morphReach = Math.max(reachOf(piece.morph), reachOf(piece.morph2));
        // Field deformation pushes the element's edge past its own bounds — drag, wave amplitude
        // and growth on press. Without this term, scissoring cuts off exactly the part being
        // dragged toward.
        const touchReach = piece.touch
          ? Math.hypot(piece.touch.pullX, piece.touch.pullY) +
            piece.touch.waveAmp * 2 +
            Math.max(piece.geometry.width, piece.geometry.height) * 0.05 * piece.touch.press
          : 0;
        const padPx =
          (lensPadDp(piece.geometry, piece.optics) + surfacePadDp(piece.geometry, 0) + morphReach + touchReach) *
          options.density;
        const left = Math.max(0, Math.floor(piece.centerX - halfWidth - padPx));
        const right = Math.min(width, Math.ceil(piece.centerX + halfWidth + padPx));
        const top = Math.max(0, Math.floor(height - (piece.centerY + halfHeight + padPx)));
        const bottom = Math.min(height, Math.ceil(height - (piece.centerY - halfHeight - padPx)));
        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(left, top, Math.max(0, right - left), Math.max(0, bottom - top));

        // 4. Lens.
        gl.useProgram(lensProgram);
        bindTextureAt(gl, 0, contentTexture, lensProgram, 'content');
        setUniform(gl, lensLoc('u_contentSize'), [width, height]);
        setUniform(gl, lensLoc('u_resolution'), [width, height]);
        setUniform(gl, lensLoc('u_center'), [piece.centerX, piece.centerY]);
        // There's no local-view margin here (one shared coordinate space) — on Android `u_reach`
        // capped adaptive-blur gathering at the edge of the lens view's PADDING; there's no such
        // boundary here, so the value is chosen deliberately larger than any real gather radius, so
        // the `reach - length(p)` condition never triggers before `u_contentMin/Max` does.
        setUniform(gl, lensLoc('u_reach'), Math.max(width, height));
        setUniform(gl, lensLoc('u_contentMin'), [1, 1]);
        setUniform(gl, lensLoc('u_contentMax'), [width - 1, height - 1]);
        if (stats) {
          setUniform(gl, lensLoc('u_probeLuma'), stats.luma);
          setUniform(gl, lensLoc('u_probeBusy'), stats.busy);
          setUniform(gl, lensLoc('u_probeRange'), [stats.lo, stats.hi]);
          setUniform(gl, lensLoc('u_probeSlope'), [stats.slopeX, stats.slopeY]);
          setUniform(gl, lensLoc('u_probe'), [stats.r, stats.g, stats.b]);
        } else {
          // The probe hasn't reported yet (the first frame or two) — the -1 sentinel keeps the
          // shader on its own point samples (see the comment in `lens-shader.ts`).
          setUniform(gl, lensLoc('u_probeLuma'), -1);
        }
        const lens = toLensProps(piece.optics, piece.geometry, options.density, {
          debug: options.debug,
          morph: piece.morph,
          morph2: piece.morph2,
          touch: piece.touch,
          progress: piece.progress,
          light: piece.light,
          appear: piece.appear,
          accent: piece.accent,
        });
        applyChannel(gl, lensLoc, lens.uniformNames, lens.uniformSizes, lens.uniformValues);
        drawFullscreenTriangle(gl);

        // 5. Surface — shares its center with the lens (see the comment at the top of this file).
        // `toSurfaceUniforms`'s contract is dp, shared with Android; the core converts it to pixels.
        gl.useProgram(surfaceProgram);
        const rawSurface = toSurfaceUniforms(piece.optics, piece.geometry, {
          debug: options.debug,
          morph: piece.morph,
          morph2: piece.morph2,
          bodyInLens: true,
          touch: piece.touch,
          progress: piece.progress,
          // The shadow is denser over text, weaker over a flat backdrop (M 11:47). The rule lives
          // in the core: while it lived here, Android didn't have it at all.
          shadow: stats ? shadowOpacity(stats.busy) : 1,
          // The probe has already computed the ambient color — the shadow gets it for free. Taken
          // as-is: `settleStats` has already smoothed it, and rounding would bring back exactly the
          // steps the smoothing was written to remove.
          ambient: stats ? ([stats.r, stats.g, stats.b] as const) : undefined,
          appear: piece.appear,
          lift: piece.lift,
        });
        // The dp → device pixel conversion lives in the core (`toDeviceSurfaceUniforms`): one list
        // of lengths for every field, so a new field can't be forgotten here by oversight.
        applyObject(gl, surfaceLoc, {
          ...toDeviceSurfaceUniforms(rawSurface, options.density),
          u_center: [piece.centerX, piece.centerY],
        });
        // What's worklet dynamics on Android (press, active, tilt) arrives here as fields on the element.
        setUniform(gl, surfaceLoc(DYNAMIC_UNIFORMS[0]), piece.press ?? 0);
        setUniform(gl, surfaceLoc(DYNAMIC_UNIFORMS[1]), piece.active ?? 0);
        const hasIcon = Boolean(piece.icon && options.iconMask);
        setUniform(gl, surfaceLoc(ICON_UNIFORMS[0]), hasIcon ? 1 : 0);
        // Scale 1: the coordinate is already in screen space, the sampler itself normalizes by size.
        setUniform(gl, surfaceLoc(ICON_UNIFORMS[1]), 1);
        setUniform(gl, surfaceLoc(ICON_UNIFORMS[2]), piece.inkIdle ?? [1, 1, 1, 1]);
        setUniform(gl, surfaceLoc(ICON_UNIFORMS[3]), piece.inkActive ?? [1, 1, 1, 1]);
        bindTextureAt(gl, 1, iconTexture, surfaceProgram, 'u_icon');
        setUniform(gl, surfaceLoc('u_iconSize'), hasIcon ? [width, height] : [1, 1]);
        const hasColor = Boolean(piece.overlay && options.colorLayer);
        setUniform(gl, surfaceLoc(OVERLAY_UNIFORMS[0]), hasColor ? 1 : 0);
        bindTextureAt(gl, 2, colorTexture, surfaceProgram, 'u_overlay');
        setUniform(gl, surfaceLoc('u_overlaySize'), hasColor ? [width, height] : [1, 1]);
        setUniform(gl, surfaceLoc('u_resolution'), [width, height]);
        drawFullscreenTriangle(gl);
      }
      gl.disable(gl.SCISSOR_TEST);

      return { probes };
    });
  }

  function destroy(): void {
    probe.destroy();
    gl.deleteProgram(blitProgram);
    gl.deleteProgram(lensProgram);
    gl.deleteProgram(surfaceProgram);
    gl.deleteTexture(contentTexture);
    gl.deleteTexture(iconTexture);
    gl.deleteTexture(colorTexture);
    if (backdropFbo) gl.deleteFramebuffer(backdropFbo);
    gpuTimer.destroy();
  }

  return { resize, render, getLastGpuMs: gpuTimer.getLastMs, destroy };
}
