# VireGlass Material Lab

This is a selection from a longer working journal kept during VireGlass's development. Entry
IDs are preserved exactly as written, so a code comment or another doc citing an entry by ID
resolves to something here; entries not selected are simply absent, not renumbered. Each entry
keeps the journal's own shape — hypothesis, then what was actually observed, then the decision
— even where a later entry overturns an earlier one.

## E-01 · Refraction Was Never Applied in Production

**Experiment.** Cross-check the prop names the JS side sends to the native lens against the
ones declared in `GlassLensView.kt`.

**Hypothesis.** There's no mismatch — the lens works, nobody has just measured it in isolation.

**Implementation.** Reading the code: the consuming component was passing `lensRadius` and
`edgeReach`; the native view declares `glassWidth`, `glassHeight`, `cornerRadius`, `edgePush`.

**Observation.** Hypothesis refuted. Expo silently ignores an unknown prop, `glassWidth` stays
`0`, and `applyEffect()` returns early on the `glassWidth <= 0f` check — before
`setRenderEffect` ever runs. The AGSL lens had not been applied in a single production scenario
since it shipped (commit `9ba44eb9`). What actually sat under the surface was a plain
overscan-sized `BlurView` rectangle, not a refracted circle. The symptom was faint enough to go
unnoticed: `intensity=9`, `tint="dark"` over a dark background renders an almost invisible
rectangle either way.

**Decision.** Prop names were brought in line with the native ones. This class of bug is now
closed by a parity test that parses `GlassLensView.kt` and `GlassLensModule.kt` and fails on any
mismatch between prop names and uniform names. Side effect: the Phase 2.1 benchmark had measured
the pipeline *without* RenderEffect — noted in `docs/benchmarks.md`; the old numbers weren't
rewritten, but their scope is now understood to be narrower than assumed.

## E-02 · One SDF Source for Both Shaders

**Experiment.** Remove the second, independent implementation of the geometry.

**Hypothesis.** AGSL and SKSL are the same language (SkSL), so the geometry can live as one
TypeScript string handed to the native view as a prop, instead of being duplicated in Kotlin.

**Implementation.** `src/sdf.ts` holds the shared snippet (`vgRoundRect`, `vgSmin`, `vgScene`,
`vgRoundRectNormal`, `vgSceneNormal`, `vgBevelT`, `vgBevelSlope`). It gets concatenated by
`src/surface-shader.ts` and `src/lens-shader.ts`; the lens source travels to `GlassLensView.kt`
as a `shaderSource` prop, and Kotlin compiles and caches it by the string's value. There is no
more built-in AGSL copy in Kotlin — otherwise the mismatch would come back through the side
door.

**Observation.** Compiling the string from JS works (`RuntimeShader(src)` accepts any valid
AGSL). A test confirms the SDF substring is byte-identical in both shaders. The visual side is
device-pending.

**Decision.** Accepted. Closes "Gap 1" from the rendering ADR (`docs/adr-001-rendering.md`) §3:
the bevel constant no longer needs manual synchronization — there is only one.

## E-04 · Thickness as Absorption, Not a Border

**Experiment.** Make the surface read as having depth without drawing a white outline.

**Hypothesis.** The sense of depth doesn't come from edge brightness, it comes from a *gradient
of response*: a calm middle, optics building up, curvature peaking right at the rim. So
thickness has to feed several phenomena at once, not sit as one separate layer.

**Implementation.** `thickness` is a fraction of the half-size under the bevel. It drives: the
bevel width (`bevelDp`), and through it the normal's tilt, hence Fresnel strength and the
highlight; the magnitude of spherical and chromatic aberration (both proportional to
`bevelDp`); an absorption band, `smoothstep(0, 0.70, t) · (1 − smoothstep(0.80, 1.0, t)) · (1 −
|facing|)`, that lives exactly where no light source reaches the rim.

**Observation.** Device-pending — the test: going from `thickness` 0.12 to 0.42 should make the
surface read "thicker" without a visible outline appearing.

**Decision.** Provisionally accepted. `thickness = 0.18` in v1 is the old, hand-tuned value;
there's no basis for changing it without an observation.

## E-05 · Fresnel from Tilt, Not Distance to the Edge

**Experiment.** Separate Fresnel from the light rim — previously they were one effect.

**Hypothesis.** Fresnel computed from `1 − N.z` (the tilt of the bevel's 3D normal) is
geometric: it fades together with thickness and doesn't produce a constant-width outline.
Fresnel computed from distance-to-edge is a CSS border, whatever you call it.

**Implementation.** `fres = pow(1 − N.z, fresnelPower) · fresnel`, where `N = normalize(n ·
slope(t), 1)`. As `thickness → min`, the bevel nearly disappears, `slope → 0`, `N.z → 1`, and
Fresnel goes to zero on its own, with no separate toggle needed.

**Observation.** Device-pending — the test: the `thickness` toggle should extinguish Fresnel
along with itself; a separate `fresnel` toggle should remove the edge highlight without touching
the rim arcs.

**Decision.** Provisionally accepted, `fresnel = 0.5`, `fresnelPower = 3.2`. The contribution is
deliberately small (`+0.34` to color, `+0.30` to alpha at the peak).

## E-06 · Refraction: How Far Before Text Stops Being Legible

**Experiment.** Tune `refraction` against the criterion "text under the glass stays legible."

**Hypothesis.** The ceiling isn't set by aesthetics but by legibility: the sample offset at the
rim, in fractions of the half-size.

**Implementation.** `refraction` in 0..1 maps linearly to `edgePush = refraction · 0.34 ·
halfMin` (dp) and to a center magnification `magnify = 1 + (refractionScale − 1) · refraction`.
The offset grows as `pow(t, 2.6)` — meaning it lives almost entirely inside the bevel, leaving
the flat middle sharp. The old production constants correspond to `refraction = 1` (`edgePush =
0.34 · halfMin ≈ 8.7 dp` on a 58 dp button).

**Observation (device, 2026-08-29).** Refraction is **visible and spatially coherent**: a
straight boundary between light and dark background zones, passing under the disc, is visibly
bent inside it, and a grid of thin lines shifts in a consistent, unbroken way, without tearing or
jitter. A bright "caustic" is visible at the lower rim — content lying behind the glass,
compressed into a thin ring; this is expected behavior, not an artifact (the rim sample reaches
`edgePush ≈ 11 dp` on a 120 dp disc, and the view's padding, `lensPadDp = 16 dp`, fully covers
it).

Text under the glass is illegible at `blur = 12`, but the structure of the background
(light/dark, large boundaries) reads fine. Separately verified in the other direction:
accidentally dragging the slider to `blur ≈ 50` turns the glass into opaque milk — the
background stops reading at all. That sets the upper bound on blur, not on refraction.

**Decision.** `refraction = 0.55`, `refractionScale = 1.14` left as is. The criterion from
`docs/reference.md` — "text stops being legible → reduce it" — didn't apply here: legibility is
bounded by **blur**, not by offset. There's no basis for reducing refraction.

## E-18 · Size Compensation: Why Small Panels "Didn't Refract"

**Observation (client, on device).** Material tuned on a large panel looks almost like plain
dimming on the tab-bar buttons and the mini-player.

**Analysis.** It isn't the numbers, it's the model. Every edge length was defined as a fraction
of the half-size:

```
bevelDp     = thickness * halfMin
edgePushDp  = refraction * 0.34 * halfMin
sphericalDp = refraction * 0.26 * bevelDp
chromaDp    = dispersion * 0.30 * bevelDp
```

So the glass scaled together with the element: a button was a panel under magnification,
showing the same fraction of optics at a quarter the size — in absolute units, almost nothing.
On v3 (`thickness 0.07`) that's a 13.7 dp bevel on a sheet against 2.4 dp on a button.

Real glass has its bevel and ray displacement set by the medium and the edge profile, not by how
big a piece was cut. They're absolute. So on a small object, the optics take up a *larger* share
of it: a glass bead distorts across almost its whole area, while a shop window distorts only
near the edge.

**Decision.** `sizeBoost(g) = clamp(TUNING_HALF / halfMin(g), 1, MAX_SIZE_BOOST)`, `TUNING_HALF
= 180` dp, `MAX_SIZE_BOOST = 2.2`. The multiplier feeds into the bevel and the rim offset;
dispersion and sphericity follow the bevel automatically. Material is tuned on a large panel —
it takes the numbers as-is (boost = 1); smaller elements get the correction.

**What the fix does NOT touch.** `refraction` and `refractionScale` stay as they are: the flat
middle's `magnify` is a property of the medium (thickness and index of refraction), independent
of the element's size. Only the edge geometry gets compensated.

**Ceiling is mandatory, not cosmetic.** Without it a 68 dp button would get an offset larger
than its own radius, and the lens view (`lensPadDp`) would balloon to half the screen.

**Test invariant.** The bevel fraction is computed by a single function, `bevelFraction`, seen
by both programs (`u_thickness` on the Skia surface and the `bevel` prop on the native lens) —
they cannot drift apart, that's the same bug class as the prop-name mismatch. Plus a check that
compensation never pushes the bevel past 0.5 (wider than the half-size breaks the SDF).

*(Superseded by E-21: `sizeBoost` was removed once bevel and offset became absolute dp values in
their own right.)*

## E-21 · v4: Causes Instead of Effects

**The brief (client).** Eighteen sliders is insane, there should be an order of magnitude
fewer, and most of it ought to adjust itself.

**Analysis.** Eighteen sliders weren't richness of control, they were a symptom: the model
exposed effects. Half the values were physically dependent, so combinations were being
assembled that don't occur in real glass — and each such state got patched with yet another
slider:

- §E-18: edge lengths were a fraction of the element's size → `sizeBoost` was added, with a
  ceiling;
- §E-19: edge density didn't depend on thickness → `edgeDensity` was added.

Both are compensations for missing physics. It's a reproducible dead end: every new parameter
multiplies the number of impossible combinations.

**Decision.** Split into two objects:

- `VireGlassMaterial` — **causes**: `ior`, `thickness` (dp), `bevel` (dp), `roughness`, `tint`,
  plus `environment` and `adaptation`, which aren't glass physics and so stay as honest knobs.
  Seven.
- `VireGlassOptics` — **effects**: the same eighteen values the shaders need, but derived
  (`resolveOptics`, the physics lives in `src/optics.ts`).

Components (`GlassPanel`, `LiquidGlassButton`, `VireGlassSurface`) now take optics, not
material: the render model is what they draw, and swapping it in the lab has to be a whole swap
— otherwise the lab tunes one thing while the product renders another.

**What disappeared on its own:**

- `edgeDensity` — this is Beer–Lambert absorption over an elongated path through the bevel;
  derived from `thickness` and `bevel`;
- `sizeBoost`, `TUNING_HALF_DP`, `MAX_SIZE_BOOST` — the bevel and offset are now absolute in dp,
  and a small element gets a larger share of them automatically. Geometry only clamps (a bevel
  wider than the half-size breaks the SDF; an offset larger than the half-size pushes the sample
  outside the shape);
- `fresnelPower` — Schlick's exponent, a constant of 5;
- `edgeWidth`, `specularPower`, `blur`, `refraction`, `refractionScale`, `dispersion`,
  `tintStrength`, `edgeStrength` — all derived;
- `opacity` — was always 1; the uniform was removed from the shader as dead;
- the `tint` prop on `LiquidGlassButton` — no consumer ever passed it.

**Calibration against v3** (read off by hand):

| | v4 | v3 |
|---|---|---|
| haze | 4.42 | 4.32 |
| center magnification | 1.05 | 1.05 |
| tint | 0.35 | 0.35 |
| rim | 0.59 | 0.60 |
| edge density | 1.36 | 1.50 |
| dispersion | 0.49 | 0.54 |
| refraction | 0.75 | 0.49 |
| specular / narrowness | 0.53 / 134 | 0.30 / 75 |
| fresnel | 0.59 | 0.77 |

Agreement on most axes is a sign the normalizations were chosen sensibly. The mismatches land
exactly on the axes where v3's values were internally inconsistent; an exact match isn't
possible and shouldn't be expected.

A 68 dp button and a sheet now get the same 12.6 dp bevel and 24.6 dp offset: 37% of radius on
the button versus 6.4% on the sheet.

v1/v2/v3 live on in the lab as an "old model" section — frozen snapshots of effects. They don't
translate back into causes: some of their values are internally incompatible, and any
"equivalent" material would be a lie.

**What's still open from E-20.** Moving Fresnel and the rim into the lens shader (step 2) has
NOT been done. They're still computed on the Skia surface, which doesn't see the backdrop, so
adaptation to content is still limited to the luminance alignment done in the lens.

## E-22 · Reflection Moved Into the Lens

**The setup.** Glass over a dark list looked the same regardless of what was under it; the rim
looked "greasy" and washed-out; of four tab-bar buttons, the one that happened to sit over
high-contrast content was the only one that looked right.

**Analysis.** All three complaints are one cause. Fresnel and the light rim were computed on
the Skia surface, and it doesn't see the backdrop at all: the surface draws on top of the lens.
With no environment to read, the rim was adding white — a constant, the same over an album cover
and over black. Reflection is by definition a function of environment, and it cannot be
computed where there is no environment.

**Decision.** Fresnel and reflection moved to the lens shader, where the backdrop is at hand:

```glsl
float3 N = normalize(float3(n * vgBevelSlope(t), 1.0));
float fres = u_fresnel * pow(1.0 - clamp(N.z, 0.0, 1.0), u_fresnelPower);
half4 rc = content.eval(s - n * (u_reflectReach * t));
rgb = mix(rgb, vgStraight(rc), half(fres));
```

The reflection sample comes from the same backdrop, offset inward — mirroring refraction, which
pushes the sample outward. `reflectReach` equals the bevel width: past that, the rim has nothing
left to reflect.

**Removed from the surface:** the rim arcs (`rimCol`/`rimLum`), the white Fresnel term, the
uniforms `u_fresnel`, `u_fresnelPower`, `u_edgeStrength`, `u_edgeWidth`, the model fields
`edgeStrength`/`edgeWidth`, and the `edge` toggle. What's left is only what doesn't depend on
the environment: the highlight from our own key light, medium absorption, shadow.

**Native side:** three props — `fresnel`, `fresnelPower`, `reflectReach`.

**Test invariant:** the lens shader must contain `u_fresnel`/`u_reflectReach`, and the surface
shader must not — otherwise reflection gets computed twice.

> Shaders are TypeScript template strings. A backtick inside a comment inside a shader
> terminates the string; typecheck catches it immediately, but the error points at the middle
> of the shader and reads as gibberish.

**Open.** The bevel profile is still `t²` (a puck): a spherical profile `t/sqrt(1−t²)`
produces visible noise — the sample offset changes fast across a wide band, and the backdrop
near "water" is barely blurred (`roughness 0.05`), so six point samples over a sharp image
alias. A real lens integrates over an area; getting the dome back means widening the sample cone
together with the curvature.

## E-23 · Grain on Dark: First Measurements (Wrong Conclusion — See E-25)

Symptom: dark areas inside the glass show visible grain; outside, none. Held under any blur, any
material.

Measured numerically, not by eye: mean pixel deviation from the four neighbors ("grain"), and
mean brightness in two 110×100 windows — inside the disc and on the same background next to it.
Reference frames are ones where the outside window gives exactly **0.000** grain (a perfectly
flat dark patch of the lab's landscape).

What was established:

| test | grain inside | conclusion |
|---|---|---|
| `backdrop` off | 0.000 | the surface is clean, the problem is in the lens |
| color replaced with a constant after sampling | 0.000 | the lens's arithmetic is clean |
| standard sampling (six taps along the normal) | 0.834 | grain arrives through `content.eval` |
| one point instead of six | 2.74 | the previous six were already damping some of the grid |
| circular gather, 8 samples, 3.5 dp radius | 1.11 | undersampling: worse than a point |
| circular gather, 24 samples, 14 dp radius | 0.637 | −24% at the cost of triple the samples and visible blur |
| spiral taps, split across channels | 8.0 | this cannot be done (see below) |

A magnified crop shows not random noise but a **regular grid of soft patches, about 7 dp
apart**. This is a block artifact from capture: `dimezisBlurView` grabs the background into a
downscaled 8-bit bitmap and stretches it back, and the one-bit difference between neighboring
blocks after stretching reads as a grid. It is real content of the captured bitmap, so averaging
only removes it together with real detail — hence −24% for a 14 dp radius.

Conclusion: keep the standard six-tap sampling (0.834, the best measured), and the honest fix is
**capturing the backdrop ourselves instead of via expo-blur**, full-resolution and without an
intermediate downscale. That's native work in the glass-lens module, a separate task.

Side findings, locked into the code:

- **Channels must be averaged at the same points.** Splitting spiral samples across channels is
  ten times cheaper, but then R, G, and B come from different places, and their difference
  reads not as noise but as colored speckle across the whole area: grain 8.0.
- **Gather radius must be clamped to the view's padding.** Beyond it there's no content, and the
  samples return transparency — the glass becomes a flat patch of constant color (in the test:
  identical 87.8 with a background ranging from 11 to 157). The clamp is a `u_reach` uniform.
- **Adaptation must add, not multiply.** The old `target/lum` multiplier was clamped at one and
  so could only dim bright content, never lift dark glass.
- **A shader edit doesn't reach the device through Fast Refresh.** The source travels to the
  native view as a prop through a memoized `toLensProps`, and its dependencies don't see the
  string; adding the string to the dependency list doesn't help — the component module doesn't
  re-execute. Only test shader edits after a full stop-and-relaunch. Otherwise measurements run
  against the old shader — that's how an hour was lost and a wrong conclusion drawn about area
  sampling.

## E-25 · Grain: Cause Found in the Library

Reading the bytecode of `BlurView 3.1.0` (the `expo-blur` dependency) turned up two things at
once.

`blurView.setupWith(target)` expands to **`setupWith(target, 4f, true)`**:

- `4f` — the background is captured at **a quarter resolution** and stretched back;
- `true` — this is `applyNoise`, and a **tiled noise texture** is drawn over the result (the
  `Noise` class: a `BitmapShader` with `TileMode.REPEAT` and `SRC_ATOP`). The tile repeat is
  what read as a regular grid inside the glass.

Both parameters reach `RenderNodeBlurController` unchanged, and the flag is genuinely checked at
both call sites. Fixed with a single patch to `expo-blur`:

```kotlin
blurView.setupWith(dimezisBlurTarget, 1f, false)
```

Also, the blur stage itself isn't needed by the lens — `BlurView` here is only used for capture,
so `intensity={0}` in `src/native/glass-surface.tsx`.

**What this bought.** Capture became full-resolution: the grid lines under the glass are now
sharp, and you can see them bend. Rim dispersion and environment pickup came back — over the
seam between colored blocks, the rim catches the neighboring red and violet.

## E-27 · Method: How I Was Lying to Myself

Three conclusions drawn overnight turned out false, all three for the same reason: the
measurement was taken on a frame where the fix hadn't actually landed yet.

- **Grain of 0.000 inside the glass proves nothing.** Glass with no content sampled at all looks
  exactly the same.
- **Matching the background's brightness proves nothing either.** So does glass that just
  passes the background straight through with no optics at all.
- **Tapping a chip isn't a fact.** The lab's panel scrolls, coordinates drift, and the tap lands
  on a neighboring chip. Every conclusion of the form "turned off X — got better," made without
  checking the screen, had to be thrown out.

Protocol from here: edit → wait for reload → **screenshot and confirm by eye that the edit is
actually on screen** → only then measure. Metric: median, not mean.

## E-30 · Grain: the Root Is the Library's Blur, Not the Capture

Bisected with the shader, each step confirmed on screen. Same metric: median local deviation,
inside the glass against the same patch of screen next to it.

| what the shader computes | grain inside | outside |
|---|---|---|
| everything (body, environment, optics) | 2.0 | 0.000 |
| sampling only, no body | 3.0 | 0.000 |
| **raw sampling**, no magnification or offsets | **7.6** | 0.000 |

The less the shader does, the dirtier the picture — so the source is in the capture itself, and
refraction and the body were only averaging it down. The E-25 patch (full resolution, noise
texture off) removed the grid, but not the dithering: on Android 13+, expo-blur routes capture
through `RenderEffect.createBlurEffect`, and Skia dithers the blur's output to hide banding. At
zero blur radius there's no blur — the dithering stays.

Fixed by having no blur in the capture at all: `GlassBackdropView` writes the screen's content
into a `RenderNode` and hands it to the lens. Measured after: **0.000 inside at 0.000 outside**
on every frame where the background is flat, and 0.250 against 0.250 where there's real detail
under the glass.

## E-32 · Adaptation: the Body Moved Into the Lens

Tint, brightness, and haze were drawn on the surface — which doesn't see the backdrop. As long
as the body lived there, per-pixel adaptation couldn't exist even in principle: one density for
the whole element. The body moved into the lens; the surface kept only the highlight, the
shadow, and the icon.

A model with no mode switch. The target body lightness is computed from the local background
lightness and the lightness of whatever the app draws on top of the glass (`ink`):

```
target = ink is light ? min(local, ink − sep) : max(local, ink + sep)
```

This is a monotonic function, so "switching" isn't an event, it's a continuous transition: the
body darkens over a light cover, lightens over a dark list, and moves smoothly between. Density
is set to whatever value gets lightness exactly to the target.

Local lightness is estimated at low frequency (four wide samples): sampling per-pixel isn't an
option — the glass would start chasing individual strokes, and a halo would appear around every
letter.

The `adaptation` slider was replaced with `legibility` (how hard the glass is required to
separate its own lightness from the caption's) and `ink` (the caption's lightness — a cause the
calling screen already knows).

## E-33 · The Doubling Came From Reflection, Not Offset

The first version of the fix was wrong: I cut `edgePush` from 2.6 to 1 and killed refraction
itself along with it, without touching the actual cause. Testing on "Crystal" showed exactly
that — the rim went flat, and the ghost copies stayed.

Consider the compression of the source into the screen. The offset grows as `E·t^F`, so the
mapping's scale is `E·F·t^(F−1)/bevel`. With `E = 2.6·bevel` and `F = 2.6`, compression is
threefold at mid-bevel and nearly sixfold at the edge. Text compressed threefold cannot be a
legible copy. And where compression is close to one (`t < 0.1`), the offset itself is already
negligible — fractions of a dp.

So the source is something else. It's in the reflection: `around = center + p + n ·
reflectReach`, a single sample offset by the gather radius — 64 dp for dense materials. A pure
translation with no compression — literally an undistorted copy of whatever lies next to the
glass.

Reflection now comes from a five-sample patch: a curved surface gathers a whole solid angle, not
a point. The rim still picks up environment color; it no longer picks up shape.

Separately: adaptive scatter now fades out toward the rim. Scatter lives in the bulk; at the
bevel the job is different — bending the ray and splitting it — and blurring the whole detail
there was eating both the dispersion and the color pickup.

## E-34 · A Day and a Half of Optics Work on an Empty Frame

Symptom: on a white background, the glass did nothing. Not "weakly" — literally nothing: 255
inside, 255 outside, 88.8% of pixels clipped. No body, no rim, no refraction.

Bisected with the shader. A red fill mixed in before the return never showed up; an
unconditional `return half4(red * alpha, alpha)` did show up. So the shader was executing, and
what was killing it was `alpha = srcA` — the sample's alpha. The sample was returning zero:
`content.eval` was reading from nothing.

The cause was in the capture. `GlassBackdropView` writes the frame into a `RenderNode`, but the
node's bounds were never set. `beginRecording(w, h)` only sizes the recording; the node itself is
clipped by its `position`, which on a freshly created node is empty. `drawRenderNode` on such a
node draws nothing.

One line (`setPosition(0, 0, width, height)`) and the lens came alive: refracted text visible
under the glass, the rim bending lines, the body reacting to the background.

**What this teaches.** The E-30 measurements ("0.000 inside at 0.000 outside") were formally
correct and completely meaningless: what was being measured was glass with nothing to show.
Exactly the trap named in E-27, and it fired again, because the grain metric equally praises a
clean render and an empty one. The metric must fail when there's no picture: since then,
contrast against the surroundings (inside vs. outside) is always measured alongside it, never
noise alone.

## E-35 · Uniforms as One Channel Instead of Thirty Props

Every material value was a separate `Prop` in Kotlin. The cost of that was already known (E-01:
a misspelled name silently disabled refraction for an entire phase), but a second one surfaced:
any new phenomenon in the shader required a Kotlin change and an APK rebuild.

Now name, size, and values travel together (`uniformNames` / `uniformSizes` / `uniformValues`,
assembled by `toLensProps`). Kotlin sets them in a loop and logs the name of any one the shader
doesn't accept. The view keeps only the uniforms it alone knows — its own size and its own place
on screen; everything else is computed in JS, already in pixels.

Side effect that made it worth doing: the whole optics model can now be edited with no rebuild.

## E-36 · Ghost Copies of Text: a Comb in Density

Text under the glass on a white background was tripling — three copies spaced apart by the
adaptation radius (22 dp). Color was honest throughout; it was the body's density that was
doubling.

Density is a nonlinear function of background lightness with a kink: below a threshold the glass
does nothing, past it, it starts darkening. Lightness was estimated from four samples. Wherever
a sample landed on a letter, the estimate jumped by 0.15, density by 0.10, body lightness by 24
out of 255. That's the copies. More samples wouldn't fix it: the problem is the estimate's
discreteness itself, and the kink only amplifies it.

The estimate moved to a native probe. `GlassBackdropView` renders its capture node into a 16×32
grid every 180 ms via `HardwareRenderer` + `ImageReader`; each lens reads its own rectangle out
of the grid and hands the shader one number per surface, smoothed across frames. There's nowhere
for a comb to come from, adaptation became appropriately slow (time constant ~0.3 s), and four
texture samples came off the per-pixel path.

## E-37 · Spectral Edge: Dispersion, Diffraction, and Interference From One Cause

Three phenomena, one cause — wavelength dependence. So the model has no three "rainbow
strength" knobs: there are the channel wavelengths (610/550/460 nm) and whatever follows from
them.

- **Dispersion.** Used to be a symmetric ±chroma spread along the normal. A symmetric spread
  reads as a colored outline, not a split — it has no direction. Now each channel's offset is
  proportional to its Cauchy deviation (R −0.21, G 0, B +0.49): blue bends more than red, and
  all three bend the same way.
- **Interference.** A thin film of thickness `film` nm: optical path difference `2·n·d·cosθ`,
  each channel its own λ, hence the color shifts. Lives in the reflected ray, so it's visible
  only at a grazing angle — i.e., on the bevel.
- **Diffraction.** Bands right at the rim, phase growing from the edge, frequency inverse to
  bevel width.

All three are a hue multiplier on reflection, normalized to its own mean: they tint reflection
without making it brighter. Otherwise interference would knock out a channel over a white
background. The cost is arithmetic only — not one extra texture sample.

There is exactly one new cause in the material: `film` (film thickness, nm). Iridescence
strength derives from Fresnel; band strength derives from dispersion.

## E-42 · Three Prohibitions That Rearranged the Model

Fixes from a live run. Each one overturns a decision that looked reasonable right up until it
didn't.

**Blur is an assist, not a legibility tool.** Adaptive scatter had been pushed up so far that on
a busy background, letters under the glass stopped being letters — a sausage of pixels. No
legibility is worth that; the element just looks cheap. Blur stays, but weak: it softens
texture, while body density does the work of separating lightness. The roughness ceiling dropped
from 26 to 12 dp, and the automatic component was halved.

**The lens must be a homogeneous medium.** Scatter was being damped toward the bevel by a `1 −
smoothstep(t)` multiplier. The intent was right (the bevel's job is different — bending and
splitting the ray), but the result was a ball with a hazy middle and a sharp rim: two different
kinds of glass in one shape. The multiplier is gone; scatter is now uniform across the whole
element. Rim sharpness is handled by geometry, not by varying how much haze sits where.

**Tinting became a gradient.** This is the correct way to handle an uneven background, and
exactly what blur had been asked to do instead. The probe now returns not one number per
surface but a plane of lightness: the slope along each axis is fit by least squares over the
same grid cells (coordinates are centered, so the normal equations decouple and each axis's
slope is computed independently). A plane is the crudest model that still describes "one half is
lighter than the other," and the only one that's smooth by construction: a pointwise estimate at
the density's kink produced ghost copies of text (E-36), a plane cannot.

Result at a black/white boundary: the black half stays black, the light half is dimmed to medium
gray, the transition across the element is smooth, and the boundary under the glass is still a
boundary. A light caption reads over both halves. Neither blur nor recoloring was needed for
this.

**Dither removed.** It had been there while background lightness was estimated per-pixel: the
body was a smooth function of the coordinate, and 8-bit output banded. After the estimate moved
to the probe, tint gives a constant (or linear) offset, and that doesn't band. Measured on the
`#000000 → #141a1e` gradient: steps larger than 0.8 out of 255 — zero, **without** dither.

Total across every lab zone after these three fixes: median local deviation inside the glass
**0.00** everywhere, against 0.00–0.29 on the same patch outside — the glass reads cleaner than
what's under it. Pixels clipped: 0% (was 88.8% on white).

## E-45 · A Glass Block Adapts as a Block

Navigation buttons were adapting one at a time: each lens had its own patch of background under
it, and by its own measurement one would sink into shadow while its neighbor stayed transparent.
On a busy background their caption polarity diverged too — the block stopped reading as a block.

A **surface group** was added (`glass-group.tsx`): members report their measurements to it, it
computes one estimate for all of them, and hands that same estimate back to each. The polarity
decision is one per block, based on mean lightness with a bias toward light.

**Density is set by the block's lightest spot, not its average.** Averaged, a block straddling a
black/white boundary never darkened at all — an average of 0.5 requires nothing, and a light
caption sank over the white half. Now the baseline is the lightest button; the lightness plane
only lets density ease off slightly at the dark edge (a 0.35 share). Over the black half, content
under the glass is already black, so there's no visible extra weight there, and over the white
half the caption reads.

**The slope had to be suppressed.** A plane fit through four points nearly interpolates them:
across a black/white boundary the buttons got 0.0, 0.3, 0.7, and 1.0 — exactly their own
individual values, and the block fell back apart into independent elements. Caught on device by
dedicated diagnostics, not inferred by eye — without it, the fix would have looked like it
worked.

**The group's estimate travels the uniform channel, not a separate prop.** The lens view is
wrapped in an animated component for the drag interaction, and a plain prop never reached it —
on screen this looked like "the group isn't working," even though it was computing correctly.
In the channel, group values are placed after the surface's own and simply overwrite them;
nothing more was needed.

Smoothing moved to JS: the native lens smooths its own estimate across frames, and the group
value arrives already settled — without that, the block's tone would step in probe-sized
increments.

**The threshold for reverting to a light caption was raised** from 0.34 to 0.40. The old value
meant a button that had flipped dark over a light zone stayed dark up to a lightness of 0.72 —
including over saturated yellow. That was the remaining "black icons on colored background" bug.

### E-45 (continued) · A Black Circle Over the Icon

The symptom looked absurd, and it was: dragging a button made an opaque black circle appear,
covering its own icon. Four wrong turns first — bevel, drop size, a race between a plain prop
and the animated one — because the cause was being hunted in the wrong layer.

The circle was being drawn by the **neighbor**. It was picking up the drop over the group's
shared channel and adding it as a second shape of its own — but the neighbor has no lens of its
own at that spot, so there's nowhere for refraction to come from, and the result is an opaque
patch. The neighbor's canvas sits above the donor's in the stack, so the patch also covered the
donor's own icon.

The pickup condition was tightened: the drop must actually reach into the neighbor's own body
(`dist < halfMin + r·0.25`), not just be nearby. At the current tab-bar spacing (90 dp) and drag
range (42 dp) that never triggers — a button can't reach its neighbor, and merging only kicks in
where surfaces actually stand close together. The drag finally draws what it should: one solid
body with a neck, icon in place, no blackness.

In passing: a wrong conclusion was retracted — Reanimated's animated props do reach the native
view. The assumption that they didn't was a misdiagnosis; the whole anomaly was explained by the
neighbor.

## E-48 · The "Backdrop" Mode Wasn't a Backdrop, So There Was Nothing to Compare Against

The "backdrop" debug mode exists to answer one question: did the content reach the shader
intact? It zeroed the lens (`lens = 0`) but didn't zero the layers that don't depend on the lens
— body, medium tint, scatter, rim light: they're all multiplied by `u_appear`, which is 1 in
this mode. The element stayed visible even with a perfect capture, and there was no way to tell
"the wrong sample arrived" apart from "we just colored it differently." That's what issue #112
sat on: the body reads lighter on Android than on web, and whether capture was to blame was
never established.

Now the mode returns the content sample and exits: on web the departure across the whole profile
is exactly 0.0. Rule: **a comparison mode has to be empty**, otherwise it answers two questions
at once and neither one all the way.

Along the way, two more stand discrepancies of the same nature turned up (besides the differing
shapes):

- **canvas scale.** The web bench's zones were drawn as a fraction of canvas width (`px = w /
  360`), while elements are sized from screen density. On desktop a cell came out five times
  larger than on a phone, and the same-sized element read completely differently than on
  device. Canvas and glass now share one scale: `VireGlassSceneDrawer` takes density as its
  sixth argument.
- **bar thickness.** Reference bars were sized as a fraction of the stage's height, and stages
  differ — a viewport versus a zone at 0.42 of the screen. The same element landed on a
  different number of bars. Bar thickness is now in dp, on a fixed-height canvas, centered on
  the stage on both benches.

Comparison is now taken as a profile through the element's center: the parity bench's
measurement script prints the same table for both the web render and a device screenshot. The
background under the body is known exactly there — the bars are horizontal, and the same row
just to the left of the element shows what lies beneath it.

## E-49 · The Gate Was Measuring the Shader's Fallback Path, Not the One Running in Production

The web probe reads the lightness grid through a PBO with a fence (`fenceSync`). The fence only
resolves once the page yields to the event loop — in a browser that happens at the frame
boundary. But the `check:optics` gate rendered its thirty frames in one synchronous loop, with
no yield at all — so the read was never ready. Every run went through `u_probeLuma = -1`, the
fallback path: no background-lightness slope under the element, no measured background range, a
point estimate instead of the probe.

Which means the six promise thresholds had been tuned against a material that doesn't run in
production. Silently: the gate was green, the shader compiled, the frames looked plausible —
that's what a fallback path is for, to look similar.

It wasn't found in the web. The element's profile on device and in the web renderer had diverged
so far that body density on Android barely varied along the element's height, while in the web
it varied threefold; chasing what lightness slope reached the shader turned up the fact that in
the web, none did.

The fix: yield to the event loop between frames (`setTimeout(0)`, not `requestAnimationFrame` —
sixteen milliseconds per frame times hundreds of measurements would turn the gate into a
half-hour run). After that, the gate passes on the real path too: worst window 38% against a
25% threshold, worst element 6.1 against a threshold of 5.

**Rule:** a batch renderer run must yield between frames. Anything read back from the GPU
asynchronously is never read in a synchronous loop — and it fails silently.

## E-50 · Eight Canvases, Shared by the Stands and the Gate

Canvases lived in three places: the web bench had its own zones, the mobile lab had its own, and
a third set lived inside `check-optics.mjs`, seen by nobody. The gate measured one thing, the
eye looked at another.

Now there is one set — `REFERENCE_SCENES` in the package, eight canvases, each labeled with the
promise it checks: flat, stripes, busy, bar, steps, edge, gradient, grid. Layers are described
as data (fill, stripes, checkerboard, step, bar, grid, stepped gradient); the canvas and the
views place the same data, and the gate uses the same drawing function.

A third stand discrepancy (after differing shapes and differing bar thickness) turned up right
here: **the pattern was anchored to the canvas's own edge**, so on a canvas spanning the full
width of the stage, the phase under the element depended on screen width — 24 dp-pitch stripes
landed under the middle differently on a 406 dp phone than on a fifteen-hundred-pixel canvas, and
the checkerboard put an entirely different cell arrangement under the element. The canvas became
a fixed-size panel in dp (`REFERENCE_SCENE_WIDTH` × `REFERENCE_SCENE_HEIGHT`), centered on the
stage on both stands.

Pseudo-random cell placement and gradient steps moved into the package as standalone functions:
`Math.random` and "draw a gradient with platform tools" would give the two platforms different
canvases, and then there'd be nothing left to compare.

## E-51 · The Last Platform Discrepancy Comes Down to Tilt, Now Read as a Number

Once canvases, shapes, scale, element position, and frame composition were reconciled, one of
the eight reference canvases still disagreed — the gradient: the body on Android tracks the
background noticeably more strongly than in the web (web 94 → 108 along the profile, Android 95
→ 125), even though the background matches row-for-row to within one unit.

That's the signature of a smaller lightness slope in the background estimate: at a single
density across the whole element, the body simply repeats whatever is underneath it.

Confirmed by substitution: forcing `u_probeSlope` to zero in the web makes the body go 77 → 129;
taking half of it gives 84 → 117. Android sits between half and full, closer to half.

There was nowhere to read the slope from: in the web it's in the renderer's return value; on
Android, nowhere — the native probe event doesn't report it. So a debug mode called **"probe"**
was added: the lens writes into its channels whatever the probe reported about the background —
mean lightness, vertical slope, and lightness at that spot. It works on both platforms and is
captured with the same reference-measurement script.

Taken on the gradient canvas, a 120 dp circle, density 3:

| value | web | Android |
|---|---:|---:|
| mean lightness under the element | 0.506 | 0.467 |
| vertical lightness slope | 0.231 | **0.161** |
| spot lightness along the profile | 87 … 171 | 89 … 142 |

Android's slope is 30% smaller, and spot lightness swings across half the range because of it.
Why it's smaller isn't established: both platforms fit the same least-squares plane over a
48×96 grid, but the web's grid covers the element with 35 rows, while Android's covers 13 (its
grid is stretched over the whole screen, not just the canvas). Filed as issue #113.

**A rule that cost a full circle of investigation:** an edit in the package doesn't reach the
APK by itself. Gradle watches the mobile app's own sources, not the package, and considers the
bundling task up to date — so the shader ships stale, silently. Fix: clear the mobile app's
generated Android asset-bundling cache.

## E-52 · The Android Probe Wasn't Averaging the Screen, It Was Filtering It — and Undercounting Tilt by a Third

The cause of the E-51 discrepancy, found. The native probe downscaled the whole screen straight
to a 48×96 grid in one step: `c.scale(48 / width, 96 / height); c.drawRenderNode(...)`. At a
25x downscale, the rasterizer doesn't average, it filters — with negative lobes, meaning it
overshoots past the edges. The web makes no such mistake: there, a shader computes each cell by
averaging a 5×5 block.

Caught on the "steps" canvas. A cell straddling the boundary between the 0.50 and 0.69 fields:

    the probe reported 0.486

That's below both levels, which no averaging, weighted any way, can produce. On flat fields
there's no error at all (0.502 against 0.50), which is why it went unnoticed — it only shows up
where there's structure under the element. On the gradient it accumulates and undercuts the
lightness slope by almost a third.

Fix: capture at a larger grid and average in blocks, the way the web does: `SHOT_BLOCK = 5`, a
240×480 capture, each grid cell the mean of a 5×5 block. Comparing the probe's grid against
what was actually drawn, before and after (a column through the element's center on the
gradient canvas, emulator at 1080×2400):

| | cells 17…29 |
|---|---|
| drawn | 0.277 0.317 0.353 0.381 0.422 0.458 0.494 0.535 0.554 0.601 0.643 0.657 0.707 |
| before | 0.264 0.299 0.327 0.338 0.372 0.389 0.417 0.452 0.464 0.503 0.542 0.566 0.603 |
| after | 0.274 0.311 0.353 0.374 0.412 0.455 0.492 0.524 0.549 0.597 0.637 0.642 0.690 |

Lightness slope went 0.1637 → 0.2075 (the web gives 0.224 on the same canvas); mean lightness
under the element 0.426 → 0.485. The body's departure on the gradient now matches: Android
−23.0 against the web's −25.6 — the gap went from 12.5 units to 2.6, inside tolerance.

**Rule:** don't trust a rasterizer with a downscale of more than a few times. If what you need
out of an image is a statistic, compute it by averaging — don't ask the rasterizer to draw it
smaller.

Filed as issue #113.

## E-53 · The Last Platform Discrepancy Was Hysteresis, Not Material

On the "gradient" canvas, the two platforms disagreed in sign: the bench read −22.3, Android
+38.0. It looked like a serious defect — sixty units of lightness.

It wasn't the optics. The caption-polarity decision has hysteresis: light flips to dark at a
deciding lightness of 0.62, and only flips back below 0.5 (`FLIP_LUMA`/`RETURN_LUMA`,
`src/adaptation.ts`). The gap is deliberate — without it, a caption would flicker on every light
album cover passing under the edge. And the gradient lands exactly in that gap: the deciding
lightness under the element sits around 0.57. So the outcome is decided not by the material but
by which state each stand entered the zone from: the bench's page had reloaded fresh with a
light caption, while the lab arrived from a neighboring zone.

With polarity pinned (`ink=0` on both), the discrepancy is 4.9 units. The whole baseline closed:
eight canvases out of eight within tolerance, the largest gap 8.1 out of 255.

**Rule:** a value with hysteresis has to be pinned explicitly when comparing platforms.
Otherwise the table measures not the material but the order in which someone clicked through the
bench. A canvas built specifically to probe the flip point especially cannot be measured on
automatic settings — that's exactly the point where it's designed to sit in the gap.
