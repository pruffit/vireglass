# Benchmarks

Consolidated from the measurement series run between August and September 2026. The raw
per-run logs stay in the private development repository; what follows is the protocol, the
device, and every number that is still valid.

## Everything measured before 2026-08-31 is void

The capture node never received `setPosition`, so it had no bounds and the lens was sampling
emptiness. The optics had nothing to compute. The conclusions drawn on that pipeline — "no
frame regression" and "up to six surfaces" — cannot serve as a baseline, and the numbers below
all come from the re-measurement of 31 August or later.

This failure is worth stating plainly because of *how* it hid: a noise metric praises a clean
render and an empty one identically. That is why a measurement is always taken as a **pair** —
lightness inside the glass against the same patch of screen just outside it. Zero difference
between the two means there is no glass in the frame at all.

## Rules, without which a measurement means nothing

1. **Physical device only.** An emulator inflates GPU cost by roughly 20× (a desktop iGPU
   through translation). It is fine for checking *correctness* and useless for *cost* — not
   even to an order of magnitude.
2. **Release build only.** In debug, Metro serves the JS bundle and something other than the
   real thing lands in the frame.
3. **The backdrop must be moving.** On a static scene the blur view does not re-capture
   content, and the frame counter never fills.
4. **The glass must sit outside its own capture target.** Inside it, the RenderNode tree closes
   on itself and the runtime crashes — see `adr-001-rendering.md` §2.
5. **Record the display refresh rate.** The frame budget follows from it: 120 Hz → 8.33 ms.
6. **Record power state and temperature.** Charging and heat both move the result.
7. **Check the lens has something to show** — the paired measurement above.

Warm up for six seconds after changing configuration, then reset the counters: otherwise shader
compilation, first backdrop initialisation and layout all land inside the window. Three repeats
per configuration, two independent passes. One run is not a measurement — a single pass once
showed six surfaces at 16 ms and looked like a 5 ms win; it was an outlier taken on a colder
phone, and repeats did not reproduce it.

## Reading the counters

Three traps, all of them specific to this ROM and all of them capable of producing a confident
wrong answer:

- **`Total frames rendered` is doubled** on HyperOS / Android 16. Divide by two. The check:
  `Number High input latency` is exactly 2× the frame counter. Raw timeline rows give an
  interval of 8.29–8.30 ms between neighbouring vsyncs — exactly 120 Hz.
- **The GPU percentile is not frame time.** It is the time the GPU finished its work by fence.
  The pipeline holds about three frames in flight, so GPU time exceeds the frame budget freely
  without a missed vsync.
- **`Janky frames` judges against the app's own deadline**, which is 10 ms rather than 8.33, and
  some frames have no deadline at all. A drop from 120 to 72 fps happens at 0.00 % janky.
  **Judge by frame rate, not by jank.**

The scene itself is validated objectively: the layer dump prints one GL layer per glass surface,
and the layer count has to match the number of surfaces requested.

## Reference device

| | |
|---|---|
| Device | Xiaomi 2311DRK48G (duchamp), Android 16 |
| Display | 1220 × 2712 at density 3.0 — 406 × 904 dp, 120 Hz active |
| Frame budget | 8.33 ms |
| Build | release, signed |
| Power | on battery, not charging |
| Temperature | recorded per run, 31–36 °C across the series |

One mid-range device. The threshold on weak hardware is certainly lower and has not been
measured.

## Cost by surface count

First valid measurement, 31 August, abstract circles over a moving backdrop:

| scene | GPU p50 | frame p50 | frame p90 |
|---|---|---|---|
| control, no glass | 5 ms | 11 ms | 16 ms |
| 1 surface | 4 ms | 10 ms | 13 ms |
| 2 surfaces | 5 ms | 12 ms | 16 ms |
| 3 surfaces | 7 ms | 14 ms | 18 ms |
| 6 surfaces | 8 ms | 16 ms | 21 ms |
| product stack | 7 ms | 17 ms | 26 ms |

**About 0.8 ms of GPU per surface**: 4 ms at one, 8 ms at six. The growth is linear, with no
threshold in the measured range.

**At three surfaces the budget is half spent** — 7 ms of 8.33. There is headroom, but it is not
double. Three is the confirmed product maximum; a fourth needs its own measurement.

**The saturation point was never found.** The earlier claim of a cliff at the seventh surface
comes from the voided series and could not be re-tested: the lab scene lays surfaces out in a
column, and at six they already reach the screen edge.

**The product stack costs more in frame time than six abstract circles** (p90 26 ms against 21)
while using *less* GPU (7 against 8). It is bound by CPU, not GPU — a live list, cover art and
real panel layout. The optics have nothing to do with that.

**The backdrop probe does not show up in the frame budget.** It renders a 48 × 96 grid every
180 ms on a background thread; the difference between the control and one surface (5 ms against
4 ms of GPU) is enough to say its contribution is not visible.

## Cost depends on the scene, not only on the count

A later run (14 September) over a patterned canvas with motion enabled:

| surfaces | GPU p50 |
|---|---|
| 1 | 6 ms |
| 2 | 7–8 ms |
| 3 | 8 ms |
| 6 | 19–21 ms |

One, two and three agree with the 31 August run (6/8/8 against 4/5/7). Six cost 20 ms here
against 8 ms there — a different scene, not a regression: the pre-change build gives the same
21 ms. Since the product never lays out more than three surfaces, the budget conclusion from
31 August stands.

That run also confirmed that the changes it was testing cost nothing measurable: both builds
reproduce themselves between passes, and the difference between them sits inside the spread of
a single pass.

## Platform parity

Circle of 120 dp, base material, ink disabled on both sides, web captured at the device's own
parameters. Body lightness offset from the backdrop, in 0–255 units:

| canvas | web bench | phone | gap |
|---|---:|---:|---:|
| flat | +7.3 | +15.5 | 8.2 |
| stripes | +43.2 | +46.1 | 2.9 |
| busy | +36.4 | +36.8 | 0.4 |
| bar | +3.3 | −0.9 | 4.2 |
| steps | +12.6 | +18.9 | 6.3 |
| edge | +177.0 | +176.9 | 0.1 |
| gradient | +32.8 | +38.3 | 5.5 |
| grid | −5.0 | −5.0 | 0.0 |

All eight within tolerance; the largest gap is 8.2 on `flat`. That canvas is the hardest to
compare — it carries the least signal, while the element still has to satisfy the presence
requirement.

### The emulator reproduces the phone — for correctness

Same run on an emulator at a different stage size and density:

| canvas | emulator | phone | difference |
|---|---:|---:|---:|
| flat | +15.5 | +15.5 | 0.0 |
| stripes | +43.7 | +46.1 | 2.4 |
| busy | +36.8 | +36.8 | 0.0 |
| bar | −1.0 | −0.9 | 0.1 |
| steps | +17.1 | +18.9 | 1.8 |
| edge | +177.0 | +176.9 | 0.1 |
| gradient | +38.3 | +38.3 | 0.0 |
| grid | −4.8 | −5.0 | 0.2 |

Within 2.4 units, and on five canvases of eight down to a tenth. Part of even that comes from
the stages being different sizes rather than from the platform. **Correctness parity can be run
on an emulator; frame cost still cannot.**

## Reference comparisons

A series comparing the material against its reference footage, one property per run. What the
gap was, and what closed it:

| what was compared | finding | outcome |
|---|---|---|
| Refraction against reference | element profile diverged | closed |
| Scattering against reference | the scatter layer erased the environment reflection entirely before it reached the frame | reflection restored ahead of scatter |
| Edge light against reference | the rim's light spread into the band it shares with the content | rim spread removed by a gate |
| Body tint against reference | tint on a lightness break | closed |
| Matte lift against reference | matte held its lift over any backdrop; the rim still tracked the backdrop | partially closed |
| Shadow against reference | the shadow darkened at the outline rather than in the gap under the element | moved into the gap |
| Shadow adaptation | shadow density lived only in the web renderer | moved into the core, so Android adapts too |
| Bevel grazing angle | the divergence conclusion did not survive a correct frame | withdrawn |

One of these deserves its own note, because it is a negative result about the measurement
rather than the material. A residual divergence had been attributed to a specific multiplier in
the lens. Re-measuring along five directions after that multiplier was removed gave the same
numbers as before — the change moved nothing measurable. It is safe, and it is also
unjustifiable by measurement: none of the existing probes reach the transition band where it
lives. The residual holds at 1–3 units, inside tolerance and next to the noise, and its old
explanation is no longer supported.

## Not measured

- Weak hardware. One mid-range device was tested; the threshold is certainly lower.
- 60 and 90 Hz.
- Sustained load beyond about eight minutes, and battery drain.
- Whatever happens at the seventh surface.
