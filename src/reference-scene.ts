/**
 * REFERENCE CANVASES — the set that both benches draw and that the gates run against.
 *
 * There used to be three kinds of canvas, each in a different place: the web bench had its own
 * zones, the mobile lab had its own, and a third set lived inside `check-optics.mjs`, invisible
 * to everyone else. So the gate measured one thing, the eye looked at another, and there was
 * nothing to confirm the question "does Android differ?" against.
 *
 * The canvases are described as DATA, not drawing code: the canvas and the native views draw
 * differently, but both platforms lay out the same list of layers. Everything is in dp and in
 * fractions — fractions of the stage kept the stripes the same relative thickness on benches of
 * different sizes.
 *
 * Each canvas answers for one promise of the material (`what`), and that's also the caption on
 * the bench. A canvas can't be added to only one bench: platform parity would go back to being
 * a matter of impression.
 */

import { capsuleGeometry, circleGeometry, roundedRectGeometry, type VireGlassGeometry } from './geometry';

/**
 * BENCH SHAPES — shared too. Element size feeds into the optics through sizeGain: a 120 circle
 * and a 150 circle are glass of different thickness, and screenshots from two benches on
 * different shapes are as incomparable as on different canvases. The values match the ones the
 * reference comparisons were shot on.
 */
export const REFERENCE_SHAPES = {
  circle: circleGeometry(120),
  capsule: capsuleGeometry(300, 110),
  tile: roundedRectGeometry(220, 120, 32),
} satisfies Record<string, VireGlassGeometry>;

export type VireGlassRefShapeName = keyof typeof REFERENCE_SHAPES;

/** A stripe's layer. Lightness is 0..1, sizes are dp: gray, not color (there's nothing to
 *  measure color with). */
export type VireGlassRefLayer =
  | { readonly kind: 'flat'; readonly level: number }
  /** Vertical stripes: wider than the bevel, so the body absorbs them rather than the rim. */
  | { readonly kind: 'stripes'; readonly level: number; readonly other: number; readonly periodDp: number; readonly widthDp: number }
  /** A pseudo-random checkerboard — a "cover": structure that fights the ink drawn over the glass. */
  | { readonly kind: 'checker'; readonly level: number; readonly amp: number; readonly cellDp: number }
  /** Left and right halves at different lightness. */
  | { readonly kind: 'step'; readonly left: number; readonly right: number }
  /** A dark bar across the middle of the stripe — measures bulging at the rim against it. */
  | { readonly kind: 'bar'; readonly level: number; readonly barLevel: number; readonly thicknessDp: number }
  /** A fine grid: any lens distortion shows up on a straight line right away. */
  | { readonly kind: 'grid'; readonly level: number; readonly lineLevel: number; readonly stepDp: number }
  /** A stepped gradient. Steps, not a smooth fill: the native views can't draw a gradient without
   *  an image. */
  | { readonly kind: 'gradient'; readonly from: number; readonly to: number; readonly steps: number };

export type VireGlassRefBand = {
  /** Stripe thickness in dp. The sum over a canvas is `REFERENCE_SCENE_HEIGHT`. */
  readonly heightDp: number;
  readonly layer: VireGlassRefLayer;
};

/**
 * Canvas size IN DP, one for all. Height is kept within the mobile lab's zone (0.42 of the
 * screen height), width within the narrowest phone (360 dp) with room to spare for the
 * surrounding field.
 *
 * Width matters NO LESS than height. The pattern is measured from the edge of the canvas, so on
 * a canvas spanning the full width of the stage, the phase of the pattern under the element
 * depended on screen width: 24 dp-period stripes landed under the center differently on a 406 dp
 * phone versus a fifteen-hundred-pixel canvas, and the checkerboard put an entirely different
 * cell arrangement under the element. A fixed-size panel removes this whole class of discrepancy
 * at once.
 */
export const REFERENCE_SCENE_WIDTH = 336;
export const REFERENCE_SCENE_HEIGHT = 252;

/** The field around the canvas. Deliberately off the stripe levels and not gray: it shows where
 *  the reference area ends, so its border can't be mistaken for a stripe in a screenshot. */
export const REFERENCE_SURROUND = '#3c1f4a';

/**
 * Where the element sits on the canvas — dp from the panel's top-left corner. Position is as much
 * a part of the contract as canvas size and shape: a bench that parks the element its own way
 * shows it over DIFFERENT stripes, and there's nothing left to compare screenshots against.
 *
 * This has drifted before: the web bench centered the element within the VISIBLE area, while the
 * canvas was drawn centered on the full canvas element — with the control panel open, those are
 * two different points.
 */
export const REFERENCE_PIECE_AT = {
  xDp: REFERENCE_SCENE_WIDTH / 2,
  yDp: REFERENCE_SCENE_HEIGHT / 2,
} as const;

export type VireGlassRefScene = {
  readonly name: string;
  /** What this canvas checks. Also the caption on the bench — otherwise the set turns to mush. */
  readonly what: string;
  /** Stripes at a given backdrop lightness: benches call with `level`, the gate sweeps the whole range. */
  readonly bands: (level: number) => readonly VireGlassRefBand[];
  /** Default lightness. Canvases that don't need it simply ignore it. */
  readonly level: number;
  /**
   * Whether the canvas is fit for NUMERIC platform comparison. A lightness profile needs a
   * backdrop that's uniform along the row; on a periodic grid of pixel-wide lines, the average
   * is determined by how the platform rasterizes that line, not by the material. Such a canvas
   * stays in the set — distortion of a straight line is visible to the eye at a glance — but it's
   * excluded from the comparison table.
   */
  readonly measurable?: false;
};

const whole = (layer: VireGlassRefLayer): readonly VireGlassRefBand[] => [
  { heightDp: REFERENCE_SCENE_HEIGHT, layer },
];

/** Stripe contrast is the same at every level, so transmission compares fairly between steps. */
const stripeLevel = (level: number) => (level < 0.5 ? level + 0.22 : level - 0.22);

export const REFERENCE_SCENES: readonly VireGlassRefScene[] = [
  {
    name: 'flat',
    what: 'the body standing off the backdrop: the element must be visible over a flat canvas',
    level: 0.5,
    bands: (level) => whole({ kind: 'flat', level }),
  },
  {
    name: 'stripes',
    what: 'the window: the brightness range inside the element is a noticeable fraction of the range outside it',
    level: 0.5,
    bands: (level) => whole({ kind: 'stripes', level, other: stripeLevel(level), periodDp: 24, widthDp: 10 }),
  },
  {
    name: 'busy',
    what: 'ink against content: both the ink and whatever is under the glass have to live over a busy cover',
    level: 0.5,
    bands: (level) => whole({ kind: 'checker', level, amp: 0.28, cellDp: 16 }),
  },
  {
    name: 'bar',
    what: 'the rim gathers content: at the silhouette the lens bulges out whatever sits behind it',
    level: 0.93,
    bands: (level) => whole({ kind: 'bar', level, barLevel: 0.12, thicknessDp: 20 }),
  },
  {
    name: 'steps',
    what: 'the body profile at five levels at once — platforms are compared against it',
    level: 0.5,
    bands: () => [
      { heightDp: 36, layer: { kind: 'flat', level: 0.1 } },
      { heightDp: 36, layer: { kind: 'flat', level: 0.3 } },
      { heightDp: 36, layer: { kind: 'flat', level: 0.5 } },
      { heightDp: 36, layer: { kind: 'flat', level: 0.69 } },
      { heightDp: 36, layer: { kind: 'flat', level: 0.9 } },
      { heightDp: 36, layer: { kind: 'step', left: 0.05, right: 0.28 } },
      { heightDp: 36, layer: { kind: 'bar', level: 0.92, barLevel: 0.12, thicknessDp: 6 } },
    ],
  },
  {
    name: 'edge',
    what: 'tint at a hard break: one half under the glass is black, the other white',
    level: 0.5,
    bands: () => whole({ kind: 'step', left: 0.03, right: 0.95 }),
  },
  {
    name: 'gradient',
    what: 'ink polarity: where the automatic switch flips the ink from light to dark',
    level: 0.5,
    bands: () => whole({ kind: 'gradient', from: 0.04, to: 0.96, steps: 28 }),
  },
  {
    name: 'grid',
    what: 'lens distortion: drift, tearing and jitter of a straight line show up immediately (by eye, not by number)',
    level: 0.91,
    measurable: false,
    bands: (level) => whole({ kind: 'grid', level, lineLevel: level > 0.5 ? level - 0.14 : level + 0.14, stepDp: 12 }),
  },
];

export type VireGlassRefSceneName = (typeof REFERENCE_SCENES)[number]['name'];

export const referenceScene = (name: string): VireGlassRefScene => {
  const scene = REFERENCE_SCENES.find((s) => s.name === name);
  if (!scene) throw new Error(`vireglass: no reference canvas "${name}"`);
  return scene;
};

/** Lightness to hex gray. One conversion for both platforms — otherwise they'd drift apart. */
export const refGray = (level: number): string => {
  const v = Math.round(Math.min(Math.max(level, 0), 1) * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${v}${v}${v}`;
};

/**
 * Checkerboard cells as POSITIONS, not as drawing: the canvas loops over them, the native views
 * lay them out as a list, and both platforms get the exact same arrangement. The generator is
 * its own and deliberately simple — `Math.random` would give two platforms different canvases.
 */
export const refCheckerCells = (
  layer: Extract<VireGlassRefLayer, { kind: 'checker' }>,
  widthDp: number,
  heightDp: number,
): readonly { readonly xDp: number; readonly yDp: number; readonly level: number }[] => {
  const cells: { xDp: number; yDp: number; level: number }[] = [];
  const lo = layer.level - layer.amp;
  const hi = layer.level + layer.amp;
  let seed = 1;
  for (let y = 0; y < heightDp; y += layer.cellDp) {
    for (let x = 0; x < widthDp; x += layer.cellDp) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      cells.push({ xDp: x, yDp: y, level: (seed >> 16) % 2 ? hi : lo });
    }
  }
  return cells;
};

/** Gradient steps — also positions: the same list for the canvas and for the native views. */
export const refGradientSteps = (
  layer: Extract<VireGlassRefLayer, { kind: 'gradient' }>,
): readonly number[] =>
  Array.from({ length: layer.steps }, (_, i) =>
    layer.from + ((layer.to - layer.from) * i) / Math.max(layer.steps - 1, 1),
  );
