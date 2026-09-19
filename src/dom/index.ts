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
import { buildDisplacementMap } from './displacement';
import { buildSpectralMap, hasSpectralEdge, type SpectralMap } from './spectral-map';
import { cached } from './map-cache';
import { roundedRectGeometry, type VireGlassGeometry } from '../geometry';
import { resolveOptics, VIREGLASS_MATERIAL, type VireGlassMaterial, type VireGlassOptics } from '../material';
import { probeBackdrop } from './probe';
import { supportsSvgBackdropFilter } from './support';
import { boxShadowCss } from './shadow';
import { resolveBody, withPresence } from './body';
import { systemAccessibility, watchAccessibility } from './preferences';
import { applyAccessibility, type VireGlassAccessibility } from '../accessibility';
import { applyGlassScale, GLASS_SCALE_DEFAULT } from '../glass-scale';
import { concentricRadius } from '../concentric';
import { RIM_WIDTH_PX, rimGradientCss } from './rim';
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
const GLASS_ATTR = 'data-vireglass';

/**
 * The hairline rim (docs/reference.md §2) needs a layer of its own over the element. A stylesheet
 * rule on `::after` keeps it out of the host's markup — injecting a child node would fight any
 * framework that owns these children.
 *
 * The mask pair is what makes it a ring rather than a fill: the same box painted twice, once
 * clipped to the content box, composited so only the padding band survives.
 */
function ensureRimStyles(): void {
  if (document.querySelector(`style[${STYLE_ATTR}]`)) return;
  const style = document.createElement('style');
  style.setAttribute(STYLE_ATTR, '');
  style.textContent =
    `[${GLASS_ATTR}]::after{content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;padding:var(--vireglass-rim-width,1px);background:var(--vireglass-rim,none);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);mask-composite:exclude}` +
    // The touch glow (§5) lights the material from the point of contact. Below the content, above
    // the refraction — it is light inside the glass, not a film over the label.
    `[${GLASS_ATTR}]::before{content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:var(--vireglass-glow,none);opacity:var(--vireglass-glow-opacity,0)}`;
  document.head.appendChild(style);
}

function getFilterHost(): SVGSVGElement {
  const existing = document.querySelector<SVGSVGElement>(`svg[${FILTER_HOST_ATTR}]`);
  if (existing) return existing;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute(FILTER_HOST_ATTR, '');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.position = 'absolute';
  svg.style.pointerEvents = 'none';
  svg.appendChild(document.createElementNS(SVG_NS, 'defs'));
  document.body.appendChild(svg);
  return svg;
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
    const base = refractionStrength(optics.ior);
    const ratio = (shift: number) => (base > 0 ? refractionStrength(optics.ior + shift) / base : 1);
    const channels: Array<[string, number, string]> = [
      ['dR', scale * ratio(DISPERSION.redShift * spread), '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0'],
      ['dG', scale, '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0'],
      ['dB', scale * ratio(DISPERSION.blueShift * spread), '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0'],
    ];
    for (const [name, chScale, matrix] of channels) {
      const pass = document.createElementNS(SVG_NS, 'feDisplacementMap');
      pass.setAttribute('in', 'blurred');
      pass.setAttribute('in2', 'map');
      pass.setAttribute('scale', String(chScale));
      pass.setAttribute('xChannelSelector', 'R');
      pass.setAttribute('yChannelSelector', 'G');
      pass.setAttribute('result', `${name}raw`);
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

const to255 = (v: number) => Math.round(Math.min(Math.max(v, 0), 1) * 255);

function rgbCss(r: number, g: number, b: number): string {
  return `rgb(${to255(r)} ${to255(g)} ${to255(b)})`;
}

/**
 * The body, from the model's own law (`./body`, ported from the lens shader §3): density is what
 * legibility and presence demand over THIS backdrop, `tintLuma` is the lightness it tints toward,
 * and the hue is the surroundings' — glass has no colour of its own, only the colour of what lies
 * beneath it. A flat fill in place of a tint is what breaks the material.
 */
function bodyCss(optics: VireGlassOptics, sample: BackdropSample, ink: number): string {
  const body = withPresence(resolveBody(optics, sample, ink), optics, sample);
  const [r, g, b] = ambientFrom(sample);
  const hue = (c: number) => body.tintLuma + (c - body.tintLuma) * optics.colorPickup;
  return `rgba(${to255(hue(r))}, ${to255(hue(g))}, ${to255(hue(b))}, ${body.density.toFixed(3)})`;
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
  /** Pointer response (§5). On by default. */
  interactive?: boolean;
  /** Overrides the probe entirely — images and video are invisible to it, and the host app
   *  already knows its own cover-art accent. */
  sample?: BackdropSample;
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
};

export type GlassHandle = {
  update(): void;
  setMorph(morph: GlassMorph | null): void;
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
  let mapKey = '';
  let morph: GlassMorph | null = null;
  // Read once at attach, then followed: a setting turned on while the page is open has to reach
  // the material, not wait for a reload.
  let a11y = systemAccessibility();
  const stopWatchingA11y = watchAccessibility((next) => {
    a11y = next;
    mapKey = '';
    apply();
  });

  ensureRimStyles();
  el.setAttribute(GLASS_ATTR, '');
  // `inset: 0` on the rim needs a positioned ancestor. Only taken over when the host left it at
  // the initial value, and put back on destroy.
  const positionWasStatic = getComputedStyle(el).position === 'static';
  if (positionWasStatic) el.style.setProperty('position', 'relative');

  /**
   * Causes to effects, then the user's scale, then accessibility — in that order. §9 is explicit
   * that a system setting outranks the material preset: even a transparent preset moves to the
   * edge of the scale under increased contrast, because the user needs contrast more than they
   * need the aesthetic.
   */
  function optics(patch?: Partial<VireGlassMaterial>): VireGlassOptics {
    const base = resolveOptics(patch ?? opts.material);
    const scaled = applyGlassScale(base, opts.scale ?? GLASS_SCALE_DEFAULT);
    return applyAccessibility(scaled, opts.accessibility ?? a11y);
  }

  function morphState() {
    if (!morph) return {};
    return { smoothing: morph.smoothing, morph: morph.shape, morph2: morph.shape2 };
  }

  function morphKey(): string {
    if (!morph) return '0';
    const part = (s?: MorphShape) =>
      s ? `${s.offsetX},${s.offsetY},${s.width},${s.height},${s.cornerRadius}` : '-';
    return `${morph.smoothing}/${part(morph.shape)}/${part(morph.shape2)}`;
  }

  function apply(): void {
    if (destroyed) return;
    const geometry = opts.geometry ?? measureGeometry(el);
    const opticsNow = optics();
    const sample = opts.sample ?? probeBackdrop(el);

    if (svgSupported) {
      // The map depends only on geometry, optics and density — never on the backdrop. Rebuilding
      // it on every scroll would re-run a per-pixel loop and a PNG encode for a picture that did
      // not change; the refraction itself updates in the compositor with no JS at all.
      const key = `m${morphKey()}|${geometry.width}x${geometry.height}r${geometry.cornerRadius}@${devicePixelRatio()}:${opticsNow.refraction}:${opticsNow.refractionScale}:${opticsNow.bevelDp}:${opticsNow.blur}`;
      if (key !== mapKey || !filterEl) {
        // Keyed by exactly what the maps are functions of, which is exactly the cache key above.
        const map = cached(`d|${key}`, () => buildDisplacementMap(opticsNow, geometry, devicePixelRatio(), morphState()));
        const defs = getFilterHost().querySelector('defs') as SVGDefsElement;
        const hue = hasSpectralEdge(opticsNow)
          ? cached(`h|${key}`, () => buildSpectralMap(opticsNow, geometry, devicePixelRatio()))
          : null;
        const next = buildFilterElement(id, map.url, opticsNow, map.scale, hue);
        if (filterEl?.parentNode) defs.replaceChild(next, filterEl);
        else defs.appendChild(next);
        filterEl = next;
        mapKey = key;
      }
      el.style.setProperty('backdrop-filter', `url(#${id})`);
      el.style.setProperty('-webkit-backdrop-filter', `url(#${id})`);
    } else {
      el.style.setProperty('backdrop-filter', fallbackFilterCss(opticsNow));
      el.style.setProperty('-webkit-backdrop-filter', fallbackFilterCss(opticsNow));
      el.style.backgroundColor = bodyCss(opticsNow, sample, wasLight ? 1 : 0);
    }

    const light = shouldInkBeLight(sample, wasLight);
    wasLight = light;
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
    el.style.setProperty('--vireglass-body-color', bodyCss(opticsNow, sample, light ? 1 : 0));

    // Rim and shadow follow the SAMPLE, not just the geometry, so they sit outside the map's
    // cache key: the environment they take their colour and density from moves under a scroll
    // while the silhouette does not.
    el.style.setProperty('--vireglass-rim', rimGradientCss(opticsNow, [tr, tg, tb], opts.light ?? REST_LIGHT));
    el.style.setProperty('--vireglass-rim-width', `${RIM_WIDTH_PX}px`);

    // §11: a rounded child inside glass has to be concentric with it, or the two curves fight.
    // Emitted rather than applied — the inset is the host's, and CSS can do the arithmetic.
    el.style.setProperty('--vireglass-radius', `${geometry.cornerRadius}px`);
    el.style.setProperty('--vireglass-radius-min', `${concentricRadius(geometry.cornerRadius, geometry.cornerRadius, 0)}px`);

    const shadow = boxShadowCss(geometry, sample);
    el.style.setProperty('--vireglass-shadow', shadow);
    if (opts.shadow !== false) el.style.setProperty('box-shadow', shadow);
  }

  apply();

  // INTERACTION (docs/reference.md §5). The physics is the core's — `createDeform` carries the
  // spring, the press attack and the wave, at its own fixed step. What lives here is only the
  // plumbing: pointer in, map and glow out.
  const deform = createDeform();
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

    // A reduced-resolution map while the finger is down: `feImage` stretches it over the element
    // regardless, the displacement is smooth, and a full device-pixel rebuild plus a PNG encode
    // every frame does not hold a frame budget.
    const map = buildDisplacementMap(risen, geometry, interacting ? 1 : devicePixelRatio(), {
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
    if (filterEl) {
      const feImage = filterEl.querySelector('feImage');
      const feDisplace = filterEl.querySelector('feDisplacementMap');
      feImage?.setAttribute('href', map.url);
      feDisplace?.setAttribute('scale', String(map.scale));
    }
    mapKey = '';

    // The glow is a CONCENTRATION of the surroundings, not the glass's own whiteness: over a dark
    // backdrop the element lightens but never turns white, and ink over it stays legible.
    const [gr, gg, gb] = ambientFrom(opts.sample ?? probeBackdrop(el));
    const cx = ((sampleOut.touchX + geometry.width / 2) / geometry.width) * 100;
    const cy = ((sampleOut.touchY + geometry.height / 2) / geometry.height) * 100;
    const reach = halfMinDp(geometry) * TOUCH_RADIUS_FRACTION;
    el.style.setProperty(
      '--vireglass-glow',
      `radial-gradient(circle ${reach.toFixed(0)}px at ${cx.toFixed(1)}% ${cy.toFixed(1)}%, rgba(${to255(gr)},${to255(gg)},${to255(gb)},1) 0%, rgba(${to255(gr)},${to255(gg)},${to255(gb)},0) 100%)`,
    );
    el.style.setProperty('--vireglass-glow-opacity', (sampleOut.active * base.edgeLight).toFixed(3));
  }

  function tick(now: number): void {
    if (destroyed) return;
    const dt = lastFrameAt ? (now - lastFrameAt) / 1000 : 1 / 60;
    lastFrameAt = now;
    deform.step(dt);
    const s = deform.sample();
    paintInteraction(s);
    if (deform.idle()) {
      interacting = false;
      frame = null;
      lastFrameAt = 0;
      // Settled: put the full-resolution map back and drop the glow.
      el.style.setProperty('--vireglass-glow-opacity', '0');
      apply();
      return;
    }
    frame = requestAnimationFrame(tick);
  }

  function run(): void {
    // §9: reduced motion turns the material's springiness off. It is the one accessibility setting
    // that leaves optics alone — it is about motion, so it applies where motion is computed.
    if ((opts.accessibility ?? a11y).reduceMotion) return;
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
    el.style.removeProperty('background-color');
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
    setMorph(next) {
      morph = next && next.smoothing > 0 ? next : null;
      mapKey = '';
      apply();
    },
    destroy,
  };
  attached.set(el, handle);
  return handle;
}
