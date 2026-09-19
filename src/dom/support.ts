// Feature detection BY MEASUREMENT, never by sniffing the user agent — the agent string is the
// first thing to lie about this after an engine update.
//
// Firefox does not support `url()` inside `backdrop-filter` and has closed the request as not
// planned (bug 1578503). Safari doesn't support `backdrop-filter` with `url()` yet either, though
// WebKit has patches in flight. Both can change without notice, so this asks the engine directly.

let backdropFilterSupport: boolean | null = null;
let svgBackdropFilterSupport: boolean | null = null;

// `CSS.supports`, not a detached element read back through `getComputedStyle`: Chromium resolves
// no style at all for an element outside the document, so that probe answered "unsupported" in the
// very engine where the displacement demonstrably works.
//
// This answers that the engine PARSES the value. An engine could in principle parse `url()` and
// render nothing; a host that meets one can override the decision through `attachGlass` instead of
// being stuck with a wrong automatic answer.
function probeProperty(property: string, value: string): boolean {
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return false;
  return CSS.supports(property, value);
}

/** Any `backdrop-filter` at all (e.g. `blur()`) — the fallback path's own requirement. */
export function supportsBackdropFilter(): boolean {
  if (backdropFilterSupport === null) {
    backdropFilterSupport =
      probeProperty('backdrop-filter', 'blur(1px)') || probeProperty('-webkit-backdrop-filter', 'blur(1px)');
  }
  return backdropFilterSupport;
}

/** `url(#filter)` specifically — the SVG displacement path's requirement. Checked separately from
 *  `supportsBackdropFilter()`: an engine can support plain blur without supporting a filter
 *  reference, which is exactly the Firefox case. */
export function supportsSvgBackdropFilter(): boolean {
  if (svgBackdropFilterSupport === null) {
    svgBackdropFilterSupport = probeProperty('backdrop-filter', 'url(#vireglass-support-probe)');
  }
  return svgBackdropFilterSupport;
}

/** Test-only: the two probes above cache after their first call, and a suite that stubs the DOM
 *  differently per test needs a way to invalidate that. */
export function resetSupportCache(): void {
  backdropFilterSupport = null;
  svgBackdropFilterSupport = null;
}
