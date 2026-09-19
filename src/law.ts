/**
 * THE LAW: every calibrated number the material obeys, in one place.
 *
 * A value here is written ONCE and read by everything that needs it — the shader text interpolates
 * it, the JS twins import it. The alternative is what this file replaces: the same number typed
 * into a GLSL string and again into a TypeScript function, drifting apart the first time one side
 * is tuned. `VG_FALLOFF` already worked this way; the rest now does too.
 *
 * Each entry carries where it came from. `§N` is a section of `docs/reference.md`, which is itself
 * drawn from Apple's public sessions; `M 2:32` and the like are the timestamps those sections cite.
 * A number with no provenance is marked as such, and that marking is a debt, not a decoration.
 *
 * Structural constants — 0, 1, 0.5, 2, π — are not laws and do not belong here.
 */

/** Rim optics: the silhouette's light (§2). */
export const RIM = {
  /**
   * The key-light lobe's exponent. Two opposing arcs come out of one expression, which is why
   * they are opposed rather than placed: `pow(max(facing, 0), 3) + 0.45 * pow(max(-facing, 0), 3)`.
   */
  lobeExponent: 3,
  /** The far arc, weaker than the one facing the light (§2). */
  opposingArc: 0.45,
  /**
   * The dark edge along the whole silhouette, as a multiplicative darkening. iOS 27 made it a
   * layer of its own, and it does not rule out the highlight sitting on top of it (§2).
   */
  darkEdge: 0.22,
  /** Width of the hairline, CSS px. "About a point, not a band and not a bevel" (§2). */
  widthPx: 1,
} as const;

/** How the medium stands between the backdrop and the eye (§3). */
export const BODY = {
  /** Lightness ceiling for the body when legibility is loose. */
  capLoose: 0.62,
  /** …and when it is strict. The model is calibrated at these two, not in between (E-43). */
  capTight: 0.38,
  /** The two ends the body tints toward. Glass has no colour of its own (HIG "Color"). */
  tintDark: 0.07,
  tintLight: 0.94,
  /** How far the backdrop's spread reaches past its mean when deciding what the ink needs. */
  busyEdge: 0.75,
  /** Fine texture the body has to stop being a window for. */
  groundSpan: 0.06,
  /** Where the tint flips direction, by the element's AVERAGE lightness — a local threshold cuts
   *  a diagonal step across the body on a gradient. */
  darkSideFrom: 0.42,
  darkSideTo: 0.58,
  /** Ceiling on any single demand, so one requirement cannot make the glass opaque on its own. */
  maxDemand: 0.92,
} as const;

/** Shadow (§4). The density law lives in `geometry.ts`; these are its measured ends. */
export const SHADOW = {
  /** Measured off reference frames 711–723: 4.0% over a flat light backdrop, 19.9% over text. */
  alphaFlat: 0.04,
  alphaBusy: 0.199,
} as const;

/** Dispersion: the channels refract at different indices (§1, Cauchy). */
export const DISPERSION = {
  /** Red bends less than the base index, blue more — and not symmetrically. */
  redShift: -0.4,
  blueShift: 0.6,
} as const;

/** Response to a finger (§5). The springs and decay live in `touch-response.ts`; these shape the
 *  field the finger deforms. */
export const TOUCH = {
  /** The element grows under pressure (M 3:51; HIG: interactive "expands"). */
  pressGrow: 0.06,
  /** The ridge around the contact blob: material displaced from under the finger ends up
   *  somewhere. Without it the shape balloons, and a dense medium does not do that. */
  ridge: 0.42,
  /** How far press pulls the field toward the finger. */
  pressPull: 0.16,
  /** Wavelength and decay of the ripple, as fractions of its span. Short and quick: in a dense
   *  medium ripples are frequent and small; long shallow swells are water. */
  waveLength: 0.17,
  waveDecay: 0.7,
  /** The ripple's span, as a multiple of the contact radius. It has to reach the far edge, or it
   *  reads as jitter under the finger rather than a wave across the surface. */
  waveSpan: 2,
  /**
   * Contact radius as a fraction of the element's half-size. UNMEASURED: §5 says the response has
   * to be visible UNDER the finger, which is why the blob is wide, but gives no figure.
   */
  radiusOfHalfSize: 1.1,
  /**
   * Wave impulse as a fraction of the travel limit. UNMEASURED: the core carries the ripple's
   * decay and frequency, but nothing says how hard a finger strikes it.
   */
  waveOfTravel: 0.18,
  /** The lift-off ring is weaker than the one from touching down (§5). UNMEASURED ratio. */
  releaseWave: 0.6,
  /**
   * How far a glow reaches past the element it started on, as a multiple of that element's
   * half-size. UNMEASURED: §5 says the glow spreads "onto any Liquid Glass elements nearby" and
   * names no distance. This is the reach at which a neighbour in a tab bar still lights and one
   * across the screen does not.
   */
  glowReach: 3,
  /**
   * How much of an element's "active" state a touch alone raises — the fraction the glow and the
   * ink lift ride on when nothing else is driving them. UNMEASURED.
   *
   * It was a private constant on the Android surface whose comment said it matched the web's, and
   * nothing enforced that: the web renderer takes `active` from the host as a field and has no
   * constant to match. Two renderers agreeing by a comment is exactly what this file is for.
   */
  activeOnTouch: 0.3,
} as const;

/** The bevel's profile — spherical, like a cap: `t / sqrt(1 - t² · k)`, clamped. A plain `t²` kept
 *  the slope near zero through most of the bevel and then shot up at the edge, so the optics
 *  bunched into a ring and the element read as a puck. */
export const BEVEL = {
  sphere: 0.94,
  floor: 0.02,
  slopeMax: 3.2,
} as const;

/** Where two shapes meet head-on their normals cancel exactly and the blend lands on zero. */
export const EPSILON = 1e-5;

/** What the medium does to light passing through it (§3). */
export const MEDIUM = {
  /** The lightness content under the glass is pulled toward, and how hard. The medium both removes
   *  light and mixes scattered light back in: over a light backdrop the body darkens, over a dark
   *  one it lightens. A layer that only ADDED light pushed the body the wrong way over light
   *  backdrops (M 2:35). */
  luma: 0.4,
  pull: 0.07,
  /** Ambient light reaching the body on top of that pull. */
  ambientSpill: 0.01,
  /** Glass concentrates light: the body is a touch lighter than what lies beneath it (M 2:29). */
  concentrate: 0.01,
  /** Scattered light on a frosted element is an ADDITION over the backdrop, not a fraction of the
   *  way to the tint — a fraction goes to zero once the backdrop reaches the tint's lightness and
   *  darkens past it (docs/benchmarks.md). */
  matteLift: 0.1,
  /** How far scattering reaches, as a fraction of the gather radius, over a busy backdrop under
   *  ink. Set against the reference: structure under the capsule fades by a factor of nine or ten
   *  there, not thirty (M 11:47). */
  scatterMax: 0.2,
  scatterBase: 0.1,
  /** The response to structure saturates early: what competes with the ink is not the AREA of
   *  foreign text but the fact of it — a line under a tile measures about 0.12 of busy. */
  structureGain: 20,
  /** Tint density in the flat middle; the bevel multiplies it by the edge density. */
  bodyDensityFlat: 0.19,
} as const;

/** The lens itself (§1). */
export const LENS = {
  /** Backdrop compression at the rim goes to infinity at the silhouette, so the radius correction
   *  is capped. */
  footprintMax: 1.8,
  /** Same reason, for the profile's slope. */
  slopeMax: 40,
  /** Every thin film on glass sits around this index. */
  filmIor: 1.35,
  /** Reference channel wavelengths in nm — red, green, blue — for diffraction and interference. */
  lambdaR: 610,
  lambdaG: 550,
  lambdaB: 460,
} as const;

/** The shadow's shape in the gap under the element (§4). */
export const SHADOW_GAP = {
  /** How much weaker the shadow is right at the outline than under the middle of the gap, and what
   *  fraction of the offset it takes to reach full depth. In the reference the shadow's minimum
   *  sits BELOW the rim, not at it. */
  light: 0.76,
  reach: 0.2,
  /** Fraction of the ambient hue the shadow carries. It has to stay a shadow, not a coloured blob. */
  tint: 1,
} as const;

/** Ink drawn inside the material (§5). */
export const INK = {
  /** Depth beneath the surface, dp. The normal displaces it by exactly this much at the rim. */
  depth: 4,
  /** Defocus under a finger, as a FRACTION of the touch blob rather than a length: the blob
   *  already arrives in device units, so this follows both screen density and element size. At
   *  rest it is zero and the sample stays a single one. */
  defocus: 0.08,
} as const;

/** The spectral edge (§1): dispersion, diffraction and interference are one cause — a dependence
 *  on wavelength — and one hue multiplier, normalised to its own mean. They colour the reflection
 *  without brightening it. */
export const SPECTRAL = {
  /** How far into the bevel the fringes reach, as a fraction of it measured from the silhouette.
   *  Diffraction is an EDGE effect; past this the bevel is plain glass. */
  diffractionOnset: 0.45,
  /** Fringes across the bevel. Denser as the bevel sharpens, which is what the phase term does. */
  diffractionFringes: 4,
  /** The channel the hue is measured against, nm. Green is the eye's own reference. */
  referenceLambda: 550,
} as const;

/** Tinting (§7): a colour that is a property of the medium, not a fill over it. */
export const ACCENT = {
  /** The tone the colour takes over a dark backdrop and over a light one. "A range of tones mapped
   *  to content brightness underneath", rather than one flat colour. */
  deep: 0.88,
  light: 1.08,
  /** How much of the medium the colour occupies by default. Short of one, because the content has
   *  to keep coming through: a fill "breaks the visual character of Liquid Glass" (@17:03). */
  amount: 0.8,
} as const;

/**
 * The system accessibility settings (§9). They are modifiers on the material's layers, so their
 * calibration belongs in the law next to the layers they move — not as private constants in the
 * module that happens to apply them.
 */
export const ACCESSIBILITY = {
  /** Frost floor under reduced transparency: the glass gets "frostier" (§9). */
  frostMinDp: 14,
  /**
   * Body floor under reduced transparency. B @10:07 is the stricter statement of the two — a bar
   * "gets a background when reduce transparency is enabled" — so this is a background, not a
   * thicker haze. UNMEASURED: neither source gives a figure.
   */
  obscureMin: 0.82,
  /** Under increased contrast the element is "predominantly black or white" (§9): the body goes to
   *  whichever pole its ink already points at, at a density that leaves it reading as that pole. */
  contrastDensity: 0.94,
  /** …and separates from the backdrop on its own, whatever is behind it. */
  contrastPresence: 0.5,
  /**
   * The contrasting border §9 asks for, in units of lightness away from the body's own pole. The
   * rim stops taking its colour from the environment and takes it from the element instead — an
   * ambient hairline is not a contrasting border. UNMEASURED.
   */
  contrastRim: 0.85,
  /**
   * Press that survives reduced motion. §9 "decreases the intensity of some effects and disables
   * any elastic properties": the spring and the ripple are elastic and go to zero, the press is an
   * ease that carries the element's light, so it is damped rather than removed — an element that
   * stops answering a finger altogether is not reduced motion, it is no feedback. UNMEASURED.
   */
  stillPress: 0.6,
} as const;

/**
 * Morphing (§5). Apple's design leads name their own model for it out loud (S 1:25:30, fireside
 * chat with the Apple design team): "we also had a refresher from biology class. It's called
 * mitosis and meiosis. When these things are coming together or materialization and
 * dematerialization and morphing."
 *
 * Which is the right physics and not a metaphor: a dividing cell is one body throughout. It never
 * has a moment of being two bodies that happen to touch, and it never pops a second body into
 * existence beside the first. The neck is continuous from start to finish, and it is the neck that
 * carries the whole transition.
 */
export const MORPH = {
  /**
   * Width of the neck between two lobes, as a fraction of the smaller one's half-size. On a large
   * element the bridge has to be wider or the seam keeps a sharp corner, which a liquid does not
   * have. UNMEASURED: the reference names the behaviour and no figure.
   */
  neck: 0.35,
  /**
   * How far past merely touching a completed fusion goes, as a multiple of the bridge width that
   * just closes the gap. At exactly the bridge width the two surfaces meet at a point, which is two
   * shapes kissing rather than one body. UNMEASURED.
   */
  fuse: 1.3,
} as const;

/**
 * CAUSE TO EFFECT. The normalisations that turn what the medium IS — index, thickness, bevel,
 * roughness, film — into what a renderer needs. They lived as literals inside `optics.ts`, half of
 * them not even named, which meant the heart of the model was the one part of it the law could not
 * see.
 *
 * Almost all of them are stylisations and say so. Literal physical values put every effect at the
 * threshold of visibility: real glass reflects four per cent at normal incidence, and a rim drawn
 * at four per cent is not a rim. Each is monotonic in its own cause, so "denser medium, brighter
 * rim" holds whatever the constant is; what no one has measured is where on the scale Apple's
 * material sits. Hence UNMEASURED on nearly all of it — that is the honest state of this file, and
 * the gate now says so out loud instead of the number hiding in a module.
 */
export const DERIVE = {
  /** Physical 4% reflectance into the render's working range. UNMEASURED. */
  fresnelGain: 17.5,
  /** Schlick's exponent. A constant of the approximation, not a knob. */
  fresnelExponent: 5,
  /** The index at which ray bending is at full strength, measured from air. UNMEASURED. */
  iorFullBend: 0.6,
  /** Magnification behind a plane-parallel plate, per dp of thickness. UNMEASURED. */
  magnifyPerDp: 0.006,
  /** In ordinary glasses the Abbe number falls as the index rises, so dispersion grows with it.
   *  UNMEASURED slope. */
  dispersionPerIor: 1.1,
  /** Index spread between the red and blue channels. The physical value (~0.01 at an Abbe number
   *  of 55) is at the threshold of visibility. UNMEASURED. */
  iorSpreadPerDispersion: 0.045,
  /** Beer–Lambert absorption per dp of path. UNMEASURED. */
  absorbPerDp: 0.017,
  /** Ceiling on how much denser the bevel may read than the body. The rim's ray travels further
   *  through the medium; past this the rim is milk rather than glass. UNMEASURED. */
  edgeDensityMax: 4,
  /**
   * Frost ceiling, dp. Deliberately low: blur is a SUPPORTING device here, and past about a dozen
   * dp letters under the glass stop being letters. Separating content from ink is the body's job.
   */
  blurMaxDp: 12,
  /** Highlight width from a smooth surface and from a fully rough one, as a specular exponent.
   *  UNMEASURED. */
  specularPowerSmooth: 160,
  specularPowerRough: 8,
  /** How much roughness damps the highlight's brightness. UNMEASURED. */
  specularRoughDamping: 0.6,
  /**
   * The medium's own hue by density. Water absorbs red and skews cool, ordinary glass is nearly
   * neutral with a faint green, dense high-index media skew warm. Glass has no colour of its own
   * (HIG "Color"), so this is never set by hand — it is tied to the index.
   */
  hueCool: [0.86, 1.0, 1.08],
  hueNeutral: [1.0, 1.02, 0.99],
  hueWarm: [1.08, 1.0, 0.88],
  /** The index range the hue sweeps across, and where it starts. UNMEASURED. */
  hueFromIor: 1.2,
  hueSpan: 0.55,
  /** Body lightness follows reflectance: the denser the medium, the more of its surroundings it
   *  returns. UNMEASURED base and slope. */
  bodyLiftBase: 0.34,
  bodyLiftPerF0: 2.4,
  /**
   * How far past the bevel the rim gathers its surroundings, as a multiple of the bevel. At a
   * grazing angle the eye receives the vicinity rather than what is under the glass, and without
   * this, glass on an empty black background has no source at all. UNMEASURED.
   */
  gatherPerBevel: 4,
  /** Floor and ceiling on that radius, dp. Unbounded, a wide bevel gathers from fifty dp away and
   *  a READABLE copy of the neighbourhood appears inside the glass — eight samples cannot blur a
   *  disc that large (E-33, E-37). */
  gatherMinDp: 4,
  gatherMaxDp: 28,
  /** The body's own density from absorption through its thickness. Small: the body only moves
   *  toward the tint under the legibility requirement, otherwise it dims the content. UNMEASURED. */
  bodyDensity: 0.05,
  /**
   * Rim light on the physical scale rather than the rim highlight's. `fresnelGain` saturates at one
   * for dense media, and applying it here too would raise body lightness harder than the glass had
   * just separated it from the ink — eating its own legibility work. UNMEASURED.
   */
  edgeLightGain: 6,
  /** Iridescence rides the REFLECTED ray, so it is tied to Fresnel and has no knob of its own.
   *  UNMEASURED gain. */
  iridescencePerFresnel: 1.6,
  /** Edge diffraction shares dispersion's λ-dependence, at the stylised amplitude: at the physical
   *  one the fringes are not visible at all. UNMEASURED. */
  diffractionPerDispersion: 0.5,
  /** Multiple internal reflection — the denser the medium, the more light it circulates and the
   *  more it is tinted by its surroundings. The ceiling keeps it a medium rather than a fill.
   *  UNMEASURED. */
  colorPickupPerFresnel: 0.9,
  colorPickupMax: 0.42,
} as const;

/**
 * SIZE AND SHADOW. What changes when an element gets bigger, and how dense its shadow reads over
 * what is behind it. 219 @6:36: as glass "flexes and morphs to larger sizes, it simulates a
 * thicker material with deeper shadows and more pronounced lensing and refraction".
 */
export const SIZE = {
  /** Half-size at which bevel and thickness are specified as given; they grow as its square root
   *  from there. UNMEASURED reference size. */
  referenceDp: 24,
  /** Floor and ceiling on that growth. UNMEASURED. */
  gainMin: 0.8,
  gainMax: 2.4,
  /** A bevel wider than this fraction of the half-size breaks the SDF — the roundings converge in
   *  the middle. A property of the geometry, not a taste. */
  maxBevelFraction: 0.65,
} as const;

/**
 * Shadow density by what is behind the element. 219 @11:47, verbatim: it "increases the opacity of
 * its shadow when it is over text… lowers the opacity of its shadow when it is over a solid light
 * background." About content BEHIND the element, so one value per element rather than a field over
 * the shadow's area. Endpoints checked against the reference by the depth of the dip under the
 * element (docs/benchmarks.md).
 */
export const SHADOW_DENSITY = {
  /** Over a flat background. */
  flat: 0.8,
  /** How fast it rises with structure behind the element, and how far it may rise. */
  busyGain: 6,
  busyRise: 1.2,
  /** Quantisation of the emitted value: a shadow that changes on every pixel of scroll re-lays-out
   *  the native view every frame. */
  step: 0.05,
} as const;

/**
 * THE MEDIUM'S RESPONSE TO A FINGER (§5). Part of the material, exactly as `ior` is: keeping these
 * with the consumer would mean web and Android ended up with two different glasses under one name.
 *
 * Press is viscous — it dents shallow and releases slowly. Drag is thick: the body noticeably lags
 * the finger, travel is short, and on release it snaps back fast with almost no overshoot, because
 * a wide springy overshoot would be liquid jelly rather than dense glass.
 */
export const SPRING = {
  /** Stiffness and damping while the finger is down. UNMEASURED. */
  holdStiffness: 260,
  holdDamping: 46,
  /** …and after it lifts. Stiffer, and damped hard: a dense medium snaps back without ringing. */
  releaseStiffness: 420,
  releaseDamping: 34,
  /** Time constants for the press dent, in and out, seconds. UNMEASURED. */
  pressAttack: 0.07,
  pressRelease: 0.16,
  /** How fast the touch point catches up to the finger. Not instant: an instant jump tears the
   *  deformation, and on rapid taps that reads as jitter. */
  pointFollow: 0.045,
  /** …and how fast the element registers as being touched at all, which is what the glow rides. */
  activeFollow: 0.09,
  /** The ripple decays within a quarter second rather than oscillating: in a viscous medium ripples
   *  are short and weak. UNMEASURED. */
  waveDecay: 0.22,
  waveTurnsPerSecond: 3,
  /** Ceilings on the accumulated ripple, as multiples of a single impulse. Impulses add up rather
   *  than restart — restarting cuts a running wave mid-period, which is what jolts on rapid taps. */
  waveCapOnGrab: 1.6,
  waveCapOnRelease: 2,
} as const;

/** The user's clear-to-tinted preference (§3). */
export const SCALE = {
  /** Where on the scale the material stays exactly as it is by default. */
  default: 0.35,
  /** Body density at the fully tinted end: content under the glass has to be hidden. UNMEASURED. */
  tintedDensity: 0.9,
} as const;

/**
 * The scroll edge (§10). 219 @9:16: as content scrolls under a glass element "the effect gently
 * DISSOLVES the content into the background, lifting the glass visually above the moving content,
 * and allowing floating elements like titles to always remain clear."
 *
 * 356 @11:32 says what it is not, and the first implementation here did exactly that: "they don't
 * block or darken like overlays. They simply clarify where UI and content meet."
 */
export const SCROLL_EDGE = {
  /** How far the content has to slide under the panel for the effect to fully engage, dp. */
  engageDp: 24,
  /** The blur the content dissolves into at the edge, dp. This is the effect itself — the content
   *  goes out of focus into the background rather than being covered by anything. UNMEASURED. */
  dissolveBlurDp: 10,
  /**
   * Over dark content the glass turns dark and 219 @9:33 switches the effect "to apply a subtle
   * dimming instead". Dimming is a reduction in luminance: dark content under dark glass merges
   * with it, and pushing the content down is what lets the glass sit above it. UNMEASURED.
   */
  dimAlpha: 0.1,
  /** A pinned view under the panel (column headers) gets a flat band instead of a gradual fade
   *  (219 @9:41) — "a stronger, more opaque boundary" (356 @12:12). UNMEASURED. */
  hardBlurDp: 14,
  hardAlpha: 0.18,
} as const;
