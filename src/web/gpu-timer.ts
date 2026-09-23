// GPU timing for `VireGlassRenderer.getLastGpuMs()`, isolated from the renderer so it can be
// unit-tested against a fake: `EXT_disjoint_timer_query_webgl2` is unavailable in the headless
// Chromium the shader gates run in, so nothing in this repository otherwise exercises the ring
// logic at all.

/** The two tokens the extension adds; everything else the timer needs is core WebGL2. */
export type GpuTimerExtension = {
  readonly TIME_ELAPSED_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
};

/** The slice of WebGL2 this module needs, kept narrow so a test can fake it without a real GL
 *  context. A `WebGL2RenderingContext` satisfies this structurally — no cast needed at the call
 *  site in `renderer.ts`. */
export type GpuTimerContext = {
  readonly QUERY_RESULT_AVAILABLE: number;
  readonly QUERY_RESULT: number;
  getExtension(name: string): unknown;
  createQuery(): WebGLQuery | null;
  deleteQuery(query: WebGLQuery): void;
  beginQuery(target: number, query: WebGLQuery): void;
  endQuery(target: number): void;
  getQueryParameter(query: WebGLQuery, pname: number): unknown;
  getParameter(pname: number): unknown;
};

/** Queries in flight at once. `EXT_disjoint_timer_query_webgl2` results arrive asynchronously,
 *  often a few frames late, so one query per frame would mean starting a new query before the
 *  previous one's result is back — undefined by spec. */
export const GPU_TIMER_RING_SIZE = 3;

type TimerSlot = { query: WebGLQuery; pending: boolean };

export type GpuTimer = {
  /** Runs `fn` as one timed sample. Always calls the matching `endQuery` even if `fn` throws, so
   *  a frame that fails partway through (a broken backdrop pass, a validation error) never leaves
   *  a query open for the next call to trip over. */
  time<T>(fn: () => T): T;
  /** `null` without the extension or while the ring hasn't produced a non-disjoint result yet. */
  getLastMs(): number | null;
  destroy(): void;
};

/** Missing the extension (most headless/CI setups, and every browser but Chromium-family in
 *  practice) degrades every method here to a no-op / `null` — never an error. */
export function createGpuTimer(gl: GpuTimerContext): GpuTimer {
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as GpuTimerExtension | null;
  const slots: TimerSlot[] = ext
    ? Array.from({ length: GPU_TIMER_RING_SIZE }, () => ({
        query: gl.createQuery() as WebGLQuery,
        pending: false,
      }))
    : [];
  let cursor = 0;
  let active: TimerSlot | null = null;
  let lastMs: number | null = null;

  function poll(): void {
    if (!ext) return;
    for (const slot of slots) {
      if (!slot.pending) continue;
      if (!gl.getQueryParameter(slot.query, gl.QUERY_RESULT_AVAILABLE)) continue;
      slot.pending = false;
      // A disjoint event (e.g. the GPU clock changed) invalidates every query since the last
      // check — the sample is discarded, not reported as zero or stale.
      if (gl.getParameter(ext.GPU_DISJOINT_EXT)) continue;
      const ns = gl.getQueryParameter(slot.query, gl.QUERY_RESULT) as number;
      lastMs = ns / 1e6;
    }
  }

  function begin(): void {
    active = null;
    if (!ext || slots.length === 0) return;
    poll();
    const slot = slots[cursor];
    // The ring hasn't caught up (this slot's previous result isn't back yet) — skip timing this
    // frame rather than reuse a query that's still in flight.
    if (slot.pending) return;
    gl.beginQuery(ext.TIME_ELAPSED_EXT, slot.query);
    active = slot;
  }

  function end(): void {
    if (!ext || !active) return;
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    active.pending = true;
    cursor = (cursor + 1) % slots.length;
    active = null;
  }

  function time<T>(fn: () => T): T {
    begin();
    try {
      return fn();
    } finally {
      end();
    }
  }

  function getLastMs(): number | null {
    poll();
    return lastMs;
  }

  function destroy(): void {
    for (const slot of slots) gl.deleteQuery(slot.query);
  }

  return { time, getLastMs, destroy };
}
