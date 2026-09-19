import { describe, expect, it, vi } from 'vitest';
import { GLASS_ATTR, warnIfNested } from '../dom/nesting';

// A minimal stand-in for the two things the check asks an element: who its parent is, and whether
// any ancestor carries the attribute. The suite runs without a DOM on purpose — the renderer is
// exercised against a real browser by `check:dom`, and these are the branches a browser makes
// awkward to set up rather than the ones it verifies.
type FakeEl = {
  tagName: string;
  id: string;
  parentElement: FakeEl | null;
  glass: boolean;
  closest(sel: string): FakeEl | null;
};

function el(tagName: string, glass = false, id = ''): FakeEl {
  const node: FakeEl = {
    tagName,
    id,
    parentElement: null,
    glass,
    closest(sel) {
      if (sel !== `[${GLASS_ATTR}]`) return null;
      let at: FakeEl | null = node;
      while (at) {
        if (at.glass) return at;
        at = at.parentElement;
      }
      return null;
    },
  };
  return node;
}

function child(parent: FakeEl, tagName: string, glass = false): FakeEl {
  const node = el(tagName, glass);
  node.parentElement = parent;
  return node;
}

// 219 @11:50: "avoid putting [glass] within or on top of other glass elements to maintain
// hierarchy and prevent clutter." S 32:54: "double translucency, layered blur, and unpredictable
// rendering."
describe('glass inside glass (docs/reference.md §7)', () => {
  it('says nothing about an element with no glass above it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    warnIfNested(child(el('main'), 'button') as unknown as Element);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('names the outer element when one contains the other', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bar = el('nav', true, 'toolbar');
    warnIfNested(child(bar, 'button') as unknown as Element);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain('nav#toolbar');
    warn.mockRestore();
  });

  it('finds the outer element however deep the nesting goes', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sheet = el('aside', true);
    warnIfNested(child(child(child(sheet, 'div'), 'span'), 'button') as unknown as Element);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('does not count the element itself: attaching glass is not nesting it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // `attachGlass` sets the attribute right after this check, and on a re-attach it is already
    // there. An element is not inside itself.
    warnIfNested(child(el('main'), 'button', true) as unknown as Element);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('warns once, not once per frame', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bar = el('nav', true);
    const inner = child(bar, 'button');
    warnIfNested(inner as unknown as Element);
    warnIfNested(inner as unknown as Element);
    warnIfNested(inner as unknown as Element);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
