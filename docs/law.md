# The law

`src/law.ts` holds every calibrated number in the material — 119 of them, in 20 groups —
and nothing else in the source is allowed to hold one. Renderers, shaders and helpers read from
it; the shader templates interpolate it into their GLSL and AGSL, so the same constant reaches
the web, Android and the DOM path without being copied.

This is not tidiness. Two things depend on it.

**A number you cannot find is a number nobody checks.** Before the law existed, the calibration
lived wherever it was used: the springs in the touch model, the shadow curve in the geometry
module, the whole cause-to-effect chain as bare literals inside `optics.ts` — `160 - roughness *
152`, `clamp(fresnelStrength(ior) * 0.9, 0, 0.42)`. Every one of those is a decision about what
the material is, and every one of them was invisible to anything that wanted to audit the model.

**Honest provenance.** Each value carries where it came from: a section of
[`reference.md`](reference.md) (`§5`), a timestamp in a source (`M 2:32`), or an entry in the
experiment journal (`E-43`). A value with none says **UNMEASURED** in its own comment, and says
why nobody has measured it.

It is part of the package's surface, not an internal detail:

```js
import { RIM, BODY, TOUCH, DERIVE } from 'vireglass/law';
```

A fourth renderer has to agree with the other three, and it cannot do that against numbers it
cannot read. The groups are on a subpath rather than the main entry because names like `SIZE`,
`SCALE` and `TOUCH` have no business in a top-level namespace.

## The gate

```bash
npm run check:law
```

It checks three things, and reports a fourth:

- every law is read by someone — a constant nothing imports is one the material no longer obeys;
- every `§N` in the source resolves to a section `reference.md` actually has;
- no calibrated constant is left outside `law.ts`;
- and it names every unmeasured value, every run — and fails if this page or the README states a
  different number, because a count written out in prose goes stale the moment a value is added.

Today that last line reads **43 of 119**. That is the real state of the model, and it is meant to
be uncomfortable. It was 9 until the constants hiding inside `optics.ts`, `geometry.ts` and
`touch-response.ts` were brought in — the number did not get worse, the instrument got honest.

Most of the forty are stylisations, and they say so. Literal physical values put every effect at
the threshold of visibility: real glass reflects four per cent at normal incidence, and a rim
drawn at four per cent is not a rim. Each stylisation is monotonic in its own cause, so "denser
medium, brighter rim" holds whatever the constant is. What no one has measured is where on the
scale Apple's material actually sits.

## Measuring one

Pick a value, find it in a frame of public reference material, and replace its UNMEASURED note
with the citation. The gate will stop naming it. Changing a number is a change to the material,
so it needs the same evidence any other change to the material needs — see
[`material-lab.md`](material-lab.md) for how the existing measurements were taken.

Values that are *derived* rather than measured do not belong here at all. `neckToBridge` is an
example: the width at which two surfaces fuse is exactly twice the gap, which falls out of the
smooth-minimum's own algebra. It lives next to that algebra in `sdf.ts`, with the derivation in
its comment.
