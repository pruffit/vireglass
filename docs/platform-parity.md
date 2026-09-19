# The platform-parity gate

> This document isn't runnable here: the parity gate drives a development bench that lives in
> the private monorepo, and that bench's tooling isn't part of this package. What follows
> records the procedure and the measured baseline — not something you can execute from this
> repo.

The material is one, the clients are two, and they draw it by different paths: web is WebGL2
over a canvas, Android is AGSL over a captured RenderNode. The question "does the glass look
different on Android?" has to be settled by a NUMBER, not an impression. This document covers
what gets captured for that, with what tool, and to what tolerance.

Why this needed setting up at all: the impression "it's different on Android" turned out three
times to be an artifact of the measurement, not a property of the material (issue #112, lab
entries E-45, E-48, E-49). Each time it was the capture conditions that diverged, not the
pixels.

## Canvases

Eight of them. They live as data in `src/reference-scene.ts` (`REFERENCE_SCENES`), both benches
draw them, and `check:optics` runs against the same set. Adding a canvas to only one bench isn't
allowed.

| canvas | what it checks | web `zone=` | Android `zone=` |
|---|---|---|---|
| `flat` | the body's departure from the backdrop: is the element visible over a flat canvas | 8 | 13 |
| `stripes` | the window: brightness swing inside the element as a fraction of the swing outside it | 9 | 14 |
| `busy` | ink against content, over a cover image | 10 | 15 |
| `bar` | whether the rim accumulates content: a bloat of what's behind the silhouette | 11 | 16 |
| `steps` | the body's profile at five levels at once — the main platform-parity check | 12 | 17 |
| `edge` | tint across a hard break: half under the glass black, half white | 13 | 18 |
| `gradient` | ink polarity: where the automation flips the label | 14 | 19 |
| `grid` | lens distortion: a straight line dragged and broken — checked BY EYE, not by number | 15 | 20 |

The indices differ because each bench also has its own zones; the canvas name is the same one.

## What makes the canvases comparable

Six conditions. Each of them was violated at some point, and each time it produced a false
conclusion.

1. **A fixed-size panel in dp**, centered on the stage, with a `REFERENCE_SURROUND` margin
   around it. Not a fraction of the stage: the benches have stages of different sizes, and the
   stripes used to come out different thicknesses.
2. **The pattern is measured from the panel's edge.** That's why the panel has to be one fixed
   size: on a full-width canvas, the stripe phase under the element used to depend on screen
   width, and a checkerboard would land a different cell arrangement under the element.
3. **The same shapes** (`REFERENCE_SHAPES`): size feeds into the optics through `sizeGain` — a
   120 circle and a 150 circle are glass of different thickness. The order and the value of
   `shape` are shared too.
4. **One scale**: the canvas gets the same screen-density number as the elements do.
5. **One element position** (`REFERENCE_PIECE_AT`), measured from the panel's corner. The web
   bench used to place the element at the center of the VISIBLE area while the canvas was drawn
   around the center of the whole canvas — with the control panel open, those are two different
   points.
6. **One frame composition**: a parity canvas's frame contains only the element. A row of
   material swatches on web used to sit right on the canvas, and a label over the glass on
   Android was missing from the web frame — different pictures were being compared.

## Three measurement rules without which the number means nothing

Each one is written up from its own mistake, and every mistake cost a round of debugging that
ended in the wrong conclusion.

1. **Measure the actual artifact, not the measurement tool's own re-render of it.** The web
   half of this tool used to draw the canvas itself — and came out 4× off from the bench: the
   bench drives ink polarity through the automation, like the product does, while the
   measurement took the material as-is. Now both platforms go through the same path: a
   screenshot, then analysis of the screenshot. The invariant is pinned by a test that lives
   with the measurement tool, alongside the bench rather than in this package.
2. **Control first, conclusion second.** The measurement must have a point with a KNOWN answer,
   captured before anything else. Here there are two: "backdrop" mode must give exactly 0.0
   departure, and the flat field must give the lightness of its own fill. If the control doesn't
   check out, no number downstream means anything, however many there are. The `check:optics`
   gate measured the shader's fallback path for six months precisely because it had no control.
3. **The state of both sides is part of the number.** Canvas, shape, density, stage scale,
   element position, polarity automation, frame composition. Anything not recorded next to the
   number will silently drift apart someday: shapes, stripe thickness, pattern phase, a label
   over the glass, and a row of swatches have all drifted this way before.

## The parity procedure

One canvas, one step at a time:

1. **Capture the web profile.**
   ```bash
   pnpm --filter @vire/vireglass measure:reference -- --web --scene=steps --density=3
   ```
   Density matches the device's own (`adb shell wm density`, divided by 160). The
   `--stage=406x904` flag sets the stage to the size of the device's screen: the probe grid is
   constant (48×96 over the whole stage), and on a tight stage it covers the element three times
   as densely as it would there.

2. **Capture the device profile.** The canvas is picked via a deep link, the panel is removed,
   and the ink automation is turned off — otherwise the two benches sit in different states:
   ```bash
   adb shell am start -a android.intent.action.VIEW \
     -d "vire://lab?zone=17&debug=0&shape=0&stage=0&panel=0&auto=0&move=0&ink=0" \
     -n com.virespace.viremusic.lab/com.virespace.viremusic.MainActivity
   adb exec-out screencap -p > lab.png
   pnpm --filter @vire/vireglass measure:reference -- --shot=lab.png
   ```
   Leave a pause of a few seconds between the deep link and the screenshot: the native probe
   eases into the new reading rather than jumping to it.

   **`ink=0` in the address is mandatory, and `auto=0` does NOT substitute for it.** `auto=0`
   only turns off the automation — the polarity stays whatever the material's is, and the
   baseline's is `ink = 1` (light). Meanwhile web is measured with `--ink=0`, and the body
   diverges in opposite directions: the bench pulls it toward white, the lab toward dark. On the
   `bar` canvas this produced −84 versus +3.3 — an 88-unit gap out of nowhere, entirely from
   state, not from the material (Sep 14).

   The component has to be given IN FULL (`-n package/class`), not just the package: the
   `vire://` scheme is registered by both the production app and the lab, so `-p` still makes
   the system show an app picker — and then the screenshot is of the dialog. If the dialog does
   pop up and stick around, kill it with `adb shell am force-stop com.android.intentresolver`;
   never tap "Always" in it — that changes the phone owner's own app associations.

   **Wrap the whole command in quotes for the DEVICE's shell** (`adb shell "am start …"`), or it
   reads the `&` in the address as "run in background": only the first parameter reaches the
   bench, and the rest execute as separate commands. From the outside this just looks like "the
   deep link doesn't work."

3. **Compare.** Both commands print the same table: a profile through the element's center, the
   backdrop on those same rows outside the element, and the body's departure. The canvases are
   made of horizontal stripes, so the backdrop UNDER the body is known, not extrapolated. The
   backdrop is sampled with the SAME window as the body: sampling it with a single pixel on
   canvases with vertical structure used to land it sometimes on a line, sometimes between two.

4. **Diff the frames when the eye disagrees.**
   ```bash
   pnpm --filter @vire/vireglass measure:reference -- --compare=lab.png --scene=grid
   ```
   The command crops the element out of both frames with the SAME window in dp and places them
   side by side at the same size. Without this, the eye compares display scale, not the
   material: the emulator's window is shrunk on screen, and a pixel-thick line under the glass
   disappears there entirely, even though it's present in the actual pixels. This is exactly how
   an "I see a difference" argument has come up before, when in pixels there was none.

**Tolerance — 10 units of lightness out of 255 (4%).** Beyond that, the platforms have
diverged, and it's a defect in the material or in the delivery path.

## Baseline capture (2026-09-14, 120 dp circle, baseline, 411×914 dp stage, density 2.625, ink=0)

Both halves were captured the SAME way — a bench screenshot and a lab screenshot — in one
state, with ink polarity PINNED. Mean body departure from the backdrop:

| canvas | bench | Android | gap |
|---|---:|---:|---:|
| flat | +7.4 | +15.5 | 8.1 |
| stripes | +42.8 | +43.5 | 0.7 |
| busy | +38.3 | +36.5 | 1.8 |
| bar | +3.3 | −1.4 | 4.7 |
| steps | +12.2 | +16.6 | 4.4 |
| edge | +177.0 | +176.9 | 0.1 |
| gradient | +33.1 | +38.0 | 4.9 |
| grid | −4.6 | −4.9 | 0.3 |

All eight are within tolerance; the largest gap is 8.1 units out of 255.

## The emulator reproduces the device (2026-09-14)

The same run on the `VireMusic_Test` emulator (android-36, x86_64, 1080×2400 at density 420 —
the same 411×914 dp and 2.625 as the phone), a build with fixes #114–#118:

| canvas | bench | emulator | gap | phone (baseline) |
|---|---:|---:|---:|---:|
| flat | +7.4 | +15.5 | 8.1 | +15.5 |
| stripes | +42.8 | +43.7 | 0.9 | +43.5 |
| busy | +38.3 | +36.8 | 1.5 | +36.5 |
| bar | +3.3 | −1.0 | 4.3 | −1.4 |
| steps | +12.2 | +17.1 | 4.9 | +16.6 |
| edge | +177.0 | +177.0 | 0.0 | +176.9 |
| gradient | +33.1 | +38.3 | 5.2 | +38.0 |
| grid | −4.6 | −4.8 | 0.2 | −4.9 |

The "phone (baseline)" column here is the run from Sep 13; a direct check against the phone was
done the same day and is written up below, together with performance, in
`docs/benchmarks.md`. Short version: **the emulator reproduces the phone within 2.4 units**,
and on five of the eight canvases to within a tenth of a unit. So the CORRECTNESS check can be
run without a phone — but only that check: the emulator overstates per-frame cost by roughly
twenty times (`docs/benchmarks.md`, rule 1).

A run on the phone itself (406×904 dp, 3.0) produced the same eight-within-tolerance result,
with the largest gap at 8.2 on `flat` — the same canvas, the same size gap, as before the
fixes.

After fixes #114–#118, the web half matched the captured baseline to a tenth of a unit across
all eight — the fixes don't move the silhouette, because the metric measures the FLAT MIDDLE of
the body, while the dark rim (#115) lives in a band about a point wide. The rim had to be
measured separately, by diffing frames (`--compare`): the bright arc on top gives +19 over the
body on the emulator versus +20.5 on the bench, and the dark outline lands at the same
lightness, 119, on both platforms. So the new, independent rim layer reaches Android without
distortion.

### Why polarity is pinned, not left to the automation

The polarity decision has hysteresis: a light label switches to dark at a threshold lightness of
0.62, and only switches back below 0.5. The `gradient` canvas lands exactly in that gap — its
threshold lightness is around 0.57 — so the outcome depends not on the material but on which
state the bench entered the zone from. With the automation on, this produced a 60-unit gap that
even flipped sign; with polarity pinned, it's 4.9.

The automation itself isn't tested here: it has its own tests (`src/__tests__`), and its job is
to pick a side, not to reproduce the other platform's pick. This table is about the MATERIAL.

### What still diverges

The DARK side of the rim on the device is darker than on the bench by about 6 units out of 255;
the LIGHT side matches almost exactly (225 versus 224). By direction from the element's center,
on the `grid` canvas:

| | right | down | left | up | up-left (light side) |
|---|---:|---:|---:|---:|---:|
| device | 163 | 162 | 166 | 185 | 225 |
| bench | 169 | 170 | 173 | 189 | 224 |

Device tilt is ruled out: with it switched off (`environment=0`) the numbers are the same
(163/164/164/186). The light pattern matches, so the key light's direction is the same one on
both.

**Pinning this on the `1 − 0.22 · outline · (1 − lit)` multiplier didn't hold up.** On Sep 14,
`(1 − lit)` was removed from that expression (#115), and re-measuring the same five directions
left a 1–3 unit residual, while the web half on the code BEFORE the fix gave exactly the same
numbers as after. So the fix doesn't touch these rays at all: the outline's minima sit where
`lit` is already near zero. The residual persists and has a different cause — the breakdown is
in `docs/benchmarks.md`.

The size of it is inside the parity tolerance, so it isn't filed as a separate defect; if the
rim ever becomes a focus of work, start here.

### What not to do

- **Don't eyeball screenshots against each other.** A 30-unit lightness difference looks the
  same across different canvases, and a 5-unit one doesn't look like anything at all.
- **Don't measure a canvas with periodic structure by number.** On a grid of pixel-wide lines,
  the window average is set by how the platform rasterizes the line, not by the material; such
  canvases are flagged `measurable: false` and are checked by eye.
- **Don't treat "backdrop" mode as just debugging.** It's a reference point: in `debug=6` mode
  the element must DISAPPEAR. A nonzero departure means something is lost in capture, and
  there's nothing further worth measuring.

## Debugging order when there's a mismatch

1. **"Backdrop" mode** (`debug=6`) on both platforms. Departure must be 0.0. Nonzero means the
   content-delivery path is at fault, not the optics.
2. **The model's debug channel** (`debug=11`, channels `--channel=r|g|b` — density, legibility
   requirement, structure). If the model's inputs diverge, it's the BACKDROP ESTIMATE that
   diverges, not the shader itself: the shader is one and the same text on both platforms.
3. **The probe's debug channel** (`debug=12`): red is mean lightness under the element, green
   is the vertical lightness slope (offset by 0.5 and halved), blue is the lightness at that
   spot. Read with the same `measure-reference.mjs --channel=`, works on both platforms.
4. **Only after all that** — the shader itself.

The order isn't arbitrary: it goes from what's cheapest to check and most often at fault. Twice
in a row the measurement turned out to be at fault, never the shader.

## A trap this has already burned on

The web probe reads the lightness grid through a PBO gated by `fenceSync`, and that fence only
fires once the page yields control back to the event loop. A batch run that never yields to the
event loop will NEVER get a probe reading — and the whole measurement silently, plausibly falls
back to the shader's fallback path (`u_probeLuma = -1`). Write-up — lab entry E-49.

That's why both the gate and the measurement draw frames with `setTimeout(0)` between them. Any
new batch render run must do the same.
