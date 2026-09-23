import { ACCENT, MORPH } from './law';
import {
  bevelDp,
  bevelFraction,
  halfMinDp,
  rimDp,
  shadowReachDp,
  surfacePadDp,
  thicknessDp,
  type VireGlassGeometry,
} from './geometry';
import { LENS_SHADER } from './lens-shader';
import { neckToBridge } from './sdf';
import { debugIndex, type VireGlassDebugMode, type VireGlassOptics } from './material';

/** A second shape joined to the element by a smooth union: the geometry that merges and growth
 *  transitions are built on (a capsule drawn into a drop, then grown into its menu). Offsets from
 *  the element's centre and sizes in dp. */
export type VireGlassMorph = {
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  cornerRadius: number;
  /** Seam smoothing radius in dp; 0 turns the second shape off. */
  smoothing: number;
};


/** Surface response to a finger: the field around the touch point deforms, not the shape's
 *  bounding box (`vgTouchWarp` in `sdf.ts`). Lengths in dp; `radius` = 0 turns the response off
 *  entirely. */
export type VireGlassTouch = {
  x: number;
  y: number;
  pullX: number;
  pullY: number;
  press: number;
  radius: number;
  waveAmp: number;
  wavePhase: number;
};

const NO_TOUCH: VireGlassTouch = {
  x: 0, y: 0, pullX: 0, pullY: 0, press: 0, radius: 0, waveAmp: 0, wavePhase: 0,
};

const NO_MORPH = { offsetX: 0, offsetY: 0, width: 0, height: 0, cornerRadius: 0, smoothing: 0 };

/** No progress. Negative rather than zero: zero is the start of the track, a legitimate value. */
const NO_PROGRESS = -1;

/** Tinted glass for the primary action (M 16:08). Color is RGB 0…1. */
export type VireGlassAccent = { color: readonly [number, number, number]; amount?: number };

/** Default tint fraction: the color reads, but content beneath it is still visible. */
export const ACCENT_AMOUNT = ACCENT.amount;
const NO_ACCENT = [0, 0, 0, 0] as const;



/** Magnification at the flat center. Kept separate from the uniform channel: it's also used by
 *  the fallback below Android 13, where there's no RuntimeShader and only an affine magnifier is
 *  left. */
export const lensMagnify = (o: VireGlassOptics) => 1 + (o.refractionScale - 1) * o.refraction;

/**
 * Lens uniforms. Assembled as ONE channel: name, size and values travel together, so a mismatch
 * with the shader is caught immediately, with the name right there in the log. There used to be a
 * separate Kotlin `Prop` per value — Expo swallows an unknown prop silently, and the lens simply
 * never turned on (docs/material-lab.md E-01, which is how refraction ended up disabled for an
 * entire phase).
 *
 * Everything with a dimension is converted to PIXELS right here. The native view is left with
 * only the uniforms it alone knows: its own size and its own place on screen.
 */
// The lens's uniform names and sizes are always the same — the set is fixed. They're handed over
// as ONE instance for the whole process: otherwise every frame of a drag would send three dozen
// fresh strings to the native side, React can't tell "unchanged" from "a new array", and motion
// goes stepwise. The values are the only thing that actually changes.
const shapes = new Map<number, { names: string[]; sizes: number[] }>();

function channel(entries: [string, number | readonly number[]][]) {
  const uniformValues: number[] = [];
  let shape = shapes.get(entries.length);
  let same = shape !== undefined;
  for (let i = 0; i < entries.length; i += 1) {
    const [name, value] = entries[i];
    const v = typeof value === 'number' ? [value] : value;
    if (same && (shape!.names[i] !== name || shape!.sizes[i] !== v.length)) same = false;
    for (const x of v) uniformValues.push(x);
  }
  if (!same) {
    shape = {
      names: entries.map((e) => e[0]),
      sizes: entries.map((e) => (typeof e[1] === 'number' ? 1 : e[1].length)),
    };
    shapes.set(entries.length, shape);
  }
  return { uniformNames: shape!.names, uniformSizes: shape!.sizes, uniformValues };
}

/** Props for the native view. Besides the uniform channel, only what the view uses itself lives
 *  here: the shader source and the visible glass's size (the probe rectangle is taken from it). */
export function toLensProps(
  optics: VireGlassOptics,
  geometry: VireGlassGeometry,
  density: number,
  options: {
    debug?: VireGlassDebugMode;
    morph?: VireGlassMorph;
    /** Third shape of the fused body; a zero size turns it off. */
    morph2?: VireGlassMorph;
    groupProbe?: number[];
    touch?: VireGlassTouch;
    /** Progress fraction, 0…1: to the left of the boundary the element is active. `undefined` means no progress. */
    progress?: number;
    /** Key light direction in screen space; defaults to the light at rest. */
    light?: readonly [number, number];
    /** 0…1: the lens builds up as the element appears — instead of a plain fade. */
    appear?: number;
    /** Tint for the primary action: the glass color and the fraction it lays over the content. */
    accent?: VireGlassAccent;
  } = {},
) {
  const morph = options.morph ?? NO_MORPH;
  const morph2 = options.morph2 ?? NO_MORPH;
  const touch = options.touch ?? NO_TOUCH;
  // Backdrop estimate for the whole surface group. Travels through the same channel as the
  // material and applies AFTER the lens's own estimate — that is, it simply overrides it. It
  // can't travel as a separate prop: the lens view is wrapped in an animated component.
  const g = options.groupProbe;
  const group: [string, number | readonly number[]][] =
    g && g.length >= 9
      ? [
          ['u_probeLuma', g[0]],
          ['u_probeBusy', g[1]],
          ['u_probeRange', [g[2], g[3]]],
          ['u_probeSlope', [g[4], g[5]]],
          ['u_probe', [g[6], g[7], g[8]]],
        ]
      : [];
  const d = density;
  const halfW = (geometry.width * d) / 2;
  const halfH = (geometry.height * d) / 2;
  const halfMin = Math.min(halfW, halfH);

  return {
    shaderSource: LENS_SHADER,
    glassWidth: geometry.width,
    glassHeight: geometry.height,
    ...channel([
      ['u_halfSize', [halfW, halfH]],
      ['u_corner', Math.min(geometry.cornerRadius * d, halfMin)],
      ['u_bevel', Math.max(bevelDp(geometry, optics) * d, 1)],
      ['u_thick', thicknessDp(geometry, optics) * d],
      ['u_rim', rimDp(geometry, optics) * d],
      ['u_ior', optics.ior],
      ['u_iorSpread', optics.iorSpread],
      ['u_light', options.light ?? REST_LIGHT],
      ['u_appear', options.appear ?? 1],
      ['u_accent', options.accent ? [...options.accent.color, options.accent.amount ?? ACCENT_AMOUNT] : NO_ACCENT],
      // Haze from surface roughness. Lives in the same disc-gather pass as adaptive scattering,
      // and fades out toward the bevel: that's a different job there — bending the ray and
      // splitting it.
      ['u_frost', optics.blur * d],
      ['u_ink', optics.ink],
      ['u_legibility', optics.legibility],
      ['u_dim', optics.dimming],
      ['u_presence', optics.presence],
      ['u_adaptRadius', optics.adaptRadius * d],
      ['u_bodyDensity', optics.bodyDensity],
      ['u_edgeLight', optics.edgeLight],
      ['u_fresnel', optics.fresnel],
      ['u_specular', optics.specular],
      // The rim gathers light from the element's vicinity — this is a radius around the shape,
      // not its bevel.
      ['u_reflectReach', optics.gatherRadiusDp * d],
      ['u_film', optics.film],
      ['u_iridescence', optics.iridescence],
      ['u_diffraction', optics.diffraction],
      ['u_colorPickup', optics.colorPickup],
      ['u_morphOffset', [morph.offsetX * d, morph.offsetY * d]],
      ['u_morphHalf', [(morph.width * d) / 2, (morph.height * d) / 2]],
      ['u_morphCorner', morph.cornerRadius * d],
      ['u_morphK', morph.smoothing * d],
      ['u_morph2Offset', [morph2.offsetX * d, morph2.offsetY * d]],
      ['u_morph2Half', [(morph2.width * d) / 2, (morph2.height * d) / 2]],
      ['u_morph2Corner', morph2.cornerRadius * d],
      ['u_touch', [touch.x * d, touch.y * d]],
      ['u_pull', [touch.pullX * d, touch.pullY * d]],
      ['u_touchPress', touch.press],
      ['u_touchRadius', touch.radius * d],
      ['u_wave', [touch.waveAmp * d, touch.wavePhase]],
      ['u_progress', options.progress ?? NO_PROGRESS],
      ['u_debug', debugIndex(options.debug ?? 'normal')],
      ...group,
    ]),
  };
}

/** Static part of the surface uniforms. Dynamics (gesture, press, light) get mixed in inside the
 *  component's worklet — the adapter must stay an ordinary function. */
export function toSurfaceUniforms(
  optics: VireGlassOptics,
  geometry: VireGlassGeometry,
  options: {
    debug?: VireGlassDebugMode;
    morph?: VireGlassMorph;
    /** Third shape of the fused body; a zero size turns it off. */
    morph2?: VireGlassMorph;
    dragLimit?: number;
    shadow?: number;
    /** Average ambient color around the element: light from it bleeds into the shadow (reference 219 @8:22). */
    ambient?: readonly [number, number, number];
    /** The lens draws the glass body — the surface is left with the highlight, shadow and icon. */
    bodyInLens?: boolean;
    touch?: VireGlassTouch;
    /** Progress fraction, 0…1: to the left of the boundary the element is active. `undefined` means no progress. */
    progress?: number;
    /** 0…1: the element is appearing — shadow and ink build up together with the lens. */
    appear?: number;
    /** 0 — the element sinks in under the finger, 1 — it rises into glass (reference §5). */
    lift?: number;
  } = {},
) {
  const morph = options.morph ?? NO_MORPH;
  const morph2 = options.morph2 ?? NO_MORPH;
  const touch = options.touch ?? NO_TOUCH;
  const pad = surfacePadDp(geometry, options.dragLimit ?? 0, morph);
  return {
    u_center: [geometry.width / 2 + pad, geometry.height / 2 + pad],
    u_halfSize: [geometry.width / 2, geometry.height / 2],
    u_corner: Math.min(geometry.cornerRadius, halfMinDp(geometry)),
    u_bevel: bevelDp(geometry, optics),
    u_thickness: bevelFraction(geometry, optics),
    u_morphOffset: [morph.offsetX, morph.offsetY],
    u_morphHalf: [morph.width / 2, morph.height / 2],
    u_morphCorner: morph.cornerRadius,
    u_morphK: morph.smoothing,
    u_morph2Offset: [morph2.offsetX, morph2.offsetY],
    u_morph2Half: [morph2.width / 2, morph2.height / 2],
    u_morph2Corner: morph2.cornerRadius,
    u_edgeDensity: optics.edgeDensity,
    u_dispersion: optics.dispersion,
    u_refraction: optics.refraction,
    // Tint density is suppressed when the lens is drawing the body: painting it twice would
    // double the fill, and adaptation is impossible on the surface anyway — it can't see the
    // backdrop. The color itself stays: it drives absorption at the rim.
    u_tint: [
      optics.tint.r,
      optics.tint.g,
      optics.tint.b,
      options.bodyInLens ? 0 : optics.tintStrength,
    ],
    u_shadow: options.shadow ?? 1,
    // Neutral by default: without an ambient sample, the shadow stays exactly as it was.
    u_ambient: options.ambient ?? [0, 0, 0],
    u_shadowReach: shadowReachDp(geometry),
    u_touch: [touch.x, touch.y],
    u_pull: [touch.pullX, touch.pullY],
    u_touchPress: touch.press,
    u_touchRadius: touch.radius,
    u_wave: [touch.waveAmp, touch.wavePhase],
    u_presence: optics.presence,
    u_progress: options.progress ?? NO_PROGRESS,
    u_appear: options.appear ?? 1,
    // Zero by default: buttons sink in, the way every element behaved before this rule existed.
    u_lift: options.lift ?? 0,

    u_debug: debugIndex(options.debug ?? 'normal'),
  };
}

/**
 * Surface fields that are LENGTHS: the adapter's contract is specified in dp, and on the web each
 * one of them has to be multiplied by screen density. The list lives here rather than in the
 * renderer, where it used to be a dozen and a half manual multiplications in a row: a missed
 * field there was only caught by eye, and the miss isn't visible everywhere — at density 1,
 * multiplying is indistinguishable from not doing it.
 */
export type SurfaceUniforms = ReturnType<typeof toSurfaceUniforms>;

export const SURFACE_LENGTH_UNIFORMS = [
  'u_halfSize',
  'u_corner',
  'u_bevel',
  'u_morphOffset',
  'u_morphHalf',
  'u_morphCorner',
  'u_morphK',
  'u_morph2Offset',
  'u_morph2Half',
  'u_morph2Corner',
  'u_shadowReach',
  'u_touch',
  'u_pull',
  'u_touchRadius',
  // `satisfies`, not just `as const`: otherwise a typo in the name compiles silently and makes it
  // to runtime — the field with the garbage name gets NaN, and the real one is left un-multiplied.
] as const satisfies readonly (keyof SurfaceUniforms)[];

/**
 * Surface uniforms in device pixels. Android draws in dp and calls the adapter as-is; the web
 * needs this conversion. `u_center` isn't part of it: the renderer knows the element's center on
 * its own.
 */
export function toDeviceSurfaceUniforms(raw: SurfaceUniforms, density: number): SurfaceUniforms {
  const scaled: Record<string, unknown> = { ...raw };
  for (const key of SURFACE_LENGTH_UNIFORMS) {
    const value: unknown = scaled[key];
    scaled[key] = Array.isArray(value)
      ? (value as number[]).map((v) => v * density)
      : (value as number) * density;
  }
  // Of the wave, only the amplitude has a length; the phase is in turns and knows nothing about density.
  scaled.u_wave = [raw.u_wave[0] * density, raw.u_wave[1]];
  return scaled as SurfaceUniforms;
}

/** Key light direction in screen coordinates, for when the orientation response is off. */
export const REST_LIGHT: readonly [number, number] = [-0.577, -0.817];

/** Uniforms the component mixes in inside the worklet (press, active, light direction) and via
 *  the icon layer. Listed here so a test can check the shader contract's completeness without
 *  importing the component itself (it pulls in Skia and doesn't come up in a node environment). */
export const DYNAMIC_UNIFORMS = ['u_press', 'u_active'] as const;

export const ICON_UNIFORMS = ['u_iconOn', 'u_iconScale', 'u_inkIdle', 'u_inkActive'] as const;

/** App-colored overlay layer on the glass. The `u_overlay` sampler shares its contract with the
 *  ink mask and is sampled at the SAME coordinate — otherwise deformation would carry them apart. */
export const OVERLAY_UNIFORMS = ['u_overlayOn'] as const;

/**
 * Fusing two surfaces into one continuous medium.
 *
 * The second shape is described RELATIVE to the first one's center, because both live in the
 * same shader: the union has no "two pieces of glass," just one body with two bulges — the mask,
 * the refraction and the rim are all computed from a single shared scene.
 *
 * `t` — how fused the shapes are: 0 turns the second shape off before any computation, 1 gives a
 * single shared medium. The seam's smoothing radius is a fraction of the smaller half-size: on
 * large elements the bridge has to be wider, otherwise the seam is left with a sharp corner,
 * which doesn't happen in a liquid.
 */


/**
 * How wide the neck between two lobes has to be: enough to soften the seam on a large element, and
 * enough to actually SPAN whatever is between them. The second term is the one that was missing.
 */
function neckFor(
  half: number,
  aw: number,
  ah: number,
  bw: number,
  bh: number,
  offsetX: number,
  offsetY: number,
): number {
  // Surface-to-surface, measured between the bounding boxes. The rounded corners put the true
  // surfaces slightly further apart, so this errs toward a wider neck, which is the safe side.
  const gx = Math.abs(offsetX) - (aw + bw) / 2;
  const gy = Math.abs(offsetY) - (ah + bh) / 2;
  const gap = Math.hypot(Math.max(gx, 0), Math.max(gy, 0));
  // Capped at the narrowest of the two bodies. A neck wider than what it joins is not a neck, and
  // past that width the honest answer is that these are two things rather than one — a menu that
  // has finished leaving its button, two controls too far apart to be a segmented control. Being
  // separate is a legitimate state; being joined by a blob larger than either shape is not.
  const widest = Math.min(aw, ah, bw, bh);
  return Math.min(Math.max(half * MORPH.neck, neckToBridge(gap) * MORPH.fuse), widest);
}

export function morphBetween(
  a: VireGlassGeometry,
  b: VireGlassGeometry,
  offsetX: number,
  offsetY: number,
  t: number,
): VireGlassMorph | undefined {
  if (t <= 0) return undefined;
  const half = Math.min(halfMinDp(a), halfMinDp(b));
  return {
    offsetX,
    offsetY,
    width: b.width,
    height: b.height,
    cornerRadius: b.cornerRadius,
    smoothing: neckFor(half, a.width, a.height, b.width, b.height, offsetX, offsetY) * Math.min(t, 1),
  };
}

/**
 * MITOSIS: the second shape grows OUT OF the first and travels to its place, instead of appearing
 * beside it at full size. A menu coming out of its button, a control dividing into segments.
 *
 * `morphBetween` is the other half — two shapes that are both already where they belong, fusing
 * into one body — and run backwards it is meiosis, the neck thinning until it breaks. What neither
 * of them may do is pop: at any `t` above zero this returns one continuous body, because that is
 * the whole of what the reference says a material transition is.
 *
 * The choreography stays the host's: what the shapes MEAN is the app's business. How a silhouette
 * emerges from another silhouette is the material's, the same way the spring under a finger is.
 */
export function morphOutOf(
  source: VireGlassGeometry,
  target: VireGlassGeometry,
  offsetX: number,
  offsetY: number,
  t: number,
): VireGlassMorph | undefined {
  if (t <= 0) return undefined;
  const k = Math.min(t, 1);
  // At t = 0 the lobe IS the parent, in the parent's place: the transition starts from one body and
  // never has a first frame in which a second one exists. The parent's own surface is what the neck
  // attaches to, so nothing has to be budded off to give it something to hold.
  const width = source.width + (target.width - source.width) * k;
  const height = source.height + (target.height - source.height) * k;
  const cornerRadius = source.cornerRadius + (target.cornerRadius - source.cornerRadius) * k;
  const half = Math.min(halfMinDp(source), Math.min(width, height) / 2);
  return {
    offsetX: offsetX * k,
    offsetY: offsetY * k,
    width,
    height,
    cornerRadius,
    // The lobe travels as it grows, so the span changes every frame and the neck is measured
    // against where the lobe actually is, not against where it will end up.
    smoothing: neckFor(half, source.width, source.height, width, height, offsetX * k, offsetY * k),
  };
}
