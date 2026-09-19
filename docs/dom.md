# Glass over live DOM

The third renderer. The other two draw their own backdrop — WebGL2 into a canvas, AGSL over a
captured RenderNode — and refract only what they drew. This one refracts the page.

## Why it cannot be done the obvious way

A canvas has no access to the composited pixels of the page, and this is a closed door rather than
a missing feature: reading a rendered page means reading cross-origin frames, visited links and
text that is not yours. No API gives it and none will.

What the browser does give is `backdrop-filter`, which filters what sits behind an element
**inside the compositor**, where those pixels already are, and never hands them to script. It
accepts a reference to an SVG filter, and `feDisplacementMap` inside that filter bends the backdrop
along a map. That is refraction of live DOM without reading anything.

## Three things the technique demands

Each was found by measuring in a browser, not by reading a specification.

**`filterUnits="objectBoundingBox"`, with an explicit unit box.** With `userSpaceOnUse` the
coordinates are not measured from the element's own box and the displacement smears across the
page instead of staying at the rim. This was the first attempt and it looked like a bug in the
map.

**`color-interpolation-filters="sRGB"`.** The specification's default is `linearRGB`, so the
browser gamma-linearises the map's bytes before reading them and 128 stops meaning "no shift".
Measured at about 57 px of spurious displacement at scale 200 — several pixels across the flat
middle of every element at usable scales, in exactly the place the reference says the backdrop
should pass through untouched.

**`feDisplacementMap` displaces by `scale · (channel / 255 − 0.5)`.** A full channel swing spans
half the scale, not all of it, and one 8-bit step is `scale / 255` px. Encoding against the whole
scale renders every material at half its derived refraction — and still passes a test that only
checks the centre is neutral.

## What it renders, and how

| From the reference | Here |
|---|---|
| §1 refraction, magnification | `feDisplacementMap` along a baked displacement map |
| §1 dispersion | three displacement passes, one per channel, at the shader's own index shifts |
| §1 diffraction, §3 interference | one baked hue map, multiplied in by an arithmetic composite |
| §2 rim light, two arcs, dark edge | a masked conic gradient on `::after`, angles and weights from the lens's key-light lobe |
| §3 body, legibility, presence | `resolveBody` — the lens's own law, one value per element |
| §3 ink polarity | `shouldInkBeLight`, the same function every platform uses |
| §4 adaptive shadow | `box-shadow`, density from `shadowOpacityFrom` |
| §5 touch, press, drag, wave, rise | `createDeform` driving the same `touchWarp` the shader uses |
| §5 merging and splitting | `setMorph` — the smooth union, through the same SDF |
| §9 accessibility | the browser's own media queries |
| §10 scroll edge | `attachScrollEdge` |
| §11 concentricity | emitted as custom properties for the host to apply |

Two things are expressed differently from the shaders, and the difference is the primitive rather
than the law. The rim is a gradient sampled at fixed angles instead of a per-pixel normal — the
lobe, its exponent, the 0.45 opposing arc and the 0.22 dark edge are the lens's numbers. And the
spectral hue is baked rather than evaluated, because a filter graph has no way to run a function
per pixel but can multiply by an image.

## The probe reads styles, not pixels

Adaptation needs to know what is behind the element, and the same door that stops the lens reading
the page stops the probe. So it reads **declared styles**: a grid of points under the element,
`elementsFromPoint` at each, and the background stack composited the way the compositor would.

Compositing is not optional. Taking the first layer with any alpha at all reads a list row tinted
`rgba(255,255,255,0.028)` as pure white, and the glass then adapts to a backdrop that does not
exist — over a dark page the ink goes dark and the label disappears.

It is exact for colour-defined surfaces and blind to images, video and iframes. Hosts pass their
own sample there; an app already knows its cover art's accent.

## What it costs

Chromium, `devicePixelRatio` 1, `npm run measure:dom`. Milliseconds.

| element | map | hue | first attach | second, same shape | update |
|---|---:|---:|---:|---:|---:|
| button 44×44 | 2.0–3.0 | 3.0–5.0 | 3.6 | 0.9 | 0.2–0.4 |
| bar 380×76 | 2.1–7.8 | 22.7–23.7 | 13–46 | 0.8–1.4 | 0.2 |
| sheet 380×520 | 2.8–24.7 | 37.7–51.1 | 43–58 | 0.7–1.1 | 0.3 |

The refraction itself costs nothing in JS — it runs in the compositor once the filter exists. What
costs is building the maps, and two decisions carry that.

**The maps resolve the bevel, not the element.** Everything inside the bevel band is a constant
and `feImage` stretches whatever it is given, so a sheet was paying for 197 000 pixels of
arithmetic to describe a profile eight samples wide.

**Maps are cached across elements.** They are pure functions of geometry, optics and density, so
four identical buttons in a tab bar were building four identical PNGs. The second element of a
shape costs under 1.5 ms.

A scroll costs `update`, which is the probe and the CSS writes — the map is untouched because the
backdrop is not one of its inputs.

## Glass that is not there until you touch it

`variant: 'interactive'` attaches the material and leaves the element alone until a finger
arrives, then materialises it under the touch and takes it away again on release. It is how glass
goes on something that is not chrome — a scrubber, a slider thumb, a card — without putting
permanent glass in the content layer, which §7 says to avoid.

```js
attachGlass(thumb, { material: MATERIAL_PRESETS.glass, variant: 'interactive' });
```

"Absent" is measured, not asserted: `check:dom` screenshots the element untouched and compares it
to the same page with no glass attached at all, and fails on any difference. That gate is what
caught `setAppear(0)` leaving a rim, a shadow, a presence floor and a spectral fringe behind.

## One pane, not two

Attaching glass to an element that is already inside glass warns on the console and names the
outer element. The warning is not a style rule: `backdrop-filter` samples what is composited
behind an element, so a nested pane's backdrop is the outer pane's output — the refraction lands
twice on the same pixels and the blurs multiply. Overlapping panes are fine and are not warned
about; that is what two sheets of glass do.

## Limits

**The refraction is Chromium-only today.** Firefox does not support a filter reference in
`backdrop-filter` and has closed the request as not planned. Safari does not yet, though WebKit
has patches in flight (bug 245510, green on queues as of 2026-09-05). Elsewhere the same optics
drive a blur-and-tint fallback, chosen by measurement rather than by user-agent string.

**Displacement is quantised to eight bits.** One step is `scale / 255` px. Measured in Chromium:
at scale 40 a high-contrast edge visibly terraces, at scale 12 it does not, and the ceiling sits
between them nearer the clean end. Thick, high-index glass is flattened to it — rim depth traded
for an edge without stairs.

**`feDisplacementMap` resamples without prefiltering.** Fine texture shatters into chevrons where
the displacement changes quickly. The cure is the `feGaussianBlur` before it, which is not a patch
but `roughness`: the material already says how much the medium scatters.

**The first attach of a large shape is tens of milliseconds.** Cached afterwards, but the first
one is real. Attach off the critical path if a sheet appears during an animation.
