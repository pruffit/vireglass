# Changelog

## 1.1.0

Glass over live DOM, and the core becomes the single place the material is written down.

### The spectral edge, and what the renderer costs

Diffraction and interference looked impossible here: both are hues that vary across the bevel, and
a filter graph cannot evaluate a function per pixel. But it can MULTIPLY by an image. Both are
baked into one hue map and applied with an arithmetic composite, carrying headroom because a
normalised hue exceeds one wherever a channel is boosted and eight bits would clip it to white.

Nothing of the material is now unrendered on the web.

Then the measurement, which had never been taken. A sheet cost 120 ms to attach and a frame of
interaction rebuilt the whole map. Both from the same mistake: resolving the ELEMENT when the map
only carries the bevel. Inside that band everything is constant and `feImage` stretches whatever it
is given, so a sheet paid for 197 000 pixels of arithmetic to describe a profile eight samples
wide. Building at the bevel's own resolution cut it five to twelve times — and `check:dom` reports
the rim displacing MORE than before, because the profile is cleaner.

Maps are cached across elements, since they are pure functions of geometry, optics and density. The
second element of a shape costs under 1.5 ms where it cost 13 to 58.

### Gates

`check:law` — every calibrated value is written once, every section citation resolves into
`docs/reference.md`, and every value without provenance is named out loud. `check:dom` — the glass
demonstrably bends live DOM at its rim, leaves its middle alone, and touches nothing outside
itself, measured from screenshots because `backdrop-filter` composites where script cannot reach.

### The core modules the DOM path was ignoring

Six of them, five of which are product: accessibility, the user's clarity scale, the scroll edge,
concentricity, and groups. They existed in the core and nothing on the web read them.

**Accessibility (§9)** now comes from the browser's own media queries — `prefers-reduced-
transparency`, `prefers-contrast`, `prefers-reduced-motion` — and is followed while the page is
open, not only as it loaded. The order is fixed and it matters: causes to effects, then the user's
scale, then the system. §9 is explicit that a system setting outranks the material preset, because
the user needs contrast more than they need the look.

**The clarity scale (§3)** is a `scale` option. iOS 27 made this continuous and apps get it
without recompiling, so the material has to stay usable across the whole range rather than at one
point.

**The scroll edge (§10)** binds the core's rules to a real scroller. It is the screen's job, not
the material's — the glass has to SEE an already-dimmed backdrop, so the effect sits behind it.

**Concentricity (§11)** is emitted as `--vireglass-radius` and `--vireglass-radius-min`, because
the inset belongs to the host and CSS can do the arithmetic.

**Groups (§3)** make a row of glass agree with itself. Each element probing alone is not merely
wasteful but wrong: neighbouring pieces of one control sit over different patches, reach different
polarities, and a tab bar ends up with two light glyphs and two dark ones. §3 says small elements
switch WHOLESALE, and a group is what that means when the element is really four of them.

### The material, not a part of it — `vireglass/dom`

The DOM renderer read six of the model's twenty-eight derived values. It now reads fourteen, and
what it left out was the half that makes the material recognisable.

**Rim light** (§2): a hairline along the silhouette with two opposing arcs, the far one weaker,
the rest of it outlined by a dark edge — and its colour taken from the environment the probe
measured. The lobe is the lens shader's own, exponent and 0.45 ratio included; the dark edge is
its 0.22 darkening. Rendered as a masked conic gradient rather than per-pixel, but the numbers
behind every stop are the model's.

**Adaptive shadow** (§4): denser over text, weaker over a flat light backdrop. The law was
already in the core as `shadowOpacityFrom`; the conversion to a CSS alpha is anchored to the two
densities measured off the reference frames, 4.0% and 19.9%, rather than to a chosen gain.

**Dispersion** (§1): three displacement passes, one per channel, at the indices the shader uses —
red at `ior - 0.4 * iorSpread`, blue at `ior + 0.6 * iorSpread` — recombined arithmetically.

**The body** (§3): density is what legibility and presence demand over this backdrop, ported from
the lens shader. It replaces a flat `bodyDensity * 4` that answered to nothing.

**Finger response** (§5): press, drag with saturating travel, the release wave, and the rise into
glass — all from the core's `createDeform` and `raiseIntoGlass`, driving the same `touchWarp`
the shader uses. The glow at the contact point is a concentration of the surroundings, not the
glass's own whiteness.

**Morphing** (§5): `setMorph` bridges the element to one or two neighbouring shapes through the
smooth union. What each shape means is the host's choreography; the material only knows how two
silhouettes join.

The core gains the JS twins these needed: `smin`, `sceneDistance`, `sceneGradient` and
`touchWarp`, each mirroring its shader counterpart term for term.

Diffraction is the one thing still missing. It needs a wavelength term at the silhouette, and a
filter graph has no way to express one.

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
