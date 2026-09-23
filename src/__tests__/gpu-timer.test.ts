import { describe, expect, it } from 'vitest';
import { createGpuTimer, GPU_TIMER_RING_SIZE, type GpuTimerContext } from '../web/gpu-timer';

// EXT_disjoint_timer_query_webgl2 is unavailable in the headless Chromium the shader gates run
// in, so this is the only place the ring buffer, the disjoint handling and the exception safety
// actually get exercised — against a fake standing in for gl + the extension.

const QUERY_RESULT_AVAILABLE = 1;
const QUERY_RESULT = 2;
const TIME_ELAPSED_EXT = 3;
const GPU_DISJOINT_EXT = 4;

type FakeQuery = { id: number };

function makeFakeGl(options: { hasExtension?: boolean } = {}) {
  const hasExtension = options.hasExtension ?? true;
  let nextId = 0;
  const created: FakeQuery[] = [];
  const deleted: FakeQuery[] = [];
  const beginCalls: FakeQuery[] = [];
  let openQueries = 0;
  const available = new Map<number, boolean>();
  const results = new Map<number, number>();
  let disjoint = false;

  const gl: GpuTimerContext = {
    QUERY_RESULT_AVAILABLE,
    QUERY_RESULT,
    getExtension: (name) =>
      hasExtension && name === 'EXT_disjoint_timer_query_webgl2'
        ? { TIME_ELAPSED_EXT, GPU_DISJOINT_EXT }
        : null,
    createQuery: () => {
      const query: FakeQuery = { id: nextId };
      nextId += 1;
      created.push(query);
      return query as unknown as WebGLQuery;
    },
    deleteQuery: (query) => deleted.push(query as unknown as FakeQuery),
    beginQuery: (target, query) => {
      if (target !== TIME_ELAPSED_EXT) throw new Error(`unexpected target ${target}`);
      beginCalls.push(query as unknown as FakeQuery);
      openQueries += 1;
    },
    endQuery: (target) => {
      if (target !== TIME_ELAPSED_EXT) throw new Error(`unexpected target ${target}`);
      openQueries -= 1;
    },
    getQueryParameter: (query, pname) => {
      const id = (query as unknown as FakeQuery).id;
      if (pname === QUERY_RESULT_AVAILABLE) return available.get(id) ?? false;
      if (pname === QUERY_RESULT) return results.get(id) ?? 0;
      throw new Error(`unexpected pname ${pname}`);
    },
    getParameter: (pname) => {
      if (pname === GPU_DISJOINT_EXT) return disjoint;
      throw new Error(`unexpected pname ${pname}`);
    },
  };

  return {
    gl,
    created,
    deleted,
    beginCalls,
    openQueries: () => openQueries,
    setAvailable: (query: FakeQuery, value: boolean) => available.set(query.id, value),
    setResult: (query: FakeQuery, ns: number) => results.set(query.id, ns),
    setDisjoint: (value: boolean) => {
      disjoint = value;
    },
  };
}

describe('createGpuTimer', () => {
  it('is inert without the extension: no queries, time() still runs the callback, getLastMs is always null', () => {
    const fake = makeFakeGl({ hasExtension: false });
    const timer = createGpuTimer(fake.gl);
    expect(fake.created).toHaveLength(0);
    expect(timer.time(() => 42)).toBe(42);
    expect(timer.getLastMs()).toBeNull();
    expect(() => timer.destroy()).not.toThrow();
  });

  it('creates a ring of GPU_TIMER_RING_SIZE queries up front', () => {
    const fake = makeFakeGl();
    createGpuTimer(fake.gl);
    expect(fake.created).toHaveLength(GPU_TIMER_RING_SIZE);
  });

  it('returns the wrapped function\'s value', () => {
    const fake = makeFakeGl();
    const timer = createGpuTimer(fake.gl);
    expect(timer.time(() => 'result')).toBe('result');
  });

  it('converts a completed, non-disjoint result from nanoseconds to milliseconds', () => {
    const fake = makeFakeGl();
    const timer = createGpuTimer(fake.gl);
    timer.time(() => {});
    const query = fake.created[0];
    fake.setAvailable(query, true);
    fake.setResult(query, 2_500_000);
    expect(timer.getLastMs()).toBeCloseTo(2.5);
  });

  it('discards a disjoint sample instead of reporting it, but still frees the slot', () => {
    const fake = makeFakeGl();
    const timer = createGpuTimer(fake.gl);
    timer.time(() => {});
    const query = fake.created[0];
    fake.setAvailable(query, true);
    fake.setResult(query, 2_500_000);
    fake.setDisjoint(true);
    expect(timer.getLastMs()).toBeNull();

    // Freed despite being discarded: the ring cycles back to this slot without getting stuck.
    for (let i = 0; i < GPU_TIMER_RING_SIZE; i += 1) timer.time(() => {});
    expect(fake.beginCalls).toHaveLength(GPU_TIMER_RING_SIZE + 1);
  });

  it('skips timing a frame rather than reuse a query still in flight', () => {
    const fake = makeFakeGl();
    const timer = createGpuTimer(fake.gl);
    for (let i = 0; i < GPU_TIMER_RING_SIZE; i += 1) timer.time(() => {});
    expect(fake.beginCalls).toHaveLength(GPU_TIMER_RING_SIZE);

    // Every slot is still awaiting its result (none marked available) — the ring must not start
    // a new query on top of one that hasn't reported back yet.
    timer.time(() => {});
    expect(fake.beginCalls).toHaveLength(GPU_TIMER_RING_SIZE);
  });

  it('does not leave a query open when the timed function throws', () => {
    const fake = makeFakeGl();
    const timer = createGpuTimer(fake.gl);
    expect(() =>
      timer.time(() => {
        throw new Error('backdrop pass exploded');
      }),
    ).toThrow('backdrop pass exploded');
    // endQuery ran in a finally, despite the throw — nothing was left began-but-never-ended for
    // the next beginQuery to trip over.
    expect(fake.openQueries()).toBe(0);
  });

  it('advances to a fresh slot on the next call after a throw, instead of stalling', () => {
    const fake = makeFakeGl();
    const timer = createGpuTimer(fake.gl);
    expect(() =>
      timer.time(() => {
        throw new Error('boom');
      }),
    ).toThrow();
    timer.time(() => {});
    expect(fake.beginCalls).toHaveLength(2);
    expect(fake.beginCalls[1]).not.toBe(fake.beginCalls[0]);
  });

  it('deletes every query on destroy', () => {
    const fake = makeFakeGl();
    const timer = createGpuTimer(fake.gl);
    timer.destroy();
    expect(fake.deleted).toHaveLength(GPU_TIMER_RING_SIZE);
  });
});
