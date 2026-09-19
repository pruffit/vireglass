# ADR-001 — VireGlass rendering architecture on Android

**Date:** 2026-08-28 · **Updated:** Phase 3.1, a dense measurement pass and metric breakdown
**Status:** **decision made — KEEP CURRENT ARCHITECTURE + DEFINE USAGE LIMITS**
**Basis:** experiments, not reasoning

> ## The one-line result
>
> **The current architecture holds up to six simultaneous glass surfaces.** On a
> Dimensity 7200 Ultra in a release build, 1–6 surfaces sustain 113–120 fps at 4–7 ms GPU
> time; from the seventh surface on, saturation sets in and the frame rate drops. The cost
> scales with the **number** of surfaces, not their area. VireMusic's real-world maximum (3)
> sits well inside the working range, so investigating a shared backdrop **isn't justified
> right now**. Full breakdown — §8.
>
> Classification of the sections below: **[E]** — emulator data, **[D]** — physical
> device, **[I]** — inference, **[?]** — unknown.
>
> **Amendment, 2026-08-29 (Phase 3).** The §5 measurement was taken in a state where the
> AGSL lens was in fact not being applied at all (a JS↔Kotlin prop-name mismatch, lab entry
> E-01). This **doesn't affect** the decision: the measurement was of the cost of backdrop
> capture — exactly what a shared HardwareBuffer was being considered for — and that cost
> turned out to be negligible. But the claim "10 surfaces = 0% dropped frames" applies to the
> pipeline without refraction.
>
> The full pipeline was measured on 2026-08-29 (`docs/benchmarks.md`): dropped frames are
> still zero across every configuration, but at 10 surfaces GPU p50 climbed to 17 ms against
> an 8.33 ms budget — the app draws less often rather than dropping frames. This doesn't
> change the KEEP decision: the product's working point (1–3 surfaces) is indistinguishable
> from the control, and the lens optics themselves are free — what's expensive is backdrop
> capture, exactly as §5 claimed.
>
> **Amendment, 2026-08-31.** Everything above was measured on a pipeline where the capture
> node had no bounds, so the lens was sampling emptiness (lab entry E-34). The KEEP decision
> survives — it rests on the cost of backdrop capture, which was real — but two numbers in
> the one-line result do not. The re-measurement gives about 0.8 ms of GPU per surface (4 ms
> at one, 7 at three, 8 at six against an 8.33 ms budget), and **the saturation point was
> never found**: the lab scene lays surfaces out in a column and at six they already reach
> the screen edge, so "from the seventh surface on" could not be re-tested at all. Read the
> frame-rate figures above as history, and `benchmarks.md` as the current numbers.

---

## The problem

The question was whether `RenderEffect` could replace the current path for obtaining the
background (`dimezisBlurView`), and whether Android lets the expensive work of capturing the
background be shared across several glass surfaces.

Before this sprint, an earlier architecture audit had recorded a recommendation to replace
`dimezisBlurView` with `createChainEffect(runtimeShaderEffect, blurEffect)`. **This ADR
overturns that recommendation** — see §3.

---

## 1. What the current renderer does

```
┌─ Skia Canvas (SKSL)        surface: shadow, bevel, Fresnel, highlight, rim, icon
├─ GlassLensView (AGSL)      RenderEffect on the view, the shader refracts its own content
│  └─ BlurView (dimezis)     child: draws the screen's content INTO ITSELF via blurTarget
└─ host View                 positioning, gestures
```

The background reaches the shader **not through `RenderEffect`**, but through the `BlurView`
child: `RenderEffect` hands the shader the content of its own node together with its children,
and the children already contain the captured background.

Full map — `docs/architecture.md`.

---

## 2. Bottlenecks in the current renderer

| Bottleneck | Evidence | Status after the on-device measurement |
|---|---|---|
| Background capture isn't reused across glass elements | architectural: every glass element gets its own `BlurView` | **true, but the cost is negligible** — [D] ~0.2–0.3 ms per surface |
| ~~Cost scales linearly, ~4.3–5.2 ms per glass element~~ | [E] `docs/benchmarks.md` | **disproven** [D]: overstated by ×20 |
| **Glass can't sit inside its own capture target** | deterministic `SIGSEGV` in `prepareTreeImpl` | **still stands** — the main remaining constraint |
| Shape geometry is computed twice (SKSL and AGSL), `BEVEL` set by hand | `docs/architecture.md` §3 | still stands |
| The surface shader only handles a circle, the lens a rounded rectangle | same source | still stands |

**[I]** After the on-device measurement, the list of bottlenecks shrank to one meaningful
one — the **topological ban** on glass sitting inside its own target. Performance dropped off
the list of problems.

Product consequence of that last constraint: **today only the tab bar and the mini player get
real glass**, since they live outside the screens. Inside screens, it deliberately degrades to
a semi-transparent slab.

---

## 3. What `RenderEffect` actually gives you

**What it gives you:** a shader transform of a node's already-drawn content (the view plus its
children). Chains (`createChainEffect`), blur (`createBlurEffect`, API 31), arbitrary AGSL
(`createRuntimeShaderEffect`, API 33).

**What it does NOT give you: access to the pixels UNDER the view.**

### Proof — an experiment, not documentation

The rig: the mobile lab's test screen, with a `GlassProbeView.kt` probe. Under the probe sit
three colored stripes. The probe's shader returns the sample as-is.

| Case | mode 0 (raw sample) | mode 2 (alpha map) | Conclusion |
|---|---|---|---|
| **A** — probe with no children | the probe isn't visible at all | **solid black** | alpha 0 reached the shader everywhere |
| **B** — probe with a `BlurView` inside it | a rectangle is visible | black + a **gray rectangle** the size of the view | the child's content came through |

Mode 2 renders alpha as opaque, which removes the main ambiguity: in case A the shader **did
run** (it painted over the area, the stripes disappeared) while still receiving nothing. The
logs confirm the effect was applied in both cases (`GlassProbe: effect applied: 525x315`).

One side finding: the shading area **isn't confined to the view's bounds** — the mode 1 marker
covered the entire parent area. Hence the need for `OVERSCAN` and clipping the shape inside the
shader itself in production.

**So the audit's §18 recommendation is wrong:** `createBlurEffect` in a chain would have
blurred the view's own (empty) content, not the background. `dimezis` can't be replaced with
`createChainEffect` — there's nothing to replace it with, since in this scheme `RenderEffect`
isn't a source of the background, only a transformer of it.

---

## 4. Can the background be shared between surfaces

Not with `RenderEffect`'s own means. But it's achievable on the platform — there are working
precedents:

| Project | Mechanism |
|---|---|
| `imla` | captures the Compose root into a `HardwareBuffer` → zero-copy import into a GLES texture → layers sample **one shared** backdrop |
| `haze` | explicit marking of a source (`hazeSource`) and an effect (`hazeEffect`); by the author's own account, based on Chet Haase's "RenderNode for Bigger, Better Blurs" technique |
| `dimezis` (current) | manually redraws the view tree into a bitmap, **per surface** |

What all three share: **the capture source has to be assigned explicitly.** None of them have
ambient access to the background on Android. The current `blurTarget` is the same idea as
`hazeSource`.

The difference is that `imla` and `haze` capture **once** and reuse it, while `dimezis` does it
per glass element. That's exactly what the linear-growth measurement showed.

---

## 5. Decision — KEEP CURRENT IMPLEMENTATION

**[D] The on-device measurement removed the grounds for investigating a shared backdrop.**

Xiaomi 2311DRK48G, Dimensity 7200 Ultra, Android 16, **release build**, **120 Hz** (8.33 ms
budget), two independent runs of 3 repeats per configuration. Full data —
`docs/benchmarks.md`.

| Surfaces | GPU p50 | janky % | Missed Vsync | Frame deadline missed |
|---:|---:|---:|---:|---:|
| 0 | 5–7 ms | **0.00** | 0 | 0 |
| 1 | 3–5 ms | **0.00** | 0 | 0 |
| 2 | 4–6 ms | **0.00** | 0 | 0 |
| 3 | 5 ms | **0.00** | 0 | 0 |
| 6 | 7–9 ms | **0.00** | 0 | 0 |
| 10 | 6–7 ms | **0.00** | 0 | 0 |

**[I]** The per-surface increment is **~0.2–0.3 ms**, right at the edge of noise: the control
is sometimes more expensive than one glass surface. The product's working point (2 surfaces:
tab bar + mini player) is indistinguishable from the control. Not a single dropped frame in any
configuration.

**[I] The emulator estimate was overstated by roughly 20×** (4.3–5.2 ms versus 0.2–0.3). The
culprits: a desktop iGPU through translation, and a debug build. Process lesson: the emulator
is good for checking **correctness** (§3), but not for estimating GPU cost, not even to within
an order of magnitude.

### What this changes

- **`dimezis` stays** as the background source. `KEEP`.
- **A shared backdrop (HardwareBuffer) — deferred.** There's nothing to optimize: on real
  hardware the linearity is there, but its coefficient is negligible.
- **The "glass only outside the screen" constraint still stands** — but it's a constraint of
  *topology*, not performance, and a shared backdrop would solve exactly that one. If glass
  inside screens is ever needed, it's worth returning to §4 for that reason, not for speed.

**[?] What the measurement doesn't cover:** one mid-range device; only 120 Hz (60/90 wouldn't
switch via adb on HyperOS); short runs (~4 min under load); the phone was charging; only round
58 dp buttons — large-area panels weren't measured, and blur area directly affects bandwidth.

---

## 6. What remains unknown

Closed in Phase 2.1: absolute cost on real hardware, release build, 120 Hz, heating over a
short run.

Still **[?]**:

- **Low-end hardware.** Only one mid-range device was tested (Dimensity 7200 Ultra). The
  picture may differ on budget GPUs.
- **60 and 90 Hz.** adb doesn't switch the refresh rate on HyperOS; the measurement was taken
  at 120 Hz, the tightest budget, so lower rates should only have more headroom — but that's an
  inference, not a measurement.
- **Large surfaces.** Round 58 dp buttons were measured. Blur area directly affects bandwidth,
  and a full-width mini-player panel wasn't checked.
- **Sustained load.** ~4 minutes under load, temperature 33→36 °C, no throttling. Nothing to
  say about tens of minutes.
- **Battery.** Draw wasn't measured; the phone was on charge.
- **The cost of layer A separately from layer B** wasn't broken out.

---

## 7. Next step

Items 1–2 from the earlier revision (release build, real device) are **done** — see §5. The
decision is made: leave the architecture alone.

What's still open, and when to come back to it:

1. **Large-area panels** (a full-width mini player) weren't measured. Blur area is the first
   thing that hits bandwidth, and only 58 dp buttons were measured. Measure this if glass goes
   onto large surfaces.
2. **Low-end hardware.** Only one mid-range device was tested. If a budget phone turns up, run
   the same protocol on it.
3. **60 / 90 Hz** — switch manually in the phone's settings (adb doesn't do it on HyperOS).
4. **Shared backdrop** — come back to this only if glass is needed INSIDE screens. It's a
   question of topology, not speed.

Performance claims now rest on measurement and are bounded by its scope: one device, 120 Hz,
short runs, round buttons.

---

## 8. Phase 3.1 addendum — measured range and a refined decision

**Date:** 2026-08-29 · Full data — `docs/benchmarks.md`.

The "jump from 6 to 10" anomaly from Phase 3 has been dissected and reframed.

### What was misread

**[I]** The Phase 3 run measured points 1/2/3/6/10 and skipped 7, 8, 9 — exactly the
transition stretch. A dense 0…10 run with three repeats showed **a threshold at the seventh
surface**, not a jump between the sixth and the tenth.

**[I]** `Total frames rendered` **doubles** on this ROM (`Number High input latency` is
exactly 2× the counter; the interval between `IntendedVsync` entries in the raw timeline is
8.30 ms, i.e. 120 Hz). The earlier figure of "~4800 frames in 20 s" meant 120 fps; "~3030"
meant 76 fps.

**[I]** `Janky frames = 0.00%` at a 17 ms GPU time is not a contradiction: the app's
`WorkloadTarget` is **10 ms**, and some frames have `FrameDeadline` removed entirely. Frames
aren't late — the app just draws less often. The drop from 120 to 72 is real and invisible to
the jank metric.

### What was measured

| Range | Surfaces | GPU p50 | fps |
|---|---:|---:|---:|
| GREEN | 1–6 | 4–7 ms | 113–120 |
| YELLOW | 7–8 | 12–14 ms | 101–89 |
| RED | 9+ | 16–18 ms | 80–72 |

**[D] The cost tracks the number of surfaces, not blur area.** A full-width 383 × 320 dp panel
(11.4× a button's area) costs 8 ms and sustains 120 fps; seven buttons with a smaller combined
area cost 12 ms and 101 fps.

**[I] Mechanism.** Every surface carries its own `BlurView`, which redraws the entire capture
target (the whole screen) regardless of the glass element's size. That's exactly the difference
§4 described architecturally: `imla`/`haze` capture once and reuse it, `dimezis` does it per
surface. Now it's measured. **[?]** Why saturation kicks in specifically at the seventh surface
hasn't been established: there's no sign of the GPU cache running out (30 `RenderTarget`
entries, 221 → 230 MB against a 953 MB limit).

**[D] Stability.** 4 minutes under 10 surfaces: 38.8 → 39.4 °C, no throttling, the numbers held
steady. The working point (2 surfaces) right after the stress test: **120.5 fps**.

### The refined decision

> **KEEP CURRENT ARCHITECTURE + DEFINE USAGE LIMITS**

The §5 decision stands; an explicit limit is added to it.

**Limit:** no more than **6** simultaneous glass surfaces per screen. Prefer one large surface
over several small ones — the cost is in the number of surfaces, not in pixels. VireMusic's
real-world maximum (tab bar + mini player + sheet = 3) sits well inside GREEN.

**[?] These bounds come from one mid-range device.** On low-end hardware the threshold is
almost certainly lower; exactly where is unknown.

Return to a shared backdrop only if the product ever needs more than six simultaneous
surfaces, or if the threshold is confirmed to be substantially lower on low-end hardware.
