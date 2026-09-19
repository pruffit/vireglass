import { createContext, useContext, type ReactNode } from 'react';
import { INK_DARK, INK_LIGHT } from '../adaptation';

/**
 * Ink polarity for content ON TOP of the glass, handed down to the surface's children.
 *
 * The glass itself decides whether letters over it must be light or dark: it's the only thing
 * that sees what's underneath (`useGlassAdaptation`). Children just ask for the color —
 * otherwise every screen would grow its own logic and they'd drift apart from each other.
 *
 * The value is continuous: on a recolor it travels between the ends, and the color travels
 * along with it.
 */
const GlassInkContext = createContext(1);

export function GlassInkProvider({ ink, children }: { ink: number; children: ReactNode }) {
  return <GlassInkContext.Provider value={ink}>{children}</GlassInkContext.Provider>;
}

/** Polarity: 1 — light ink, 0 — dark. */
export function useGlassInk(): number {
  return useContext(GlassInkContext);
}

const hex = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255);

/**
 * Ink color for the current polarity. Between the ends it travels by lightness — the same
 * quantity the glass uses for its own separation, so the text and the body don't drift apart
 * mid-transition.
 */
export function inkColor(ink: number, light: string, dark: string): string {
  if (ink >= 0.999) return light;
  if (ink <= 0.001) return dark;
  // In-between frames last a fraction of a second, and exact per-channel interpolation isn't
  // needed here: what matters is that the transition doesn't read as a step.
  const v = INK_DARK + (INK_LIGHT - INK_DARK) * ink;
  const g = hex(v);
  return `rgb(${g}, ${g}, ${g})`;
}

export function useInkColor(light: string, dark: string): string {
  return inkColor(useGlassInk(), light, dark);
}
