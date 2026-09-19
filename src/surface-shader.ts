import { VG_FALLOFF, VG_SDF } from './sdf';

/** Order matches `DEBUG_MODES` in `material.ts`: the index goes straight into `u_debug`. */
export const SURFACE_SHADER = `
uniform shader u_icon;
/** App-colored content ON the glass — cover art, a thumbnail. A separate layer from the ink
 *  mask: that one is single-channel and colored by polarity, this one carries its own color
 *  as-is. */
uniform shader u_overlay;

uniform float2 u_center;
uniform float2 u_halfSize;
uniform float  u_corner;
uniform float  u_bevel;
uniform float  u_thickness;
uniform float2 u_morphOffset;
uniform float2 u_morphHalf;
uniform float  u_morphCorner;
uniform float  u_morphK;
uniform float2 u_morph2Offset;
uniform float2 u_morph2Half;
uniform float  u_morph2Corner;

uniform float  u_press;
uniform float  u_active;
/* 0 — the element sinks in under the finger, 1 — it rises into glass (reference §5). */
uniform float  u_lift;

uniform float  u_edgeDensity;
uniform float  u_dispersion;
uniform float  u_refraction;
uniform float4 u_tint;
uniform float  u_shadow;
uniform float  u_shadowReach;
uniform float3 u_ambient;
uniform float  u_presence;
uniform float  u_progress;
uniform float  u_appear;
uniform float  u_debug;

uniform float  u_iconOn;
uniform float  u_overlayOn;
uniform float  u_iconScale;
uniform float4 u_inkIdle;
uniform float4 u_inkActive;
uniform float2 u_touch;
uniform float2 u_pull;
uniform float  u_touchPress;
uniform float  u_touchRadius;
uniform float2 u_wave;

${VG_SDF}

const float VG_FALLOFF = ${VG_FALLOFF};

// Tint density in the flat middle; at the bevel it's multiplied by u_edgeDensity.
const float VG_BODY_DENSITY = 0.19;
/* Fraction of the ambient hue in the shadow. The shadow has to stay a shadow, not a colored
 *  blob. */
const float VG_SHADOW_TINT = 1.0;
// How much weaker the shadow is right at the outline than under the middle of the gap, and what
// fraction of the offset it takes to reach full depth. In the reference the shadow's minimum
// sits below the rim, not right at it.
const float VG_GAP_LIGHT = 0.76;
const float VG_GAP_REACH = 0.20;
/* Depth of the ink beneath the surface, dp. The normal displaces it by exactly this much right
 *  at the rim. */
const float VG_INK_DEPTH = 4.0;
/* Ink defocus under the finger (reference §6): a glyph loses its edge and drowns in milk. Given
 * as a FRACTION of the touch blob, not a number: the blob already arrives in device units, so
 * the radius automatically follows both screen density and the element's size. At rest it's
 * zero, and the sample stays a single one. */
const float VG_INK_DEFOCUS = 0.08;

half4 vgPack(half3 c, float a) { return half4(c * half(a), half(a)); }

// What bleeds into the shadow is the COLOR of the surroundings, not its brightness: the hue's own
// lightness is subtracted out of it, otherwise the shadow pales and loses depth instead of
// warming up. Strength is set by how much light there is around: over a nearly black backdrop
// there's nothing to bleed into the shadow.
float3 vgShadowTint(float3 ambient) {
  float peak = max(max(ambient.r, ambient.g), max(ambient.b, 0.001));
  float3 hue = ambient / peak;
  float lumaWeights = dot(ambient, float3(0.2126, 0.7152, 0.0722));
  return (hue - dot(hue, float3(0.2126, 0.7152, 0.0722))) * lumaWeights;
}

half3 vgHeat(float v) {
  float x = clamp(v, 0.0, 1.0);
  return half3(half(clamp(x * 2.2 - 0.2, 0.0, 1.0)),
               half(clamp(1.0 - abs(x - 0.5) * 2.2, 0.0, 1.0)),
               half(clamp(1.2 - x * 2.4, 0.0, 1.0)));
}

half4 main(float2 xy) {
  float2 p = vgTouchWarp(xy - u_center, u_touch, u_pull, u_touchPress, u_touchRadius, u_wave.x, u_wave.y);

  // Inverse deformation: stretch A along the pull vector, compression 1/sqrt(A) across it. This
  // exact law mirrors the transform of the live backdrop under the canvas, otherwise the two
  // would drift apart. There's NO motion geometry here — no pull, no press-driven bulge. All of
  // that is done by a single wrapper transform, the same one that carries the native lens: the
  // shader doesn't touch it, and two pipelines driving one motion would drift apart by a frame,
  // making the layers visible as separate.

  float halfMin = max(min(u_halfSize.x, u_halfSize.y), 1.0);
  float bevel = max(u_bevel, 1.0);

  float sd = vgScene(p, u_halfSize, u_corner, u_morphOffset, u_morphHalf, u_morphCorner, u_morphK,
                u_morph2Offset, u_morph2Half, u_morph2Corner);
  float t = vgBevelT(sd, bevel);
  float2 n = vgSceneNormal(p, u_halfSize, u_corner, u_morphOffset, u_morphHalf, u_morphCorner, u_morphK,
                u_morph2Offset, u_morph2Half, u_morph2Corner);
  float3 N = normalize(float3(n * vgBevelSlope(t), 1.0));

  // Progress is an active state turned into a field: the played fraction shines and glows
  // exactly as much as an active element shines whole. This does NOT touch ink: recoloring text
  // as the track advances would mean changing it mid-word.
  float lit = max(u_active, vgProgress(p, u_halfSize, u_progress));

  // The highlight and the rim are computed by the lens: reflection is a function of the
  // surroundings, and only the lens can see them.

  if (u_debug > 0.5) {
    float inMask = 1.0 - smoothstep(-1.0, 1.0, sd);
    if (u_debug < 1.5) {
      float band = abs(fract(sd / (halfMin * 0.22)) - 0.5) * 2.0;
      half3 c = sd < 0.0 ? half3(0.20, 0.62, 1.0) : half3(1.0, 0.42, 0.22);
      return vgPack(c * half(0.25 + band * 0.75), 1.0);
    }
    if (u_debug < 2.5) { return vgPack(half3(1.0), inMask); }
    if (u_debug < 3.5) { return vgPack(vgHeat(t), inMask); }
    // Fresnel now lives in the lens; here we show its SHAPE — how grazing the view is.
    if (u_debug < 4.5) { return vgPack(vgHeat(1.0 - clamp(N.z, 0.0, 1.0)), inMask); }
    if (u_debug < 5.5) {
      float push = pow(t, VG_FALLOFF) * u_refraction;
      return vgPack(vgHeat(push), inMask);
    }
    if (u_debug < 6.5) { return half4(0.0); }
    if (u_debug < 7.5) { return half4(0.0); }
    // Dispersion is computed by the lens; here is the field it grows along.
    if (u_debug < 8.5) { return vgPack(vgHeat(u_dispersion * t * t), inMask); }
    if (u_debug < 9.5) { return vgPack(half3(N * 0.5 + 0.5), inMask); }
    // spectral and adapt are shown by the LENS — the surface has to get out of the way.
    return half4(0.0);
  }

  // The shadow and the halo live OUTSIDE the shape: inside, their place is taken by the glass
  // itself. Separation from the content rests entirely on the shadow — without it the surface
  // would sit ON the picture, not above it. The shadow only lives at the rim and outside it: at
  // sd < −1 the outside multiplier is already zero. Computing it deep inside the shape would be
  // a wasted FULL SDF evaluation for every such pixel, and the body covers almost the whole
  // area. The branch here is on the coordinate, but only the threads right at the rim actually
  // diverge.
  float shade = 0.0;
  float halo = 0.0;
  if (sd > -1.0) {
    float outside = smoothstep(-1.0, 1.0, sd);
    // Under the finger a button moves TOWARD the backdrop, and the shadow tightens: it's exactly
    // the gap between the two. A control rising into glass (a switch knob, a slider handle —
    // reference §5) moves AWAY from it, and then the shadow spreads out instead. Only the app
    // knows which one applies, so the direction arrives as a fraction: 0 is sinking in, the way
    // every element behaved before this rule existed.
    float reach = u_shadowReach * (1.0 + mix(-0.25, 0.55, u_lift) * u_press);
    // The shadow is soft and wide, shifted downward (M 11:58): it's what holds the element's
    // separation from the content.
    float sdDrop = vgScene(p - float2(0.0, reach * 0.35), u_halfSize, u_corner,
                           u_morphOffset, u_morphHalf, u_morphCorner, u_morphK,
                u_morph2Offset, u_morph2Half, u_morph2Corner);
    float amb = 1.0 - smoothstep(-reach * 0.3, reach, sdDrop);
    // THE GAP UNDER A RAISED ELEMENT IS LIT: right at the outline the shadow is WEAKER than
    // further down. Otherwise the minimum sits right against the silhouette — both parts of the
    // shadow are monotonic in distance.
    float gap = smoothstep(0.0, max(reach * VG_GAP_REACH, 1.0), max(sd, 0.0));
    shade = amb * amb * 0.13 * mix(VG_GAP_LIGHT, 1.0, gap) * outside * u_shadow * u_appear;
    halo = 1.0 - smoothstep(0.0, reach * 0.30, max(sd, 0.0));
    halo = halo * halo * lit * 0.10 * outside * u_appear;
  }

  if (sd > 1.0) {
    // Ambient light bleeds into the shadow (219 @8:22): it isn't a black hole, it's tinted by
    // whatever lies nearby. Otherwise an element over colored content would hang over a gray
    // blob.
    half3 spill = max(half3(half(halo)) + half3(vgShadowTint(u_ambient)) * half(VG_SHADOW_TINT * shade * (1.0 - halo)), half3(0.0));
    return half4(spill, half(halo + shade * (1.0 - halo)));
  }

  float density = u_tint.w;
  float inner = clamp(-sd / halfMin, 0.0, 1.0);
  half3 col = half3(u_tint.rgb);

  // The tint is LIGHT and weak, not dark: dark glass over dark content disappears, and has to be
  // held together with a heavy rim — which makes the surface read as a chrome bead. Tint density
  // at the bevel is a separate value: physically the bevel bends light harder, but it doesn't
  // get hazier. Coupled together, the two produced a milky ring around the whole outline.
  float body = mix(VG_BODY_DENSITY, VG_BODY_DENSITY * u_edgeDensity, smoothstep(0.10, 0.62, t)) * density;
  float vignette = smoothstep(0.15, 1.0, inner) * 0.19 * density;
  // There's NO density boost on press here. It was meant as "the element stands out more under
  // the finger," but it pulls the body toward the tint, and the tint depends on polarity: over a
  // light backdrop (dark polarity) press ended up DARKENING the element. Presence is shown
  // instead by the vgTouchWarp field's deformation and the highlight blooming below — neither
  // cares about the sign of polarity.
  float a = max(body, vignette);

  // Active state does NOT touch the body's color. Mixing in a fixed gray here flipped the
  // effect's sign depending on the backdrop: over dark the element lightened, over light it
  // darkened, for the exact same state. Active state is shown instead by the highlight and rim
  // lighting above: neither cares about the backdrop.

  // THE ICON SITS BENEATH THE SURFACE, it isn't stuck on top of it: it used to be mixed in last,
  // over the highlight, and read as a flat sticker on volumetric glass. At the rim the normal
  // displaces it, like everything seen through the glass, while the highlight sits ON TOP — it
  // lives on the surface itself.
  //
  // There is NO shadow under the icon here. It used to be made from the difference of two offset
  // mask samples and produced a second outline along the edge — the icon's borders looked
  // ragged.
  // THE INK'S SHIFT IS SET BY ITS OWN DEPTH, NOT BY BEVEL WIDTH. The ink sits right at the
  // surface, and it's displaced by exactly the thin layer of glass above it — not by how wide a
  // bevel this particular piece of glass happens to have. It used to be a fraction of the bevel:
  // on thin glass the shift came out to 4 dp and everything lined up, but on thick glass it was
  // 8, and cover art inset from the edge by 6 stretched toward the rim and spilled past its
  // bounds. The ceiling is absolute: ink has one depth regardless of the glass.
  float2 inkShift = n * (min(u_bevel * 0.5, VG_INK_DEPTH) * t);
  float2 inkUv = u_center + p - inkShift;

  // INK LOSES SHARPNESS UNDER THE FINGER (reference §6): in the reference, a glyph under
  // pressure drowns in milk rather than simply getting lighter. This branch is uniform across
  // the whole element: press arrives as a uniform, so defocus costs nothing while the element
  // isn't being touched.
  float defocus = VG_INK_DEFOCUS * u_touchRadius * u_touchPress;
  float2 inkDx = float2(defocus, 0.0);
  float2 inkDy = float2(0.0, defocus);

  half4 ink;
  half4 over;
  if (defocus > 0.01) {
    // A cross around the center with double weight in the middle: the ink mask is
    // high-contrast, and four samples are enough for a stroke to stop holding its edge.
    ink = (u_icon.eval((inkUv - inkDx) * u_iconScale)
         + u_icon.eval((inkUv + inkDx) * u_iconScale)
         + u_icon.eval((inkUv - inkDy) * u_iconScale)
         + u_icon.eval((inkUv + inkDy) * u_iconScale)
         + u_icon.eval(inkUv * u_iconScale) * 2.0) * half(u_iconOn / 6.0);
    // Colored content lives in the same plane as the ink and blurs together with it: different
    // sharpness for two layers in one plane would read as a defect, not a press.
    over = (u_overlay.eval((inkUv - inkDx) * u_iconScale)
          + u_overlay.eval((inkUv + inkDx) * u_iconScale)
          + u_overlay.eval((inkUv - inkDy) * u_iconScale)
          + u_overlay.eval((inkUv + inkDy) * u_iconScale)
          + u_overlay.eval(inkUv * u_iconScale) * 2.0) * half(u_overlayOn * u_appear / 6.0);
  } else {
    ink = u_icon.eval(inkUv * u_iconScale) * half(u_iconOn);
    over = u_overlay.eval(inkUv * u_iconScale) * half(u_overlayOn * u_appear);
  }

  // The backing under the ink is held by the LENS (body density from the probe), not the
  // surface: legibility is a property of the material, and computing it here a second time
  // would give two different answers to one question.

  // Layers are composited premultiplied-over: in straight alpha, a nearly transparent dark body
  // used to pull the color of semi-transparent ink and the finger's light toward itself — letter
  // edges grayed out, pressing darkened things.
  half3 pm = col * half(a);
  half inkA = ink.g * half(mix(0.82, 1.0, u_active) * u_appear);
  half3 inkCol = mix(half3(u_inkIdle.rgb), half3(u_inkActive.rgb), half(u_active));
  pm = pm * (1.0 - inkA) + inkCol * inkA;
  a = a + float(inkA) * (1.0 - a);

  // COLORED CONTENT LIVES IN THE SAME PLACE AS THE INK — inside the material, at the same
  // coordinate. Otherwise deformation would carry them apart: on press, the title and artist
  // name would shake together with the surface while the cover art stayed put, because it used
  // to be a separate layer on top of the glass. Polarity doesn't touch it — it has its own
  // color, and there's nothing to swap it for.
  pm = pm * (1.0 - over.a) + over.rgb * over.a;
  a = a + float(over.a) * (1.0 - a);

  // Light from the finger is gathered by the LENS: it's a concentration of the surroundings, not
  // the glass's own whiteness. The surface is left with only what the glass spills outward — the
  // halo above.

  float mask = 1.0 - smoothstep(-1.0, 1.0, sd);
  pm = clamp(pm, half3(0.0), half3(1.0)) * half(mask);
  a *= mask;
  pm = max(pm + half3(vgShadowTint(u_ambient)) * half(VG_SHADOW_TINT * shade * (1.0 - a)), half3(0.0));
  return half4(pm, half(a + shade * (1.0 - a)));
}
`;
