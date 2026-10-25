import { describe, expect, it } from 'vitest';
import { rimLayerCss } from '../dom/rim';

const SUPPORTED = '@supports (background-clip:border-area){';
const UNSUPPORTED = '@supports not (background-clip:border-area){';

function branches(css: string) {
  const a = css.indexOf(SUPPORTED);
  const b = css.indexOf(UNSUPPORTED);
  return { base: css.slice(0, a), clipped: css.slice(a, b), masked: css.slice(b) };
}

describe('rim layer css', () => {
  const css = rimLayerCss('[data-x]');
  const { base, clipped, masked } = branches(css);

  it('draws the ring as the border area, with no mask where that is supported', () => {
    expect(clipped).toContain('background-clip:border-area');
    expect(clipped).toContain('border:var(--vireglass-rim-width,1px) solid transparent');
    expect(clipped).toContain('background-origin:border-box');
    expect(clipped).not.toContain('mask');
    expect(base).not.toContain('mask');
    expect(base).not.toContain('padding');
  });

  it('keeps the pair of masks, with the padding that sizes them, only where border-area is missing', () => {
    expect(masked).toContain('padding:var(--vireglass-rim-width,1px)');
    expect(masked).toContain('mask-composite:exclude');
    expect(masked).toContain('-webkit-mask-composite:xor');
    expect(masked).not.toContain('border-area');
    expect(masked).not.toContain('border:');
  });

  it('follows the element\'s radius and takes its paint from the rim variable', () => {
    expect(base).toContain('border-radius:inherit');
    expect(base).toContain('background:var(--vireglass-rim,none)');
    expect(base).toContain('inset:0');
    expect(css.match(/\[data-x\]::after/g)).toHaveLength(3);
  });
});
