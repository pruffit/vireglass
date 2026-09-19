// System accessibility on the web (docs/reference.md §9). The three settings the reference names
// all have media queries, so nothing here has to be asked of the host: the browser already knows.
//
// `reduceMotion` is read but not applied to optics — §9 is explicit that it is about motion, and
// motion is applied by whoever computes it. `attachGlass` uses it to hold the material still.
import { NO_ACCESSIBILITY, type VireGlassAccessibility } from '../accessibility';

const QUERIES = {
  reduceTransparency: '(prefers-reduced-transparency: reduce)',
  increaseContrast: '(prefers-contrast: more)',
  reduceMotion: '(prefers-reduced-motion: reduce)',
} as const;

function matches(query: string): boolean {
  if (typeof matchMedia !== 'function') return false;
  try {
    return matchMedia(query).matches;
  } catch {
    // An engine that does not know a query throws rather than answering false. Not knowing it is
    // an answer of "not set", not a reason to fail.
    return false;
  }
}

export function systemAccessibility(): VireGlassAccessibility {
  if (typeof matchMedia !== 'function') return NO_ACCESSIBILITY;
  return {
    reduceTransparency: matches(QUERIES.reduceTransparency),
    increaseContrast: matches(QUERIES.increaseContrast),
    reduceMotion: matches(QUERIES.reduceMotion),
  };
}

/** Fires whenever any of the three changes. The material has to follow a setting turned on while
 *  the page is open, not only one that was on when it loaded. */
export function watchAccessibility(onChange: (next: VireGlassAccessibility) => void): () => void {
  if (typeof matchMedia !== 'function') return () => {};
  const lists: MediaQueryList[] = [];
  const handler = () => onChange(systemAccessibility());
  for (const query of Object.values(QUERIES)) {
    try {
      const list = matchMedia(query);
      list.addEventListener('change', handler);
      lists.push(list);
    } catch {
      // Same as above: an unknown query simply has nothing to watch.
    }
  }
  return () => {
    for (const list of lists) list.removeEventListener('change', handler);
  };
}
