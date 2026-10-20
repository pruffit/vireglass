export type RenderStats = {
  /** `elementsFromPoint` backdrop probes. */
  probes: number;
  /** Displacement maps baked at full device resolution (cache hits are not bakes). */
  fullBakes: number;
  /** Displacement maps baked at reduced resolution: interim morphs and the finger path. */
  reducedBakes: number;
  /** Filter elements put into the shared `<defs>`, replacing or adding. */
  filterSwaps: number;
};

const counts: RenderStats = { probes: 0, fullBakes: 0, reducedBakes: 0, filterSwaps: 0 };

/** The work the renderer has done since the last reset; the hook for a consumer's performance gate. */
export function renderStats(): RenderStats {
  return { ...counts };
}

export function resetRenderStats(): void {
  counts.probes = 0;
  counts.fullBakes = 0;
  counts.reducedBakes = 0;
  counts.filterSwaps = 0;
}

export function bump(key: keyof RenderStats): void {
  counts[key] += 1;
}
