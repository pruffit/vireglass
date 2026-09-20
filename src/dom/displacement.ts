// The DOM renderer's own optics: an `feDisplacementMap` source built from the same causes as the
// GL/AGSL shaders, so a page refracting live content still reads as the same material. See
// `docs/superpowers/specs/2026-09-19-vireglass-over-live-dom.md` for the technique this encodes.
import { bevelDp, thicknessDp, type VireGlassGeometry } from '../geometry';
import { BEVEL } from '../law';
import type { VireGlassOptics } from '../material';
import {
  sceneDistance,
  sceneGradient,
  touchWarp,
  type MorphShape,
  type TouchWarp,
} from '../sdf';

export type DisplacementMap = { url: string; width: number; height: number; scale: number };

/** dp of rim displacement per dp of size-adjusted thickness, at full refraction strength (ior →
 *  1.6). Tuned so the product default (V5: ior 1.5, thickness 28dp) lands well under `MAX_SCALE`
 *  before it's ever clamped — the ceiling below is what actually limits denser glass. */
const SCALE_GAIN = 0.75;

/**
 * `feDisplacementMap` displaces by `scale * (channel / 255 - 0.5)`: a full channel swing spans
 * ±scale/2, and one 8-bit step is `scale/255` px — not `scale/127`, which an earlier version of
 * this file assumed and which rendered every material at half its derived refraction.
 *
 * Measured in Chromium on 2026-09-19: at scale 40 (0.157 px/step) a high-contrast edge visibly
 * terraces; at scale 12 (0.047 px/step) it does not. The ceiling sits between them and nearer
 * the clean end — thick, high-index glass is flattened to it instead of its derived scale,
 * trading rim depth for an edge without stairs.
 */
const MAX_STEP_PX = 0.09;
const MAX_SCALE = 255 * MAX_STEP_PX;

/**
 * Samples across the bevel band, which is the only place the map carries anything. Everything
 * inside it is a constant, and `feImage` stretches whatever it is given over the element anyway,
 * so resolving the element is wasted work: a sheet at device resolution is 197 000 pixels of
 * per-pixel maths and a PNG encode, 120 ms on attach and far past a frame during interaction.
 *
 * Eight samples describe a profile that is smooth by construction. The measured cost falls with
 * the square of the reduction, and `check:dom` measures the displacement afterwards to say
 * whether anything was lost.
 */
const BEVEL_SAMPLES = 8;

/** Resolution the map is built at: enough to resolve the bevel, never more than the element. */
function mapDensity(geometry: VireGlassGeometry, bevel: number, dpr: number): number {
  if (bevel <= 0) return dpr;
  return Math.min(dpr, BEVEL_SAMPLES / bevel);
}

/** True neutral is the unrepresentable 127.5; 128 is the nearest byte and leaves a residual
 *  0.002 of the scale, far below one step and below a pixel at any usable scale. */
function encode(displacement: number, scale: number): number {
  const channel = Math.round(255 * (displacement / scale + 0.5));
  return channel < 0 ? 0 : channel > 255 ? 255 : channel;
}

/** Mirrors the shader's `vgBevelSlope`, renormalized into 0..1: curvature concentrated at the
 *  rim, the middle left flat. A plain linear ramp from `vgBevelT` alone reads as a chamfer, not a
 *  lens — the same reason the shader doesn't use it raw either. */
function bevelProfile(t: number): number {
  const raw = Math.min(t / Math.sqrt(Math.max(1 - t * t * BEVEL.sphere, BEVEL.floor)), BEVEL.slopeMax);
  return raw / BEVEL.slopeMax;
}

export type DisplacementState = {
  /** Finger response (docs/reference.md §5): the field around the touch deforms, so the silhouette
   *  the backdrop bends along deforms with it. */
  touch?: TouchWarp;
  /** Smooth-union neighbours (§5): shapes merging into one and splitting apart. */
  smoothing?: number;
  morph?: MorphShape;
  morph2?: MorphShape;
  /** Any number of shapes flowing into this one. `morph`/`morph2` are the first two, kept so a
   *  caller that only ever had two does not have to change. */
  morphs?: readonly MorphShape[];
};

/**
 * The raw pixel buffer, with no canvas involved — the part actually worth unit-testing.
 * `buildDisplacementMap` below is a thin DOM wrapper around this.
 *
 * Encoding: R = x offset, G = y offset, 128 = no shift, one step = `scale/255` px; B = 128
 * (unused), A = 255 (opaque, `feImage` would otherwise composite the map against page black).
 * The offset points INWARD — the rim samples the backdrop from inside the shape, a convex thick
 * lens. Displacement lives only in the bevel band (`bevelDp`); the flat middle is exactly 128/128.
 */
export function renderDisplacementPixels(
  optics: VireGlassOptics,
  geometry: VireGlassGeometry,
  dpr: number,
  state: DisplacementState = {},
): { data: Uint8ClampedArray; width: number; height: number; scale: number } {
  const bevel = bevelDp(geometry, optics);
  const density = mapDensity(geometry, bevel, dpr);
  const width = Math.max(1, Math.round(geometry.width * density));
  const height = Math.max(1, Math.round(geometry.height * density));
  const rawScale = optics.refraction * thicknessDp(geometry, optics) * SCALE_GAIN;
  const scale = Math.min(rawScale, MAX_SCALE);
  const smoothing = state.smoothing ?? 0;
  // One list, whichever way the caller expressed it.
  const shapes: (MorphShape | undefined)[] = [state.morph, state.morph2, ...(state.morphs ?? [])];

  const data = new Uint8ClampedArray(width * height * 4);
  const halfW = geometry.width / 2;
  const halfH = geometry.height / 2;

  for (let py = 0; py < height; py += 1) {
    const y = (py + 0.5) / density - halfH;
    for (let px = 0; px < width; px += 1) {
      const x = (px + 0.5) / density - halfW;
      const i = (py * width + px) * 4;
      // Warp the FIELD first, then read the scene at the warped point — the shader's own order.
      const [wx, wy] = state.touch ? touchWarp(x, y, state.touch) : [x, y];
      const sd = sceneDistance(wx, wy, geometry.width, geometry.height, geometry.cornerRadius, smoothing, ...shapes);
      const t = Math.min(Math.max((sd + bevel) / bevel, 0), 1);
      if (t <= 0 || scale <= 0) {
        data[i] = 128;
        data[i + 1] = 128;
        data[i + 2] = 128;
        data[i + 3] = 255;
        continue;
      }
      const [gx, gy] = sceneGradient(wx, wy, geometry.width, geometry.height, geometry.cornerRadius, smoothing, ...shapes);
      // The rim reaches half the scale: the encoding can only span ±scale/2, so the derived
      // displacement is expressed as a fraction of that half-range.
      const magnitude = bevelProfile(t) * (scale / 2);
      const dx = -gx * magnitude;
      const dy = -gy * magnitude;
      // Inverse of the spec's own formula: channel = 255 * (displacement / scale + 0.5).
      data[i] = encode(dx, scale);
      data[i + 1] = encode(dy, scale);
      data[i + 2] = 128;
      data[i + 3] = 255;
    }
  }

  return { data, width, height, scale };
}

function hasCanvasSupport(): boolean {
  return typeof document !== 'undefined' && typeof document.createElement === 'function';
}

/** Builds the map at device-pixel resolution so it stays sharp once the browser stretches it back
 *  over the element's CSS-px box (`feImage` fills the filter region regardless of source size). */
export function buildDisplacementMap(
  optics: VireGlassOptics,
  geometry: VireGlassGeometry,
  dpr: number,
  state: DisplacementState = {},
): DisplacementMap {
  if (!hasCanvasSupport()) {
    throw new Error('vireglass/dom: buildDisplacementMap requires a DOM (canvas)');
  }
  const { data, width, height, scale } = renderDisplacementPixels(optics, geometry, dpr, state);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('vireglass/dom: 2D canvas context unavailable');
  const imageData = ctx.createImageData(width, height);
  imageData.data.set(data);
  ctx.putImageData(imageData, 0, 0);
  return { url: canvas.toDataURL('image/png'), width, height, scale };
}
