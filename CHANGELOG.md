# Changelog

## Unreleased

### Glass over live DOM — `vireglass/dom`

`attachGlass(el)` refracts the real page behind an element. No canvas, no second render of your
UI. The displacement comes from the same material model the other two renderers use, handed to
`backdrop-filter` as an SVG filter so the bending happens inside the compositor — the browser
never gives page pixels to script, and it should not.

Adaptation still runs, but its probe reads declared styles through `elementsFromPoint` and
composites the background stack, because there are no pixels to measure. Exact for colour-defined
surfaces, blind to images and video; pass your own `sample` there.

Refraction is Chromium-only today — Firefox has closed the request as not planned, Safari has
patches in flight — and everywhere else the same optics drive a blur-and-tint fallback, chosen by
measurement rather than by user-agent string.

Also adds `sdfRoundedRect` and `sdfRoundedRectGradient` to the core: the JS twin of the shader's
geometry, so the DOM path bends along the same silhouette instead of a second, drifting one.

## 1.0.0

First stable release. The material had been developed inside a private product since
August 2026; this is its extraction, unchanged in behaviour.

Supersedes 0.1.0, which was published briefly and then corrected: the core turned out to
require React through a single hook, a git install produced no `dist/`, and publishing built
the package twice. All three are fixed here. Use 1.0.0.

### Entry points

`vireglass` is the core and has no dependencies at all. `vireglass/web` is the WebGL2
renderer. `vireglass/react` carries the one hook that needs React, so that importing the core
never does. `vireglass/native` ships as source: the surface uses a Reanimated worklet, and
worklets are compiled by the consumer's Babel plugin.

### What is in it

- **Material model.** Glass described by causes — `ior`, `thickness`, `bevel`, `roughness`,
  `film`, `environment`, `legibility`, `ink`, `presence` — with every shader value derived from
  them (`resolveOptics`). Seven presets.
- **One shader source, two targets.** AGSL/SkSL transpiled to GLSL ES 3.0; a parity test keeps
  uniform names identical across both.
- **Optics.** Refraction and magnification, spherical aberration and dispersion on the bevel,
  environment reflection by Fresnel, interference from thin-film thickness, edge diffraction,
  ambient colour pickup, Beer–Lambert absorption, key-light specular.
- **Automatic adaptation.** Backdrop probe, gradient body tinting, density response to
  variegation, `presence`, and ink polarity decided by the cost of holding light ink.
- **Accessibility.** Reduced transparency, increased contrast and reduced motion mapped onto the
  material as floors; a separate user clarity scale from ultra clear to fully tinted.
- **Web renderer.** WebGL2, four passes, backdrop probe per element.
- **Android renderer.** Expo module with a native AGSL lens, a Skia surface, a backdrop probe,
  and an affine fallback below Android 13.
- **Gates.** 122 unit tests, shader compilation against a real Chromium, and a behavioural
  optics gate asserting the glass stays both a window and an object across the backdrop range.

### Known limits

Glass over live DOM is not supported on the web; there is no iOS target; refraction requires
Android 13+; interference derives a value but shows no visible iridescence. The full list is in
the README.

### Not included

The UI kit built on this material and the animated backdrop technology are separate products.
The platform-parity gate drives a development bench that is not part of this repository; the
procedure and baseline are documented, the tooling is not public.
