// Scroll edge effect (reference 219 @8:52) — the SCREEN's job, not the material's: it sits over
// the content beneath the panel, and the glass sees an already-dimmed backdrop. Only the general
// rules live here.

export type ScrollEdgeStyle = 'dissolve' | 'dim' | 'hard';

/**
 * The edge style follows the style of the nearest glass: light ink means dark glass, and the
 * content beneath it fades into a light dimming; dark ink means light glass, and the content
 * dissolves into the background. A pinned view under the panel (column headers) gets a flat
 * band with no gradient.
 */
export function scrollEdgeStyle(inkLight: boolean, pinned = false): ScrollEdgeStyle {
  if (pinned) return 'hard';
  return inkLight ? 'dim' : 'dissolve';
}

/** How far the content has to slide under the panel for the effect to fully engage, dp. */
export const SCROLL_EDGE_ENGAGE_DP = 24;

/**
 * Edge strength as a function of scroll. With no scroll, content near the top doesn't slide
 * under the panel yet — so there's no effect (a mail screen at the top: the header sits on a
 * clean background). At the bottom, content slides under it for as long as there's room left
 * to scroll.
 */
export function scrollEdgeStrength(side: 'top' | 'bottom', scroll: number, maxScroll: number): number {
  const room = side === 'top' ? scroll : maxScroll - scroll;
  return Math.min(Math.max(room / SCROLL_EDGE_ENGAGE_DP, 0), 1);
}
