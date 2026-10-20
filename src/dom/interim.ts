/** Geometry snapped to a grid, so a morph that moves by a fraction of a pixel reuses a map. */
export function quantise(value: number, step = 2): number {
  return Math.round(value / step) * step;
}

export function interimKey(
  width: number,
  height: number,
  cornerRadius: number,
  morph: string,
  extra: string,
): string {
  return `i|${quantise(width)}x${quantise(height)}r${quantise(cornerRadius)}|${morph}|${extra}`;
}

/**
 * What a filter's structure depends on. A filter with the same signature can take a new map in
 * place; a different one has to be rebuilt.
 */
export function filterSignature(blur: number, ior: number, iorSpread: number, hasHue: boolean): string {
  return `${blur}|${ior}|${iorSpread > 1e-4 ? iorSpread : 0}|${hasHue ? 'h' : '-'}`;
}

/** A small least-recently-used store, so a long morph cannot evict the resting maps. */
export function createLru<T>(limit: number) {
  const store = new Map<string, T>();
  return {
    get(key: string): T | undefined {
      const hit = store.get(key);
      if (hit === undefined) return undefined;
      store.delete(key);
      store.set(key, hit);
      return hit;
    },
    set(key: string, value: T): void {
      store.delete(key);
      store.set(key, value);
      if (store.size > limit) {
        const oldest = store.keys().next();
        if (!oldest.done) store.delete(oldest.value);
      }
    },
    get size(): number {
      return store.size;
    },
  };
}
