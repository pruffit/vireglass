# VireGlass — current architecture map

**Date:** 2026-08-31 (updated after auto-adaptation) · **Method:** reading the code
**Status:** describes what's actually in the repository.

---

## 1. Layout

| File | Layer | Role |
|---|---|---|
| `src/material.ts` | model | `VireGlassMaterial`, ranges, presets, toggles, debug modes |
| `src/optics.ts` | model | the physics: causes → the values the shaders consume |
| `src/geometry.ts` | model | shape in dp and its derived quantities (bevel, offset, view padding) |
| `src/sdf.ts` | model | the shared SDF text both shaders build on |
| `src/adaptation.ts` | model | backdrop sampling → ink polarity (the recolor decision) |
| `src/surface-shader.ts` | shaders | the SKSL surface shader, built on the shared optics |
| `src/lens-shader.ts` | shaders | the AGSL lens shader, built on the shared optics, shipped to native as a string |
| `src/adapters.ts` | bridge | material + geometry → view props and SKSL uniforms |
| `src/web/renderer.ts` | web | the WebGL2 pipeline: scene, blit, probe, lens, surface |
| `src/native/environment.ts` | bridge | sensor → filter → light direction |
| `src/native/glass-ink.tsx` | JS | hands polarity down to the surface's children |
| `src/native/glass-surface.tsx` | JS | layer composition: backdrop, lens, canvas |
| `src/native/lens.ts` | JS bridge | prop types, SDK gate, fallback |
| `src/native/provider.tsx` | JS | host policy: glass toggle, motion, backdrop suppression |
| `android/.../GlassLensView.kt` | native | compiles the AGSL it's handed + `RenderEffect` |
| `android/.../GlassBackdropView.kt` | native | captures the frame into a RenderNode + probes backdrop lightness |
| `android/.../GlassLensModule.kt` | native | registers the views, the uniform channel, the measurement event |

Three things this map names but does not ship, because they belong to the host app rather than
to the material: the production button built on the surface (gestures, icon mask), flat panel
glass (a blur view plus gradients, never wired to the material model), and the blur-target
context that guards against putting glass inside its own capture target. The mobile lab's frame
meter is a development tool and stays private too — see `benchmarks.md` for what it measured.

In the app this was built for, the material carries the tab bar, the mini player, sheets and a
handful of screens — chrome, in other words, never content. That is not a style preference; it
follows from §2 below.

---

## 2. The actual layer stack

```
┌─ Skia Canvas (SKSL)        surface: shadow, bevel, absorption at the rim, highlight, icon
├─ GlassLensView (AGSL)      RenderEffect on the view: refraction, both aberrations, dispersion,
│                            environment reflection, diffraction, interference, the glass BODY
└─ host View                 positioning, gestures

    GlassBackdropView        a separate view wrapping the screen's background: writes the frame
                             into a RenderNode and, every 180 ms, samples a 48×96 lightness grid off it
```

**The key detail that everything else follows from:** the lens draws the backdrop ITSELF —
`canvas.drawRenderNode` on the node that `GlassBackdropView` wrote — and `RenderEffect`
transforms what's already been drawn. The backdrop used to come from expo-blur's `BlurView`, but
that returned a dithered copy (lab entry E-30). The node must have `setPosition` set: without
bounds it draws nothing, and the lens samples emptiness while still reading "clean" on every
noise metric (E-34).

**The lens computes the glass body, not the surface.** Density, tint, and highlight all depend
on what's under the glass, and only the lens can see that: the surface is drawn on top of it and
has no backdrop of its own at all. As long as the tint lived in the surface, it was forced to be
uniform across the whole element.

---

## 3. The material model and its boundary with the renderer

```
VireGlassMaterial + VireGlassGeometry      WHAT the glass is
            │
            ├── toLensProps ──────────►    GlassLensView props  ┐
            └── toSurfaceUniforms ────►    SKSL uniforms         ┴ HOW Android draws it
```

The material knows nothing about Android or Skia. Values in dp are computed by the geometry
module (`src/geometry.ts`); the dp→px conversion for the lens is done
by **JS** (`PixelRatio`), while SKSL works in dp by construction of the canvas.

The lens's uniforms travel over ONE channel — `uniformNames`/`uniformSizes`/`uniformValues`.
There's no separate `Prop` per value: an unknown prop is swallowed silently by Expo, and the lens
simply doesn't turn on (E-01, E-35). The only uniforms left on the native view itself are the
ones only it knows: its own size, its own place on screen, and the probe reading.

**Effect toggles are parameter zeroing**, not shader variants: `refraction: false` yields
`refraction = 0, refractionScale = 1`. That way an ON/OFF comparison runs on one and the same
program. Exceptions: `backdrop` (the `BlurView` isn't mounted at all) and `blur` (intensity 0) —
those are resolved in the component.

---

## 4. Geometry is computed once

A shared SDF snippet (`src/sdf.ts`) is concatenated into both
shaders; the AGSL source itself is assembled in TypeScript and handed to `GlassLensView` through
the `shaderSource` prop (Kotlin compiles it and caches by the string's value). There is
deliberately no built-in copy of the AGSL in Kotlin.

All the edge quantities are derived from the shared geometry:

| Quantity | Source | Feeds |
|---|---|---|
| `sd` | `vgScene` | the mask, the shadow, early-out |
| `t` = `vgBevelT(sd, bevel)` | from `sd` | thickness, refraction, both aberrations, rim width, the highlight mask |
| `n` | `vgSceneNormal` | the direction of the rim arcs, the sampling offset |
| `N` = `(n · slope(t), 1)` | from `n`, `t` | Fresnel, the highlight |

The earlier gaps noted in this document (the Phase 2 revision) are closed:

- **Gap 1** (geometry duplicated, `BEVEL` set by hand) — closed: there is one SDF text, and the
  bevel comes from the material.
- **Gap 2** (the surface only handled a circle) — closed: the surface now works on a rounded
  rectangle, with circle and capsule as its special cases.
- **Gap 3** (deformation synced by hand) — **still open**: the inverse deformation in SKSL and
  the live-backdrop transform are still two implementations of one and the same law. Both live
  side by side in `glass-surface.tsx` (`src/native/glass-surface.tsx` in the package), sharing one
  `MAX_STRETCH` constant.

---

## 5. Lifecycle and constraints

- **Version gate:** `createRuntimeShaderEffect` needs Android 13+ (SDK 33). Below that, an
  affine magnifier is used instead. The gate is exposed to JS as the `isGlassLensSupported`
  constant.
- **View padding is computed, not given as a coefficient:** `lensPadDp` = sampling offset + both
  aberrations + margin; `surfacePadDp` = shadow overhang + drag travel. The old `OVERSCAN = 1.55`
  and `PAD_RATIO = 0.44` used to be constants independent of the material.
- **Don't touch `visibility`:** `dimezisBlurView` stops capturing when the view is hidden, and
  doesn't revive on its own. Hiding is only safe when the shader is entirely absent.
- **A JS↔Kotlin prop-name mismatch is swallowed silently by Expo** — that's exactly how
  refraction ended up switched off in production for an entire phase. Closed by a parity test
  that parses `GlassLensModule.kt` and `GlassLensView.kt` (a test in the app's own test suite).
- **RenderNode recursion:** a blur target must not contain the `BlurView` itself, or the tree
  closes on itself (`SIGSEGV` on the RenderThread). Guarded by `BlurTargetScope`.
- **Consequence of that guard:** glass **inside** the target screen doesn't get the real effect
  and degrades to a semi-transparent slab. Today only the tab bar and the mini player get real
  glass.
- **An AGSL compile error** is caught and logged; a uniform mismatch is caught separately
  (`setFloatUniform` on a name that doesn't exist throws `IllegalArgumentException`).

---

## 6. CPU/GPU boundaries

| Work | Where |
|---|---|
| Icon mask (offscreen Skia surface, `makeNonTextureImage`) | CPU/GPU, once per icon change |
| AGSL compilation | once per change of the shader text (cached by string) |
| Uniforms, springs, gestures | CPU (Reanimated worklets, UI thread) |
| Accelerometer filter | CPU, 20 Hz, only when `environment > 0` |
| SKSL surface | GPU, every frame |
| Backdrop capture (`dimezisBlurView`) | redraws the view tree, **per glass element** |
| Blur | RenderEffect inside `BlurView` |
| AGSL lens, 6 samples per pixel | GPU, every frame |
| Morphing: normal via finite differences | GPU, +4 SDF evaluations per pixel, bench only |

**Only partially measured.** The Phase 2.1 run (`docs/benchmarks.md`) measured the pipeline
**without** RenderEffect — the lens wasn't switched on yet at that point. The cost of Material v1
has not been measured.
