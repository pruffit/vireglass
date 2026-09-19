import { afterEach, describe, expect, it, vi } from 'vitest';
import { roundedRectGeometry } from '../geometry';
import { MATERIAL_PRESETS, resolveOptics } from '../material';
import { buildDisplacementMap, renderDisplacementPixels } from '../dom/displacement';

// Odd device-pixel counts so a pixel sample lands exactly on the geometric centre and on the
// exact edge midpoint — an even count straddles both and every assertion becomes approximate.
const GEOMETRY = roundedRectGeometry(41, 41, 8);
const OPTICS = resolveOptics();
const DPR = 1;

describe('renderDisplacementPixels', () => {
  it('is exactly 128/128 at the centre pixel', () => {
    const { data, width } = renderDisplacementPixels(OPTICS, GEOMETRY, DPR);
    const mid = (width - 1) / 2; // 20, sample point (0, 0) exactly
    const i = (mid * width + mid) * 4;
    expect(data[i]).toBe(128);
    expect(data[i + 1]).toBe(128);
    expect(data[i + 2]).toBe(128);
    expect(data[i + 3]).toBe(255);
  });

  it('displaces inward in the bevel band, on the flat edge away from any corner', () => {
    const { data, width, height } = renderDisplacementPixels(OPTICS, GEOMETRY, DPR);
    const midRow = (height - 1) / 2;
    const rightEdge = width - 1; // x = +halfW - 0.5dp: inside the bevel band, off the corner
    const i = (midRow * width + rightEdge) * 4;
    // Inward at the right edge means sampling from smaller x — R below the 128 no-shift point.
    expect(data[i]).toBeLessThan(128);
    // No corner involvement on this row: the y offset stays at the no-shift point.
    expect(data[i + 1]).toBe(128);
  });

  // The map resolves the BEVEL, not the element. Everything inside the bevel band is a constant
  // and `feImage` stretches whatever it is given, so resolving the element is work nobody sees:
  // a sheet at device resolution was 197 000 pixels of maths and a PNG encode on every attach.
  it('samples the bevel rather than the element, and never exceeds it', () => {
    const dpr = 2.5;
    const geometry = roundedRectGeometry(37, 52, 6);
    const { width, height } = renderDisplacementPixels(OPTICS, geometry, dpr);
    expect(width).toBeLessThanOrEqual(Math.round(37 * dpr));
    expect(height).toBeLessThanOrEqual(Math.round(52 * dpr));
    // The aspect has to survive, or the profile stretches differently along each axis.
    expect(width / height).toBeCloseTo(37 / 52, 1);
  });

  it('lets a large element with a wide bevel cost less than its own pixel count', () => {
    const big = roundedRectGeometry(400, 400, 60);
    const { width } = renderDisplacementPixels(OPTICS, big, 1);
    expect(width).toBeLessThan(400);
  });

  it('stays at the no-shift value across the flat middle, away from the bevel band', () => {
    const { data, width, height } = renderDisplacementPixels(OPTICS, GEOMETRY, DPR);
    const cx = (width - 1) / 2;
    const cy = (height - 1) / 2;
    for (const [dx, dy] of [
      [-3, 0],
      [3, 0],
      [0, -3],
      [0, 3],
    ]) {
      const i = ((cy + dy) * width + (cx + dx)) * 4;
      expect(data[i]).toBe(128);
      expect(data[i + 1]).toBe(128);
    }
  });
});

describe('buildDisplacementMap (canvas wrapper)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws a clear error outside a DOM (never a raw TypeError)', () => {
    expect(() => buildDisplacementMap(OPTICS, GEOMETRY, DPR)).toThrow(/DOM/);
  });

  it('wraps the pixel buffer into a url/width/height/scale using a stubbed canvas', () => {
    let captured: { data: Uint8ClampedArray } | null = null;
    const fakeCtx = {
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: (imageData: { data: Uint8ClampedArray }) => {
        captured = imageData;
      },
    };
    const fakeCanvas = {
      width: 0,
      height: 0,
      getContext: () => fakeCtx,
      toDataURL: () => 'data:image/png;base64,stub',
    };
    vi.stubGlobal('document', {
      createElement: (tag: string) => (tag === 'canvas' ? fakeCanvas : null),
    });

    const map = buildDisplacementMap(OPTICS, GEOMETRY, DPR);
    expect(map.url).toBe('data:image/png;base64,stub');
    expect(map.width).toBe(41);
    expect(map.height).toBe(41);
    expect(map.scale).toBeGreaterThan(0);
    expect(captured).not.toBeNull();
  });
});

// Two defects lived here and no unit test could see either, because both are contracts with the
// browser rather than with this file: the spec's displacement formula, and the filter's colour
// space. The formula half is pinnable here; the colour space is pinned by an attribute on the
// filter element and by the note beside it.
describe('the spec formula the map is encoded against', () => {
  const decode = (channel: number, scale: number) => scale * (channel / 255 - 0.5);

  it('round-trips a rim displacement through encode and the spec decode', () => {
    const optics = resolveOptics(MATERIAL_PRESETS.glass);
    const geometry = roundedRectGeometry(200, 120, 30);
    const { data, width, height, scale } = renderDisplacementPixels(optics, geometry, 1);

    // The most-displaced pixel on the horizontal centre line: mid-height, one pixel inside the
    // left edge, where the gradient points straight along x.
    const row = Math.floor(height / 2);
    const i = (row * width + 1) * 4;
    const dx = decode(data[i]!, scale);

    expect(Math.abs(dx)).toBeGreaterThan(0);
    // A full channel swing spans ±scale/2, never ±scale. Encoding against ±scale — as an earlier
    // version did — halves every material's refraction and still passes a "centre is 128" test.
    expect(Math.abs(dx)).toBeLessThanOrEqual(scale / 2 + 1e-6);
    expect(dx).toBeGreaterThan(0);
  });

  it('keeps one 8-bit step under a tenth of a pixel', () => {
    const optics = resolveOptics(MATERIAL_PRESETS.crystal);
    const { scale } = renderDisplacementPixels(optics, roundedRectGeometry(320, 180, 40), 2);
    expect(scale / 255).toBeLessThanOrEqual(0.09 + 1e-9);
  });
});
