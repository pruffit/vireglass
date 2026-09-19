# VireGlass

A liquid glass material for interfaces, derived from optics rather than assembled from effects.

One material model, one shader source, two render targets: **WebGL2** in the browser and
**AGSL** on Android. Apache-2.0.

```bash
npm install vireglass
```

---

## The idea

Most glass effects are a stack of knobs: blur radius, rim brightness, rainbow strength, a
highlight slider. Every knob is independent, so most of the combinations you can dial in
describe glass that does not exist — a razor-thin bevel with a dense white rim, a rim whose
optics scale with the element's size.

VireGlass exposes **causes** and derives the rest:

```ts
import { resolveOptics } from 'vireglass';

const optics = resolveOptics({
  ior: 1.5,        // index of refraction — water 1.33, glass 1.5, sapphire 1.77
  thickness: 20,   // dp
  bevel: 10,       // dp, absolute: a real rim doesn't scale with the piece
  roughness: 0.12,
  film: 0,         // thin-film thickness, nm — iridescence
});
```

Those turn into the values the shaders need — refraction strength, magnification, Fresnel,
specular, dispersion, diffraction, interference, medium tint, body density, ambient colour
pickup. There is no "rainbow strength" knob because dispersion, diffraction and interference
are one cause (wavelength dependence) and one hue multiplier, normalised to its own mean: they
tint the reflection without brightening it.

Dispersion follows Cauchy, absorption follows Beer–Lambert, reflectance follows Schlick. Where
the model departs from physics, the comment says so and says why.

## Presets

```ts
import { MATERIAL_PRESETS, resolveOptics } from 'vireglass';

resolveOptics(MATERIAL_PRESETS.crystal);
```

`water` · `glass` · `crystal` · `frosted` · `thick` · `thin` · `iridescent` — points in the
space of causes, not bundles of finished effects.

## Web

```ts
import { createVireGlassRenderer } from 'vireglass/web';
import { resolveOptics, roundedRectGeometry, MATERIAL_PRESETS } from 'vireglass';

const renderer = createVireGlassRenderer(canvas);
renderer.resize(canvas.width, canvas.height);

renderer.render({
  density: devicePixelRatio,
  debug: 'normal',
  scene: (ctx, width, height) => {
    ctx.fillStyle = '#12141a';
    ctx.fillRect(0, 0, width, height);
    // ...draw whatever the glass should refract
  },
  pieces: [
    {
      optics: resolveOptics(MATERIAL_PRESETS.glass),
      geometry: roundedRectGeometry(220, 120, 32),
      centerX: canvas.width / 2,
      centerY: canvas.height / 2,
    },
  ],
});
```

`render` also returns one backdrop probe per element — mean lightness, 10th/90th percentiles
and variegation of what lies under it. That is what the adaptation layer reads.

> **WebGL does not see the DOM**, so this renderer refracts only what it drew itself — hence the
> `scene` callback. For glass over your actual page, use `vireglass/dom` below.

## Live DOM

```ts
import { attachGlass } from 'vireglass/dom';

const glass = attachGlass(document.querySelector('.player'), {
  material: MATERIAL_PRESETS.glass,
});
// glass.update() after a scroll or a theme change, glass.destroy() on unmount
```

The element now refracts the real page behind it. No canvas, no duplicate render of your UI.

It works by handing `backdrop-filter` an SVG filter whose `feDisplacementMap` bends the backdrop
along a map derived from the same material model the other renderers use. The browser never gives
the page's pixels to script — that boundary is what stops a page reading your cross-origin frames
and visited links — so the displacement happens inside the compositor, where the pixels already are.

It carries the material, not a corner of it: refraction with per-channel dispersion, the rim with
its two opposing arcs and dark edge, the adaptive shadow, the body under legibility and presence,
and the finger response — press, drag, the release wave and the rise into glass.

```ts
glass.setMorph({ smoothing: 34, shape: { offsetX: 150, offsetY: -78, width: 170, height: 92, cornerRadius: 28 } });
```

Two shapes joined through the smooth union — §5's merging and splitting. What the shapes mean is
your choreography; the material only knows how two silhouettes join.

`attachGlass` writes CSS custom properties you can use directly:

| | |
|---|---|
| `--vireglass-ink-color` | ink colour for this backdrop, already resolved |
| `--vireglass-body-color` | the glass body: density from the model, hue from the surroundings |
| `--vireglass-tint-color` | ambient colour alone |
| `--vireglass-rim`, `--vireglass-rim-width` | the hairline's gradient, applied for you |
| `--vireglass-shadow` | the adaptive shadow, also written to `box-shadow` unless you opt out |
| `--vireglass-radius`, `--vireglass-radius-min` | for concentric children (§11) |
| `--vireglass-ink`, `--vireglass-tint`, `--vireglass-body-density` | the model's raw numbers |

The three system accessibility settings are read from the browser's own media queries and
followed while the page is open — reduced transparency frosts the glass, increased contrast takes
the element by its silhouette, reduced motion holds it still. A system setting outranks the
material preset and the user's own clarity slider (`scale`), because the user needs contrast more
than they need the look.

Three things to know before you reach for it:

- **It renders the whole material.** Refraction with per-channel dispersion, the rim with its two
  opposing arcs and dark edge, the adaptive shadow, the body under legibility and presence, the
  finger response, and the spectral edge — diffraction and interference baked into a hue map and
  multiplied in, since a filter graph cannot evaluate a function per pixel but can multiply by an
  image.

- **The refraction is Chromium-only today.** Firefox does not support a filter reference in
  `backdrop-filter` and has closed the request as not planned; Safari does not yet, though WebKit
  has patches in flight. Elsewhere `attachGlass` falls back to blur, saturation and tint from the
  same optics — detected by measurement, never by user-agent string.
- **There is no pixel probe, so adaptation reads declared styles.** The grid under the element is
  sampled through `elementsFromPoint` and the background stack is composited. That is exact for
  colour-defined surfaces and blind to images, video and canvas — pass your own `sample` there,
  since your app already knows its cover-art accent.

## Android / React Native

```tsx
import { VireGlassProvider, VireGlassSurface } from 'vireglass/native';
```

The Android target is an Expo module: `expo-module.config.json` ships in the package, so
autolinking picks up the Kotlin in an Expo app and stays silent everywhere else. Run
`expo prebuild` after installing. `vireglass/native` ships as **source** on purpose — the
surface uses a Reanimated worklet, and worklets are compiled by the consumer's Babel plugin.

`VireGlassProvider` is optional. Mount it to give the host app an escape hatch:

```tsx
<VireGlassProvider glassEnabled={settings.glass} reduceMotion={settings.reduceMotion}>
  <App />
</VireGlassProvider>
```

Without it, everything works on sensible defaults.

## How the glass decides what to be

Three loops, all automatic, all in the core and shared by both platforms.

**The body adapts to the backdrop by a gradient, not a number.** The probe returns a plane of
lightness — a slope along each axis — so the glass separates itself from the ink at *every*
point of the element: it darkens harder over the bright half and barely touches the dark one. A
plane is the crudest model that can express "one half is brighter than the other", and the only
one that is smooth by construction. A point estimate at a density break produced ghost copies
of the text underneath.

**Density adapts to variegation.** Fine texture — a checkerboard, a line of type — cannot be
described by a plane, so density rises as a whole, driven by the lightness range. This is what
real glass does with roughness: it stops being a window.

**Presence.** Over a uniform backdrop there is nothing to refract, and the glass honestly
disappears. Correct for a piece of background, wrong for a control. `presence` sets a minimum
lightness separation from the backdrop, and the sign is taken from the *backdrop*: lighter over
dark, darker over light.

Ink polarity is decided by the **cost of holding it**, not by contrast: how much body density
it would take to keep light ink legible. Above the threshold the element would stop being glass
and become a painted plate, and the decision passes to the app. Contrast is the wrong measure —
it also collapses on saturated yellow, and light icons kept flipping to dark over coloured
blocks.

## React

The core is dependency-free on purpose, so the one piece that needs hooks lives behind its own
entry point:

```ts
import { useGlassAdaptation } from 'vireglass/react';
```

It carries the confirmation policy and the recolor fade. The decision itself —
`shouldInkBeLight` — is a pure function in the core, shared by every platform.

## Accessibility

`applyAccessibility` maps the three system settings — reduced transparency, increased contrast,
reduced motion — onto the material. They set floors and they win over the user's clarity
preference; `applyGlassScale` gives that preference its own axis, ultra clear to fully tinted.

## Quality gates

```bash
npm run typecheck
npm test             # 244 tests
npm run check:glsl   # both shaders compile and link as GLSL ES 3.0
npm run check:optics
npm run check:law    # every calibrated number is in src/law.ts, cited or named unmeasured
npm run check:dom    # a real browser: the glass bends live DOM, and only where it should
```

`check:optics` is the interesting one. It renders the material over a sweep of backdrops and
asserts that the glass stays **both a window and an object**: enough of the backdrop's lightness
range survives inside the element, and the element stays visible against it — across the whole
range, not at a convenient value. It also checks that ink under a finger defocuses, that a
raised element separates from its backdrop, that ink and content both survive over a busy
canvas, and that the rim gathers what is behind it.

## Limits — read these before adopting

- **Glass over live DOM refracts in Chromium only**, and falls back to blur elsewhere. Its
  adaptation reads declared styles rather than pixels, so images and video need a supplied
  `sample`. See *Live DOM* above.
- **Refraction needs Android 13+** (`RenderEffect`). Below that it degrades to an affine
  magnifier: a loupe, not a lens.
- **No iOS.** There is no public API for reading what is behind a view.
- **Real glass only works outside a capture target.** You cannot put glass inside the node it is
  capturing — the RenderNode tree closes on itself and the runtime crashes. In practice that
  means chrome (tab bars, mini players), not content. See `docs/adr-001-rendering.md` §2.
- **Budget: about 0.8 ms of GPU per surface**, growing linearly — 4 ms at one surface, 7 at
  three, 8 at six, against an 8.33 ms frame budget at 120 Hz on the reference device. Three is
  the confirmed product maximum. Six is where the budget runs out, not a measured cliff: the
  saturation point was never found. Cost also depends on the scene, not just the count. Do not
  judge frame cost on an emulator — it inflates GPU cost roughly 20× (it does reproduce the
  phone closely for *correctness*, within 2.4 units across the reference canvases).
- **The probe cannot see texture finer than a 22 px cell.** Below that it averages, and the
  glass treats the backdrop as uniform.
- **Interference (`film`) derives a value but produces no visible iridescence yet.** Known,
  unexplained.
- Editing a shader needs an app restart on Android, not just Fast Refresh: the source travels as
  a prop out of a memoised adapter.

## Documentation

| | |
|---|---|
| `docs/reference.md` | what the material was calibrated against, and what each number must satisfy |
| `docs/architecture.md` | layers, parameters, limits |
| `docs/adr-001-rendering.md` | the rendering architecture decision and its evidence |
| `docs/platform-parity.md` | how web and Android are kept numerically in agreement |
| `docs/benchmarks.md` | measurement protocol, device, numbers |
| `docs/dom.md` | the DOM renderer: the technique, what it renders, what it costs |
| `docs/law.md` | where every calibrated number lives, and which ones nobody has measured |
| `docs/material-lab.md` | selected entries from the experiment journal |

## Calibration

The material was measured against publicly available reference material — Apple's WWDC 2025
sessions 219 and 356 and related design talks — and the documentation cites them by session and
timestamp so the claims can be checked. No Apple code, assets or footage is included in or
distributed with this package.

Every calibrated number lives in `src/law.ts` with its provenance, and `check:law` names the ones
that have none: **41 of 113** today. See [`docs/law.md`](docs/law.md).

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

The patent grant is deliberate: this is an optical algorithm, not glue code.
