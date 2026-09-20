// The comparison canvases, and the one drawer that puts them on a 2D context.
//
// Bench machinery, not material. It exists so two platforms can be held against the same
// backdrop and compared as numbers (docs/platform-parity.md), and it is on its own subpath
// because a material library’s surface should not be its own test canvases: an app that wants
// glass has no use for a checkerboard, and a host that already has its own comparison canvases
// should not have to dodge a name collision to adopt the material.
export * from './reference-scene';
export * from './web/reference-draw';
