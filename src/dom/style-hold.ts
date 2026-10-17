/** The inline value an element had for a property before the glass took it over, as a way back. */
export function holdProperty(style: Pick<CSSStyleDeclaration, 'getPropertyValue' | 'setProperty' | 'removeProperty'>, name: string): () => void {
  const saved = style.getPropertyValue(name);
  return () => {
    if (saved) style.setProperty(name, saved);
    else style.removeProperty(name);
  };
}
