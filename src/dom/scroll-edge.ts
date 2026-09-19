// The scroll edge (docs/reference.md §10). Not the material's job but the SCREEN's: it sits over
// the content beneath a panel, and the glass sees a backdrop that is already dimmed. The rules are
// the core's (`../scroll-edge`); this attaches them to a real scroller and a real element.
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

function gradientFor(style: ScrollEdgeStyle, side: 'top' | 'bottom', reach: number): string {
  const direction = side === 'top' ? 'to bottom' : 'to top';
  if (style === 'hard') return `linear-gradient(${direction}, rgba(0,0,0,0.18) 0 ${reach}px, transparent ${reach}px)`;
  const tone = style === 'dim' ? '255,255,255' : '0,0,0';
  const peak = style === 'dim' ? 0.1 : 0.22;
  return `linear-gradient(${direction}, rgba(${tone},${peak}) 0%, rgba(${tone},0) 100%)`;
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
    edgeEl.style.setProperty('background-image', gradientFor(style, side, 1));
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
      edgeEl.style.removeProperty('background-image');
      edgeEl.style.removeProperty('opacity');
    },
  };
}
