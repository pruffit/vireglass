// Tinting (docs/reference.md §7, 219 @16:31): "Selecting a color generates a range of tones that
// are mapped to content brightness underneath the tinted element. It draws inspiration from how
// colored glass works in reality: changing its hue, brightness and saturation depending on what's
// behind without deviating too much from the intended color."
//
// So a tint is not a fill. @17:03 is explicit about what a fill costs: "it is completely opaque
// and breaks the visual character of Liquid Glass." The colour has to be a property of the medium,
// and the content has to keep coming through it.
//
// JS twin of the accent block in the lens shader.
import type { VireGlassAccent } from './adapters';
import { ACCENT } from './law';

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * The tone this accent takes over a backdrop of the given lightness — deeper over dark, lighter
 * over light, which is what "a range of tones mapped to content brightness" means.
 *
 * @17:21: tinting is for the primary action, not for everything. "When every element is tinted,
 * nothing stands out." That is the host's call, not this function's.
 */
export function accentTone(
  color: readonly [number, number, number],
  backdropLuma: number,
): [number, number, number] {
  const k = ACCENT.deep + (ACCENT.light - ACCENT.deep) * clamp01(backdropLuma);
  return [clamp01(color[0] * k), clamp01(color[1] * k), clamp01(color[2] * k)];
}

/** The fraction of the medium the colour occupies, which is what keeps the content showing
 *  through it rather than being covered by it. */
export function accentAmount(accent: VireGlassAccent): number {
  return clamp01(accent.amount ?? ACCENT.amount);
}
