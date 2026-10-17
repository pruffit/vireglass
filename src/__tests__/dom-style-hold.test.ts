import { describe, expect, it } from 'vitest';
import { holdProperty } from '../dom/style-hold';

function fakeStyle(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getPropertyValue: (name: string) => values.get(name) ?? '',
    setProperty: (name: string, value: string) => void values.set(name, value),
    removeProperty: (name: string) => (values.delete(name), ''),
  };
}

describe('giving an element its own inline value back', () => {
  it('restores what the host had set', () => {
    const style = fakeStyle({ 'background-color': 'rgb(1, 2, 3)' });
    const restore = holdProperty(style, 'background-color');
    style.setProperty('background-color', 'rgba(9, 9, 9, 0.5)');
    restore();
    expect(style.values.get('background-color')).toBe('rgb(1, 2, 3)');
  });

  it('removes the property when the host had none', () => {
    const style = fakeStyle();
    const restore = holdProperty(style, 'background-color');
    style.setProperty('background-color', 'rgba(9, 9, 9, 0.5)');
    restore();
    expect(style.values.has('background-color')).toBe(false);
  });
});
