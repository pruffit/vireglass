import { describe, expect, it } from 'vitest';
import { capsuleGeometry, roundedRectGeometry, sizeDp, sizeGain } from '../geometry';
import { SIZE } from '../law';

// 219 @6:36: "When Liquid Glass flexes and morphs to larger sizes, it simulates a thicker material
// with deeper shadows and more pronounced lensing and refraction effects, enhancing perceived
// depth." Its own summary names the large end: "with larger controls like iPadOS and macOS
// sidebars".
//
// The surfaces below are the ones an interface is actually built from, smallest to largest. The
// model has to tell them apart — all of them, not the convenient end.
const LADDER = [
  ['hairline rule', roundedRectGeometry(900, 8, 4)],
  ['toolbar button', capsuleGeometry(64, 44)],
  ['toolbar', roundedRectGeometry(390, 52, 26)],
  ['popover', roundedRectGeometry(280, 200, 22)],
  ['sheet, quarter open', roundedRectGeometry(390, 220, 34)],
  ['sheet, half open', roundedRectGeometry(390, 420, 34)],
  ['iPad sidebar', roundedRectGeometry(320, 1000, 20)],
  ['sheet, full screen', roundedRectGeometry(390, 780, 34)],
  ['Mac panel', roundedRectGeometry(900, 640, 16)],
] as const;

describe('bigger element, thicker glass (docs/reference.md §1)', () => {
  it('reads every surface in the interface as a different size', () => {
    // The defect this replaced: a hard ceiling at 2.4 that a half-open sheet already reached, so a
    // half sheet, a full sheet, an iPad sidebar and a 900px Mac panel were one identical glass —
    // and those are the large end the reference names.
    const seen = LADDER.map(([, g]) => sizeGain(g));
    for (let i = 1; i < seen.length; i += 1) {
      expect(seen[i], `${LADDER[i][0]} vs ${LADDER[i - 1][0]}`).toBeGreaterThan(seen[i - 1]);
    }
  });

  it('spreads them across the range rather than bunching at one end', () => {
    const seen = LADDER.map(([, g]) => sizeGain(g));
    const span = Math.max(...seen) - Math.min(...seen);
    expect(span).toBeGreaterThan((SIZE.gainMax - SIZE.gainMin) * 0.6);
  });

  it('is still short of the ceiling at the largest screen there is', () => {
    expect(sizeGain(roundedRectGeometry(3840, 2160, 40))).toBeLessThan(SIZE.gainMax);
  });

  it('cannot pass the ceiling at any size at all', () => {
    // It approaches asymptotically and only lands on the ceiling where the exponential underflows,
    // which is somewhere past a million pixels. Approaching is the property; arriving there is
    // floating point, and it still never goes over.
    for (const side of [1e3, 1e4, 1e6, 1e9, Number.MAX_SAFE_INTEGER]) {
      expect(sizeGain(roundedRectGeometry(side, side, 0))).toBeLessThanOrEqual(SIZE.gainMax);
    }
  });

  it('holds at the floor for anything smaller than the floor', () => {
    expect(sizeGain(roundedRectGeometry(2, 2, 1))).toBe(SIZE.gainMin);
    expect(sizeGain(roundedRectGeometry(0, 0, 0))).toBe(SIZE.gainMin);
  });

  it('joins the square root smoothly, with no step at the floor', () => {
    // Value and slope both continuous: a step here would be a visible jump in glass thickness
    // between two elements a pixel apart in size.
    const at = (s: number) => sizeGain(roundedRectGeometry(s, s, 0));
    let previous = at(1);
    for (let s = 1; s < 400; s += 1) {
      const now = at(s);
      expect(now).toBeGreaterThanOrEqual(previous);
      expect(now - previous).toBeLessThan(0.05);
      previous = now;
    }
  });
});

describe('what counts as size (docs/reference.md §1)', () => {
  it('sees a taller sheet as a bigger surface than a shorter one of the same width', () => {
    // Half the narrower side cannot: both of these have a 390px narrow side.
    expect(sizeDp(roundedRectGeometry(390, 780, 34))).toBeGreaterThan(
      sizeDp(roundedRectGeometry(390, 420, 34)),
    );
  });

  it('sees a hairline rule as the thinnest glass there is, whatever its area', () => {
    // Area alone cannot: a 900x8 rule has more of it than a 64x44 button.
    expect(sizeDp(roundedRectGeometry(900, 8, 4))).toBeLessThan(sizeDp(capsuleGeometry(64, 44)));
  });

  it('does not care which way round a shape is', () => {
    expect(sizeDp(roundedRectGeometry(320, 1000, 20))).toBeCloseTo(
      sizeDp(roundedRectGeometry(1000, 320, 20)),
      9,
    );
  });
});
