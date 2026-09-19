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
