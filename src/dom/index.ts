// The third VireGlass renderer: refracts LIVE DOM via `backdrop-filter: url(#svg-filter)` with an
// `feDisplacementMap`, instead of drawing its own backdrop like the WebGL2 and AGSL renderers do.
//
// Everything is derived from the same model the shaders read, and where a law already exists in
// the core or in the shader text, this mirrors it rather than restating it: the rim's two arcs are
// the lens's own key-light lobe, the shadow is `shadowOpacityFrom`, dispersion is the shader's
// per-channel index shift, and the finger response is `createDeform` driving the same `touchWarp`.
//
// Even the spectral edge, which looked impossible: a filter graph cannot evaluate a function per
// pixel, but it can MULTIPLY by an image, so diffraction and interference are baked into one and
// applied with an arithmetic composite.
// See `docs/superpowers/specs/2026-09-19-vireglass-over-live-dom.md` for the technique and the
// three findings that make it work (objectBoundingBox, prefiltering the source, the 8-bit step).
import { ambientFrom, INK_DARK, INK_LIGHT, shouldInkBeLight, type BackdropSample } from '../adaptation';
import { buildDisplacementMap, buildDisplacementMapInSlices, displacementScale, type DisplacementMap, type DisplacementState } from './displacement';
import { buildSpectralMap, buildSpectralMapInSlices, hasSpectralEdge, type SpectralMap } from './spectral-map';
import { cached, isCached } from './map-cache';
import { roundedRectGeometry, type VireGlassGeometry } from '../geometry';
import { resolveOptics, VIREGLASS_MATERIAL, type VireGlassMaterial, type VireGlassOptics } from '../material';
import { probeBackdrop } from './probe';
import { bump } from './stats';
import { createLru, filterSignature, mapKeyFor, quantise, sampleMoved, snapGeometry } from './interim';
import { interimBuilder, releaseMap, type InterimPair, type WorkerFailure } from './interim-build';
import { Superseded } from './bake';
import { startBlend, type Blend } from './blend';
import { pairBytes, touch, track, untrack, type BudgetEntry } from './pair-budget';
import { supportsSvgBackdropFilter } from './support';
import { boxShadowCss } from './shadow';
import { bodyLayer, resolveBody, withPresence } from './body';
import { systemAccessibility, watchAccessibility } from './preferences';
import { applyAccessibility, contrastRimLuma, elasticAllowed, type VireGlassAccessibility } from '../accessibility';
import { applyGlassScale, GLASS_SCALE_DEFAULT } from '../glass-scale';
import { applyAppear } from '../appear';
import { accentAmount, accentTone } from '../accent';
import type { VireGlassAccent } from '../adapters';
import { concentricRadius } from '../concentric';
import { RIM_WIDTH_PX, contrastRimCss, rimGradientCss, rimLayerCss } from './rim';
import { GLASS_ATTR, warnIfNested } from './nesting';
import { holdProperty } from './style-hold';
import { REST_LIGHT } from '../adapters';
import { refractionStrength } from '../optics';
import { DISPERSION, TOUCH } from '../law';
import type { MorphShape } from '../sdf';
import { createDeform, raiseIntoGlass, type DeformSample } from '../touch-response';
import { halfMinDp, MAX_STRETCH } from '../geometry';

export * from './support';
export * from './probe';
export * from './displacement';
export * from './rim';
export * from './shadow';
export * from './body';
export * from './preferences';
export * from './scroll-edge';
export * from './group';
export * from './spectral-map';
export * from './map-cache';
export { renderStats, resetRenderStats, type RenderStats } from './stats';
export { PAIR_BUDGET_BYTES } from './pair-budget';

const SVG_NS = 'http://www.w3.org/2000/svg';
const FILTER_HOST_ATTR = 'data-vireglass-filters';

let filterCounter = 0;

/** Live instances keyed by element, so a second attach can retire the first rather than orphan
 *  its filter. Weak: a detached element takes its entry with it. */
const attached = new WeakMap<HTMLElement, GlassHandle>();

const TOUCH_RADIUS_FRACTION = TOUCH.radiusOfHalfSize;

const WAVE_OF_TRAVEL = TOUCH.waveOfTravel;
const RELEASE_WAVE = TOUCH.releaseWave;

function waveImpulse(g: VireGlassGeometry): number {
  return halfMinDp(g) * MAX_STRETCH * WAVE_OF_TRAVEL;
}

const STYLE_ATTR = 'data-vireglass-styles';


/**
 * The hairline rim (docs/reference.md §2) needs a layer of its own over the element. A stylesheet
 * rule on `::after` keeps it out of the host's markup — injecting a child node would fight any
 * framework that owns these children.
 *
 * The mask pair is what makes it a ring rather than a fill: the same box painted twice, once
 * clipped to the content box, composited so only the padding band survives.
 */
/**
 * Where the filter and the rim styles go.
 *
 * `backdrop-filter: url(#id)` resolves the reference in the element's OWN tree. From inside a
 * shadow root, a filter parked on the page is not found — and the failure is silent, because the
 * reference is valid CSS: the element gets no backdrop at all, not even the blur fallback. A
 * widget in a shadow root (which is how you survive a page full of global `!important`) came out
 * with no material whatsoever.
 *
 * So the host is the element's own root node, which is the shadow root when there is one and the
 * document otherwise. Nothing to configure and nothing to get wrong.
 */
function hostFor(el: Element): Document | ShadowRoot {
  const root = el.getRootNode();
  return root instanceof ShadowRoot ? root : el.ownerDocument ?? document;
}

/** A shadow root has no `<head>`; a style element goes straight into it. */
function styleParent(host: Document | ShadowRoot): Node {
  return host instanceof ShadowRoot ? host : host.head;
}

function ensureRimStyles(host: Document | ShadowRoot): void {
  if (host.querySelector(`style[${STYLE_ATTR}]`)) return;
  const style = document.createElement('style');
  style.setAttribute(STYLE_ATTR, '');
  ensureColourProperties();
  style.textContent =
    rimLayerCss(`[${GLASS_ATTR}]`) +
    `:where([data-vireglass-ease]){transition:--vireglass-ink-color ${EASE_MS}ms,--vireglass-tint-color ${EASE_MS}ms,--vireglass-body-color ${EASE_MS}ms,background-color ${EASE_MS}ms}` +
    // The touch glow (§5) lights the material from the point of contact. Below the content, above
    // the refraction — it is light inside the glass, not a film over the label.
    `[${GLASS_ATTR}]::before{content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:var(--vireglass-glow,none);opacity:var(--vireglass-glow-opacity,0)}`;
  styleParent(host).appendChild(style);
}

function getFilterHost(host: Document | ShadowRoot): SVGSVGElement {
  const existing = host.querySelector<SVGSVGElement>(`svg[${FILTER_HOST_ATTR}]`);
  if (existing) return existing;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute(FILTER_HOST_ATTR, '');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.position = 'absolute';
  svg.style.pointerEvents = 'none';
  svg.appendChild(document.createElementNS(SVG_NS, 'defs'));
  // A shadow root takes the svg directly; a document takes it on the body.
  (host instanceof ShadowRoot ? host : host.body).appendChild(svg);
  return svg;
}

/** Every apply writes the presence, and most applies do not change it. */
function writeAttr(node: Element, name: string, value: string): void {
  if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}

type Channel = 'dR' | 'dG' | 'dB';

/** A channel's share of the base displacement: its index shifts with the dispersion (docs/reference.md §1). */
function channelRatio(optics: VireGlassOptics, channel: Channel): number {
  if (channel === 'dG' || optics.iorSpread <= 1e-4) return 1;
  const base = refractionStrength(optics.ior);
  const shift = (channel === 'dR' ? DISPERSION.redShift : DISPERSION.blueShift) * optics.iorSpread;
  return base > 0 ? refractionStrength(optics.ior + shift) / base : 1;
}

/**
 * Finding #1 (do not re-litigate): `objectBoundingBox` with an explicit unit box. `userSpaceOnUse`
 * measures from something other than the element's own box and the displacement smears across
 * the page instead of staying at the rim.
 */
function buildFilterElement(
  id: string,
  mapUrl: string,
  optics: VireGlassOptics,
  scale: number,
  spectral: SpectralMap | null,
): SVGFilterElement {
  const filter = document.createElementNS(SVG_NS, 'filter');
  filter.setAttribute('id', id);
  filter.setAttribute('filterUnits', 'objectBoundingBox');
  filter.setAttribute('x', '0');
  filter.setAttribute('y', '0');
  filter.setAttribute('width', '1');
  filter.setAttribute('height', '1');
  // Without this the spec's default is linearRGB: the browser gamma-linearises the map's bytes
  // before reading them, so 128 stops meaning "no shift" and the flat middle of the glass drifts
  // by several pixels. Measured at ~57px of spurious displacement at scale 200.
  filter.setAttribute('color-interpolation-filters', 'sRGB');

  const feImage = document.createElementNS(SVG_NS, 'feImage');
  feImage.setAttribute('href', mapUrl);
  feImage.setAttribute('preserveAspectRatio', 'none');
  feImage.setAttribute('result', 'map');

  // Finding #2: prefiltering the source before displacement. This is `roughness`, not a hack —
  // without it, fine texture (1px diagonals) resamples into chevrons under the displacement.
  const feBlur = document.createElementNS(SVG_NS, 'feGaussianBlur');
  feBlur.setAttribute('in', 'SourceGraphic');
  feBlur.setAttribute('stdDeviation', String(Math.max(optics.blur, 0)));
  feBlur.setAttribute('result', 'blurred');

  filter.append(feImage, feBlur);

  // DISPERSION (docs/reference.md §1, and `lens-shader.ts` lines 283–284 for the law): the channels
  // refract at different indices — red at `ior - 0.4 * iorSpread`, blue at `ior + 0.6 * iorSpread`,
  // green at the base. One displacement pass cannot do that, so each channel gets its own and they
  // are summed back. Three passes instead of one, so it only runs when the spread is worth paying
  // for.
  const spread = optics.iorSpread;
  if (spread > 1e-4) {
    const channels: Array<[Channel, number, string]> = [
      ['dR', scale * channelRatio(optics, 'dR'), '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0'],
      ['dG', scale, '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0'],
      ['dB', scale * channelRatio(optics, 'dB'), '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0'],
    ];
    for (const [name, chScale, matrix] of channels) {
      const pass = document.createElementNS(SVG_NS, 'feDisplacementMap');
      pass.setAttribute('in', 'blurred');
      pass.setAttribute('in2', 'map');
      pass.setAttribute('scale', String(chScale));
      pass.setAttribute('xChannelSelector', 'R');
      pass.setAttribute('yChannelSelector', 'G');
      pass.setAttribute('result', `${name}raw`);
      // Each channel displaces by its own share of the base scale. The share is stored on the
      // element itself: under a press the scale is recomputed every frame, with nowhere else to
      // recover the shares from.
      pass.setAttribute('data-vireglass-ratio', String(scale > 0 ? chScale / scale : 1));
      pass.setAttribute('data-vireglass-channel', name);
      const only = document.createElementNS(SVG_NS, 'feColorMatrix');
      only.setAttribute('in', `${name}raw`);
      only.setAttribute('type', 'matrix');
      only.setAttribute('values', matrix);
      only.setAttribute('result', name);
      filter.append(pass, only);
    }
    // Arithmetic add, not a blend: every channel is isolated, so the sum is the recombined colour.
    // Alpha stays at 1 on all three and clamps, which is what an opaque backdrop wants.
    const rg = document.createElementNS(SVG_NS, 'feComposite');
    rg.setAttribute('in', 'dR');
    rg.setAttribute('in2', 'dG');
    rg.setAttribute('operator', 'arithmetic');
    rg.setAttribute('k1', '0');
    rg.setAttribute('k2', '1');
    rg.setAttribute('k3', '1');
    rg.setAttribute('k4', '0');
    rg.setAttribute('result', 'dRG');
    const rgb = document.createElementNS(SVG_NS, 'feComposite');
    rgb.setAttribute('in', 'dRG');
    rgb.setAttribute('in2', 'dB');
    rgb.setAttribute('operator', 'arithmetic');
    rgb.setAttribute('k1', '0');
    rgb.setAttribute('k2', '1');
    rgb.setAttribute('k3', '1');
    rgb.setAttribute('k4', '0');
    rgb.setAttribute('result', 'refracted');
    filter.append(rg, rgb);
    return withSpectral(filter, spectral);
  }

  const feDisplace = document.createElementNS(SVG_NS, 'feDisplacementMap');
  feDisplace.setAttribute('in', 'blurred');
  feDisplace.setAttribute('in2', 'map');
  feDisplace.setAttribute('scale', String(scale));
  feDisplace.setAttribute('xChannelSelector', 'R');
  feDisplace.setAttribute('yChannelSelector', 'G');
  feDisplace.setAttribute('result', 'refracted');
  filter.append(feDisplace);
  return withSpectral(filter, spectral);
}

/**
 * Multiplies the refracted frame by the baked hue (docs/reference.md §1). `feComposite` in
 * arithmetic mode with `k1` is a per-pixel product, which is the only way a filter graph can apply
 * a function of position. The headroom the bake divided by is multiplied back here.
 */
function withSpectral(filter: SVGFilterElement, spectral: SpectralMap | null): SVGFilterElement {
  if (!spectral) return filter;
  const image = document.createElementNS(SVG_NS, 'feImage');
  image.setAttribute('href', spectral.url);
  image.setAttribute('preserveAspectRatio', 'none');
  image.setAttribute('result', 'hue');
  const product = document.createElementNS(SVG_NS, 'feComposite');
  product.setAttribute('in', 'refracted');
  product.setAttribute('in2', 'hue');
  product.setAttribute('operator', 'arithmetic');
  product.setAttribute('k1', String(spectral.headroom));
  product.setAttribute('data-vireglass-headroom', String(spectral.headroom));
  product.setAttribute('k2', '0');
  product.setAttribute('k3', '0');
  product.setAttribute('k4', '0');
  filter.append(image, product);
  return filter;
}

function measureGeometry(el: HTMLElement): VireGlassGeometry {
  const rect = el.getBoundingClientRect();
  // Uniform corner radius only, matching `VireGlassGeometry` itself — a per-corner or elliptical
  // radius isn't modeled by any renderer in this package.
  const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
  return roundedRectGeometry(rect.width, rect.height, radius);
}

function devicePixelRatio(): number {
  return typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
}

/**
 * No SVG filter reference support (Firefox, older Safari): a real path, not a stub — the Android
 * renderer degrades to an affine magnifier below API 33 and that's documented as normal too. Blur
 * and saturation stand in for refraction's optical effect; the tint carries what refraction can't:
 * a body of glass, not just a smudge over whatever's behind it.
 */
function fallbackFilterCss(optics: VireGlassOptics): string {
  const blurPx = Math.max(optics.blur, 1.5);
  const saturate = 1 + optics.colorPickup;
  return `blur(${blurPx}px) saturate(${saturate})`;
}

function probe(el: HTMLElement, rect?: ProbeRect): BackdropSample {
  bump('probes');
  return probeBackdrop(el, rect ? { rect } : {});
}

type ProbeRect = { left: number; top: number; width: number; height: number };

const PROPERTIES_ATTR = 'data-vireglass-properties';
const EASE_MS = 200;

/** Registered, so a colour custom property can transition: an unregistered one jumps. Document-wide, even for a shadow root. */
function ensureColourProperties(): void {
  if (document.head.querySelector(`style[${PROPERTIES_ATTR}]`)) return;
  const style = document.createElement('style');
  style.setAttribute(PROPERTIES_ATTR, '');
  style.textContent = ['ink', 'tint', 'body']
    .map((name) => `@property --vireglass-${name}-color{syntax:'<color>';inherits:true;initial-value:transparent}`)
    .join('');
  document.head.appendChild(style);
}

/** A map that is still decoding draws the backdrop displaced by the wrong amount, so a new one is
 *  decoded before it is shown. */
function decoded(url: string): Promise<void> {
  if (typeof Image === 'undefined') return Promise.resolve();
  const img = new Image();
  img.src = url;
  return typeof img.decode === 'function' ? img.decode().catch(() => undefined) : Promise.resolve();
}

function reportFailure(error: unknown): void {
  if (typeof reportError === 'function') reportError(error);
  else console.error(error);
}

/** Resolves in a task after the next frame has been drawn, or after 100 ms where no frame comes (a hidden page). */
function afterNextFrame(): Promise<void> {
  return new Promise((resolve) => {
    const fallback = setTimeout(resolve, 100);
    if (typeof requestAnimationFrame !== 'function') return;
    requestAnimationFrame(() =>
      setTimeout(() => {
        clearTimeout(fallback);
        resolve();
      }, 0),
    );
  });
}

type InterimMap = {
  key: string;
  map: DisplacementMap;
  hue: SpectralMap | null;
  ready: boolean;
  geometry: VireGlassGeometry;
  /** Dropped from the store while its maps are on screen or held: released when nothing uses it. */
  evicted?: boolean;
  budget?: BudgetEntry;
};

function releaseRecord(rec: InterimMap): void {
  if (rec.budget) untrack(rec.budget);
  releaseMap(rec.map.url);
  if (rec.hue) releaseMap(rec.hue.url);
}

/** The destination of a motion: the pair of maps for it, and the sample the lens takes at landing. */
type Prepared = {
  token: number;
  key: string;
  full: VireGlassOptics;
  geometry: VireGlassGeometry;
  dpr: number;
  state: DisplacementState;
  hue: boolean;
  sample: BackdropSample | null;
  rec: InterimMap | null;
  failed: boolean;
};

type PendingBuild = {
  key: string;
  mine: number;
  forFilter: SVGFilterElement;
  optics: VireGlassOptics;
  geometry: VireGlassGeometry;
  dpr: number;
  state: DisplacementState;
  hue: boolean;
};

/** Interim with no call for this long ends itself: a morph that never reported landing must not
 *  leave the glass on a stretched map for good. */
const INTERIM_IDLE_MS = 2000;

const isEmpty = (g: VireGlassGeometry) => quantise(g.width) < 1 || quantise(g.height) < 1;

const to255 = (v: number) => Math.round(Math.min(Math.max(v, 0), 1) * 255);

function rgbCss(r: number, g: number, b: number): string {
  return `rgb(${to255(r)} ${to255(g)} ${to255(b)})`;
}

/**
 * The body, from the model's own law (`./body`, ported from the lens shader §3): density is what
 * legibility and presence demand over THIS backdrop, the tint is the lightness it tints toward,
 * and the hue is the surroundings' — glass has no colour of its own, only the colour of what lies
 * beneath it. A flat fill in place of a tint is what breaks the material.
 */
function bodyCss(
  optics: VireGlassOptics,
  sample: BackdropSample,
  ink: number,
  accent: VireGlassAccent | undefined,
  appear: number,
): string {
  // A tinted element takes its colour from the accent rather than from its surroundings, but it is
  // still the MEDIUM that is coloured: the amount stays short of one so the content keeps coming
  // through. A fill at full opacity is the thing §7 says breaks the material.
  if (accent) {
    const settled = applyAppear(optics, appear);
    const body = withPresence(resolveBody(settled, sample, ink), settled, sample);
    const [r, g, b] = accentTone(accent.color, sample.luma);
    const amount = Math.max(accentAmount(accent), body.density);
    return `rgba(${to255(r)}, ${to255(g)}, ${to255(b)}, ${amount.toFixed(3)})`;
  }

  const layer = bodyLayer(optics, sample, ink, ambientFrom(sample), appear);
  return `rgba(${to255(layer.r)}, ${to255(layer.g)}, ${to255(layer.b)}, ${layer.alpha.toFixed(3)})`;
}

export type AttachGlassOptions = {
  material?: Partial<VireGlassMaterial>;
  /** Defaults to the element's measured box (size + `border-radius`). */
  geometry?: VireGlassGeometry;
  /** Key-light direction in screen space; defaults to the light at rest. */
  light?: readonly [number, number];
  /** Whether `attachGlass` writes `box-shadow` itself. Turn it off if the host owns that property —
   *   is always emitted either way. */
  shadow?: boolean;
  /**
   * The user's clear-to-tinted preference (§3). iOS 27 made it continuous and apps get it without
   * recompiling, so the material has to stay usable across the WHOLE range, not at one point.
   */
  scale?: number;
  /** System accessibility (§9). Read from the browser's own media queries unless supplied. */
  accessibility?: VireGlassAccessibility;
  /**
   * Tint for a primary action (§7). A colour that belongs to the medium, generating a range of
   * tones from the backdrop's brightness — not a fill. Use it on the one element that should stand
   * out: "when every element is tinted, nothing stands out" (219 @17:31).
   */
  accent?: VireGlassAccent;
  /** Initial presence, 0 to 1 (§1). Defaults to fully present. */
  appear?: number;
  /**
   * `'interactive'` is glass that is not there until it is touched (S 42:34, "Building Tide Guide"): "this effect doesn't
   * change the appearance of a view until you interact with it... as you start sliding it, the
   * interactive effect adds a soft, subtle highlight". The element carries no material at rest and
   * materialises under the finger — §1's materialising, driven by touch instead of by the host.
   *
   * It is what makes glass usable on a control that is not chrome: a slider thumb, a chart scrubber,
   * a card. Permanent glass there would be glass in the content layer, which §6 says to avoid.
   */
  variant?: 'present' | 'interactive';
  /** Called while this element is being touched, so a group can carry the glow to its neighbours
   *  (§5). Wired for you by `createGlassGroup`. */
  onGlow?: (glow: { pageX: number; pageY: number; strength: number } | null) => void;
  /** Pointer response (§5). On by default. */
  interactive?: boolean;
  /**
   * Overrides the probe entirely. The probe reads declared backgrounds, so images, video and
   * canvases are invisible to it; a host that knows its backdrop (a cover's accent, a gradient)
   * states it here, and changes it later with `setSample`. `statsFromSamples` builds one from
   * a handful of colours.
   */
  sample?: BackdropSample;
  /**
   * Whether `attachGlass` paints the body as the element's `background-color`. On by default;
   * turn it off if the host owns that property — `--vireglass-body-color` is always emitted
   * either way and carries the same colour.
   */
  body?: boolean;
};

/**
 * Shapes this element flows into (docs/reference.md §5): merging with a neighbour, or splitting
 * into parts across two bridges. Offsets and sizes are CSS px relative to this element's centre.
 *
 * `smoothing` is the width of the bridge — zero leaves the element alone. What each shape MEANS
 * (a menu growing out of its button, a control breaking into segments) is the host's choreography;
 * the material only knows how two silhouettes join.
 */
export type GlassMorph = {
  smoothing: number;
  shape?: MorphShape;
  shape2?: MorphShape;
  /**
   * Any number of shapes flowing into this one. Several independent elements becoming one whole is
   * the behaviour; how many of them there are is the host's business, and it used to be the
   * material's — the count lived in the field NAMES, so a fourth element had nowhere to go.
   *
   * `shape` and `shape2` still work and come first.
   */
  shapes?: readonly MorphShape[];
};

/** Where a motion ends, announced when it starts. */
export type PrepareTarget = {
  /** The final box. */
  geometry: VireGlassGeometry;
  /** The final morph; absent keeps the current one, `null` means none. */
  morph?: GlassMorph | null;
  /** The final material, over the one the lens was attached with. */
  material?: Partial<VireGlassMaterial>;
  /** The backdrop of the destination. At `land()` the lens takes its tint, ink, body, rim and shadow from it without probing. */
  sample?: BackdropSample;
  /** The destination's box in the viewport: with no `sample`, an idle lens probes there. */
  rect?: { left: number; top: number; width: number; height: number };
};

export type GlassHandle = {
  update(): void;
  /**
   * How present the material is, 0 to 1 (docs/reference.md §1). Drive this to bring glass in and
   * out — NOT opacity. "Instead of fading, Liquid Glass objects materialize in and out by
   * gradually modulating the light bending and lensing" (219 @2:55). A faded element shows the
   * backdrop through a veil; one that is still arriving shows it undistorted.
   */
  setAppear(t: number): void;
  /** Tint the element, or clear it with null (§7). */
  setAccent(accent: VireGlassAccent | null): void;
  /** A glow that started on a neighbour, in page coordinates (§5). Null clears it. */
  setNeighbourGlow(glow: { pageX: number; pageY: number; strength: number } | null): void;
  setMorph(morph: GlassMorph | null): void;
  /**
   * While on, the element is changing shape every frame (a morph, a drag, a growth). It stops
   * probing the backdrop, stops baking on the main thread and keeps its filter. A change of the box,
   * of `setMorph` shapes or of the material asks a worker for a pair of maps (displacement and
   * hue), shown once both have decoded; the strength follows the live box meanwhile. Turning it
   * off on a lens that shows the pair for its box changes nothing; otherwise it does one
   * full-resolution rebuild and one probe. With no call for 2 s it turns itself off; calling it on again restarts
   * the 2 s, which is how a host keeps a gesture held still interim. Turning it off twice does nothing. `setInterim(false)` is `land()`.
   */
  setInterim(on: boolean): void;
  /**
   * Announces where the motion ends: the lens builds and decodes the pair of maps for `target` ahead (in the worker
   * when there is one, with priority over interim maps), and holds it for `land()`. The newest call wins; a
   * superseded pair goes to the cache and is never shown. Call it when the motion starts, or while idle for a
   * destination that may be reached. `null` forgets it.
   */
  prepare(target: PrepareTarget | null): void;
  /**
   * Ends interim on the prepared destination, or on the current box when nothing was prepared. A decoded pair is
   * written in this task, with no timer, probe or bake, and returns `'exact'`. Otherwise the shown pair is blended
   * into the destination's over about 120 ms as soon as it is ready, and returns `'blend'`. Call it in the
   * motion's last frame, after the host has set the final box and `setMorph`.
   */
  land(): 'exact' | 'blend';
  /** Resolves when the prepared pair is decoded, or has failed, or nothing is prepared. */
  whenPrepared(): Promise<void>;
  /**
   * Replaces the backdrop the glass adapts to, without re-attaching, and repaints. The same
   * object as `sample` in the options; `null` goes back to probing declared backgrounds.
   */
  setSample(sample: BackdropSample | null): void;
  destroy(): void;
};

export function attachGlass(el: HTMLElement, opts: AttachGlassOptions = {}): GlassHandle {
  if (typeof document === 'undefined') {
    throw new Error('vireglass/dom: attachGlass requires a browser DOM');
  }

  // One live instance per element. Re-attaching without destroying the previous handle used to
  // leave its filter in the shared <defs> forever, unreferenced, while the element quietly moved
  // to the new id.
  attached.get(el)?.destroy();

  const id = `vireglass-filter-${(filterCounter += 1)}`;
  const svgSupported = supportsSvgBackdropFilter();
  let wasLight = (opts.material?.ink ?? VIREGLASS_MATERIAL.ink) > 0.5;
  let filterEl: SVGFilterElement | null = null;
  let destroyed = false;
  let prepared: Prepared | null = null;
  let preparedToken = 0;
  let destJob: { p: Prepared; cancel(): boolean } | null = null;
  let destWanted: Prepared | null = null;
  let landing: Prepared | null = null;
  let blend: Blend | null = null;
  let landingNow = false;
  let waiters: (() => void)[] = [];
  let easeTimer: ReturnType<typeof setTimeout> | null = null;
  let onVisible: (() => void) | null = null;
  let mapKey = '';
  // The key of the pair on the filter, and the interim record it came from, if it did.
  let shownKey = '';
  let shownRec: InterimMap | null = null;
  let interim = false;
  let settling = false;
  let lastSample: BackdropSample | null = null;
  let seq = 0;
  let shownSeq = 0;
  // A landing whose maps wait for the next frame; a second landing of the same maps joins it.
  let deferred: { key: string; filter: SVGFilterElement; mine: number } | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const interimMaps = createLru<InterimMap>(8, (rec) => {
    if (isPinned(rec)) rec.evicted = true;
    else releaseRecord(rec);
  });
  // The newest interim key asked for, the worker build in flight, and the one to build when it lands.
  let latestKey = '';
  let building: PendingBuild | null = null;
  let wanted: PendingBuild | null = null;
  let morph: GlassMorph | null = null;
  const onlyWhenTouched = opts.variant === 'interactive';
  let appear = onlyWhenTouched ? 0 : (opts.appear ?? 1);
  let lastAppear = appear;
  let accent = opts.accent;
  let supplied = opts.sample;
  // Read once at attach, then followed: a setting turned on while the page is open has to reach
  // the material, not wait for a reload.
  let a11y = systemAccessibility();
  const stopWatchingA11y = watchAccessibility((next) => {
    a11y = next;
    mapKey = '';
    deform.setElastic(elasticAllowed(opts.accessibility ?? a11y));
    apply();
  });

  warnIfNested(el);

  // The element's own tree: a shadow root when it is in one, the document otherwise.
  const host = hostFor(el);
  ensureRimStyles(host);
  el.setAttribute(GLASS_ATTR, '');
  // `inset: 0` on the rim needs a positioned ancestor. Only taken over when the host left it at
  // the initial value, and put back on destroy.
  const restoreBackground = holdProperty(el.style, 'background-color');
  const positionWasStatic = getComputedStyle(el).position === 'static';
  if (positionWasStatic) el.style.setProperty('position', 'relative');

  /**
   * Causes to effects, then the user's scale, then accessibility — in that order. §9 is explicit
   * that a system setting outranks the material preset: even a transparent preset moves to the
   * edge of the scale under increased contrast, because the user needs contrast more than they
   * need the aesthetic.
   */
  function settledOptics(patch?: Partial<VireGlassMaterial>): VireGlassOptics {
    const base = resolveOptics(patch ?? opts.material);
    const scaled = applyGlassScale(base, opts.scale ?? GLASS_SCALE_DEFAULT);
    return applyAccessibility(scaled, opts.accessibility ?? a11y);
  }

  function optics(patch?: Partial<VireGlassMaterial>): VireGlassOptics {
    // Appearance last, and by modulating the lens rather than by fading the element: §1 is
    // explicit that opacity is the wrong instrument for this.
    return applyAppear(settledOptics(patch), appear);
  }

  function morphStateOf(m: GlassMorph | null) {
    if (!m) return {};
    return { smoothing: m.smoothing, morph: m.shape, morph2: m.shape2, morphs: m.shapes };
  }

  function morphSignatureOf(m: GlassMorph | null): string {
    return m ? JSON.stringify([m.smoothing, m.shape, m.shape2, m.shapes]) : '0';
  }

  const morphState = () => morphStateOf(morph);
  const morphSignature = () => morphSignatureOf(morph);

  function isPinned(rec: InterimMap): boolean {
    return rec === shownRec || rec === prepared?.rec || rec === landing?.rec;
  }

  function maybeRelease(rec: InterimMap | null | undefined): void {
    if (rec && rec.evicted && !isPinned(rec)) releaseRecord(rec);
  }

  function setShown(rec: InterimMap | null): void {
    const prev = shownRec;
    shownRec = rec;
    if (prev && prev !== rec) maybeRelease(prev);
  }

  function offscreen(): boolean {
    if (!el.isConnected) return true;
    const r = el.getBoundingClientRect();
    return r.bottom < 0 || r.right < 0 || r.top > window.innerHeight || r.left > window.innerWidth;
  }

  /** Keeps a pair in the lens's store and under the byte budget. */
  function remember(rec: InterimMap): void {
    interimMaps.set(rec.key, rec);
    rec.budget = { bytes: pairBytes(rec.map, rec.hue), offscreen, pinned: () => !rec.ready || isPinned(rec), evict: () => interimMaps.delete(rec.key, rec) };
    track(rec.budget);
  }

  function decodeRec(rec: InterimMap, then?: () => void): Promise<void> {
    return Promise.all([decoded(rec.map.url), rec.hue ? decoded(rec.hue.url) : undefined]).then(() => {
      rec.ready = true;
      then?.();
    });
  }

  /** The interim pair of this key, if it has everything the filter shows. */
  function adoptable(key: string, spectral: boolean): InterimMap | undefined {
    const rec = interimMaps.get(key);
    if (rec?.budget) touch(rec.budget);
    return rec && (!spectral || rec.hue) ? rec : undefined;
  }

  /** A pair the settled cache already holds, as a record of this lens. */
  function cachedRec(key: string, full: VireGlassOptics, geometry: VireGlassGeometry, dpr: number, state: DisplacementState, hue: boolean): InterimMap | undefined {
    if (!isCached(`d|${key}`) || (hue && !isCached(`h|${key}`))) return undefined;
    const rec: InterimMap = {
      key,
      map: cached(`d|${key}`, () => buildDisplacementMap(full, geometry, dpr, state)),
      hue: hue ? cached(`h|${key}`, () => buildSpectralMap(full, geometry, dpr, state)) : null,
      ready: false,
      geometry,
    };
    remember(rec);
    return rec;
  }

  /** Drops every pending decode: whatever installs a map synchronously supersedes them. */
  function invalidate(): void {
    seq += 1;
    shownSeq = seq;
  }

  function keepInterim(): void {
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = setTimeout(leaveInterim, INTERIM_IDLE_MS);
  }

  function leaveInterim(): void {
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = null;
    if (destroyed || !interim) return;
    interim = false;
    latestKey = '';
    invalidate();
    mapKey = '';
    settling = true;
    apply();
  }

  function retarget(f: SVGFilterElement, map: DisplacementMap, hue: SpectralMap | null, rec: InterimMap | null, key: string): void {
    const images = f.querySelectorAll('feImage');
    if (images[0]) writeAttr(images[0], 'href', map.url);
    if (hue && images[1]) writeAttr(images[1], 'href', hue.url);
    setShown(rec);
    shownKey = key;
    present(f);
  }

  /**
   * The maps are baked at full presence and appear is these attributes. The spectral hue is
   * `1 + appear * (hue - 1)`, so mixing the full one in is the same picture. The strength follows
   * the live box, not the box the shown map was baked for.
   */
  function present(f: SVGFilterElement, live?: VireGlassGeometry): void {
    const o = optics();
    const scale = displacementScale(o, live ?? opts.geometry ?? measureGeometry(el));
    const full = settledOptics();
    // EVERY pass, with its own share of the scale: see paintInteraction.
    for (const pass of f.querySelectorAll('feDisplacementMap')) {
      const channel = pass.getAttribute('data-vireglass-channel') as Channel | null;
      if (channel) writeAttr(pass, 'data-vireglass-ratio', String(channelRatio(full, channel)));
      const ratio = Number(pass.getAttribute('data-vireglass-ratio') ?? 1);
      writeAttr(pass, 'scale', String(scale * (Number.isFinite(ratio) ? ratio : 1)));
    }
    const frost = f.querySelector('feGaussianBlur');
    if (frost) writeAttr(frost, 'stdDeviation', String(Math.max(o.blur, 0)));
    const hue = f.querySelector('feComposite[in2="hue"]');
    if (hue) {
      const headroom = Number(hue.getAttribute('data-vireglass-headroom') ?? 1);
      writeAttr(hue, 'k1', String(headroom * appear));
      writeAttr(hue, 'k2', String(1 - appear));
    }
  }

  function requestInterimMap(measured?: VireGlassGeometry, onMainThread = false): void {
    if (!svgSupported || !filterEl || destroyed) return;
    const live = measured ?? opts.geometry ?? measureGeometry(el);
    if (isEmpty(live)) return;
    const full = settledOptics();
    const dpr = devicePixelRatio();
    const geometry = snapGeometry(live);
    const key = mapKeyFor(geometry, morphSignature(), full, dpr);
    if (key === latestKey) return;
    latestKey = key;
    const hue = hasSpectralEdge(full) && filterEl.querySelectorAll('feImage').length > 1;
    let rec = adoptable(key, hue) ?? cachedRec(key, full, geometry, dpr, morphState(), hue);
    if (!rec && !onMainThread && interimBuilder().ready()) {
      bump('reducedBakes');
      wanted = { key, mine: (seq += 1), forFilter: filterEl, optics: full, geometry, dpr, state: morphState(), hue };
      if (!building) pump();
      return;
    }
    if (!rec) {
      bump('reducedBakes');
      bump('mainThreadBakes');
      const built = { key, map: buildDisplacementMap(full, geometry, dpr, morphState()), hue: null, ready: false, geometry };
      remember(built);
      showInterim((seq += 1), built, filterEl);
      return;
    }
    wanted = null;
    showInterim((seq += 1), rec, filterEl);
  }

  function showInterim(mine: number, record: InterimMap, forFilter: SVGFilterElement): void {
    const show = () => {
      if (destroyed || filterEl !== forFilter || mine <= shownSeq) return;
      shownSeq = mine;
      retarget(forFilter, record.map, record.hue, record, record.key);
    };
    if (record.ready) {
      show();
      return;
    }
    void decodeRec(record, show);
  }

  function pump(): void {
    const job = wanted;
    wanted = null;
    if (!job || destroyed || !interim || job.key !== latestKey || job.forFilter !== filterEl) return;
    const hit = interimMaps.get(job.key);
    if (hit) {
      showInterim(job.mine, hit, job.forFilter);
      return;
    }
    building = job;
    interimBuilder()
      .build(job.optics, job.geometry, job.dpr, job.state, job.hue)
      .then(
        (pair) => {
          building = null;
          bump('workerBakes');
          landBuilt(job, pair);
          pump();
        },
        (error: WorkerFailure) => {
          building = null;
          if (!error.silent) reportFailure(error);
          recoverOnMainThread(job, error.timedOut);
        },
      );
  }

  function landBuilt(job: PendingBuild, pair: InterimPair): void {
    if (destroyed || filterEl !== job.forFilter || !interim || job.mine <= shownSeq) {
      releaseMap(pair.map.url);
      if (pair.hue) releaseMap(pair.hue.url);
      return;
    }
    const rec: InterimMap = { ...pair, key: job.key, ready: false, geometry: job.geometry };
    remember(rec);
    showInterim(job.mine, rec, job.forFilter);
  }

  function recoverOnMainThread(job: PendingBuild, onMainThread = false): void {
    wanted = null;
    if (destroyed || !interim || filterEl !== job.forFilter) return;
    latestKey = '';
    try {
      requestInterimMap(undefined, onMainThread);
    } catch (error) {
      reportFailure(error);
    }
  }

  function describe(geometry: VireGlassGeometry, m: GlassMorph | null, material?: Partial<VireGlassMaterial>) {
    const full = settledOptics(material ? { ...opts.material, ...material } : undefined);
    const snapped = snapGeometry(geometry);
    const dpr = devicePixelRatio();
    return {
      key: mapKeyFor(snapped, morphSignatureOf(m), full, dpr),
      full,
      geometry: snapped,
      dpr,
      state: morphStateOf(m),
      hue: hasSpectralEdge(full),
    };
  }

  const wants = (p: Prepared) => !destroyed && (prepared === p || landing === p);

  function settle(): void {
    if (prepared && !prepared.failed && !prepared.rec?.ready) return;
    const all = waiters;
    waiters = [];
    for (const resolve of all) resolve();
  }

  function holdRec(p: Prepared, rec: InterimMap): void {
    p.rec = rec;
    if (landing === p && document.hidden) {
      installLanding(p);
      return;
    }
    if (rec.ready) {
      pairReady(p);
      return;
    }
    void decodeRec(rec, () => pairReady(p));
  }

  function pairReady(p: Prepared): void {
    if (!wants(p)) return;
    if (landing === p) beginLanding(p);
    settle();
  }

  function failPrepared(p: Prepared): void {
    p.failed = true;
    if (landing === p) landingFailed();
    settle();
  }

  function takePair(p: Prepared, pair: InterimPair): void {
    const existing = adoptable(p.key, p.hue);
    if (existing || destroyed) {
      releaseMap(pair.map.url);
      if (pair.hue) releaseMap(pair.hue.url);
      if (existing && wants(p)) holdRec(p, existing);
      return;
    }
    const rec: InterimMap = { ...pair, key: p.key, ready: false, geometry: p.geometry };
    remember(rec);
    if (wants(p)) holdRec(p, rec);
  }

  function nextDestination(): void {
    const next = destWanted;
    destWanted = null;
    if (next && wants(next) && !next.rec) startPrepared(next);
  }

  function buildOnWorker(p: Prepared): void {
    const job = interimBuilder().build(p.full, p.geometry, p.dpr, p.state, p.hue, 'destination');
    destJob = { p, cancel: job.cancel };
    job.then(
      (pair) => {
        if (destJob?.p === p) destJob = null;
        bump('workerBakes');
        takePair(p, pair);
        nextDestination();
      },
      (error: WorkerFailure) => {
        if (destJob?.p === p) destJob = null;
        if (!error.silent) reportFailure(error);
        if (!error.superseded && wants(p) && !p.rec) buildOnMainThread(p);
        nextDestination();
      },
    );
  }

  /** Slices of 4 ms after a frame, each checking that anyone still wants the result; the encode is a task of its own. */
  function buildOnMainThread(p: Prepared): void {
    void (async () => {
      try {
        await afterNextFrame();
        const control = { sliceMs: 4, live: () => wants(p) && !p.rec };
        if (!control.live()) return;
        const dKey = `d|${p.key}`;
        const hKey = `h|${p.key}`;
        const map = isCached(dKey)
          ? cached(dKey, () => buildDisplacementMap(p.full, p.geometry, p.dpr, p.state))
          : await buildDisplacementMapInSlices(p.full, p.geometry, p.dpr, p.state, control);
        cached(dKey, () => map);
        let hue: SpectralMap | null = null;
        if (p.hue) {
          hue = isCached(hKey)
            ? cached(hKey, () => buildSpectralMap(p.full, p.geometry, p.dpr, p.state))
            : await buildSpectralMapInSlices(p.full, p.geometry, p.dpr, p.state, control);
          const built = hue;
          cached(hKey, () => built);
        }
        if (!control.live()) return;
        bump('mainThreadBakes');
        const rec: InterimMap = { key: p.key, map, hue, ready: false, geometry: p.geometry };
        remember(rec);
        holdRec(p, rec);
      } catch (error) {
        if (error instanceof Superseded) return;
        reportFailure(error);
        if (wants(p)) failPrepared(p);
      }
    })();
  }

  function startPrepared(p: Prepared): void {
    const hit = adoptable(p.key, p.hue) ?? cachedRec(p.key, p.full, p.geometry, p.dpr, p.state, p.hue);
    if (hit) {
      holdRec(p, hit);
      return;
    }
    if (destJob && destJob.p !== landing && destJob.cancel()) destJob = null;
    if (destJob) {
      destWanted = p;
      return;
    }
    if (interimBuilder().ready()) buildOnWorker(p);
    else buildOnMainThread(p);
  }

  function endInterim(): void {
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = null;
    interim = false;
    latestKey = '';
    wanted = null;
    invalidate();
  }

  function abandonLanding(): void {
    blend?.stop();
    blend = null;
    const old = landing;
    landing = null;
    if (old) {
      mapKey = '';
      maybeRelease(old.rec);
    }
  }

  function finishBlend(): void {
    if (!blend) return;
    blend.stop();
    blend = null;
    if (landing?.rec) installLanding(landing);
  }

  function beginLanding(p: Prepared): void {
    const rec = p.rec;
    if (!rec || !filterEl || landing !== p) return;
    const sameStructure = filterEl.getAttribute('data-vireglass-signature') === filterSignature(p.full.iorSpread, p.hue);
    if (document.hidden || !sameStructure) {
      installLanding(p);
      return;
    }
    let ran = false;
    const started = startBlend(filterEl, { mapUrl: rec.map.url, hueUrl: rec.hue?.url ?? null }, () => {
      ran = true;
      blend = null;
      installLanding(p);
    });
    if (!ran) blend = started;
  }

  function landingFailed(): void {
    abandonLanding();
    settling = true;
    landingNow = true;
    try {
      apply();
    } finally {
      landingNow = false;
    }
  }

  /** Writes the destination pair: the hrefs and the presentation in this task. A filter of another structure is replaced. */
  function installLanding(p: Prepared): void {
    const rec = p.rec;
    if (!rec || destroyed) return;
    blend?.stop();
    blend = null;
    if (landing === p) landing = null;
    if (prepared === p) prepared = null;
    invalidate();
    if (filterEl) {
      const signature = filterSignature(p.full.iorSpread, p.hue);
      if (filterEl.getAttribute('data-vireglass-signature') === signature) {
        retarget(filterEl, rec.map, rec.hue, rec, p.key);
      } else {
        const defs = getFilterHost(host).querySelector('defs') as SVGDefsElement;
        const next = buildFilterElement(id, rec.map.url, p.full, rec.map.scale, rec.hue);
        next.setAttribute('data-vireglass-signature', signature);
        if (filterEl.parentNode) defs.replaceChild(next, filterEl);
        else defs.appendChild(next);
        bump('filterSwaps');
        bump('syncSwaps');
        filterEl = next;
        shownKey = p.key;
        setShown(rec);
      }
    }
    mapKey = p.key;
    settling = false;
    const was = landingNow;
    landingNow = true;
    try {
      apply();
    } finally {
      landingNow = was;
    }
    if (!rec.ready) verifyWhenVisible(rec);
    settle();
  }

  /** A page that was hidden drew no frame and decoded nothing: when it is shown again, decode, and land the lens properly if it moved meanwhile. */
  function verifyWhenVisible(rec: InterimMap): void {
    if (onVisible || typeof document === 'undefined') return;
    onVisible = () => {
      if (document.hidden) return;
      document.removeEventListener('visibilitychange', onVisible!);
      onVisible = null;
      void decodeRec(rec).then(() => {
        if (destroyed || interim) return;
        const g = opts.geometry ?? measureGeometry(el);
        if (isEmpty(g) || describe(g, morph).key === shownKey) return;
        mapKey = '';
        settling = true;
        apply();
      });
    };
    document.addEventListener('visibilitychange', onVisible);
  }

  function land(): 'exact' | 'blend' {
    if (destroyed) return 'exact';
    finishBlend();
    landingNow = true;
    try {
      return landOn();
    } finally {
      landingNow = false;
    }
  }

  function landOn(): 'exact' | 'blend' {
    const exact = (): 'exact' => {
      bump('landedExact');
      return 'exact';
    };
    let p = prepared;
    if (!svgSupported || !filterEl) {
      endInterim();
      mapKey = '';
      apply();
      return exact();
    }
    const current = opts.geometry ?? measureGeometry(el);
    if (!p) {
      if (isEmpty(current)) {
        endInterim();
        apply();
        return exact();
      }
      const d = describe(current, morph);
      if (d.key === shownKey) {
        endInterim();
        mapKey = d.key;
        settling = false;
        apply();
        return exact();
      }
      p = prepared = { token: (preparedToken += 1), ...d, sample: null, rec: null, failed: false };
      startPrepared(p);
    } else if (p.key === shownKey) {
      endInterim();
      if (p.sample) lastSample = p.sample;
      prepared = null;
      maybeRelease(p.rec);
      mapKey = p.key;
      settling = false;
      apply();
      settle();
      return exact();
    }
    endInterim();
    if (p.sample) lastSample = p.sample;
    if (p.rec && (p.rec.ready || document.hidden)) {
      installLanding(p);
      return exact();
    }
    landing = p;
    mapKey = p.key;
    settling = false;
    bump('landedBlend');
    apply();
    if (p.failed) landingFailed();
    return 'blend';
  }

  function prepare(target: PrepareTarget | null): void {
    if (destroyed) return;
    const old = prepared;
    if (!target) {
      prepared = null;
      maybeRelease(old?.rec);
      settle();
      return;
    }
    if (!svgSupported || isEmpty(target.geometry)) return;
    const m = target.morph === undefined ? morph : target.morph && target.morph.smoothing > 0 ? target.morph : null;
    const p: Prepared = {
      token: (preparedToken += 1),
      ...describe(target.geometry, m, target.material),
      sample: target.sample ?? null,
      rec: null,
      failed: false,
    };
    prepared = p;
    maybeRelease(old?.rec);
    startPrepared(p);
    const rect = target.rect;
    if (rect && !p.sample && !interim) {
      void afterNextFrame().then(() => {
        if (destroyed || prepared !== p || p.sample || interim) return;
        p.sample = probe(el, rect);
      });
    }
  }

  function whenPrepared(): Promise<void> {
    return new Promise((resolve) => {
      waiters.push(resolve);
      settle();
    });
  }

  /** Eases the colours to a backdrop that really changed: not on a landing, a motion or a change of presence. */
  function easeTo(): void {
    el.setAttribute('data-vireglass-ease', '');
    if (easeTimer !== null) clearTimeout(easeTimer);
    easeTimer = setTimeout(() => {
      easeTimer = null;
      el.removeAttribute('data-vireglass-ease');
    }, EASE_MS + 60);
  }

  function apply(): void {
    if (destroyed) return;
    if (interim) keepInterim();
    const geometry = opts.geometry ?? measureGeometry(el);
    const opticsNow = optics();
    const before = lastSample;
    const held = (interim || landingNow) && lastSample;
    if (landingNow && !supplied && !held) bump('probesAtLand');
    const sample = supplied ?? (held ? lastSample! : probe(el));
    lastSample = sample;
    if (!interim && !landingNow && appear === lastAppear && before && sampleMoved(before, sample)) easeTo();
    lastAppear = appear;
    const light = shouldInkBeLight(sample, wasLight);
    wasLight = light;
    const body = opts.body === false ? null : bodyCss(settledOptics(), sample, light ? 1 : 0, accent, appear);

    if (svgSupported) {
      // The map depends only on geometry, optics and density — never on the backdrop. Rebuilding
      // it on every scroll would re-run a per-pixel loop and a PNG encode for a picture that did
      // not change; the refraction itself updates in the compositor with no JS at all.
      const full = settledOptics();
      const dpr = devicePixelRatio();
      const snapped = snapGeometry(geometry);
      // The same key the interim pairs are made under, so a lens that lands on a pair it showed keeps it.
      const key = mapKeyFor(snapped, morphSignature(), full, dpr);
      if (interim && filterEl) {
        requestInterimMap(geometry);
      } else if (isEmpty(geometry)) {
        // Nothing to refract in a box of no size; the next resize bakes it.
      } else if (key !== mapKey || !filterEl) {
        const morphNow = morphState();
        const spectral = hasSpectralEdge(full);
        const adopted = adoptable(key, spectral);
        const bakeMap = () =>
          adopted?.map ??
          cached(`d|${key}`, () => {
            bump('fullBakes');
            return buildDisplacementMap(full, snapped, dpr, morphNow);
          });
        const bakeHue = () =>
          spectral
            ? (adopted?.hue ??
              cached(`h|${key}`, () => {
                bump('fullBakes');
                return buildSpectralMap(full, snapped, dpr, morphNow);
              }))
            : null;
        const bakeMapInSlices = async () => {
          if (adopted || isCached(`d|${key}`)) return bakeMap();
          const built = await buildDisplacementMapInSlices(full, snapped, dpr, morphNow);
          return cached(`d|${key}`, () => (bump('fullBakes'), built));
        };
        const bakeHueInSlices = async () => {
          if (!spectral || adopted || isCached(`h|${key}`)) return bakeHue();
          const built = await buildSpectralMapInSlices(full, snapped, dpr, morphNow);
          return cached(`h|${key}`, () => (bump('fullBakes'), built));
        };
        const signature = filterSignature(full.iorSpread, spectral);
        if (settling && filterEl?.getAttribute('data-vireglass-signature') === signature) {
          settling = false;
          const forFilter = filterEl;
          const forKey = key;
          const current = (mine: number) => !destroyed && !interim && el.isConnected && filterEl === forFilter && mapKey === forKey && mine > shownSeq;
          const land = (mine: number, map: DisplacementMap, mapReady: Promise<void>, hue: SpectralMap | null) =>
            Promise.all([mapReady, hue ? decoded(hue.url) : undefined]).then(() => {
              if (!current(mine)) return;
              shownSeq = mine;
              retarget(forFilter, map, hue, adopted ?? null, forKey);
            });
          const mapCached = isCached(`d|${key}`);
          const hueCached = !spectral || isCached(`h|${key}`);
          if (adopted?.ready) {
            shownSeq = seq += 1;
            retarget(forFilter, adopted.map, adopted.hue, adopted, forKey);
          } else if (adopted || (mapCached && hueCached)) {
            const map = bakeMap();
            void land((seq += 1), map, decoded(map.url), bakeHue());
          } else if (deferred && deferred.key === key && deferred.filter === forFilter) {
            deferred.mine = seq += 1;
          } else {
            // After the next frame, in slices of a few ms: baked in the task that lands, the maps made it a long task.
            const entry = (deferred = { key, filter: forFilter, mine: (seq += 1) });
            const rearm = () => {
              mapKey = '';
              settling = true;
            };
            const ours = () => !destroyed && !interim && filterEl === forFilter && mapKey === forKey && entry.mine > shownSeq;
            void (async () => {
              try {
                await afterNextFrame();
                if (current(entry.mine)) {
                  const map = await bakeMapInSlices();
                  const mapReady = decoded(map.url);
                  const hue = current(entry.mine) ? await bakeHueInSlices() : null;
                  if (current(entry.mine)) {
                    if (deferred === entry) deferred = null;
                    await land(entry.mine, map, mapReady, hue);
                    return;
                  }
                }
                // Out of the document, the lens is landed by the next apply() once it is back.
                if (ours() && !el.isConnected) rearm();
              } catch (error) {
                if (ours()) rearm();
                reportFailure(error);
              } finally {
                if (deferred === entry) deferred = null;
              }
            })();
          }
        } else {
          const map = bakeMap();
          const hue = bakeHue();
          settling = false;
          invalidate();
          const defs = getFilterHost(host).querySelector('defs') as SVGDefsElement;
          const next = buildFilterElement(id, map.url, full, map.scale, hue);
          next.setAttribute('data-vireglass-signature', signature);
          if (filterEl?.parentNode) defs.replaceChild(next, filterEl);
          else defs.appendChild(next);
          bump('filterSwaps');
          filterEl = next;
          shownKey = key;
          setShown(adopted ?? null);
        }
        mapKey = key;
      }
      if (filterEl) present(filterEl, geometry);
      el.style.setProperty('backdrop-filter', `url(#${id})`);
      el.style.setProperty('-webkit-backdrop-filter', `url(#${id})`);
    } else {
      el.style.setProperty('backdrop-filter', fallbackFilterCss(opticsNow));
      el.style.setProperty('-webkit-backdrop-filter', fallbackFilterCss(opticsNow));
    }
    if (body) el.style.backgroundColor = body;

    const [tr, tg, tb] = ambientFrom(sample);
    el.style.setProperty('--vireglass-ink', light ? '1' : '0');
    el.style.setProperty('--vireglass-tint', `${tr} ${tg} ${tb}`);
    el.style.setProperty('--vireglass-body-density', String(opticsNow.bodyDensity));

    // The raw numbers above are the model's own values; these are the same thing in a form CSS
    // can actually consume. Without them a host has to convert in script, which is the work this
    // renderer exists to do.
    const inkLevel = Math.round((light ? INK_LIGHT : INK_DARK) * 255);
    el.style.setProperty('--vireglass-ink-color', `rgb(${inkLevel} ${inkLevel} ${inkLevel})`);
    el.style.setProperty('--vireglass-tint-color', rgbCss(tr, tg, tb));
    el.style.setProperty(
      '--vireglass-body-color',
      body ?? bodyCss(settledOptics(), sample, light ? 1 : 0, accent, appear),
    );

    // Rim and shadow follow the SAMPLE, not just the geometry, so they sit outside the map's
    // cache key: the environment they take their colour and density from moves under a scroll
    // while the silhouette does not.
    // §9: under increased contrast the hairline stops reporting where the light is and starts
    // separating the element from what is behind it, so it is measured from the body, not the
    // environment.
    const pole = withPresence(resolveBody(opticsNow, sample, light ? 1 : 0), opticsNow, sample).tintLuma;
    el.style.setProperty(
      '--vireglass-rim',
      (opts.accessibility ?? a11y).increaseContrast
        ? contrastRimCss(pole, contrastRimLuma(pole), appear)
        : rimGradientCss(opticsNow, [tr, tg, tb], opts.light ?? REST_LIGHT, appear),
    );
    el.style.setProperty('--vireglass-rim-width', `${RIM_WIDTH_PX}px`);

    // §11: a rounded child inside glass has to be concentric with it, or the two curves fight.
    // Emitted rather than applied — the inset is the host's, and CSS can do the arithmetic.
    el.style.setProperty('--vireglass-radius', `${geometry.cornerRadius}px`);
    el.style.setProperty('--vireglass-radius-min', `${concentricRadius(geometry.cornerRadius, geometry.cornerRadius, 0)}px`);

    const shadow = boxShadowCss(geometry, sample, appear);
    el.style.setProperty('--vireglass-shadow', shadow);
    if (opts.shadow !== false) el.style.setProperty('box-shadow', shadow);
  }

  apply();

  // INTERACTION (docs/reference.md §5). The physics is the core's — `createDeform` carries the
  // spring, the press attack and the wave, at its own fixed step. What lives here is only the
  // plumbing: pointer in, map and glow out.
  const deform = createDeform({ elastic: elasticAllowed(opts.accessibility ?? a11y) });
  let frame: number | null = null;
  let lastFrameAt = 0;
  let interacting = false;

  function localPoint(e: PointerEvent): [number, number] {
    const rect = el.getBoundingClientRect();
    return [e.clientX - rect.left - rect.width / 2, e.clientY - rect.top - rect.height / 2];
  }

  function paintInteraction(sampleOut: DeformSample): void {
    const geometry = opts.geometry ?? measureGeometry(el);
    const base = optics();
    // Under the finger a matte control stops being frosted and becomes a lens (§5, M 4:10–4:30).
    const rise = raiseIntoGlass(sampleOut.press);
    // The same chain as at rest — the user's scale and the system's settings do not stop
    // applying because a finger is down.
    const risen = optics({ ...opts.material, roughness: (opts.material?.roughness ?? VIREGLASS_MATERIAL.roughness) * rise.solid });

    if (interim) keepInterim();
    // A reduced-resolution map while the finger is down: `feImage` stretches it over the element
    // regardless, the displacement is smooth, and a full device-pixel rebuild plus a PNG encode
    // every frame does not hold a frame budget.
    bump('reducedBakes');
    const map = buildDisplacementMap(risen, geometry, 1, {
      ...morphState(),
      touch: {
        x: sampleOut.touchX,
        y: sampleOut.touchY,
        pullX: sampleOut.pullX,
        pullY: sampleOut.pullY,
        press: sampleOut.press,
        radius: halfMinDp(geometry) * TOUCH_RADIUS_FRACTION,
        waveAmp: sampleOut.waveAmp,
        wavePhase: sampleOut.wavePhase,
      },
    });
    invalidate();
    if (filterEl) {
      const feImage = filterEl.querySelector('feImage');
      feImage?.setAttribute('href', map.url);
      // EVERY pass, not the first. With dispersion there are three at different scales, and
      // querySelector returned only red: under a finger it got the undispersed scale while green
      // and blue kept their attach-time values, and the coloured rim stopped following the finger.
      for (const pass of filterEl.querySelectorAll('feDisplacementMap')) {
        const ratio = Number(pass.getAttribute('data-vireglass-ratio') ?? 1);
        pass.setAttribute('scale', String(map.scale * (Number.isFinite(ratio) ? ratio : 1)));
      }
    }
    mapKey = '';
    shownKey = '';
    latestKey = '';
    setShown(null);

    paintGlow(sampleOut.touchX, sampleOut.touchY, sampleOut.active * base.edgeLight, geometry);

    // "the glow spreads throughout the element and onto any Liquid Glass elements NEARBY" (§5,
    // 219 @12:11). This element cannot know who is nearby; the group does, so it is told.
    const rect = el.getBoundingClientRect();
    opts.onGlow?.({
      pageX: rect.left + rect.width / 2 + sampleOut.touchX,
      pageY: rect.top + rect.height / 2 + sampleOut.touchY,
      strength: sampleOut.active,
    });
  }

  /**
   * The glow is a CONCENTRATION of the surroundings, not the glass's own whiteness: over a dark
   * backdrop the element lightens but never turns white, and ink over it stays legible.
   *
   * `x` and `y` are relative to the element's centre and may fall outside it — a glow that started
   * next door still has a direction, and dropping it to the centre would make a neighbour brighten
   * uniformly rather than from the side the finger is on.
   */
  function paintGlow(x: number, y: number, strength: number, geometry: VireGlassGeometry): void {
    if (strength <= 0.001) {
      el.style.setProperty('--vireglass-glow-opacity', '0');
      return;
    }
    const [gr, gg, gb] = ambientFrom(supplied ?? (interim && lastSample ? lastSample : probe(el)));
    const cx = ((x + geometry.width / 2) / geometry.width) * 100;
    const cy = ((y + geometry.height / 2) / geometry.height) * 100;
    const reach = halfMinDp(geometry) * TOUCH_RADIUS_FRACTION;
    el.style.setProperty(
      '--vireglass-glow',
      `radial-gradient(circle ${reach.toFixed(0)}px at ${cx.toFixed(1)}% ${cy.toFixed(1)}%, rgba(${to255(gr)},${to255(gg)},${to255(gb)},1) 0%, rgba(${to255(gr)},${to255(gg)},${to255(gb)},0) 100%)`,
    );
    el.style.setProperty('--vireglass-glow-opacity', strength.toFixed(3));
  }

  function tick(now: number): void {
    if (destroyed) return;
    const dt = lastFrameAt ? (now - lastFrameAt) / 1000 : 1 / 60;
    lastFrameAt = now;
    deform.step(dt);
    const s = deform.sample();
    // The interactive variant materialises with the touch rather than being held present. `active`
    // rather than `press`: press is the depth of the dent, active is simply whether a finger is
    // there, and the material arriving has to track the second.
    if (onlyWhenTouched) appear = s.active;
    paintInteraction(s);
    if (deform.idle()) {
      interacting = false;
      frame = null;
      lastFrameAt = 0;
      // Settled: put the full-resolution map back and drop the glow.
      el.style.setProperty('--vireglass-glow-opacity', '0');
      opts.onGlow?.(null);
      settling = !interim;
      apply();
      return;
    }
    frame = requestAnimationFrame(tick);
  }

  function run(): void {
    if (frame === null && !destroyed) frame = requestAnimationFrame(tick);
  }

  let grabX = 0;
  let grabY = 0;

  function onDown(e: PointerEvent): void {
    const [x, y] = localPoint(e);
    const geometry = opts.geometry ?? measureGeometry(el);
    interacting = true;
    grabX = x;
    grabY = y;
    // Pointer capture, or a drag that leaves the element stops reporting and the deformation
    // freezes mid-pull with the finger still down.
    el.setPointerCapture?.(e.pointerId);
    deform.grab(x, y, waveImpulse(geometry));
    run();
  }
  function onMove(e: PointerEvent): void {
    if (!interacting) return;
    const [x, y] = localPoint(e);
    const geometry = opts.geometry ?? measureGeometry(el);
    // `drag` takes the travel FROM the grab point, and saturates it against the limit itself.
    deform.drag(x - grabX, y - grabY, halfMinDp(geometry) * MAX_STRETCH);
    run();
  }
  function onUp(e?: PointerEvent): void {
    if (!interacting) return;
    const geometry = opts.geometry ?? measureGeometry(el);
    if (e) el.releasePointerCapture?.(e.pointerId);
    // Lifting throws a second, weaker ring (§5) — the core caps the sum, so this only has to be
    // the smaller impulse.
    deform.release(waveImpulse(geometry) * RELEASE_WAVE);
    run();
  }

  if (opts.interactive !== false) {
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('pointerleave', onUp);
  }

  // The "listener" `destroy()` has to remove: geometry defaults to the measured box, so a resize
  // of the element itself has to rebuild the map, or the displacement drifts from the element's
  // actual silhouette as soon as its layout changes.
  let resizeObserver: ResizeObserver | null = null;
  if (!opts.geometry && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => apply());
    resizeObserver.observe(el);
  }

  function destroy(): void {
    destroyed = true;
    wanted = null;
    destWanted = null;
    destJob?.cancel();
    destJob = null;
    blend?.stop();
    blend = null;
    landing = null;
    prepared = null;
    settle();
    if (onVisible) document.removeEventListener('visibilitychange', onVisible);
    onVisible = null;
    if (easeTimer !== null) clearTimeout(easeTimer);
    easeTimer = null;
    el.removeAttribute('data-vireglass-ease');
    interimMaps.clear();
    setShown(null);
    invalidate();
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = null;
    stopWatchingA11y();
    if (attached.get(el) === handle) attached.delete(el);
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onUp);
    el.removeEventListener('pointerleave', onUp);
    el.style.removeProperty('--vireglass-glow');
    el.style.removeProperty('--vireglass-glow-opacity');
    resizeObserver?.disconnect();
    resizeObserver = null;
    if (filterEl?.parentNode) filterEl.parentNode.removeChild(filterEl);
    filterEl = null;
    mapKey = '';
    el.style.removeProperty('backdrop-filter');
    el.style.removeProperty('-webkit-backdrop-filter');
    if (opts.body !== false) restoreBackground();
    el.style.removeProperty('--vireglass-ink');
    el.style.removeProperty('--vireglass-tint');
    el.style.removeProperty('--vireglass-body-density');
    el.style.removeProperty('--vireglass-ink-color');
    el.style.removeProperty('--vireglass-tint-color');
    el.style.removeProperty('--vireglass-body-color');
    el.style.removeProperty('--vireglass-rim');
    el.style.removeProperty('--vireglass-rim-width');
    el.style.removeProperty('--vireglass-shadow');
    el.style.removeProperty('--vireglass-radius');
    el.style.removeProperty('--vireglass-radius-min');
    el.style.removeProperty('box-shadow');
    el.removeAttribute(GLASS_ATTR);
    if (positionWasStatic) el.style.removeProperty('position');
  }

  const handle: GlassHandle = {
    update: apply,
    setAppear(t) {
      const next = t < 0 ? 0 : t > 1 ? 1 : t;
      if (next === appear) return;
      appear = next;
      apply();
    },
    setAccent(next) {
      accent = next ?? undefined;
      apply();
    },
    setNeighbourGlow(glow) {
      if (destroyed || interacting) return;
      const geometry = opts.geometry ?? measureGeometry(el);
      if (!glow) {
        paintGlow(0, 0, 0, geometry);
        return;
      }
      const rect = el.getBoundingClientRect();
      paintGlow(
        glow.pageX - (rect.left + rect.width / 2),
        glow.pageY - (rect.top + rect.height / 2),
        glow.strength,
        geometry,
      );
    },
    setMorph(next) {
      morph = next && next.smoothing > 0 ? next : null;
      if (landing) abandonLanding();
      if (interim) {
        apply();
        return;
      }
      mapKey = '';
      apply();
    },
    setInterim(on) {
      if (destroyed) return;
      if (on) {
        finishBlend();
        if (landing) abandonLanding();
        // A gesture held still sends no geometry, so a repeat is the host saying it is still moving.
        if (!interim) latestKey = shownKey;
        interim = true;
        keepInterim();
        return;
      }
      if (interim) land();
    },
    prepare,
    land,
    whenPrepared,
    setSample(next) {
      supplied = next ?? undefined;
      apply();
    },
    destroy,
  };
  attached.set(el, handle);
  return handle;
}
