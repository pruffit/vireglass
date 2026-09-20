# Reference: Liquid Glass from primary sources

A breakdown of how the material looks and behaves in the primary sources — the reference for
any change to VireGlass optics. Anything in the code that diverges from this document counts as
a code defect, not "our own reading."

## Sources

All of these are publicly available. They are cited by session and timestamp so that every claim
below can be checked against the same frame it was drawn from. Nothing from them is redistributed
here, and no footage ships with this package.

| Code | Source |
|---|---|
| M | WWDC25 session 219, "Meet Liquid Glass" |
| D | WWDC25 session 356, "Get to know the new design system" |
| A | Apple, "iOS 26: Introducing Liquid Glass" |
| L | Design Lovers, "Liquid Glass Is Finally Usable (iOS 27)" |
| N | Apple Newsroom, 2025-06-09 |
| H | Human Interface Guidelines, "Materials" and "Color"; SwiftUI `Glass`, `GlassEffectContainer` |
| S | Meet with Apple, session 208, "Showcase: how apps are adopting the new design and Liquid Glass" — 1.5 h, with commentary from Apple's design team |
| B | Tech Talks 111462, "Raise the bar with iPhone Duo" — bars on wide screens |
| P | WWDC26 Platforms State of the Union — the material's rework in iOS 27. **No recording**, text only |
| R | Release notes for iOS 26.1 / 26.2 / 26.4 — the Clear/Tinted choice. **No recording**, text only |

Measurements were taken by extracting frames locally with `ffmpeg`, cropping them, and reading
grid lines under the glass off brightness. That working copy is not part of this repository.

**P and R are sources without a recording**, and that is a different class of evidence: a claim
from them can be quoted but not checked against a frame. Numbers from such sources don't go into
code — only structural rules do.

## 1. The lens — the essentials

- **The center barely displaces the backdrop at all — all the optics live in a band near the
  rim** (M 2:32, a capsule straddling a light/dark boundary). The boundary under the glass at the
  center runs exactly where it does outside.
- **The rim samples the backdrop from INSIDE the shape.** The dark half under the capsule reads as
  a smaller "inset" capsule, and between it and the rim runs a band of light pulled from above the
  horizon (M 2:34, crop of the lower rim). A switch knob lifted into the glass is outlined by a
  thin green line — the green sits inside, under the knob (M 4:12). A button over a Mac against a
  sky background is outlined in orange all the way around, even though outside it, one side is
  clear sky (M 2:52). This is a convex, thick lens; sampling outward would be a concave one, and
  the reference material has none of that.
- **The displacement at the silhouette is on the order of the element's radius**: at a small
  button the image flips near the edge, like in a ball lens (M 2:52, left button).
- **The profile is steep right at the edge**: within a band of about 10% of the smaller
  half-size, grid lines bend and run along the rim (M 0:50, a disc over a grid).
- **Bigger element, thicker glass**: more lensing and refraction, deeper shadow, softer
  scattering (M 7:02–7:25). Bevel and thickness scale with size, they aren't a fixed constant.
- **Appearance is by modulating the lens, not by fading opacity** (M 2:55).

### The displacement, measured off a real lens

frames/crops/disc-ul is a disc over a regular lattice — the one place in the reference where the
lens's own displacement can be read off directly instead of inferred. Tracing the grid line row by
row, following the previous row's answer so the trace stays on the same line as it bends:

- The disc's geometry comes from fitting a circle to its bright rim: centre (687, 612), radius 592
  px, mean residual **0.6 px** over 34 points.
- The grid line stands exactly where the lattice puts it from the bottom of the frame up to y ≈ 286
  — **the middle of the lens passes the backdrop through untouched**, which is the claim §1 rests
  on and which nothing had ever checked against a measured lens.
- From there it sweeps, reaching 36 px of lateral shift before the line breaks up in the caustic at
  the rim. Fitting our own bevel profile to the 26 rows that kept their contrast gives a refracting
  zone **0.18 of the radius** deep and an rms error of **1.1 px — under 0.2% of the radius**.
- A plain linear ramp fits half as well (1.5 px), so the profile is carrying real information and
  not just a scale. A sagitta — `1 − sqrt(1 − t²)` — fits better still (0.29 px), and that is an
  open question rather than a correction: a ray's deflection goes with the surface's SLOPE, which
  is the form we use, and the traced rows stop short of the rim where the two differ most.
- The zone's depth does not transfer. This is a studio puck, and §6 says those show the material at
  its limit; the same fraction on a UI control would be a bevel three times what any preset carries.

### What counts as "larger"

219 @6:36: as glass "flexes and morphs to larger sizes, it simulates a thicker material with deeper
shadows and more pronounced lensing and refraction effects, enhancing perceived depth", and the
session's own summary names the large end — "larger controls like iPadOS and macOS sidebars".

That range has to stay continuous across it. A model that saturates partway stops obeying the rule
exactly where the reference points: a half-open sheet, a full-screen sheet, an iPad sidebar and a
900 px Mac panel are four different surfaces, and they must not be one glass.

Size here is neither the narrower side nor the area. Half the narrower side makes a 390x780 sheet
the same as a 390x420 one; area makes a 900x8 rule larger than a toolbar button. The measure has to
respect both facts — the narrow side caps how much glass there can be, and among shapes sharing it,
more surface is more glass.

## 2. Rim light

- **A thin line along the silhouette**, ~1 pt, not a band and not a bevel (M 2:36, 4K crop).
- **Two opposing arcs**: a bright one faces the light source, the other sits opposite it, weaker
  and with an iridescent fringe of dispersion (M 2:38; A 1:50). The rest of the silhouette is
  outlined by a thin **dark** line.
- **Rim color comes from the environment**: over a yellow flower the rim is yellow, over sky it's
  blue (M 2:46).
- The light **moves** along the silhouette on interaction and with device tilt (M 11:04).
- **iOS 27 added the dark edge as a separate layer**, and it does NOT rule out a highlight: "to
  establish more depth and separation, we also introduced a darkened edge along with brighter
  specular highlights" (P). Before this, the dark line read as "wherever there's no highlight";
  now it reads as "along the whole silhouette, with the highlight on top of it."

### How wide the arc is

Measured off two close-ups of real end caps (frames/crops/cap158-left, cap158-right), sampling the
luminance radially every degree around the silhouette and taking the lift over the local backdrop.

- The bright arc's full width at half its peak is **53°** in the first and **30°** in the second.
  Both arcs saturate to white at the top — 38° of clipping in the first, 9° in the second — so
  those widths are if anything OVERestimates.
- A `cos^n` lobe is `2·acos(0.5^(1/n))` wide, so the two imply exponents of 6 and 20. The model's
  was 3, whose arc is 75° wide: broader than either measurement, with the error in the same
  direction both times.
- One exponent cannot serve both, and the disagreement is not noise. A specular lobe's width
  depends on the light's angular size as much as on the surface, and these are two different
  scenes. The model has no term for the light's size; 6 is the conservative end of what was
  measured.
- The dark edge runs the whole way round, including underneath the bright arc — measured at 12 to
  50 levels below the local backdrop, deepest on the same side the arc is on. Which is the
  reference's own note that the hairline does not rule out the highlight sitting on top of it.

## 3. Body and adaptation (the Regular variant)

- Over a light background: milky-light glass with dark glyphs; over a dark one: smoky-dark glass
  with light glyphs (M 14:50, 15:16). Small elements **switch** wholesale between light and dark;
  large ones (menus, sidebars) don't — they only adjust.
- Tint and **dynamic range** under the glass compress just enough for the label to stay legible,
  letting through as much of the content as possible (M 6:42).
- Regular **blurs** the backdrop: text under a capsule turns into soft blobs (M 11:47).
- The glass **concentrates light**: the body is a bit lighter than the backdrop under it
  (M 2:29; A 1:46, 9:41).
- **Clear**: consistently more transparent, no adaptation, needs a ~35% darkening layer
  underneath it (M 14:16; H).
- **Tinting**: color produces a range of tones tied to the lightness of the backdrop under the
  element, like colored glass (M 16:31). A flat fill in place of a tint breaks the material
  (M 17:03).
- Light **spills** from colored content nearby onto the surface and into the shadow (M 8:09).

### The user-facing opacity slider

- iOS 26.1 offered a CHOICE OF TWO: "the default clear look or a new tinted look which
  **increases opacity of the material**" (R).
- iOS 27 made it continuous: "a new slider in settings to adjust Liquid Glass **anywhere from
  ultra clear to fully tinted**" (P), and apps get it automatically, with no recompilation.
- Design consequence: the material must stay usable ACROSS THE WHOLE RANGE, not at one point.
  Thresholds checked at a single setting say nothing about the range.

### There are two variants, and they don't mix

- Regular is universal and adaptive: it holds legibility on its own, in any context and at any
  size (219 @13:48). Clear is consistently more transparent, has NO adaptation, and the content
  under it shows through almost as-is.
- For Clear, ink legibility is held up by a DARKENING LAYER under the glass (219 @14:16): without
  it, glyphs drown. For small elements the darkening is local — confined to the element itself, so
  the surrounding content keeps its richness.
- Clear is appropriate only when three conditions hold at once (219 @14:46): the element sits
  over media content, the content can tolerate darkening, and the ink on top is large and bold. In
  every other case, use Regular.
- Frames: transport controls over video (219 @14:2x) — the buttons are nearly transparent, each
  with its own dark patch under the glyph, rather than one shared milky film.

## 4. Shadow

Soft, small, **adaptive**: denser over text, weaker over flat light backgrounds (M 11:47).
Literally about what's behind the ELEMENT ITSELF ("aware of what's behind it"), not under the
shadow: one value per element. Measured off frames 711–723: 19.9% over text versus 4.0% over a
flat light background, for the same capsule. The absolute number depends on the element — a
slider knob over white measures 10.5%.

## 5. Interaction

- Touch: the material **lights up from inside, from the point of contact**, the glow spreads
  across the element and onto neighboring glass, and spills onto the backdrop (M 3:38, 12:05; 4K
  frames at 3:48).
- Gel-like elasticity: the element stretches toward the finger and grows under pressure (M 3:51;
  H: interactive "expands").
- Elements **rise into the glass** for the duration of the touch: a switch/slider knob is matte
  white at rest, and under the finger becomes a transparent, enlarged lens (M 4:10–4:30).
- Morphing between states, and merging of nearby shapes into one (M 4:43; H:
  `GlassEffectContainer`).
- The button-to-menu morph is done for ERGONOMICS, not for looks (S, conversation with the design
  team): the menu unfolds right where the button was, so you don't have to regrip the phone for an
  action near the bottom of the screen. So the menu must grow OUT OF its button and stay under the
  same finger.
- The design team names their own model out loud (S 1:25:30): "we also had a refresher from biology
  class. It's called MITOSIS AND MEIOSIS. When these things are coming together or materialization
  and dematerialization and morphing." Which is physics, not decoration: a dividing cell is one
  body from beginning to end. It never has a frame in which it is two bodies that happen to touch,
  and it never pops a second body into existence beside the first. Both of our mechanics follow
  from that — a lobe grows OUT of its parent and travels while attached, and two shapes fuse
  through a bridge wide enough to actually span what is between them.
- A menu unfolding from a panel (M 5:11, frame-by-frame at 15 fps) happens in TWO PHASES. The
  panel first contracts into a droplet, glyphs go out of focus (~0.15 s); a ridge grows from the
  droplet's side toward where the menu will be. Then the droplet grows into the menu with a slight
  overshoot (~0.4 s), and as it nears full size the content emerges — first as a blurred, clipped
  body. Closing runs in reverse: the menu flows into a droplet, which flows back into the panel and
  leaves a ridge on top that dissolves away.
- Measured off the frame (frames/morph/s03, the panel where the necks are still attached): lobes
  72 and 82 px, centres 92 px apart — 15 px of space between their surfaces — joined by a neck 28
  px tall, about 0.39 of the smaller lobe. Our bridge law renders 29.0 on the same geometry. The
  measurement is sharp: a fusion margin of 1.2 gives 23.5 and 1.4 gives 33.5.
- A control splitting into parts (M 5:02, frame-by-frame at 12 fps): "Select" whitens, the label
  goes out of focus, the body STRETCHES and bulges out its future parts, bridges stretch taut
  between them, and only then do they tear. The reverse is the same: the parts flow back into one
  body. The parts don't "slide apart already formed" — right up until the split, it's one body
  with bulges.
- Throughout all this the element glows with a CONCENTRATE OF THE ENVIRONMENT, not its own
  whiteness: in these frames the background is light, so the droplet comes out nearly white. Over
  a dark background it has nothing to turn white from.

## 6. UI on device

The studio scenes in M show the material at its limit; the product footage in A shows what it
settles into in the interface.

- **Regular over dark video** (A 2:17): smoky body, the content under it is heavily blurred and
  slightly lightened, the frame's color is picked up — capsules over a warm scene turn brownish.
  The rim is a thin light line all around, a bit brighter at the top. No shadow is visible on the
  dark background.
- **Ringer slider over fabric** (A 2:02): the pattern under the track blurs into blobs, the rim
  at the end cap picks up the color of the carpet next to it.
- **Pressed button** (M 3:52): grows, turns milkier, the glyph under the finger goes out of
  focus.
- **Capsule over text** (L 6:39): the line under the glass is blurred, the neighboring text
  outside it stays sharp; the shadow under the capsule is denser than over a flat background.

## 7. Color, layers, and brand

- Glass is a LAYER OVER CONTENT, and color in the controls themselves was deliberately REDUCED
  (S): color was handed over to the content layer so content reads through the UI. Painting the
  glass in a brand color is a mistake; the brand lives in the content, and the glass picks it up
  and reflects it.
- The exception is a screen's single primary action: it's tinted with colored glass, not filled
  solid (M 16:08). A flat fill switches the material off: the texture of the content under the
  element disappears.
- Apple describes the material like this: it dynamically bends shapes and CONCENTRATES LIGHT in
  real time, refracts the content beneath it and reflects the light around it (S, introduction).
  That's where the rule that our whole optics model rests on comes from: an element's light is a
  concentrate of the environment — it has none of its own.
- Component metrics were recalculated for today's screens (S): sizes like 44/48/52 pt are the
  result of a revision, not historical constants.
- For a large element, the app's ENVIRONMENT sets the look of the glass: the color of the nearest
  content bleeds slightly onto its surface (219 @8:09). And it's not just the surface — light
  reflects, scatters, and BLEEDS INTO THE SHADOW (219 @8:22), the way it does in life. Frames at
  504–512 s show a panel over a yellow cover taking on yellow, over a pink one taking on pink,
  with the color spilling past its edge.
- In the new design a panel is TRANSPARENT and lives with the scroll-edge effect, so persistent
  brand graphics inside it start to crowd the content and lose legibility. The American Airlines
  case (S): the logo was removed from the header and let it scroll away with the content — the
  brand is carried by the content itself, not by a badge on top of it.

### Which layer the glass belongs in

219 @11:50 states it among the principles: glass is "best reserved for the NAVIGATION layer",
and you should "avoid putting glass in the content layer and avoid putting [it] within or on top
of other glass elements to maintain hierarchy and prevent clutter."

Containment and overlap are not the same failure. Two panes in the stacking order — a sheet over
a bar — is what two panes of glass actually do, and 219 calls it a hierarchy mistake rather than a
rendering one. Glass CONTAINED IN glass is broken output: an adopting team (S 32:54, "Building
CNN for iOS 26") reported it as their first lesson — "applying the glass effect to both a parent
and child views led to visual redundancy. Double translucency, layered blur, and unpredictable
rendering." On any renderer that samples what is already composited behind an element, the inner
pane's backdrop is the outer pane's output: the refraction lands twice on the same pixels and the
blurs multiply.

The way to put glass on something that is NOT chrome is to have it arrive only under the finger
(S 42:34, "Building Tide Guide"): "this effect doesn't change the appearance of a view until you
interact with it... as you start sliding it, the interactive effect adds a soft, subtle highlight
beneath the wave." At rest there is no glass in the content layer, because there is no glass.

## 8. Bars on wide screens (iPhone Duo)

- On a wide screen, navigation and toolbars move SIDEWAYS, into a vertical strip: vertical space
  stays with the content, and the controls end up within reach (B 0:28).
- The vertical strip is a shared area for navigation, the toolbar, and the tab bar; it's pinned
  to the hardware, so it doesn't mirror for right-to-left languages (B 3:09).
- The strip's width is fixed, an element's height is not: it fits icons, not text. An element
  with an icon moves to the vertical axis, a text one stays on the horizontal one (B 5:56).
- By default the vertical strip has NO scroll-edge effect, but with "Reduce Transparency" turned
  on it gets a solid background (B 10:36) — a direct instruction for how the material must degrade
  in accessibility mode.
- Whatever doesn't fit goes into an overflow menu, bottom to top; visibility priority is
  assigned, and elements carrying status (a badge with a number) must stay visible (B 11:40,
  13:10).

## 9. Accessibility

System settings are MODIFIERS of the material: they change its layers but don't turn it off
(219 @18:15). They work automatically as soon as an app adopts the new material.

- **Reduce Transparency** — the glass turns more matte and hides what's underneath it more
  strongly (219 @18:22). A vertical bar that has no background in its normal state gets one under
  this setting (B 10:07).
- **Increase Contrast** — the element shifts mostly to black or white and picks up a contrasting
  outline around its silhouette (219 @18:29). Specifically an outline, not just a flat fill of the
  body.
- **Reduce Motion** — effect intensity drops, and the material's elasticity turns off entirely
  (219 @18:35). This is about motion, not optics. The elastic properties are the ones that
  overshoot and oscillate: the spring that lags the finger and the ripple that crosses the
  surface. The press is neither — it is what lights an element from within (219 @12:11), which is
  light rather than movement, so it stays and is damped. An element that stops answering a finger
  under this setting is not reduced motion, it is no feedback.
- The settings apply to ALL the glass at once (219 @18:45), and the Clear variant is no
  exception: under Increase Contrast it too moves to the edge of the scale — the "variants don't
  mix" rule gives way to what the person themselves asked for.

## 10. The scroll-edge effect

The effect works IN TANDEM with the glass: it maintains layer separation and legibility as
content scrolls under a bar (219 @8:52).

- Content under the bar isn't clipped — it goes into a BLUR that grows toward the edge and
  dissolves into the background; floating titles, meanwhile, stay crisp (219 @9:12, frames at
  552–576 s). It is NOT an overlay. 356 @11:32: "they don't block or darken like overlays. They
  simply clarify where UI and content meet, and shouldn't be used where there aren't any floating
  UI elements." The blur is the effect; nothing is laid over the content.
- Two styles across the system, "soft and hard", and they must not be mixed or stacked (356
  @11:48). Soft is the default and covers both adaptive forms below. Hard is "a stronger, more
  opaque boundary", mostly macOS — pinned table headers, interactive text, controls without
  backgrounds (356 @12:09). One per view; in a split view each pane may have its own, at the same
  height (356 @12:22).
- When dark content scrolls under the glass and it switches to the dark style, the dissolve is
  replaced by a light DARKENING (219 @9:28) — the same move as ink polarity.
- Measured off the footage (frames/scroll-edge/z576, 320x413): high-frequency energy per row —
  which a brightness gradient in the content cannot fake, and which the row MEANS could not be
  separated from — reads 1.4 through the zone under the bar against 14 in the sharp content below.
  A factor of ten, so the content really is going out of focus rather than being covered. The zone
  runs from the bar's lip at y≈45 to y≈130, about 1.9 times the bar's own height.
- The same frame confirms @9:22: the floating title sits INSIDE that zone and measures 32, twenty
  times its surroundings. Titles stay crisp while everything behind them dissolves — which is why
  the effect goes behind the glass in the stack, not over the content.
- With no scrolling, there's no effect at all: the bar sits on a plain background.
- For pinned views under the bar (column headers), the style is HARD: a flat band across the
  full height of the bar and the pinned view, no gradient (219 @9:41).

## 11. Concentricity

- Glass controls nest into a window's rounded corners while KEEPING concentricity across the
  interface (219 @7:53): nested shapes share a center of curvature, so the inner radius is
  smaller than the outer one by exactly the inset.
- Otherwise the corners aren't parallel: the gap between the shapes narrows at the curve and
  widens along the straight stretches. The defect is visible to the eye, but the cause usually
  goes unnamed.
- The rule CHAINS: a cover inside a tile is computed from the tile's radius, not the screen's.
- Shapes whose corners aren't nested into anything (a round button, a cover in the middle of a
  list) aren't touched by the rule: concentricity is about corners that sit against someone else's
  corners.
- **Far from an edge, an honest calculation gives zero**, i.e. a square corner, and the nested
  shape drops out of the family. SwiftUI has `concentric(minimum:)` for this case — a radius floor
  that breaks concentricity on purpose.

### Three shape types

356 @3:42 names what concentric layouts are built from: "fixed shapes have a constant corner
radius. Capsules use a radius that's half the height of the container. And concentric shapes
calculate their radius by subtracting padding from the parent's." @3:59: "the capsule's geometry
naturally supports concentricity", which is why it runs through sliders, switches, bars, buttons
and the corners of grouped table views.

- For a component that has to work both nested and alone, 356 @6:00 gives a concentric shape a
  FALLBACK radius: "the concentric value adapts when nested, and the fallback kicks in when the
  component stands alone." Not the same as `minimum`, which is a floor that applies while nested
  and breaks concentricity on purpose. A fallback never overrides a parent that exists.
- Near a device edge the choice is by platform (356 @5:44): on phone, a capsule with extra margin
  to create space at the screen edge; on iPad and Mac, a concentric shape aligned with the window
  edge.
- The defect has two directions and 356 @5:19 names them: corners that feel "too pinched — or
  flared". Pinched is an inner radius smaller than concentricity asks for, so the gap widens
  through the curve; flared is larger, so the corners crowd each other.

## 12. Where mistakes happen most often

| Mistake | What the reference actually shows |
|---|---|
| sampling outward at the rim | the rim shows what's under the center |
| highlight as a wide bevel | a ~1 pt line along the silhouette |
| one bevel size for every element | bigger element, thicker glass |
| a size response that saturates | sidebars are the large end, not past it |
| opacity fade on appearance | the lens builds up from zero |
| solid color fill | tint keyed to backdrop lightness |
| glass nested inside glass | one pane, or glass that arrives on touch |
| a scroll edge painted as a scrim | a blur the content dissolves into |
| permanent glass on a content control | the interactive variant — nothing at rest |
