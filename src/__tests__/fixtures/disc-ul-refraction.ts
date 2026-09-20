/**
 * The displacement profile of a real lens, traced off frames/crops/disc-ul.
 *
 * A disc over a regular lattice. Outside it the grid line is where the lattice puts it; inside, it
 * is where the glass moved it. Tracing the line row by row — following the previous row's answer so
 * the trace stays on the same line as it bends — gives the displacement directly.
 *
 * The disc's own geometry comes from fitting a circle to the bright rim: centre (687, 612), radius
 * 592 px, mean residual 0.6 px over 34 points. The grid line stands at x = 347 where the glass
 * leaves it alone, which it does from the bottom of the frame up to y ≈ 286 — the middle of a lens
 * passes the backdrop through nearly untouched, exactly as §1 says.
 *
 * Only rows whose trace kept a contrast above 18 are here. Below that the line breaks up in the
 * caustic near the rim, and a position read out of a smear is not a measurement.
 */
export const DISC = { centreX: 687, centreY: 612, radius: 592, gridLineX: 347 } as const;

/** [row, the column the grid line appears in]. */
export const TRACE: ReadonlyArray<readonly [number, number]> = [
  [320, 347], [300, 347], [286, 347], [282, 346], [280, 346], [274, 345], [268, 344], [266, 344],
  [262, 343], [258, 342], [256, 341], [252, 340], [250, 339], [246, 337], [244, 336], [240, 333],
  [238, 332], [236, 331], [234, 328], [232, 327], [230, 325], [228, 323], [226, 320], [224, 316],
  [222, 315], [220, 311],
];

/** Depth below the rim and lateral shift, in pixels, for each traced row. */
export function samples(): { depth: number; shift: number }[] {
  return TRACE.map(([y, x]) => ({
    depth: DISC.radius - Math.hypot(x - DISC.centreX, y - DISC.centreY),
    shift: DISC.gridLineX - x,
  })).filter((s) => s.depth > 0);
}
