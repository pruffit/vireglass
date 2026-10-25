# Changelog

## 3.7.0 (unreleased)

One family of maps. DOM target only. A lens that finished a motion used to change on screen: the interim map was a
reduced, stretched one, the settled map a different image, and the two met in a visible step after a pause
(pruffit/vireuikit#44). Interim and settled maps are now the same bytes for the same box, morph, optics and density,
and a motion that only changes the box gets maps of its own.

- An interim job is a pair: the worker builds the displacement map and the spectral hue map for one key. The main thread
  never bakes while a lens is in interim when a worker is available; without one the displacement map is built on the
  main thread as before and the hue keeps the settled one.
- The hue is drawn on the same silhouette as the displacement map, with the morph shapes and their smoothing. A morph
  used to refract along the bridge and take its colour from the plain rounded rect.
- One key for both. The box is snapped to half a pixel (it was 2 px for interim and exact for settled), interim uses the
  device pixel ratio the settled map uses (it was capped at 1), and the key lists exactly what the pixels depend on:
  refraction, thickness, bevel, film, iridescence, diffraction. Blur and ior are no longer part of it. The settled
  key also includes `shapes` now, which it ignored.
- Landing on the key the lens showed in interim keeps that pair, its URLs included: no bake, no filter swap and no
  change to the filter. A pair the settled cache already holds is shown in interim without a job.
- A change of the box in interim (a resize, or a new measured box) requests a pair for the live box exactly as
  `setMorph` does: one build in flight per lens, the newest wins, and a pair is shown when it is newer than the one
  shown. It used to keep the old box's map stretched over the new box.
- The refraction strength follows the live box, not the box the shown map was baked for, so the depth no longer jumps
  when a map for the new size arrives.
- The filter's structure depends only on dispersion being on or off and the hue being on or off. Blur, the ior ratios of
  the three dispersion passes and the hue's weights are attributes, rewritten in place, so a material step no longer
  forces a synchronous bake and a filter swap on landing.
- The worker's 2 s timeout counts from the start of a job. Jobs from all lenses go to the worker one at a time, so a
  queue of jobs no longer disables the worker for good; a job that started and hangs still does.
- `check:dom` grows a geometry-only resize in interim followed by the landing: the landed frame has no pixel that
  differs from the last interim frame by more than one level, and the same run with the first box's maps put back
  differs at 5308 pixels.

### Prepare and land (also 3.7.0)

- `handle.prepare(target | null)`: the host announces the destination (`geometry`, `morph`, `material`, `sample`, `rect`)
  when a motion starts. The pair is built and decoded ahead, in the worker with priority over interim jobs, or on the
  main thread after a frame in slices of 4 ms when there is no worker. The newest call wins; a superseded result goes
  to the cache and is never shown. `handle.whenPrepared()` resolves when it is ready.
- `handle.land()` returns `'exact'` when the pair is decoded and writes it with the presentation in the same task: no
  timer, probe, bake or filter swap. Otherwise it returns `'blend'`: a 120 ms mix from the shown pair into the
  destination, written as attributes of two added `feImage`s and `feComposite`s, removed at the end.
  `setInterim(false)` is `land()`, so it no longer probes: the held sample is kept (or the prepared one), and real
  backdrop changes ease over 200 ms through registered `--vireglass-ink-color`, `-tint-color` and `-body-color`.
- A hidden page installs the pair undecoded and settles on `visibilitychange`.
- The decoded pairs of all lenses stay under about 24 MB; lenses off screen go first, and a pair a filter shows or a
  landing holds is never released. The worker queue serves destinations before interim maps.
- `renderStats()` gains `landedExact`, `landedBlend`, `probesAtLand` and `syncSwaps`.
- `check:dom`: a morph with `prepare` at its start and `land()` in its last frame changes 0 pixels afterwards, with
  the worker and without it, and no main-thread task of the run passes 16.7 ms (longest 5.2 ms with the worker, 6.7 ms
  without); a morph without `prepare` lands as a blend and changes 650 pixels.

## 3.6.1

The deferred landing never puts rows and an encode in one task. DOM target only. A map whose rows fit in one slice went
on to its PNG encode in the same task, and then into the next map's first slice, so one task held the displacement rows
(about 5 ms), their `toDataURL` (about 1.2 ms), the spectral rows (about 5 ms), their encode (about 1.8 ms) and the
garbage they made: 10 to 14 ms, once 23 ms, over a 16.7 ms main-thread bound. A slice followed by its encode made
7 to 9 ms tasks. Measured from vireuikit's frame gate on the popover-to-sheet and sheet detent traces.

- Every task of a landing now does at most one slice of rows or one encode: it yields after the last slice of a map,
  after each encode, and so between the displacement map and the spectral map.
- Same pixels, same guards, and both maps are still retargeted together once both are decoded. On a hidden page nothing
  yields, as before. Interim maps are not affected.

## 3.6.0

The rim is drawn without a mask. DOM target only. The hairline was an `::after` with two conic layers cut by a pair of
gradient masks (`mask-composite: exclude`), and a mask costs two offscreen layers the size of the whole box, almost all
of it empty interior, redrawn on every frame the box resizes. It is now the border area of that layer:
`border: var(--vireglass-rim-width) solid transparent` with `background-clip: border-area`. The browser clips the paint
to the ring itself, following the box and its radii, with no script and nothing to keep current.

Why: in vireuikit's navigation morph (pruffit/vireuikit#41) hiding the rim saved about 1.7 ms of GPU-process work a
frame in frames 1 to 3. That is the ceiling for this change; the saving of the clip itself is not measured here.

- The ring is the same one. `check:dom` renders it old and new on a capsule, a rounded rect and a box with four different
  elliptical radii, and no pixel differs by more than 2/255 farther than 1 px from an anti-aliased edge. The differences
  are edge pixels of the curves: at most 38/255 on one channel with a solid white ring (mean 0.12 to 0.14 over the
  240 by 140 crop), at most 23 with the real gradient (mean 0.03 to 0.04). A ring inset 1 px more fails the same check.
- The masks had no soft inner edge, so nothing is lost: the inner radius is the outer one less the ring width, floored at
  0, and CSS clamps a radius larger than half the box first, as before.
- Browsers without `background-clip: border-area` keep the pair of masks, chosen by `@supports`, and draw what they drew.
- `--vireglass-rim-width` still sets the width. The padding the masks needed exists only in the fallback branch.

## 3.5.0

Interim maps are built in a worker. DOM target only. A morph in interim mode no longer renders rows or encodes a PNG on
the main thread; the pixels are the same bytes as before.

Measured from vireuikit's frame gate (pruffit/vireuikit#40, a popover growing on a Ryzen 5 3500U with Vega 8): the
map's rows took 2.3 to 5.4 ms on about 12 of 20 frames, the first one 5.4 ms, and the buffers and the encode fed a
scavenge of 0.9 to 2.2 ms in the same frames. The first frame of growth was a 17.2 ms task, over a 16.7 ms bound.

- One worker for the page, made on the first interim build from a Blob URL. Its source is bundled into the package as a
  string at build time: there is no second file to serve.
- It renders the rows with `renderDisplacementPixels` and encodes with `OffscreenCanvas.convertToBlob`. The main thread
  makes a blob URL, decodes it and retargets, as for any map.
- Until the built map arrives the lens shows the map it has, stretched to the new box, as it does while a map decodes.
  The new map lands a frame or more after the one that asked for it.
- One build in flight per lens. When it lands it is shown if it is newer than the map on screen, even when a newer key
  was asked for meanwhile, so a motion faster than its builds still moves; then only the newest key is built, and the
  keys in between are never built.
- A result lands nothing once the lens left interim, was destroyed or took another filter.
- A key still in the store of 8 is answered at once, with no build. A map the store drops, and every map of a
  destroyed lens, has its blob URL revoked.
- Without `Worker`, `OffscreenCanvas` or `convertToBlob`, or when a CSP refuses the blob worker, or when the worker
  errors, the main thread builds as before, for the rest of the page's life. A job that fails is reported with
  `reportError` and the lens gets its map from the main thread; a worker that cannot start is not reported.
- A job that fails, a worker that errors, a message that cannot be read, or a worker silent for 2 s switches the whole
  page to the main thread for good. A failed job is reported once, by its own lens; the lenses with other jobs in
  flight fall back silently, and no lens is left without a map. A `postMessage` that throws (a DataCloneError) is
  reported the same way.
- The Blob URL of the worker source is revoked when the worker is terminated.
- A page with a `worker-src` policy needs `blob:` in it to use the worker; without it the fallback applies.
- `renderStats()` gains `mainThreadBakes` (interim maps built on the main thread) and `workerBakes` (built in the
  worker). `reducedBakes` still counts the interim maps asked for.

## 3.4.1

Maps are baked on a canvas kept in memory, and a landing bakes its maps after the next frame in slices of a few ms. DOM
target only. The settled map lands at least a frame (up to 100 ms) later, plus the time of its slices, so the
interim map stays on screen a little longer; nothing else on screen changes.

`toDataURL` on a canvas the GPU backs waits for the GPU process, which is busy while the page animates: building a
map took 11 to 44 ms there (up to 140 ms) and 1 to 3 ms on a canvas created with `willReadFrequently`, on a Ryzen 5
3500U with Vega 8. Every bake, interim maps included, was paying it; a landing was a task of 16 to 34 ms and a lens
attached in a frame was one of up to 42 ms.

Leaving interim also baked the displacement map and the spectral map of a surface in the task that landed it, and a
large one is a long task even alone (19 to 23 ms for a sheet). Now that task bakes nothing: after the next frame (or
100 ms where no frame comes) the maps are rendered a few rows at a time, yielding every 5 ms, then encoded, and the
two are retargeted together once both are decoded. `displacementRows`, `spectralRows` and `renderInSlices` give the
same pixels as `renderDisplacementPixels` and `renderSpectralPixels`.

- Both are baked at the device pixel ratio the landing was keyed for.
- The wait lands nothing once the lens has entered interim again, been destroyed, left the document or taken a new
  key; a second landing of the same maps during it joins it instead of queueing another.
- A bake that throws is reported with `reportError`, and the lens bakes again on its next landing or resize.
- A lens taken out of the document during the wait lands when it is back and measured again.
- A hidden page renders the remaining rows at once: its timers are clamped to about a second, and it draws no frames.
- A landing whose maps are all cached lands at once, as before.

## 3.4.0

`VIREGLASS_CONTROL_MATERIAL` is frosted as the reference control over text: roughness 0.035 → 0.18, blur 0.42 →
2.16 pt. Every target; a visible change to anything built of the control material.

Body text read through a control almost untouched (vireuikit's legibility gate: its rail and floating buttons at
4:1 over a page of text). At 0.035 Chromium renders no blur at all. Why it shipped: the roughness was chosen by eye
("thick and clear"), a unit test asserted that choice, and no gate put text under a control.

- Measured against M 7:11 (frames/verify/m-711), a control capsule over body text, with frost, magnification and the
  body on both sides: the whole material over a scene at the frame's proportions, read as the frame is. The frame
  gives darkest 0.31–0.41, depth kept 0.48–0.58, detail kept 0.14–0.15; 0.18 gives 0.30, 0.58, 0.17, the least
  frost inside all three. One frame, one size, one typeface (docs/material-lab.md).
- `check:dom` holds that scene to the frame's ranges; the canary is 0.035 (0.01, 0.99, 0.98).
- The rim follows `specular`, which roughness lowers from 0.979 to 0.892: about 9% weaker. Under the finger the
  control still rises into a clear lens (`raiseIntoGlass` scales the roughness down), now from frosted, which is
  the reference's matte-at-rest, lens-under-the-finger (M 4:10).
- `check:optics` reads the rim's gathering on the lensing alone (1.90x, threshold unchanged) and the control as
  shipped against thin glass (1.87x, guard 1.8; thin glass reads 1.73 without frost).
- The unit test asserts the measured blur range instead of "clearer than the baseline".

## 3.3.0

The DOM probe reads text under the glass. DOM target only.

`probeBackdrop` reads declared styles, and type is not a declared background: a page of body text read as
flat (`busy` 0), so everything that answers structure behind the glass did nothing over text. The shadow
measured off the reference (frames 711–723: 4.0% over a flat light backdrop, 19.9% over text) stayed at its flat
value over a paragraph. Why it shipped: no gate put type under the glass; `check:optics` sweeps luminance
backdrops, none of them a line of text.

- A sample point on a line box of a text node, with nothing opaque above it, counts the text's colour as a
  share of the point (`PROBE.inkOfLine`, 0.2, unmeasured: typographic). It feeds `busy`; `luma`, `lo` and
  `hi` stay the background's, so type never moves the ink's polarity on its own.
- `check:dom` puts a paragraph under the glass in a real browser: `busy` 0.41 and the shadow 0.200 over it,
  `busy` 0 and the shadow 0.040 with the text transparent (the canary), the reference's two numbers.
- Text above an image, a video, a canvas, an iframe or a background image is covered by it; a text fill
  (`-webkit-text-fill-color`) wins over `color`, and the element's own opacity thins it. The line boxes of each
  text node are measured once per probe.
- What else follows `busy` changes over text. The ink requirement in `resolveBody` now binds there in full, and
  the fine-texture ground rises a little. Under light ink over a page of light text that raises the body; under
  dark ink over dark text on a light page the law still reads the spread as enough, so the body stays where it
  was. Calibrating that against the reference is the rest of #31.
- The share is an estimate, and a 5 by 5 grid meets lines as they scroll past it, so `busy` over text moves in
  steps while it scrolls.

## 3.2.2

The scroll edge is strongest at the panel's edge and fades away from it. It was the other way round.

`paintFor` wrote `linear-gradient(to top, …)` for a panel at the top. A gradient starts at the far side of its
direction, so the mask was opaque at the bottom of the band and clear under the panel: the content right under a
bar stayed sharp, and the dissolve and the dimming sat where nothing needed them. Why it shipped: no consumer used
`attachScrollEdge` until vireuikit 0.11, and its unit test asserted the CSS string it wrote ("to top" for a top
panel), not where the strength is.

- The mask and the dimming tone now run from the panel's edge inward, for both sides.
- The unit test reads where the strength is: alpha 1 at the panel's edge, 0 at the far end of the band.
- `check:dom` measures it in a real browser: the edge changes the content under it by 47 at the panel's edge and
  6 at the far end of its band (the previous code: 5 and 46). The canary is the written ramp turned round.

## 3.2.1

A spectral bake costs a fraction of what it did, and so does ending interim (#26). DOM target only.

The kit's perf gate, once its window covered the landing, showed 33 to 100 ms stalls when interim ended. The
spectral map was most of it, 5 to 8 times the displacement map: `renderSpectralPixels` evaluated `spectralHue`
(a `pow`, a `sqrt`, six `cos`) at every pixel of the bevel, although for one element the hue is a function of
the depth into the bevel alone.

- The hue is tabled at 2049 depths, denser towards the silhouette where the rim's slope turns fastest, and
  interpolated. A bake reads the plain middle of the element as neutral without evaluating it. The map is
  within one 8-bit step of the hue evaluated at every pixel, for every preset with a spectral edge and for
  extremes of film (900 nm), iridescence and diffraction (1), on five geometries at dpr 1 to 3.
- Counted in a unit test: a bake evaluates the hue 2049 times whatever the element's size; it used to be once
  per pixel of the bevel. Measured in Chromium on one machine: a spectral bake 5.7 → 2.7 ms for a 390×64 bar,
  20.2 → 5.9 ms for a 390×520 sheet at dpr 2.
- The map key carries what the hue depends on beyond the displacement (thickness, film, iridescence,
  diffraction), both for the cache and for deciding to rebuild. Two materials that differed only there shared
  a map, and a live element whose film alone changed kept its old one.
- A hue above the headroom of 2, which an iridescence near 1 reaches, still clips in the map, as before.

## 3.2.0

`setAppear` changes the lens in place instead of rebuilding its maps, so glass can materialise every frame (#24).
DOM target only.

Appear was part of the map key, so every step rebuilt the maps: at rest a full bake and a new filter element,
50 to 200 ms on an integrated GPU, and during interim a reduced bake. The kit fell back to fading its toolbar
capsules by opacity, which the reference rules out. Yet the map's pixels are a fraction of the displacement
scale and do not depend on it, and the spectral hue is `1 + appear * (hue - 1)`. So the maps are now baked at
full presence, and appear is written as attributes: the scale of every displacement pass, the frost's
`stdDeviation`, and `k1`/`k2` on the spectral product to mix the hue in. The strength belongs to the
map that is shown, so interim still stretches one map at one strength. The picture is the same at every appear: a `check:dom` run
of the previous code read the same rim at 0, 0.5 and 1 (0.00, 44.00, 54.23). `check:optics` and
`check:backdrop` cover the other targets, which this does not change.

- 30 `setAppear` steps in unit tests and 31 in `check:dom` in a real browser cost no bake and no filter swap,
  at rest and in interim. Thirty morph steps, which the map is keyed by, are the canary.
- `setAppear` during interim no longer bakes a reduced map.
- An element of the interactive variant, at appear 0 until touched, now bakes its full maps on attach and keeps
  its spectral passes as an identity mix. Under the finger its frost and spectral mix stay where they were at
  rest, as before; only the displacement follows the touch.

## 3.1.1

`setInterim(true)` called again while interim restarts the 2 s safety net. It was a no-op, so a drag or a
press held still for longer than 2 s, which sends no geometry, left interim by itself and baked the full map
and probed mid-gesture; the next frame of movement then ran on that map until the gesture ended. A host keeps
a long gesture interim by repeating the call while it lasts.

## 3.1.0

An interim mode for glass that changes shape every frame, and counters for the work the live DOM target
does. DOM target only; the WebGL2 and Android renderers are unchanged.

Every morph, drag or growth of a glass element ran at 10 to 20 fps with glass on and 60 without, because each
new geometry re-ran the whole pipeline: an `elementsFromPoint` backdrop probe, a full-resolution displacement
and spectral map, and a new filter element swapped in with `replaceChild`.

- `GlassHandle.setInterim(on)`. While on, `apply()` reuses the last sample (a supplied `sample` still wins, and
  then ending interim does not probe), keeps the filter and its maps (`feImage` stretches them over the live
  box) and updates only the cheap parts. A change of `setMorph` shapes, of `setAppear` or of the accessibility
  settings during interim rebuilds the map at reduced resolution, keyed by geometry quantised to 2 px, and
  updates the filter in place; a new map is shown only after `Image.decode()`, which matters where the
  browser decodes lazily. `setInterim(false)` does one full rebuild and one probe, decoded and applied in
  place. Interim with no call for 2 s ends itself the same way. An element of no size is not baked.
  `GlassHandle` gains this member, so a hand-written mock of the type needs it.
- `renderStats()` and `resetRenderStats()` from `vireglass/dom`: `probes`, `fullBakes`, `reducedBakes`,
  `filterSwaps`, counted in the module. The spectral map counts as a bake of its own. `check:dom` uses them to
  assert that sixty frames of changing geometry inside interim cost no probe, no full bake and no filter
  swap, with the same frames outside interim as the canary.
- When a finger settles, the full-resolution map is decoded and set in place instead of swapping the filter.

## 3.0.1

Under increased contrast the live DOM target drew its contrast rim whatever the element's appear: a glass meant
to be absent (`setAppear(0)`, such as a trigger whose body a grown menu has taken over) left an outline behind.
The contrast rim now follows appear like every other layer: absent at 0, partial on the way in, opaque once the
element is there (#18).

## 3.0.0

What a resting control looked like against the reference, measured and corrected in the live DOM
target; the lens shader carries the rim change and the same law.

### The rim follows its surroundings and goes all the way round

The key-light lobe was drawn full white on every backdrop and only on the lit side: over dark video
the brightest rim bin read 0.95 in OKLab lightness against 0.42 to 0.53 in the reference, and 0.70
to 0.80 over the surround against 0.24 to 0.27. The rim is now a thin light line round the whole
contour, brighter toward the key light, over the dark edge, and its strength follows the lightness
around the element (`RIM.strengthDark` to `RIM.strengthLight`), scaled by the medium's reflectance
up to that of ordinary glass (`RIM.reflectanceRef`). Rim strength is therefore derived, not a new
cause: a denser medium draws the line no brighter than glass at index 1.5 does, a thinner one
fainter. The same law is in `lens-shader.ts`, so WebGL2 and AGSL draw it too; there the light line
starts a third of the way into the band (`RIM.lineInset`) so the dark edge stays visible over bright canvases.
`rimGradientCss` now returns two gradients (the light line, then the dark edge) as one background
list; `rimStrength`, `rimLineAlpha` and `ambientLuma` are exported from `vireglass/dom`.

### The body is drawn on the SVG path, and it is lighter than its surroundings

`bodyCss` was applied as `background-color` only where SVG backdrop filters are missing; elsewhere
only `--vireglass-body-color` was published, and over dark that colour was darker than the surround.
The body is now one translucent layer composed from the lens's chain (tint, matte lift, the medium's
pull, ambient spill, concentration), painted on both paths (`bodyLayer`).

The law's direction changed with it, in the shader as much as here. The reference body is lighter
than its surroundings from dark video to sky, under a white glyph as much as a dark one, and the
old law darkened it wherever light ink met a backdrop above about 0.5, and under light ink over dark
as well. Now the tint is toward light on every backdrop: `presence` is a floor on the density, toward
light only, worth `presence` times the room left under the light pole, so it fades out as the room
does and has no step anywhere on the scale (the old floor asked for the whole separation and divided
by the room: a body that read 0.54 opaque at `#efefef` read 0.10 at `#f0f0f0`). The ink's legibility
requirement binds over texture only (`BODY.inkBusyFrom`,
`BODY.inkBusyTo`), going to the ink's own pole where it is what holds the density (or a system
setting has raised it: `BODY.inkPoleTo`). `BODY.darkSideFrom` and `BODY.darkSideTo` are gone.
`VIREGLASS_CONTROL_MATERIAL.presence` is 0, from 0.176: with the body lifting toward light, that floor
read 0.22 to 0.28 of OKLab lightness over dark video against the reference's 0.05 to 0.13.

The lens's key-light glint inside the reflection is scaled by the same ambient strength as the rim,
and the shader's presence floor now uses `BODY.presenceDemand` as the DOM path does.

### A host can feed the probe and change it later

`attachGlass(el, { sample })` already existed; `handle.setSample(sample | null)` updates it without
re-attaching and repaints, and `null` returns to probing. `statsFromSamples` accepts colours
without an alpha. `GlassHandle` gains `setSample`, so code that implements the type (a test double)
has to add it.

### Breaking changes

- `attachGlass` now paints the body inline as `background-color`. A host that paints
  `var(--vireglass-body-color)` itself passes `body: false`; the property is emitted either way.
- `GlassHandle` gained `setSample`. Code that implements the type (test doubles, wrappers) must add
  it.
- `rimGradientCss` returns two gradients, the light line and the dark edge, as one background list,
  and the light line is part of it all the way round. A host that sets it as the value of
  `--vireglass-rim` needs nothing; one that parses the string does.
- `resolveBody` and `withPresence` return `need` and `pole` as well as `density` and `tintLuma`,
  and the tint they return is toward light unless the ink asked for its pole; a host that builds its
  body from them directly gets the new direction.
- `VIREGLASS_CONTROL_MATERIAL.presence` is 0.
- `BODY.darkSideFrom` and `BODY.darkSideTo` are removed from `vireglass/law`; `BODY.inkBusyFrom`,
  `BODY.inkBusyTo`, `BODY.inkPoleTo` and `RIM.strengthDark`, `strengthLight`, `ambientFrom`,
  `ambientTo`, `lineInset`, `contour`, `whiteShare`, `reflectanceRef` are added.
- `GlassBody` requires `need` and `pole`: a caller that constructs a body to pass to
  `withPresence` no longer type-checks. `withPresence`'s third argument is ignored and optional.
- `--vireglass-body-color` now carries the composed layer, with a different alpha (it includes the
  medium's lift, so it is never fully transparent at full appearance).
- The WebGL2 and AGSL output changed: the body direction, the presence floor (capped at
  `BODY.presenceDemand` 0.5 where it was 0.92, and no longer dependent on the backdrop's lightness),
  the rim (no `u_presence * 2` floor on the line, an ambient-scaled glint) and the transparency
  scale's object gain.

### Gates

`check:dom` measures a control-sized circle against the reference's numbers: rim faint over dark and
plain over bright, the line unbroken round the contour, the body lighter than the surround over dark
and over a mid-light backdrop where the glyph is still white (on a body that carries a presence
floor, so the direction shows), and `setSample`. Each has a canary that must fail: a full-white lobe,
a rim drawn for dark over bright, a lobe with no contour, no body drawn, the old direction over
mid-light. A unit gate holds the body's alpha continuous from 0.80 to 1.00 in lightness for the
default material and every preset, with the old floor as its canary, and the `check:optics` sweep
now runs to 1.00 instead of stopping at 0.94.

## 2.3.1

### toGLSL no longer rewrites comments

The transpiler's rewrites are regexes over raw text, and they read comments as code. A comment in
`main` that mentioned "return" was turned into one — with `[^;]+` running across lines to the
next semicolon — so everything up to that semicolon vanished and the shader still compiled. A
brace in a comment ended the entry point early. Comments are now stripped before any rewrite
(line breaks kept, so compile errors still point at the source line). The package's own lens and
surface shaders were not affected: their output is identical apart from comments. Shaders of your
own passed through `toGLSL` — a backdrop pass, say — could have been. An unterminated block
comment is now an error rather than a silently truncated shader. The generated GLSL no longer
carries the source's comments; the AGSL source, where they are written, is unchanged.

## 2.3.0

A backdrop that is already a GPU simulation can now be what the glass refracts, without a
detour through a 2D canvas.

### New: a GPU backdrop pass

`scene` costs a CPU rasterize and a `texSubImage2D` upload every frame — fine for text and cover
art, wrong for a backdrop that is already a GPU simulation. `renderer.render({ backdrop })` draws
straight into the texture the lens samples, in the same WebGL2 context, with no canvas and no
readback; `scene` and `backdrop` are now both optional on `VireGlassRenderOptions`, exactly one is
required. See *GPU backdrop* under *Web* in the README for the signature and its orientation
contract, and `check:backdrop` for the gate that holds the two paths equivalent — including a
canary for a pass that gets the orientation backwards.

`vireglass/web` also gains the low-level GL helpers the renderer itself is built on —
`createProgram`, `createTexture`, `createFramebuffer`, `bindTextureAt`, `drawFullscreenTriangle`,
`locationCache`, `setUniform` — public now that a backdrop pass needs them too. `TextureOptions`
gains `wrap` (`CLAMP_TO_EDGE` by default, applied to both S and T) for a simulation with a
periodic domain.

`VireGlassRenderer.getLastGpuMs()` reports the GPU time of the last `render()` call via
`EXT_disjoint_timer_query_webgl2` — `null` without the extension or on a disjoint sample, never an
error.

A render that throws — a backdrop pass with a shader typo, say — no longer leaves the timer query
open: every later reading used to fail silently and `getLastGpuMs()` froze. After a backdrop pass
the renderer resets every piece of GL state its own passes rely on, so a pass may leave depth,
culling, stencil, masks, its VAO or the unpack flags however it likes.

### Repository

`check:agsl` runs on pull requests again: a folded YAML scalar had merged it into `check:glsl`'s
arguments. `check:dom` now renders in a shadow root and under a finger, and `check:english` keeps
every tracked file in English.

## 2.2.0

Four bugs from the first real integration, and a gate for the target that had none.

### Glass in a shadow root rendered nothing at all

The filter went on `document.body` and the rim styles on `document.head`, but
`backdrop-filter: url(#id)` resolves the reference in the element's OWN tree. From inside a shadow
root the filter is not found — and the failure is silent, because the reference is valid CSS: the
element gets no backdrop whatsoever, not even the blur fallback. A widget in a shadow root, which
is how you survive a page full of global `!important`, came out with no material.

The host is now the element's own `getRootNode()`: the shadow root when there is one, the document
otherwise. Nothing to configure.

### A white page read as black

With no opaque layer in the stack, the probe fell back to the topmost element's `color` — its TEXT
colour. On a white page with black text that reads black, and the material dressed itself for a
dark backdrop over a light one.

Not an edge case. CSS propagates the body's background to the CANVAS, so `getComputedStyle` reports
`<html>`, and often `<body>`, as transparent on a perfectly ordinary page. Any element past the end
of the body's box — a widget pinned to a corner — sees a stack of nothing. The propagation rule
says where to look instead: the root element's background, then the body's, then the user agent's
white.

### Presence put the body exactly on the backdrop

`withPresence` picked its direction from the backdrop alone — lighter over dark — and then, when
the body disagreed, clamped `tintLuma` to the backdrop's mean, which is the one value that
separates from nothing. Light ink over a dark backdrop puts the body at 0.07 against a backdrop of
0.12: already separating, downward, and the clamp pulled it back. Measured on the default material
at `presence: 0.08`, the delivered separation was exactly 0.0000 at backdrops of 0.12, 0.20 and
0.35.

It takes the side the body is already on now. Presence also gains a density ceiling of its own,
below the general one: it is a floor on visibility, not a licence to stop being a window.

### Dispersion left two channels behind under a finger

`paintInteraction` called `querySelector('feDisplacementMap')` where dispersion builds three, each
with its own scale. Red got the undispersed scale and green and blue kept whatever they had at
attach time, so the coloured edge stopped following the finger. All three are updated now, each
at its own fraction.

### check:agsl

`check:glsl` proves the TRANSPILER works — it converts the source to GLSL ES 3.0 and compiles that
in Chromium. It says nothing about whether the source is valid SkSL, which is what Android runs. So
one of the three targets this package claims had no gate at all, and a shader change could only be
found out about in somebody's app.

`check:agsl` compiles the same text with Skia's own compiler through CanvasKit. Both shaders are
valid, so there was nothing latent. The check is verified able to fail: a shader referencing an
undeclared name is rejected.


## 2.1.0

### Several elements flowing into one whole, however many there are

That is the behaviour §5 describes. How many elements there happen to be is the host's business,
and it used to be the material's: the count lived in the argument and field NAMES —
`sceneDistance(x, y, w, h, r, k, b?, c?)`, `GlassMorph { shape?, shape2? }`,
`DisplacementState { morph?, morph2? }`. A fourth element had nowhere to go without a `d`, a
`shape3` and a `morph3`, and then a fifth. That is not a limit the material has; it is a limit of
what somebody once wrote as two optional arguments.

`sceneDistance` and `sceneGradient` are a fold now, taking a rest parameter, so every existing
call with two shapes works verbatim and the count is unbounded. `GlassMorph` gains `shapes` and
`DisplacementState` gains `morphs`; the old fields still work and come first.

The gradient's derivation generalises the same way — at each step the normals blend with the
weight that blends the distances — as long as the running distance is carried alongside the
running normal, because the next step's weight is measured against it. Verified to agree with the
previous answer to ten decimal places for the two shapes the old signature allowed.

**The shaders still take two.** There the count is in the uniform NAMES (`u_morphOffset`,
`u_morph2Offset`), and lifting it means uniform arrays with a count and a loop in both. So the
live-DOM target takes any number today and WebGL2 and AGSL take two, which is what they took
before.

### The release workflow creates the release

A tag reached npm and left no release page: the repository went on showing the previous version as
Latest while the registry had the new one. Three releases existed and every one was made by hand,
so the fourth did not happen. The notes now come from this file's section for the version being
released, and a version with no section fails the release rather than publishing something nobody
wrote down.


## 2.0.0

Ready to be depended on: what the package exports, and a gate for every promise the docs make.

### Breaking: the comparison canvases leave the root

`REFERENCE_SCENES`, `VireGlassRefLayer`, `refCheckerCells`, `refGradientSteps` and
`drawReferenceLayer` move from `vireglass` and `vireglass/web` onto `vireglass/reference`.

They are bench machinery: two platforms held against the same backdrop and compared as numbers
(`docs/platform-parity.md`). A material library's surface should not be its own test canvases — an
app that wants glass has no use for a checkerboard, and a host that already has comparison
canvases of its own should not have to dodge a name collision to adopt the material. Which is not
hypothetical: the monorepo this was extracted from has exactly that, under its own names.

```diff
- import { REFERENCE_SCENES } from 'vireglass';
+ import { REFERENCE_SCENES } from 'vireglass/reference';
```

Nothing else moved, and nothing was dropped.

### New: the law is readable

`vireglass/law` exports every calibrated number in the material, in twenty groups, each carrying
where it came from. A fourth renderer has to agree with the other three and cannot do that against
numbers it cannot read. On a subpath rather than the root, because names like `SIZE`, `SCALE` and
`TOUCH` have no business in a top-level namespace.

### Gates that cover the package as a package

- `check:package` packs the tarball, installs it into an empty project, and loads every entry
  point in CommonJS and ESM — deliberately without React present, so a core that needs it fails
  here rather than in someone's install. It also checks that the Android source ships and imports
  nothing the package does not declare: an undeclared peer there surfaces in an Expo build, which
  is the worst place to find it.
- `check:readme` reads the import lines out of every markdown file and checks each name against
  the entry it names, resolved through the package's own exports map. The worst way for an open
  library to fail a stranger is for its first example not to run, and docs drift silently — a
  rename leaves the build and the tests green.


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
