// Glass inside glass (docs/reference.md §6). 219 @11:50 puts it among the principles: "avoid
// putting [glass] within or on top of other glass elements to maintain hierarchy and prevent
// clutter." S 32:54 ("Building CNN for iOS 26") is the same rule reported from the other side, by a
// team that had already shipped it: "Applying the glass effect to both a parent and child views led to visual redundancy.
// Double translucency, layered blur, and unpredictable rendering."
//
// On this renderer it is not only a matter of hierarchy. `backdrop-filter` samples what is already
// composited behind the element, so a nested pane's backdrop is the outer pane's OUTPUT: the
// displacement is applied twice to the same pixels and the two blurs multiply. The inner element
// does not look like thicker glass, it looks like a mistake.
//
// Overlap is a different case and not this function's business — a sheet over a bar is two panes in
// the stacking order, which is what two panes of glass actually do. Only containment is wrong.
const WARNED = new WeakSet<Element>();

/** Set by `attachGlass`; exported so the check does not have to know the attribute's spelling. */
export const GLASS_ATTR = 'data-vireglass';

export function warnIfNested(el: Element): void {
  if (WARNED.has(el)) return;
  const outer = el.parentElement?.closest(`[${GLASS_ATTR}]`);
  if (!outer) return;
  WARNED.add(el);
  // Warned, not refused: where an element sits is the host's layout, and a library that silently
  // declines to render is harder to debug than one that says what is wrong.
  const where = outer.tagName.toLowerCase() + (outer.id ? `#${outer.id}` : '');
  console.warn(
    `vireglass: glass inside glass — this element is a descendant of <${where}>, which is also glass. ` +
      `Its backdrop is the outer element's output, so the refraction is applied twice and the blurs ` +
      `multiply. Put the glass on one of the two.`,
  );
}
