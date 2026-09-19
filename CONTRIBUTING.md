# Contributing

## Setup

```bash
npm install
npx playwright install --with-deps chromium
npm test
```

The shader gates drive a real Chromium, so that second line is not optional.

## The rule that matters most

**Every number in this package is calibrated.** Thresholds, exponents, radii, tolerances — they
came from measurements, and most of them have a comment saying what broke when they were
something else. A patch that changes a constant without a measurement behind it will be turned
down, however much better the frame looks on your screen.

If you want to move a number, bring the frame: what you rendered, over which backdrop, at which
density, and what the gate reported before and after.

## Causes and effects

`src/material.ts` holds **causes** — what a piece of glass *is*. `src/optics.ts` derives the
**effects** the shaders consume. New knobs go in the second file as derivations, not in the
first as parameters.

Before proposing a new cause, check that it cannot be derived. The model had eighteen
independent sliders once; half of them were physically dependent, and combining them produced
states real glass never occupies. That is the mistake this design exists to prevent.

## Shaders

There is one shader source (`src/lens-shader.ts`, `src/surface-shader.ts`), written in
AGSL/SkSL, transpiled to GLSL ES 3.0 for the web (`src/targets/`). Both targets must stay in
sync — `src/__tests__/targets.test.ts` enforces that uniform names match, because a name drift
once went unnoticed and shipped with refraction silently switched off for a whole phase.

Comments inside the shader source are load-bearing. They are the only place the optics are
written down next to the arithmetic that implements them.

## Gates

All four must be green before a PR is considered:

```bash
npm run typecheck
npm test
npm run check:glsl
npm run check:optics
```

`check:optics` is behavioural, not a compile check: it renders the material across a sweep of
backdrops and asserts the glass stays both a window and an object. If it fails, the material
changed — that is the point of it.

## Platform parity

Android and the web are expected to agree numerically, within a documented tolerance
(`docs/platform-parity.md`). The parity gate itself drives a development bench that is not part
of this repository, so a change that could plausibly move the two apart should say so in the PR
rather than assume it did not.

## What is not here

The UI kit built on this material and the animated backdrop technology are separate products and
are not in scope for this repository.

## Language

Code, comments, tests and documentation are in English.
