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
| §2 rim light, two arcs, dark edge | a masked conic gradient on `::after`: a light line round the whole contour with the lens's key-light lobe on it, over a dark edge; strength from the ambient lightness |
| §3 body, legibility, presence | `resolveBody` and `bodyLayer` — the lens's own law, composed into one translucent layer per element, painted as `background-color` |
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

## Measured against the reference

The controls of A 2:17 (over dark video), M 2:52 (over sky), A 2:18 (grass), M 18:26 (a flower),
M 18:30 (the same under reduced transparency) and M 11:58 (text) were cut from the reference frames,
the control's own footprint filled smoothly from its surround, and a 44 dp circle or capsule of
`VIREGLASS_CONTROL_MATERIAL` laid over each at device pixel ratio 3, with the footprint's mean colour
as `sample`. Body and surround are OKLab medians of the rings 0.15 to 0.45 R inside the rim and 0.15
to 0.55 R outside it; the rim is the brightest of 24 angular bins (90th percentile) over the surround.
The frames are local and are not in the repository.

Body lightness over the surround (ΔL) and rim over the surround, reference, then 2.3.1, then this
release:

| control | ref ΔL | 2.3.1 | now | ref rim | 2.3.1 | now |
|---|---|---|---|---|---|---|
| A 2:17 skip back | +0.086 | +0.023 | +0.090 | 0.240 | 0.707 | 0.253 |
| A 2:17 pause | +0.071 | +0.038 | +0.117 | 0.257 | 0.762 | 0.310 |
| A 2:17 skip forward | +0.045 | +0.027 | +0.114 | 0.268 | 0.796 | 0.320 |
| A 2:17 Continue | +0.080 | +0.076 | +0.143 | 0.256 | 0.759 | 0.317 |
| A 2:17 Info | +0.126 | +0.018 | +0.088 | 0.268 | 0.704 | 0.236 |
| M 2:52 next, over sky | +0.076 | +0.002 | +0.025 | 0.246 | 0.329 | 0.240 |
| A 2:18 more, over grass (a) | +0.232 | +0.016 | +0.061 | 0.372 | 0.523 | 0.352 |
| M 18:26 flower (a) | +0.040 | -0.019 | +0.004 | 0.291 | 0.293 | 0.203 |
| M 18:30 reduced transparency (a) | +0.169 | -0.127 | -0.367 | 0.187 | 0.301 | 0.192 |
| M 11:58 bar over text (a) | +0.049 | -0.044 | -0.040 | 0.114 | 0.114 | 0.063 |

(a) the backdrop under the control is not in the frame, so the surround is only a guess for it.

The body is lighter than the surround on every smooth row, as in the reference, and within 0.05 of
it on skip back, pause and Info; skip forward and Continue are 0.07 and 0.06 above, and sky is 0.051
below. Chroma is within 0.04 of the reference on every row. The rim is within 0.08 on every smooth
row. The medium's own lift (matte, pull, concentration of light) sets the body now; the control
material no longer asks for a presence floor on top of it. A presence that brings the sky inside 0.05
puts two dark rows further out, and the reference's own spread (+0.045 to +0.126 over similar
backdrops) is wider than the tolerance, so one constant cannot sit inside all of them.

Reduced transparency (M 18:30) is not held to the reference: the backdrop's lightness sits at the
ink polarity's switch, the ink stays light, and a body at the density that mode asks for goes to its
pole, a dark plate where the reference is a light one.

The WebGL2 lens and this path were measured on the same flat backdrops (the footprint means above)
with the same material: body within 0.019 of each other everywhere, rim within 0.021 over dark,
0.053 over sky and grass and 0.024 over near-white, the lens fainter over light. Both are inside the
rim tolerance.

## The probe reads styles, not pixels

Adaptation needs to know what is behind the element, and the same door that stops the lens reading
the page stops the probe. So it reads **declared styles**: a grid of points under the element,
`elementsFromPoint` at each, and the background stack composited the way the compositor would.

Compositing is not optional. Taking the first layer with any alpha at all reads a list row tinted
`rgba(255,255,255,0.028)` as pure white, and the glass then adapts to a backdrop that does not
exist — over a dark page the ink goes dark and the label disappears.

Type is not a declared background, so a point that falls on a line box of a text node, with nothing
opaque or pictured above it, also reads the text's fill: as `PROBE.inkOfLine` of the point, in the
spread (`busy`) only, never in the lightness or its percentiles. That share is an estimate, not a
measurement, and a 5 by 5 grid meets lines as they scroll past it.

It is exact for colour-defined surfaces, estimates type, and is blind to images, video and iframes.
Hosts pass their own sample there; an app already knows its cover art's accent, and `setSample`
changes it later without re-attaching.

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

## The gate looks at the picture

`check:dom` renders the material over a saturated page and compares its own pixels' saturation
against the same page with no glass on it. Glass moves light; it cannot make colour that is not
already there, so the material must not read as more saturated than what it stands on.

That assertion exists because everything else passed while the default preset wrapped every
control in a neon tube. The spectral overlay multiplied the backdrop channel by channel — 1.68 on
red against 0.05 on blue — and 286 unit tests, a shader compile, an optics sweep and a
displacement measurement all stayed green. The hairline fixture the other assertions use is nearly
grey, so a material that saturates everything looks fine on it.

It also corrupted the measurement next to it. `full` against `flat` is supposed to isolate the
displacement, and `flat` is the same material at ior = 1 — which zeroes the iridescence too,
because that rides Fresnel. So most of what the rim figure reported was the overlay, not the lens:
22.45 before, 7.96 now, on unchanged optics.

## Limits

**Colour pickup is uniform, and reality is a gradient.** A large element takes on the colour of the
content beside it (§7). Measured off the reference, that bleed peaks at about 0.3 of the content's
own chroma at the edge nearest it and is gone about ninety pixels in. This renderer has one backdrop
sample per element, so it applies the peak across the whole body: right at the edge, too strong in
the middle. The WebGL and AGSL paths sample per pixel and do not have this limit.

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
