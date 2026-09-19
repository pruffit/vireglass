// The scroll edge (docs/reference.md §10). Not the material's job but the SCREEN's: it sits over
// the content beneath a panel, and the glass sees a backdrop that is already dimmed. The rules are
// the core's (`../scroll-edge`); this attaches them to a real scroller and a real element.
import { SCROLL_EDGE } from '../law';
import { scrollEdgeStrength, scrollEdgeStyle, type ScrollEdgeStyle } from '../scroll-edge';

export type ScrollEdgeHandle = { update(): void; destroy(): void };

export type ScrollEdgeOptions = {
  /** Which edge of the scroller the panel sits at. */
  side?: 'top' | 'bottom';
  /** A view pinned under the panel — column headers — gets a flat band with no gradient (§10). */
  pinned?: boolean;
  /** Ink polarity of the nearest glass, 1 light and 0 dark. The edge style follows it: light ink
   *  means dark glass and the content fades into a light dimming; dark ink means the opposite. */
  ink?: () => number;
};

/**
 * What the effect actually is. 356 @11:32: "they don't block or darken like overlays."
 *
 * So the soft style is a BLUR with a mask, not a painted gradient: the content under the panel
 * goes out of focus into the background, which is what 219 @9:16 means by dissolving it, and
 * nothing is laid over it. The first version of this painted black at 22% down the ramp — an
 * overlay, doing the one thing the reference names as wrong.
 *
 * `dim` is the other soft form and it does carry a tone, because 219 @9:33 asks for one: over dark
 * content the glass turns dark and "the effect intelligently switches to apply a subtle dimming
 * instead". Dimming is a reduction in luminance. This painted white, which lightened the content
 * it was supposed to be pushing down.
 */
export type EdgePaint = { filter: string; mask: string; tone: string };

export function paintFor(style: ScrollEdgeStyle, side: 'top' | 'bottom'): EdgePaint {
  const direction = side === 'top' ? 'to top' : 'to bottom';
  if (style === 'hard') {
    // A flat band rather than a gradual fade (219 @9:41), and a stronger boundary (356 @12:12).
    return {
      filter: `blur(${SCROLL_EDGE.hardBlurDp}px)`,
      mask: '',
      tone: `linear-gradient(${direction}, rgba(0,0,0,${SCROLL_EDGE.hardAlpha}) 0 100%)`,
    };
  }
  const ramp = `linear-gradient(${direction}, rgba(0,0,0,1) 0%, rgba(0,0,0,0) 100%)`;
  return {
    filter: `blur(${SCROLL_EDGE.dissolveBlurDp}px)`,
    mask: ramp,
    tone:
      style === 'dim'
        ? `linear-gradient(${direction}, rgba(0,0,0,${SCROLL_EDGE.dimAlpha}) 0%, rgba(0,0,0,0) 100%)`
        : 'none',
  };
}

/**
 * Paints the edge onto `edgeEl` — an element the host positions along the scroller's edge, under
 * the glass. It is the host's because §10 puts this on the screen, not on the material: the glass
 * must SEE the result, which means the effect has to be behind it in the stack.
 */
export function attachScrollEdge(
  scroller: HTMLElement,
  edgeEl: HTMLElement,
  opts: ScrollEdgeOptions = {},
): ScrollEdgeHandle {
  const side = opts.side ?? 'top';
  let destroyed = false;

  function update(): void {
    if (destroyed) return;
    const maxScroll = Math.max(scroller.scrollHeight - scroller.clientHeight, 0);
    const strength = scrollEdgeStrength(side, scroller.scrollTop, maxScroll);
    const inkLight = (opts.ink?.() ?? 1) > 0.5;
    const style = scrollEdgeStyle(inkLight, opts.pinned);
    const paint = paintFor(style, side);
    // The blur is what dissolves the content; the mask is what makes it a ramp rather than a step.
    edgeEl.style.setProperty('backdrop-filter', paint.filter);
    edgeEl.style.setProperty('-webkit-backdrop-filter', paint.filter);
    if (paint.mask) {
      edgeEl.style.setProperty('mask-image', paint.mask);
      edgeEl.style.setProperty('-webkit-mask-image', paint.mask);
    } else {
      edgeEl.style.removeProperty('mask-image');
      edgeEl.style.removeProperty('-webkit-mask-image');
    }
    edgeEl.style.setProperty('background-image', paint.tone);
    edgeEl.style.setProperty('opacity', strength.toFixed(3));
  }

  const onScroll = () => update();
  scroller.addEventListener('scroll', onScroll, { passive: true });
  update();

  return {
    update,
    destroy() {
      destroyed = true;
      scroller.removeEventListener('scroll', onScroll);
      edgeEl.style.removeProperty('backdrop-filter');
      edgeEl.style.removeProperty('-webkit-backdrop-filter');
      edgeEl.style.removeProperty('mask-image');
      edgeEl.style.removeProperty('-webkit-mask-image');
      edgeEl.style.removeProperty('background-image');
      edgeEl.style.removeProperty('opacity');
    },
  };
}
