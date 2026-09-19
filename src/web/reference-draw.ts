/**
 * Drawing the reference canvas onto a canvas element. Lives in `web/` because it knows about the
 * 2D context; the canvases themselves are data in `reference-scene.ts`, and the mobile lab lays
 * out the same data as native views.
 *
 * The same drawer is used by the `check:optics` gate: only this way do the eye at the bench and
 * the number in the gate look at the same canvas. The one difference between them is the fit mode.
 */

import {
  REFERENCE_SCENE_HEIGHT,
  REFERENCE_SCENE_WIDTH,
  REFERENCE_SURROUND,
  refCheckerCells,
  refGradientSteps,
  refGray,
  type VireGlassRefLayer,
  type VireGlassRefScene,
} from '../reference-scene';

export type VireGlassRefDrawOptions = {
  /** Pixels per dp. The same value used for elements: the canvas and the glass must live at the
   *  same scale. */
  readonly density: number;
  /** Canvas lightness; canvases that don't need it ignore it. Defaults to the canvas's own. */
  readonly level?: number;
  /**
   * `band` — a `REFERENCE_SCENE_WIDTH`×`REFERENCE_SCENE_HEIGHT` dp panel centered on the stage,
   * with a surrounding field: only this way do two benches show the SAME canvas, including the
   * pattern's phase under the element. `frame` — stripes stretched across the whole frame: the
   * gate has its own fixed stage, and the surrounding field would get in the way of sampling
   * pixels.
   */
  readonly fit?: 'band' | 'frame';
};

function drawLayer(
  ctx: CanvasRenderingContext2D,
  layer: VireGlassRefLayer,
  x: number,
  y: number,
  w: number,
  h: number,
  d: number,
): void {
  switch (layer.kind) {
    case 'flat': {
      ctx.fillStyle = refGray(layer.level);
      ctx.fillRect(x, y, w, h);
      return;
    }
    case 'stripes': {
      ctx.fillStyle = refGray(layer.level);
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = refGray(layer.other);
      for (let at = 0; at < w; at += layer.periodDp * d) {
        ctx.fillRect(x + at, y, layer.widthDp * d, h);
      }
      return;
    }
    case 'checker': {
      for (const cell of refCheckerCells(layer, w / d, h / d)) {
        ctx.fillStyle = refGray(cell.level);
        ctx.fillRect(x + cell.xDp * d, y + cell.yDp * d, layer.cellDp * d + 1, layer.cellDp * d + 1);
      }
      return;
    }
    case 'step': {
      ctx.fillStyle = refGray(layer.left);
      ctx.fillRect(x, y, w / 2, h);
      ctx.fillStyle = refGray(layer.right);
      ctx.fillRect(x + w / 2, y, w - w / 2, h);
      return;
    }
    case 'bar': {
      ctx.fillStyle = refGray(layer.level);
      ctx.fillRect(x, y, w, h);
      const t = layer.thicknessDp * d;
      ctx.fillStyle = refGray(layer.barLevel);
      ctx.fillRect(x, y + Math.round((h - t) / 2), w, t);
      return;
    }
    case 'grid': {
      ctx.fillStyle = refGray(layer.level);
      ctx.fillRect(x, y, w, h);
      // A line exactly ONE device pixel wide — the same as what the native view draws
      // (`StyleSheet.hairlineWidth`). Half density gave two pixels on this screen against one,
      // and the two benches' canvases diverged on the scene's finest detail.
      const thin = 1;
      const step = layer.stepDp * d;
      ctx.fillStyle = refGray(layer.lineLevel);
      for (let at = 0; at <= w; at += step) ctx.fillRect(x + Math.round(at), y, thin, h);
      for (let at = 0; at <= h; at += step) ctx.fillRect(x, y + Math.round(at), w, thin);
      return;
    }
    case 'gradient': {
      const steps = refGradientSteps(layer);
      const band = h / steps.length;
      for (let i = 0; i < steps.length; i += 1) {
        ctx.fillStyle = refGray(steps[i]);
        ctx.fillRect(x, y + Math.round(i * band), w, Math.ceil(band) + 1);
      }
      return;
    }
  }
}

export function drawReferenceScene(
  ctx: CanvasRenderingContext2D,
  scene: VireGlassRefScene,
  width: number,
  height: number,
  options: VireGlassRefDrawOptions,
): void {
  const d = options.density;
  const bands = scene.bands(options.level ?? scene.level);
  const fill = options.fit !== 'band';

  let x: number;
  let y: number;
  let w: number;
  let scale: number;
  if (fill) {
    x = 0;
    y = 0;
    w = width;
    scale = height / (REFERENCE_SCENE_HEIGHT * d);
  } else {
    ctx.fillStyle = REFERENCE_SURROUND;
    ctx.fillRect(0, 0, width, height);
    w = Math.round(REFERENCE_SCENE_WIDTH * d);
    x = Math.round((width - w) / 2);
    y = Math.round((height - REFERENCE_SCENE_HEIGHT * d) / 2);
    scale = 1;
  }

  for (const band of bands) {
    const h = Math.round(band.heightDp * d * scale);
    drawLayer(ctx, band.layer, x, y, w, h, d);
    y += h;
  }
}
