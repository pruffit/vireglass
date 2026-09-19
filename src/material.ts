// VireGlass material model.
//
// Two distinct objects, and they must not be confused:
//
//   VireGlassMaterial — CAUSES. What a piece of glass is described by: index of refraction,
//                       thickness, bevel width, roughness, absorption color. This is what gets
//                       configured.
//   VireGlassOptics   — EFFECTS. Eighteen values the shaders need. Not configured: they're
//                       derived (`resolveOptics`, physics in `optics.ts`).
//
// Before v4, what was exposed were the effects themselves — eighteen independent sliders. Half of
// them are physically dependent, so combining them produced states that don't occur in real
// glass: a thin bevel with a dense white rim, rim optics as a fraction of the element's own size.
// Every such case was patched by adding yet another slider (`edgeDensity`, a size compensation) —
// that is, compensating for physics that wasn't there. Here there's one cause, and the effects
// are derived.

import {
  absorption,
  blur as blurFrom,
  dispersion as dispersionFrom,
  edgeDensity as edgeDensityFrom,
  gatherRadius as gatherRadiusFrom,
  fresnelStrength,
  FRESNEL_EXPONENT,
  mediumTint,
  refractionScale as refractionScaleFrom,
  refractionStrength,
  specularPower as specularPowerFrom,
  bodyDensity as bodyDensityFrom,
  edgeLight as edgeLightFrom,
  iridescence as iridescenceFrom,
  diffraction as diffractionFrom,
  colorPickup as colorPickupFrom,
  specularStrength,
  iorSpread as iorSpreadFrom,
} from './optics';

export type VireGlassTint = { r: number; g: number; b: number };

export type VireGlassMaterial = {
  /** Index of refraction of the medium. Water 1.33, glass 1.5, sapphire 1.77. */
  ior: number;
  /** Glass thickness, dp. Drives center magnification and absorption. */
  thickness: number;
  /** Bevel width, dp. Absolute: on real glass the rim doesn't depend on the piece's size. */
  bevel: number;
  /** Surface roughness: backdrop haziness and highlight blur. */
  roughness: number;
  /** Response to device orientation, 0 means the light is locked to the screen. */
  environment: number;
  /** Not physics but a legibility requirement: how strongly the glass has to separate its own
   *  lightness from the ink drawn over it. 0 means the glass is simply transparent. */
  legibility: number;
  /** Dimming layer UNDER the glass, 0..1. For the transparent (Clear) variant this is what
   *  provides legibility: that glass has no adaptation, and without dimming the ink drowns over
   *  bright content.
   *
   *  Not to be confused with the mobile surface's `dim` prop: that one compensates for a platform
   *  capture quirk (BlurView can't see a scrim drawn over the content), while this is a property
   *  of the material itself. */
  dimming: number;
  /** Lightness of what the app draws OVER the glass: 1 is light icons and text, 0 is dark. A
   *  cause, not a knob: the calling screen knows it. */
  ink: number;
  /** Minimum PRESENCE of the element itself: how far its body must stand off in lightness from
   *  the backdrop behind it. Not the same as `legibility` — that's about the ink OVER the glass,
   *  this is about the element itself. Over a uniform backdrop the glass has nothing to refract,
   *  and the element disappears; for a control that's unacceptable. 0 means no presence is
   *  required.
   *
   *  The sign is taken FROM THE BACKDROP, not from ink polarity: over dark the body lightens,
   *  over light it darkens. So the requirement works the same way on any backdrop. */
  presence: number;
  /** Surface film thickness, nm. This is where interference comes from: the optical path
   *  difference in the film becomes comparable to the wavelength, and the reflection picks up
   *  iridescence. 0 means no film. */
  film: number;
};

export const MATERIAL_RANGES = {
  ior: [1, 2],
  thickness: [0, 60],
  bevel: [0, 40],
  roughness: [0, 1],
  environment: [0, 1],
  legibility: [0, 1],
  dimming: [0, 0.5],
  ink: [0, 1],
  presence: [0, 0.6],
  film: [0, 900],
} as const satisfies Record<string, readonly [number, number]>;

export type VireGlassNumericKey = keyof typeof MATERIAL_RANGES;

/** Radius over which the LOCAL backdrop lightness is taken, dp. Not per-pixel: otherwise the
 *  glass chases individual strokes and a halo appears around letters beneath it. */
export const ADAPT_RADIUS = 22;

/** Lens dimming on product surfaces — a flat fill over the backdrop. */
export const PRODUCT_DIM = 0.2;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** The values the shaders need. Assembled from the material, never set by hand. */
export type VireGlassOptics = {
  blur: number;
  refraction: number;
  refractionScale: number;
  /** Bevel width in dp — an absolute property of the medium. */
  bevelDp: number;
  /** Radius over which the rim gathers light around the element. */
  gatherRadiusDp: number;
  fresnel: number;
  fresnelPower: number;
  specular: number;
  specularPower: number;
  dispersion: number;
  tint: VireGlassTint;
  tintStrength: number;
  edgeDensity: number;
  environment: number;
  legibility: number;
  /** Dimming of the content under the glass — the very layer of the Clear variant. */
  dimming: number;
  ink: number;
  /** Minimum presence of the element against the backdrop — in units of lightness. */
  presence: number;
  adaptRadius: number;
  bodyDensity: number;
  edgeLight: number;
  /** Film thickness, nm — passed straight to the shader: the path difference is computed in the
   *  same units. */
  film: number;
  /** Strength of reflection iridescence. */
  iridescence: number;
  /** Strength of the edge diffraction fringes. */
  diffraction: number;
  /** How much the body is tinted by the color of its surroundings. */
  colorPickup: number;
  /** Index of refraction: the shader computes ray bending from it via Snell's law. */
  ior: number;
  /** Plate thickness, dp — before the correction for element size. */
  thicknessDp: number;
  /** Spread of the index between the red and blue channels — dispersion. */
  iorSpread: number;
};

// The product default — "water": lower index of refraction, thinner medium and bevel, an almost
// smooth surface. Chosen on-device at the bench.
export const VIREGLASS_MATERIAL_V4: VireGlassMaterial = {
  ior: 1.33,
  thickness: 14,
  bevel: 5,
  roughness: 0.05,
  environment: 0.27,
  legibility: 0.26,
  dimming: 0,
  ink: 1,
  presence: 0.05,
  film: 340,
};


/**
 * Glass, not water. v4's index of refraction, 1.33, is water: almost no reflection at the rim,
 * almost no dispersion, 2% magnification. On screen that surface honestly reads as "nothing much",
 * and it was being mistaken for glass that wasn't rendering at all.
 *
 * 1.5 is ordinary glass. The effects follow from it on their own: reflection at the rim twice as
 * strong, dispersion one and a half times, ambient color pickup at its ceiling. Thickness is
 * raised a little too: it drives magnification, but absorption comes along with it, and
 * absorption is blackness.
 */
export const VIREGLASS_MATERIAL_V5: VireGlassMaterial = {
  ior: 1.5,
  thickness: 28,
  bevel: 6,
  roughness: 0.06,
  environment: 0.27,
  legibility: 0.26,
  dimming: 0,
  ink: 1,
  presence: 0.05,
  film: 340,
};

/**
 * Frosted sheet glass. The sheet sits over a LIVE screen, and it can't be transparent: transport
 * buttons and progress used to read right through it — the layout looked broken. Dimming doesn't
 * fix this (a flat scrim over a sharp picture doesn't hide it), so roughness is raised instead: it
 * drives `u_frost`, a floor on backdrop blur that the adaptive-blur ceiling doesn't reach.
 */
export const VIREGLASS_SHEET_MATERIAL: VireGlassMaterial = {
  ...VIREGLASS_MATERIAL_V5,
  roughness: 0.85,
};
/** The product's material. Consumers use this, not a specific version by name. */
/**
 * Glass under large text (the lyrics panel in the player).
 *
 * The product material with NO change to optics — only `legibility` is raised. That's exactly its
 * reason to exist: "text on me must stay readable." It adds density locally — denser over light
 * and busy backdrops, more transparent over an even dark one.
 *
 * A dedicated thick material (thickness 52, ior 1.58) used to sit here and was removed: medium
 * absorption grows with thickness, and the panel picked up a black fringe around its perimeter —
 * a sooty plate instead of glass. Don't turn thickness into a legibility knob; that's what
 * `legibility` is for.
 */
export const VIREGLASS_LYRICS_MATERIAL: VireGlassMaterial = {
  ...VIREGLASS_MATERIAL_V5,
  legibility: 0.95,
};

/**
 * Glass for controls — buttons, tiles, anything that gets pressed.
 *
 * THICK AND CLEAR, not the baseline: wider bevel, thickness up by half, higher index of
 * refraction and almost no roughness. Baseline glass is a lens over a calm backdrop; a control has
 * to read as an object you can pick up, and that's not done by a fill but by volume: a wide bevel
 * gives the rim something to catch, and thickness gives it depth.
 *
 * Thickness is set by BUILDUP AT THE RIM: on the reference control the stripe image under the
 * element bulges there by a factor of 1.85; ours came out at 1.36 at 30. Saturation sets in around
 * 44, and any extra thickness past that only adds absorption — hence 44, not more.
 *
 * It also drags `tintStrength` (= `absorption(thickness)`) along with it, and on the path WITHOUT
 * a native lens that sets body density: there the element is denser by 2.4 percentage points. On
 * the web the surface has no body at all; the effect only shows on Android below 13.
 *
 * `presence` is raised for the same reason: a piece of background is allowed to disappear over a
 * uniform canvas, a control isn't — it has to be visible before it's been tapped.
 *
 * IMPORTANT about size. The bevel is specified by the medium in dp and doesn't depend on the
 * element's size, but the geometry clamps it to half the smaller half-size (`MAX_BEVEL_FRACTION`).
 * On a 52 dp button that's 13 instead of 16 — a small element made of this glass ends up being
 * bevel all the way through. That's by design: a small piece of thick glass is supposed to look
 * like a lens, not a slab.
 */
export const VIREGLASS_CONTROL_MATERIAL: VireGlassMaterial = {
  ...VIREGLASS_MATERIAL_V5,
  ior: 1.69,
  thickness: 44,
  bevel: 8,
  roughness: 0.035,
  presence: 0.176,
};

export const VIREGLASS_MATERIAL = VIREGLASS_MATERIAL_V5;

/**
 * An element that CARRIES app ink (an icon, a line of text, cover art) has to keep it legible —
 * that's the reason `legibility` exists. An element with no ink has nothing to separate lightness
 * from, so the requirement is turned off for it: the model just promises it plain transparent
 * glass.
 *
 * The rule lives here, not with the consumer: otherwise the same icon button would get different
 * legibility on the web and on Android.
 */
export function materialForInk(material: VireGlassMaterial, carriesInk: boolean): VireGlassMaterial {
  // For the transparent variant, legibility is held by the dimming layer, not the body. Raising
  // its requirement would just turn it into ordinary glass, and the variants don't mix (219 §Clear).
  if (material.dimming > 0) return material;
  return { ...material, legibility: carriesInk ? VIREGLASS_LYRICS_MATERIAL.legibility : 0 };
}

/**
 * The transparent material variant (Clear). It has no adaptation — the glass stays consistently
 * more transparent, content beneath it shows through almost as-is, and legibility of the ink is
 * held by the dimming layer instead. Fit only where the reference's three conditions hold: the
 * element sits over media, the content can tolerate dimming, and the ink over it is large and
 * bright.
 */
export const VIREGLASS_CLEAR_MATERIAL: VireGlassMaterial = {
  ...VIREGLASS_MATERIAL,
  legibility: 0,
  presence: 0,
  // Apple's own numbers: 0.35 in the HIG Materials text, 0.3 in its own sample code. We take the
  // lower one — it comes from working code, not from prose, and Clear has to stay a window.
  dimming: 0.3,
};

/**
 * ACTIVE STATE as a state of the MEDIUM, not a highlight drawn over it.
 *
 * An active element is denser, clearer glass: higher index of refraction, thicker body, wider
 * bevel, less roughness. A bright rim, a strong highlight and greater presence all follow from
 * these causes on their own — assembling them separately would produce a state that doesn't occur
 * in real glass.
 *
 * `environment` is deliberately left untouched here. It sets how much the body is tinted by
 * what's beneath it, and at full strength an active button over cover art turned into a colored
 * blob: the state read as "smudged" rather than "selected." A state indicator must not depend on
 * the backdrop — otherwise any image sliding underneath the element would fake it.
 */
export function activeMaterial(material: VireGlassMaterial, on: number): VireGlassMaterial {
  const k = Math.min(Math.max(on, 0), 1);
  return {
    ...material,
    ior: material.ior + 0.35 * k,
    thickness: material.thickness * (1 + 0.9 * k),
    bevel: material.bevel * (1 + 1.8 * k),
    roughness: material.roughness * (1 - 0.75 * k),
    presence: material.presence + 0.12 * k,
  };
}

export function resolveMaterial(patch: Partial<VireGlassMaterial> = {}): VireGlassMaterial {
  const m = { ...VIREGLASS_MATERIAL, ...patch };
  const out = { ...m };
  for (const key of Object.keys(MATERIAL_RANGES) as VireGlassNumericKey[]) {
    const [lo, hi] = MATERIAL_RANGES[key];
    out[key] = clamp(out[key], lo, hi);
  }
  return out;
}

/** Causes → effects. All of the transition's physics lives in `optics.ts`. */
export function resolveOptics(patch: Partial<VireGlassMaterial> = {}): VireGlassOptics {
  const m = resolveMaterial(patch);
  return {
    blur: blurFrom(m.roughness),
    refraction: refractionStrength(m.ior),
    refractionScale: refractionScaleFrom(m.ior, m.thickness),
    bevelDp: m.bevel,
    gatherRadiusDp: gatherRadiusFrom(m.bevel),
    fresnel: fresnelStrength(m.ior),
    fresnelPower: FRESNEL_EXPONENT,
    specular: specularStrength(m.ior, m.roughness),
    specularPower: specularPowerFrom(m.roughness),
    dispersion: dispersionFrom(m.ior),
    tint: mediumTint(m.ior),
    tintStrength: absorption(m.thickness),
    edgeDensity: edgeDensityFrom(m.thickness, m.bevel),
    environment: m.environment,
    legibility: m.legibility,
    dimming: m.dimming,
    ink: m.ink,
    presence: m.presence,
    adaptRadius: ADAPT_RADIUS,
    bodyDensity: bodyDensityFrom(m.thickness),
    edgeLight: edgeLightFrom(m.ior),
    film: m.film,
    iridescence: iridescenceFrom(m.ior, m.film),
    diffraction: diffractionFrom(m.ior),
    colorPickup: colorPickupFrom(m.ior),
    ior: m.ior,
    thicknessDp: m.thickness,
    iorSpread: iorSpreadFrom(m.ior),
  };
}

/**
 * Frozen snapshots of the EFFECTS from the previous model. Kept as reference points until v4
 * settles: they can't be converted to causes — some of the values are internally inconsistent
 * (exactly why the move was made in the first place), and any "equivalent" material would be a
 * lie.
 */
export const LEGACY_OPTICS = {
  'v3-manual': {
    blur: 4.32,
    refraction: 0.49,
    refractionScale: 1.05,
    bevelDp: 12.6,
    gatherRadiusDp: 40,
    fresnel: 0.77,
    fresnelPower: 2.86,
    specular: 0.3,
    specularPower: 74.58,
    dispersion: 0.54,
    tint: { r: 0.4, g: 0.4, b: 0.44 },
    tintStrength: 0.35,
    edgeDensity: 1.5,
    environment: 0.27,
    legibility: 0.55,
    dimming: 0,
    ink: 1,
    presence: 0,
    adaptRadius: ADAPT_RADIUS,
    bodyDensity: 0.14,
    edgeLight: 0.35,
    film: 0,
    iridescence: 0,
    diffraction: 0,
    colorPickup: 0,
    ior: 1.5,
    thicknessDp: 16,
    iorSpread: 0,
  },
  'v2': {
    blur: 5,
    refraction: 0.95,
    refractionScale: 1.34,
    bevelDp: 14,
    gatherRadiusDp: 40,
    fresnel: 0.72,
    fresnelPower: 2.4,
    specular: 0.38,
    specularPower: 46,
    dispersion: 0.3,
    tint: { r: 0.4, g: 0.4, b: 0.44 },
    tintStrength: 0.1,
    edgeDensity: 3.63,
    environment: 0,
    legibility: 0,
    dimming: 0,
    ink: 1,
    presence: 0,
    adaptRadius: ADAPT_RADIUS,
    bodyDensity: 0.14,
    edgeLight: 0.35,
    film: 0,
    iridescence: 0,
    diffraction: 0,
    colorPickup: 0,
    ior: 1.5,
    thicknessDp: 16,
    iorSpread: 0,
  },
  'v1': {
    blur: 12,
    refraction: 0.55,
    refractionScale: 1.14,
    bevelDp: 10,
    gatherRadiusDp: 40,
    fresnel: 0.5,
    fresnelPower: 3.2,
    specular: 0.42,
    specularPower: 58,
    dispersion: 0.22,
    tint: { r: 0.4, g: 0.4, b: 0.44 },
    tintStrength: 0.16,
    edgeDensity: 3.63,
    environment: 0,
    legibility: 0,
    dimming: 0,
    ink: 1,
    presence: 0,
    adaptRadius: ADAPT_RADIUS,
    bodyDensity: 0.14,
    edgeLight: 0.35,
    film: 0,
    iridescence: 0,
    diffraction: 0,
    colorPickup: 0,
    ior: 1.5,
    thicknessDp: 16,
    iorSpread: 0,
  },
} as const satisfies Record<string, VireGlassOptics>;

export type LegacyOpticsName = keyof typeof LEGACY_OPTICS;
export const LEGACY_NAMES = Object.keys(LEGACY_OPTICS) as LegacyOpticsName[];

/** Material presets: points in the space of CAUSES, not a set of ready-made effects. */
export const MATERIAL_PRESETS = {
  water: VIREGLASS_MATERIAL_V4,
  glass: { ...VIREGLASS_MATERIAL_V4, ior: 1.45, thickness: 25, bevel: 12.6, roughness: 0.17 },
  crystal: { ...VIREGLASS_MATERIAL_V4, ior: 1.7, thickness: 30, bevel: 16, roughness: 0.02 },
  frosted: { ...VIREGLASS_MATERIAL_V4, roughness: 0.55 },
  thick: { ...VIREGLASS_MATERIAL_V4, thickness: 48, bevel: 22 },
  thin: { ...VIREGLASS_MATERIAL_V4, thickness: 4, bevel: 3 },
  iridescent: { ...VIREGLASS_MATERIAL_V4, ior: 1.5, thickness: 8, bevel: 6, film: 620 },
} as const satisfies Record<string, VireGlassMaterial>;

export type MaterialPresetName = keyof typeof MATERIAL_PRESETS;
export const PRESET_NAMES = Object.keys(MATERIAL_PRESETS) as MaterialPresetName[];

export const EFFECTS = [
  'backdrop',
  'blur',
  'refraction',
  'fresnel',
  'bevel',
  'specular',
  'dispersion',
  'tint',
  'environment',
  'legibility',
  'interference',
  'diffraction',
] as const;

export type VireGlassEffect = (typeof EFFECTS)[number];
export type VireGlassToggles = Record<VireGlassEffect, boolean>;

export const ALL_EFFECTS_ON: VireGlassToggles = EFFECTS.reduce(
  (acc, e) => ({ ...acc, [e]: true }),
  {} as VireGlassToggles,
);

/**
 * A toggle zeroes out an EFFECT, it isn't a branch in the shader: the ON/OFF comparison runs on
 * one shader variant, otherwise two different programs would be getting compared. It operates on
 * optics, not on the material: a cause can't be zeroed out — it drags half a dozen effects along
 * with it. `backdrop` isn't handled by a toggle here: it decides whether to mount the BlurView at
 * all.
 */
export function applyToggles(
  optics: VireGlassOptics,
  toggles: Partial<VireGlassToggles> = {},
): VireGlassOptics {
  const on = { ...ALL_EFFECTS_ON, ...toggles };
  const o = { ...optics, tint: { ...optics.tint } };
  if (!on.blur) o.blur = 0;
  if (!on.refraction) {
    o.refraction = 0;
    o.refractionScale = 1;
    o.ior = 1;
  }
  if (!on.fresnel) o.fresnel = 0;
  if (!on.bevel) o.bevelDp = 1;
  if (!on.specular) o.specular = 0;
  if (!on.dispersion) {
    o.dispersion = 0;
    o.iorSpread = 0;
  }
  if (!on.tint) o.tintStrength = 0;
  if (!on.environment) o.environment = 0;
  if (!on.legibility) {
    o.legibility = 0;
    // The dimming layer is the same answer to the legibility requirement, just for the
    // transparent variant.
    o.dimming = 0;
  }
  if (!on.interference) o.iridescence = 0;
  if (!on.diffraction) o.diffraction = 0;
  return o;
}

/** Order = the `u_debug` value in both shaders. Bench-only. */
export const DEBUG_MODES = [
  'normal',
  'sdf',
  'mask',
  'edge',
  'fresnel',
  'refraction',
  'backdrop',
  'specular',
  'dispersion',
  'normals',
  'spectral',
  'adapt',
  'probe',
] as const;

export type VireGlassDebugMode = (typeof DEBUG_MODES)[number];

export function debugIndex(mode: VireGlassDebugMode): number {
  return DEBUG_MODES.indexOf(mode);
}
