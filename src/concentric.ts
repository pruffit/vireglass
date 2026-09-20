// Concentricity (reference 219 @7:53): nested shapes share the CENTER of curvature, not the radius.
// So the inner shape's radius is smaller by exactly the inset — otherwise the corners don't run
// parallel and the gap between the shapes either gets eaten or spreads apart.

/**
 * Radius of a nested shape: outer radius minus inset. Zero is a square corner; it never goes
 * negative — once the inset exceeds the outer radius, the corner is simply a right angle.
 *
 * `minimum` — a floor on the radius (analogous to `concentric(minimum:)` in SwiftUI): far from
 * the edge, honest concentricity yields zero and the nested element drops out of the family with
 * a sharp corner. The floor breaks concentricity on purpose — here kinship between shapes matters
 * more than a shared center of curvature.
 */
export function concentricRadius(outerRadius: number, inset: number, minimum = 0): number {
  return Math.max(outerRadius - inset, Math.max(minimum, 0));
}

/**
 * The inset at which an inner shape with a given radius stays concentric with the outer one.
 * The inverse problem: the element's radius is known (its size dictates it), and what's needed
 * is the margin around it.
 */
export function concentricInset(outerRadius: number, innerRadius: number): number {
  return Math.max(outerRadius - innerRadius, 0);
}

/**
 * The three shape types the design system builds concentric layouts from (356 @3:42): "fixed
 * shapes have a constant corner radius. Capsules use a radius that's half the height of the
 * container. And concentric shapes calculate their radius by subtracting padding from the
 * parent's."
 *
 * Naming them is the point. 356 @5:09: "using the three shape types we covered earlier helps keep
 * your components aligned with the system." A host that only has a number has to decide what that
 * number means every time the layout changes; a host that has the type gets the number recomputed
 * for it.
 */
export type ShapeSpec =
  | { type: 'fixed'; radius: number }
  | { type: 'capsule' }
  /**
   * `fallback` is 356 @6:00: "a neat trick for managing components that need to work both inside a
   * container and on their own: use a concentric shape with a fallback radius. The concentric value
   * adapts when nested, and the fallback kicks in when the component stands alone."
   *
   * It is not the same as `minimum`. A minimum is a floor that applies while nested and breaks
   * concentricity on purpose; a fallback applies only when there is no parent to be concentric
   * with, and never overrides a parent that exists.
   */
  | { type: 'concentric'; inset: number; minimum?: number; fallback?: number };

/** What is around a shape, when there is something around it. */
export type ShapeParent = { cornerRadius: number };

/**
 * The corner radius a shape takes in the place it finds itself. `height` is the shape's own, which
 * is what a capsule's radius is measured from; `parent` is absent when the shape stands alone.
 */
export function resolveShape(spec: ShapeSpec, height: number, parent?: ShapeParent): number {
  switch (spec.type) {
    case 'fixed':
      return Math.max(spec.radius, 0);
    case 'capsule':
      return Math.max(height, 0) / 2;
    case 'concentric':
      return parent
        ? concentricRadius(parent.cornerRadius, spec.inset, spec.minimum)
        : Math.max(spec.fallback ?? 0, 0);
  }
}

/**
 * Whether two nested shapes are concentric, and which way they are wrong when they are not.
 * 356 @5:19: "keep an eye out for corners that feel too pinched — or flared. They can create
 * tension and break the sense of balance."
 *
 * Pinched is an inner radius smaller than concentricity asks for: the gap between the corners
 * widens through the curve. Flared is larger: the gap narrows and the corners crowd each other.
 * The defect is visible to the eye and usually goes unnamed, which is why this names it.
 */
export function concentricFit(
  outerRadius: number,
  inset: number,
  innerRadius: number,
  tolerance = 0.5,
): 'concentric' | 'pinched' | 'flared' {
  const want = concentricRadius(outerRadius, inset);
  if (innerRadius < want - tolerance) return 'pinched';
  if (innerRadius > want + tolerance) return 'flared';
  return 'concentric';
}
