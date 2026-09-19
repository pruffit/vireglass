import { afterEach, describe, expect, it } from 'vitest';
import { resetSupportCache, supportsBackdropFilter, supportsSvgBackdropFilter } from '../dom/support';

// No jsdom in this project's vitest config (environment: 'node') — these run with no `document`
// at all, which is exactly the "import must never throw under Node" case the DOM entry point has
// to survive, since something may import `vireglass/dom` in an SSR pass.
describe('support probes outside a DOM', () => {
  afterEach(() => {
    resetSupportCache();
  });

  it('answer false rather than throwing when there is no document', () => {
    expect(() => supportsBackdropFilter()).not.toThrow();
    expect(supportsBackdropFilter()).toBe(false);
  });

  it('cache their answer across calls', () => {
    supportsSvgBackdropFilter();
    expect(supportsSvgBackdropFilter()).toBe(false);
  });
});

// The first version of this probe read a DETACHED element back through `getComputedStyle`, which
// Chromium resolves to nothing at all — so it reported "unsupported" in the one engine where the
// displacement actually works, and would have sent every visitor to the fallback.
describe('support probes against an engine that answers', () => {
  const original = (globalThis as { CSS?: unknown }).CSS;

  afterEach(() => {
    (globalThis as { CSS?: unknown }).CSS = original;
    resetSupportCache();
  });

  function stub(answer: (property: string, value: string) => boolean) {
    (globalThis as { CSS?: unknown }).CSS = { supports: answer };
    resetSupportCache();
  }

  it('report support when the engine parses the value', () => {
    stub(() => true);
    expect(supportsBackdropFilter()).toBe(true);
    expect(supportsSvgBackdropFilter()).toBe(true);
  });

  it('separate plain blur from a filter reference', () => {
    stub((_property, value) => !value.startsWith('url('));
    expect(supportsBackdropFilter()).toBe(true);
    expect(supportsSvgBackdropFilter()).toBe(false);
  });
});
