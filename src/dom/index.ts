// The third VireGlass renderer: refracts LIVE DOM via `backdrop-filter: url(#svg-filter)` with an
// `feDisplacementMap`, instead of drawing its own backdrop like the WebGL2 and AGSL renderers do.
//
// It carries PART of the material: refraction, the roughness prefilter, body density and ambient
// pickup. Fresnel, specular, dispersion, iridescence and diffraction have nowhere to live in an
// SVG filter graph and are absent here by construction, not by oversight.
// See `docs/superpowers/specs/2026-09-19-vireglass-over-live-dom.md` for the technique and the
// three findings that make it work (objectBoundingBox, prefiltering the source, the 8-bit step).
import { ambientFrom, INK_DARK, INK_LIGHT, shouldInkBeLight, type BackdropSample } from '../adaptation';
import { buildDisplacementMap } from './displacement';
import { roundedRectGeometry, type VireGlassGeometry } from '../geometry';
import { resolveOptics, VIREGLASS_MATERIAL, type VireGlassMaterial, type VireGlassOptics } from '../material';
import { probeBackdrop } from './probe';
import { supportsSvgBackdropFilter } from './support';

export * from './support';
export * from './probe';
export * from './displacement';

const SVG_NS = 'http://www.w3.org/2000/svg';
const FILTER_HOST_ATTR = 'data-vireglass-filters';

let filterCounter = 0;

/** Live instances keyed by element, so a second attach can retire the first rather than orphan
 *  its filter. Weak: a detached element takes its entry with it. */
const attached = new WeakMap<HTMLElement, GlassHandle>();

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
function buildFilterElement(id: string, mapUrl: string, blurPx: number, scale: number): SVGFilterElement {
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
  feBlur.setAttribute('stdDeviation', String(Math.max(blurPx, 0)));
  feBlur.setAttribute('result', 'blurred');

  const feDisplace = document.createElementNS(SVG_NS, 'feDisplacementMap');
  feDisplace.setAttribute('in', 'blurred');
  feDisplace.setAttribute('in2', 'map');
  feDisplace.setAttribute('scale', String(scale));
  feDisplace.setAttribute('xChannelSelector', 'R');
  feDisplace.setAttribute('yChannelSelector', 'G');

  filter.append(feImage, feBlur, feDisplace);
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

/** The body: the material's own presence over the backdrop. Density comes from the model, the
 *  hue from the surroundings — a flat fill in place of a tint is what breaks the material. */
function bodyCss(optics: VireGlassOptics, r: number, g: number, b: number): string {
  const alpha = Math.min(Math.max(optics.bodyDensity * 4, 0), 0.35);
  return `rgba(${to255(r)}, ${to255(g)}, ${to255(b)}, ${alpha})`;
}

function fallbackTintCss(optics: VireGlassOptics, sample: BackdropSample): string {
  const [r, g, b] = ambientFrom(sample);
  return bodyCss(optics, r, g, b);
}

export type AttachGlassOptions = {
  material?: Partial<VireGlassMaterial>;
  /** Defaults to the element's measured box (size + `border-radius`). */
  geometry?: VireGlassGeometry;
  /** Overrides the probe entirely — images and video are invisible to it, and the host app
   *  already knows its own cover-art accent. */
  sample?: BackdropSample;
};

export type GlassHandle = { update(): void; destroy(): void };

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

  function apply(): void {
    if (destroyed) return;
    const geometry = opts.geometry ?? measureGeometry(el);
    const optics = resolveOptics(opts.material);
    const sample = opts.sample ?? probeBackdrop(el);

    if (svgSupported) {
      // The map depends only on geometry, optics and density — never on the backdrop. Rebuilding
      // it on every scroll would re-run a per-pixel loop and a PNG encode for a picture that did
      // not change; the refraction itself updates in the compositor with no JS at all.
      const key = `${geometry.width}x${geometry.height}r${geometry.cornerRadius}@${devicePixelRatio()}:${optics.refraction}:${optics.refractionScale}:${optics.bevelDp}:${optics.blur}`;
      if (key !== mapKey || !filterEl) {
        const map = buildDisplacementMap(optics, geometry, devicePixelRatio());
        const defs = getFilterHost().querySelector('defs') as SVGDefsElement;
        const next = buildFilterElement(id, map.url, optics.blur, map.scale);
        if (filterEl?.parentNode) defs.replaceChild(next, filterEl);
        else defs.appendChild(next);
        filterEl = next;
        mapKey = key;
      }
      el.style.setProperty('backdrop-filter', `url(#${id})`);
      el.style.setProperty('-webkit-backdrop-filter', `url(#${id})`);
    } else {
      el.style.setProperty('backdrop-filter', fallbackFilterCss(optics));
      el.style.setProperty('-webkit-backdrop-filter', fallbackFilterCss(optics));
      el.style.backgroundColor = fallbackTintCss(optics, sample);
    }

    const light = shouldInkBeLight(sample, wasLight);
    wasLight = light;
    const [tr, tg, tb] = ambientFrom(sample);
    el.style.setProperty('--vireglass-ink', light ? '1' : '0');
    el.style.setProperty('--vireglass-tint', `${tr} ${tg} ${tb}`);
    el.style.setProperty('--vireglass-body-density', String(optics.bodyDensity));

    // The raw numbers above are the model's own values; these are the same thing in a form CSS
    // can actually consume. Without them a host has to convert in script, which is the work this
    // renderer exists to do.
    const inkLevel = Math.round((light ? INK_LIGHT : INK_DARK) * 255);
    el.style.setProperty('--vireglass-ink-color', `rgb(${inkLevel} ${inkLevel} ${inkLevel})`);
    el.style.setProperty('--vireglass-tint-color', rgbCss(tr, tg, tb));
    el.style.setProperty('--vireglass-body-color', bodyCss(optics, tr, tg, tb));
  }

  apply();

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
    if (attached.get(el) === handle) attached.delete(el);
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
  }

  const handle: GlassHandle = { update: apply, destroy };
  attached.set(el, handle);
  return handle;
}
