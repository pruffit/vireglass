// Scroll edge effect (reference 219 @8:52) — the SCREEN's job, not the material's: it sits over
// the content beneath the panel, and the glass sees an already-dimmed backdrop. Only the general
// rules live here.
import { SCROLL_EDGE } from './law';

/**
 * 356 @11:48 names two styles across the system, "soft and hard", and says not to mix or stack
 * them. Soft is the default; hard is "a stronger, more opaque boundary", mostly macOS, for pinned
 * table headers and controls without backgrounds.
 *
 * Soft has two forms, and which one is in play is not a choice: 219 @9:16 dissolves the content
 * into the background, and @9:33, when darker content scrolls under and the glass itself turns to
 * its dark style, "the effect intelligently switches to apply a subtle dimming instead". Same
 * trigger as ink polarity, because it is the same problem — dark content under dark glass merges
 * with it unless the content is pushed down.
 */
export type ScrollEdgeStyle = 'dissolve' | 'dim' | 'hard';

export function scrollEdgeStyle(inkLight: boolean, pinned = false): ScrollEdgeStyle {
  if (pinned) return 'hard';
  return inkLight ? 'dim' : 'dissolve';
}

/** How far the content has to slide under the panel for the effect to fully engage, dp. */
export const SCROLL_EDGE_ENGAGE_DP = SCROLL_EDGE.engageDp;

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
