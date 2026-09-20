import { describe, expect, it } from 'vitest';
import { accentAmount, accentTone } from '../accent';
import { ACCENT } from '../law';

// 219 @16:31: "Selecting a color generates a range of tones that are mapped to content brightness
// underneath the tinted element. It draws inspiration from how colored glass works in reality:
// changing its hue, brightness and saturation depending on what's behind without deviating too
// much from the intended color."
describe('tinting (docs/reference.md §7)', () => {
  const red: readonly [number, number, number] = [0.85, 0.2, 0.2];

  it('generates a range of tones from what is underneath, not one flat colour', () => {
    const overDark = accentTone(red, 0.05);
    const overLight = accentTone(red, 0.95);
    expect(overLight[0]).toBeGreaterThan(overDark[0]);
  });

  it('does not deviate far from the colour that was asked for', () => {
    // The whole range stays within about a tenth of the intended colour: colored glass changes
    // its brightness with its surroundings, it does not become a different colour.
    for (const luma of [0, 0.25, 0.5, 0.75, 1]) {
      const [r, g, b] = accentTone(red, luma);
      expect(Math.abs(r - red[0])).toBeLessThan(0.12);
      expect(Math.abs(g - red[1])).toBeLessThan(0.12);
      expect(Math.abs(b - red[2])).toBeLessThan(0.12);
    }
  });

  it('keeps the hue: a red tint never turns into a blue one', () => {
    for (const luma of [0, 0.5, 1]) {
      const [r, g, b] = accentTone(red, luma);
      expect(r).toBeGreaterThan(g);
      expect(r).toBeGreaterThan(b);
    }
  });

  it('stays inside the representable range over a very light backdrop', () => {
    // The light end multiplies by more than one, so a colour already near white would leave the
    // range without the clamp.
    const [r, g, b] = accentTone([1, 1, 1], 1);
    expect(Math.max(r, g, b)).toBeLessThanOrEqual(1);
  });

  it('occupies part of the medium, never all of it', () => {
    // @17:03: a solid fill "is completely opaque and breaks the visual character of Liquid Glass".
    expect(accentAmount({ color: red })).toBe(ACCENT.amount);
    expect(accentAmount({ color: red })).toBeLessThan(1);
    expect(accentAmount({ color: red, amount: 5 })).toBe(1);
    expect(accentAmount({ color: red, amount: -1 })).toBe(0);
  });
});
