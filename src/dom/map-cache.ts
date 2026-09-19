// Maps are pure functions of geometry, optics and density — the same element twice, or four
// identical buttons in a tab bar, produce byte-identical PNGs. Building each one again is the
// single largest avoidable cost in this renderer: a sheet's hue map is tens of milliseconds, and
// it happens on every attach, every remount and every re-attach after a theme change.
//
// Small and strict on purpose. A page has a handful of distinct glass shapes, not hundreds; a
// cache that grew without bound would hold megabytes of data URIs alive for a screen nobody is
// looking at any more.
const LIMIT = 24;

const store = new Map<string, unknown>();

export function cached<T>(key: string, build: () => T): T {
  const hit = store.get(key);
  if (hit !== undefined) {
    // Re-inserting moves it to the end: the oldest key is the one evicted, not the most used one.
    store.delete(key);
    store.set(key, hit);
    return hit as T;
  }
  const value = build();
  store.set(key, value);
  if (store.size > LIMIT) {
    const oldest = store.keys().next();
    if (!oldest.done) store.delete(oldest.value);
  }
  return value;
}

/** Test-only: the cache is process-wide, and a suite that measures build cost needs it cold. */
export function clearMapCache(): void {
  store.clear();
}

export function mapCacheSize(): number {
  return store.size;
}
