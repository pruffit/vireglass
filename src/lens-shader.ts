import { ACCENT, BODY, DISPERSION, LENS, MEDIUM, RIM, SPECTRAL } from './law';
import { VG_SDF } from './sdf';

// The lens source is assembled HERE and ships to the native view as a prop: AGSL and SKSL are one
// language, so the lens's and the surface's geometry are literally the same string (`VG_SDF`).
//
// Glass is a thick plate with a convex rounded edge (docs/reference.md §1). A ray from above
// refracts at the top face and lands on the content shifted INWARD relative to the shape: the
// middle isn't shifted, the rim shows what lies beneath the body of the element.
//
// Uniforms, apart from the view's own geometry, arrive over a SHARED CHANNEL (`adapters.ts` →
// `uniformNames`/`uniformSizes`/`uniformValues`). There are no more separate Props per value:
// those were exactly what let a typo silently turn the lens off (docs/material-lab.md E-01).
export const LENS_SHADER = `
uniform shader content;

// Known only to the view itself: its own size and its own place on screen.
uniform float2 u_center;
uniform float  u_reach;
uniform float2 u_contentMin;
uniform float2 u_contentMax;
// Backdrop estimate UNDER the glass from the native probe: lightness, variegation and average
// color, already smoothed over time. Negative lightness means the probe hasn't reported yet —
// fall back to our own samples.
uniform float  u_probeLuma;
uniform float  u_probeBusy;
// The endpoints of the lightness range under the glass: right at a black/white border the
// average reads as a gray that says "everything's fine," while the ink drowns over the light
// half.
uniform float2 u_probeRange;
// Slope of lightness across the surface, fraction per half-size: tinting is a gradient — one
// density per element wouldn't separate the ink from both halves of the backdrop.
uniform float2 u_probeSlope;
uniform float3 u_probe;

// Material — over the shared channel from JS, already in device pixels.
uniform float2 u_halfSize;
uniform float  u_corner;
uniform float  u_bevel;
uniform float  u_thick;
uniform float  u_rim;
uniform float  u_ior;
uniform float  u_iorSpread;
uniform float2 u_light;
uniform float  u_appear;
uniform float4 u_accent;
uniform float  u_frost;
uniform float  u_ink;
uniform float  u_legibility;
uniform float  u_dim;
uniform float  u_presence;
uniform float  u_progress;
uniform float  u_adaptRadius;
uniform float  u_bodyDensity;
uniform float  u_edgeLight;
uniform float  u_fresnel;
uniform float  u_specular;
uniform float  u_reflectReach;
uniform float  u_film;
uniform float  u_iridescence;
uniform float  u_diffraction;
uniform float  u_colorPickup;
uniform float2 u_morphOffset;
uniform float2 u_morphHalf;
uniform float  u_morphCorner;
uniform float  u_morphK;
uniform float2 u_morph2Offset;
uniform float2 u_morph2Half;
uniform float  u_morph2Corner;
uniform float  u_debug;
uniform float2 u_touch;
uniform float2 u_pull;
uniform float  u_touchPress;
uniform float  u_touchRadius;
uniform float2 u_wave;

${VG_SDF}

// Sample count for the disc gather: fewer than this reads as a staircase of copies at a sharp edge.
const int   VG_FROST_TAPS = 20;
// The sample count grows with the disc's area: estimator noise is the spread under the glass
// divided by the square root of the sample count. The ceiling is cost: texture sampling is the
// most expensive thing here.
const int   VG_FROST_TAPS_MAX = 64;
// The radius correction for backdrop compression at the rim is capped: at the silhouette it goes
// to infinity.
const float VG_FOOTPRINT_MAX = ${LENS.footprintMax};
const float VG_TAU = 6.28318530718;
// Ceiling on body lightness under light ink (and the mirrored floor under dark ink). This is a
// ceiling, not a difference: "0.14 darker than white" is a lightness of 0.86, at which white text
// is invisible.
const float VG_BODY_CAP_LOOSE = ${BODY.capLoose};
const float VG_BODY_CAP_TIGHT = ${BODY.capTight};
// Tint lightness in both directions: real glass is never coal-black or paper-white.
const float VG_TINT_DARK = ${BODY.tintDark};
const float VG_TINT_LIGHT = ${BODY.tintLight};
// Reference channel wavelengths, nm — for diffraction and interference.
const float3 VG_LAMBDA = float3(${LENS.lambdaR}.0, ${LENS.lambdaG}.0, ${LENS.lambdaB}.0);
// Film index of refraction: every thin film on glass sits around this value.
const float VG_FILM_IOR = ${LENS.filmIor};
// Ceiling on the profile's slope right at the silhouette: it goes to infinity there.
const float VG_SLOPE_MAX = ${LENS.slopeMax}.0;
// Fraction of the gather radius that scattering reaches over a busy backdrop under ink (M 11:47).
// Set against the reference: there, structure under the capsule fades by a factor of 9-10, not
// thirty.
const float VG_SCATTER_MAX = ${MEDIUM.scatterMax};
const float VG_SCATTER_BASE = ${MEDIUM.scatterBase};
// The response to structure under the glass saturates early: what competes with the ink isn't
// the area of foreign text but the mere fact that it's there (a line under a tile gives a busy
// of about 0.12).
const float VG_STRUCTURE_GAIN = ${MEDIUM.structureGain}.0;
// How much denser the body with ink gets over a BUSY backdrop than over a calm one. There's no
// flat floor here: legibility picks up its own targeted requirement further down, and base
// frosting comes from VG_MATTE_LIFT.
const float VG_GROUND_SPAN = ${BODY.groundSpan};
// Scattered light on a frosted element is an ADDITION on top of the backdrop, not a fraction of
// the way to the tint: the fraction goes to zero once the canvas reaches the tint's lightness,
// and darkens past it (docs/benchmarks.md).
const float VG_MATTE_LIFT = ${MEDIUM.matteLift};
// The fraction of backdrop spread that survives through to the body past scattering: the
// legibility requirement is computed from this edge, not from the spot's average lightness.
const float VG_BUSY_EDGE = ${BODY.busyEdge};
// Light concentration: the body is a touch lighter than what's beneath it (M 2:29).
const float VG_CONCENTRATE = ${MEDIUM.concentrate};
// The lightness the medium pulls content under the glass toward, and the strength of that pull.
// The medium both removes light and mixes in scattered light: over a light backdrop the body
// darkens, over a dark one it lightens.
const float VG_MEDIUM_LUMA = ${MEDIUM.luma};
const float VG_MEDIUM_PULL = ${MEDIUM.pull};
// How much ambient light reaches the body on top of the pull.
const float VG_AMBIENT_SPILL = ${MEDIUM.ambientSpill};

float vgLuma(float3 c) { return dot(c, float3(0.2126, 0.7152, 0.0722)); }

// Un-premultiply into ordinary color. One division, done in float: near zero, half's step is too
// coarse, and several divisions in a row raise noise.
float3 vgUnpack(half4 c) {
  float a = float(c.a);
  return a > 0.004 ? float3(c.rgb) / a : float3(0.0);
}

// The capture ends at the screen edge: samples are clamped to the rectangle where content
// actually exists, otherwise full-width glass picked up a band of emptiness along its edges.
float2 vgInContent(float2 q) { return clamp(q, u_contentMin, u_contentMax); }

// Hue without lightness. Below the threshold the color has no hue, and the division blows up.
float3 vgHue(float3 c) {
  float l = vgLuma(c);
  if (l < 0.02) { return float3(1.0); }
  return clamp(c / l, float3(0.0), float3(2.0));
}

// Edge profile — a convex squircle: x = 0 at the silhouette, 1 where the rounding turns flat.
float vgRimQ(float x) {
  float k = 1.0 - x;
  return sqrt(sqrt(max(1.0 - k * k * k * k, 0.0)));
}

float vgRimQd(float x) {
  float k = 1.0 - x;
  return k * k * k / pow(max(1.0 - k * k * k * k, 1e-5), 0.75);
}

// Glass height above the content at distance e from the silhouette.
float vgHeight(float e, float w) {
  return mix(u_rim, u_thick, vgRimQ(clamp(e / w, 0.0, 1.0)));
}

// Slope of the top face at the same point: the derivative of height with respect to distance
// from the silhouette.
float vgSlope(float e, float w) {
  if (e >= w) { return 0.0; }
  return min((u_thick - u_rim) / w * vgRimQd(clamp(e / w, 0.0, 1.0)), VG_SLOPE_MAX);
}

// Where a ray falling from above lands on a face with normal N: Snell's law refraction, then a
// path of length z through the medium to the content. The convex face bends the ray toward the
// normal — that is, inward relative to the shape.
float2 vgShift(float3 N, float z, float ior) {
  float3 T = refract(float3(0.0, 0.0, -1.0), N, 1.0 / ior);
  return z * T.xy / max(-T.z, 0.05);
}

// Thin-film interference: optical path difference 2·n·d·cosθt, each channel with its own λ.
// Returns a hue normalized to its own average — it colors, but doesn't lighten.
float3 vgInterference(float cosI) {
  float sinT2 = (1.0 - cosI * cosI) / (VG_FILM_IOR * VG_FILM_IOR);
  float cosT = sqrt(max(1.0 - sinT2, 0.0));
  float opd = 2.0 * VG_FILM_IOR * u_film * cosT;
  float3 i = 0.5 + 0.5 * cos(VG_TAU * opd / VG_LAMBDA + 3.14159265);
  return i / max((i.r + i.g + i.b) / 3.0, 0.001);
}

// Edge diffraction: fringes get denser the sharper the bevel. Also a hue, not a brightness.
float3 vgDiffraction(float distFromEdge, float bevel) {
  float phase = VG_TAU * ${SPECTRAL.diffractionFringes}.0 * distFromEdge / max(bevel, 1.0);
  float3 d = 0.5 + 0.5 * cos(phase * (${SPECTRAL.referenceLambda}.0 / VG_LAMBDA));
  return d / max((d.r + d.g + d.b) / 3.0, 0.001);
}

float vgHash(float2 p) {
  return fract(sin(dot(p, float2(12.9898, 78.233))) * 43758.5453);
}

// Soft compression instead of a hard clamp: over a white backdrop, additions used to knock a
// channel to one, and the glass turned into a flat blob with no detail.
float3 vgSoftClip(float3 c) {
  float3 over = max(c - 0.86, float3(0.0));
  return min(c, float3(0.86)) + over * 0.14 / (0.14 + over);
}

// Our own blur: the capture is left clean, the shader does the blurring — averaging in float
// smooths banding on its own and adds no noise of its own. A golden-angle spiral, rotated to its
// own angle at every pixel: with a shared angle, neighboring pixels took the same samples, and
// texture under the glass read in clumps. Accumulated premultiplied — one shared un-premultiply
// at the end.
float4 vgGather(float2 q, float radius, float2 seed) {
  float4 acc = float4(content.eval(vgInContent(q)));
  if (radius <= 0.25) { return acc; }
  if (radius < 4.0) {
    float r = radius * 0.7;
    acc += float4(content.eval(vgInContent(q + float2(r, 0.0))))
      + float4(content.eval(vgInContent(q - float2(r, 0.0))))
      + float4(content.eval(vgInContent(q + float2(0.0, r))))
      + float4(content.eval(vgInContent(q - float2(0.0, r))));
    return acc * 0.2;
  }
  float ca = cos(2.39996323);
  float sa = sin(2.39996323);
  float a0 = vgHash(seed) * 6.28318530718;
  float2 dir = float2(cos(a0), sin(a0));
  float wide = radius * 0.5;
  int taps = int(clamp(float(VG_FROST_TAPS) * wide * wide, float(VG_FROST_TAPS), float(VG_FROST_TAPS_MAX)));
  for (int i = 1; i <= VG_FROST_TAPS_MAX; i++) {
    if (i > taps) { break; }
    dir = float2(dir.x * ca - dir.y * sa, dir.x * sa + dir.y * ca);
    float r = radius * sqrt(float(i) / float(taps));
    acc += float4(content.eval(vgInContent(q + dir * r)));
  }
  return acc / float(taps + 1);
}

half4 main(float2 xy) {
  float2 p = vgTouchWarp(xy - u_center, u_touch, u_pull, u_touchPress, u_touchRadius, u_wave.x, u_wave.y);
  float sd = vgScene(p, u_halfSize, u_corner, u_morphOffset, u_morphHalf, u_morphCorner, u_morphK,
                u_morph2Offset, u_morph2Half, u_morph2Corner);
  // There's nothing outside the glass — except the light it spills onto the backdrop under the
  // finger (M 3:38): the same concentrated ambient as inside, so no white halo appears over a
  // dark backdrop.
  if (sd > 1.0) {
    float spill = u_touchPress * exp(-sd / max(min(u_halfSize.x, u_halfSize.y) * 0.5, 4.0)) * 0.5 * u_appear;
    if (spill < 0.004) { return half4(0.0); }
    float3 lit = clamp((u_probeLuma >= 0.0 ? u_probe : float3(0.35)) * 1.6 + float3(0.1), float3(0.0), float3(1.0));
    return half4(half3(lit * spill), half(spill));
  }

  float bevel = max(u_bevel, 1.0);
  float e = max(-sd, 0.0);
  // 0 in the flat middle, 1 at the silhouette.
  float t = 1.0 - clamp(e / bevel, 0.0, 1.0);
  float2 n = vgSceneNormal(p, u_halfSize, u_corner, u_morphOffset, u_morphHalf, u_morphCorner, u_morphK,
                u_morph2Offset, u_morph2Half, u_morph2Corner);

  // "backdrop" mode hands back the content as-is — a reference point for comparing the optics.
  float on = u_debug > 5.5 && u_debug < 6.5 ? 0.0 : 1.0;
  float lens = on * u_appear;

  float z = vgHeight(e, bevel);
  float slope = vgSlope(e, bevel);
  float3 N = normalize(float3(n * slope, 1.0));
  float2 shift = vgShift(N, z, u_ior) * lens;
  float2 s = u_center + p + shift;

  // The area the lens gathers into one pixel: a one-pixel step inward on screen, measured
  // against the sampling step. At the silhouette it's large — a stripe of backdrop is compressed
  // into a line there, and a point sample gives grain.
  float e1 = e + 1.0;
  float3 N1 = normalize(float3(n * vgSlope(e1, bevel), 1.0));
  float2 shift1 = vgShift(N1, vgHeight(e1, bevel), u_ior) * lens;
  float footprint = length(shift1 - shift - n);
  float spread = max(footprint - 1.0, 0.0) * 0.5 * on;

  // Dispersion: the same ray with each channel's own index. Blue bends more than red.
  float2 dR = vgShift(N, z, u_ior + ${DISPERSION.redShift} * u_iorSpread) * lens - shift;
  float2 dB = vgShift(N, z, u_ior + ${DISPERSION.blueShift} * u_iorSpread) * lens - shift;
  float chroma = length(dB - dR);

  float3 rgb;
  float srcA;

  if (chroma + spread < 0.25) {
    // In the flat body all the samples would land at the same point, and the body is almost the
    // whole area of the glass.
    half4 c = content.eval(vgInContent(s));
    srcA = float(c.a);
    rgb = srcA > 0.004 ? float3(c.rgb) / srcA : float3(0.0);
  } else {
    // Accumulate premultiplied and divide once per pair: channels from different points with
    // different alpha would otherwise produce a colored fringe at content edges that isn't
    // really there.
    float2 ev = n * spread;
    half4 c0 = content.eval(vgInContent(s + dR - ev));
    half4 c1 = content.eval(vgInContent(s + dR + ev));
    half4 c2 = content.eval(vgInContent(s - ev));
    half4 c3 = content.eval(vgInContent(s + ev));
    half4 c4 = content.eval(vgInContent(s + dB - ev));
    half4 c5 = content.eval(vgInContent(s + dB + ev));

    float aR = float(c0.a + c1.a) * 0.5;
    float aG = float(c2.a + c3.a) * 0.5;
    float aB = float(c4.a + c5.a) * 0.5;
    rgb = float3(
      aR > 0.004 ? float(c0.r + c1.r) * 0.5 / aR : 0.0,
      aG > 0.004 ? float(c2.g + c3.g) * 0.5 / aG : 0.0,
      aB > 0.004 ? float(c4.b + c5.b) * 0.5 / aB : 0.0);
    srcA = (aR + aG + aB) / 3.0;
  }

  // "backdrop" mode checks the CAPTURE, not a simplified version of the optics. What follows are
  // layers that aren't tied to the lens (body, medium, scattering), and they used to conflate
  // "did the pixels arrive" with "how did we process them." Here the element must DISAPPEAR: a
  // visible silhouette means a capture loss.
  if (u_debug > 5.5 && u_debug < 6.5) {
    float bypass = srcA * (1.0 - smoothstep(-1.0, 1.0, sd));
    return half4(half3(clamp(rgb, float3(0.0), float3(1.0)) * bypass), half(bypass));
  }

  // The transparent variant's dimming layer holds legibility instead of the body. A
  // multiplication, not a tint: the content has to stay visible, just quieter.
  rgb *= 1.0 - u_dim * u_appear;

  // REFLECTION. Fresnel from the face's actual slope: at the silhouette the view is grazing and
  // reflection is nearly total, which is why the rim reads as a thin line on its own. What's
  // reflected is the element's surroundings and the key light.
  float cosT = clamp(N.z, 0.0, 1.0);
  float f0 = (u_ior - 1.0) / (u_ior + 1.0);
  f0 *= f0;
  float fres = (f0 + (1.0 - f0) * pow(1.0 - cosT, 5.0)) * u_fresnel * lens;

  float lineW = clamp(min(u_halfSize.x, u_halfSize.y) * 0.03, 1.5, 5.0);
  float3 refl;
  if (e < lineW * 2.0 || fres > 0.01) {
    float2 around = u_center + p + n * (u_reflectReach * mix(0.35, 1.0, clamp(slope / 3.2, 0.0, 1.0)));
    // Two rings of eight samples total: a single offset sample is an undistorted COPY of
    // neighboring content inside the glass (docs/material-lab.md E-33).
    float p1 = u_reflectReach * 0.75;
    float p2 = u_reflectReach * 0.4;
    float d = 0.7071;
    float4 rsum = float4(content.eval(vgInContent(around + float2(p1, 0.0))))
      + float4(content.eval(vgInContent(around - float2(p1, 0.0))))
      + float4(content.eval(vgInContent(around + float2(0.0, p1))))
      + float4(content.eval(vgInContent(around - float2(0.0, p1))))
      + float4(content.eval(vgInContent(around + float2(p2, p2) * d)))
      + float4(content.eval(vgInContent(around + float2(-p2, p2) * d)))
      + float4(content.eval(vgInContent(around + float2(p2, -p2) * d)))
      + float4(content.eval(vgInContent(around + float2(-p2, -p2) * d)));
    float ra = rsum.a * 0.125;
    refl = ra > 0.004 ? rsum.rgb * 0.125 / ra : float3(0.0);
  } else {
    refl = u_probeLuma >= 0.0 ? u_probe : rgb;
  }

  // Light reaching the body is the same across the whole element: blending with the surroundings
  // over the bevel's band used to paint a ring-shaped seam on the body.
  float3 ambient = u_probeLuma >= 0.0 ? u_probe : rgb;

  // Light comes from wherever the surroundings are brighter (M 11:04): the lightness slope under
  // the element pulls the key light toward itself, and over a flat backdrop it stays at rest.
  float2 bright = u_probeLuma >= 0.0 ? u_probeSlope : float2(0.0);
  float brightLen = length(bright);
  float2 L = normalize(mix(u_light, bright / max(brightLen, 1e-4), smoothstep(0.03, 0.2, brightLen)) + float2(1e-5));
  // The key light's reflection uses the face's actual normal: at the flat top it points straight
  // up, and there's nothing there for direction to depend on. Using the SDF normal instead
  // painted the body as a cone.
  float facing = dot(N.xy, L);
  float key = u_specular * (pow(max(facing, 0.0), ${RIM.lobeExponent}.0) + ${RIM.opposingArc} * pow(max(-facing, 0.0), ${RIM.lobeExponent}.0));
  float rimFacing = dot(n, L);
  float rimKey = u_specular * (pow(max(rimFacing, 0.0), ${RIM.lobeExponent}.0) + ${RIM.opposingArc} * pow(max(-rimFacing, 0.0), ${RIM.lobeExponent}.0));
  // Wherever the key light doesn't fall, the face reflects its shaded surroundings — hence the
  // dark outline.
  float3 env = refl * (0.55 + 0.45 * min(key, 1.0)) + float3(1.2 * key);

  // Interference and diffraction live in the reflected ray at a grazing angle — a single hue
  // multiplier applied to the reflection, no extra samples.
  float3 spectral = float3(1.0);
  if (u_iridescence > 0.001) {
    spectral *= mix(float3(1.0), vgInterference(cosT), u_iridescence);
  }
  if (u_diffraction > 0.001) {
    float w = u_diffraction * smoothstep(${SPECTRAL.diffractionOnset}, 1.0, t);
    spectral *= mix(float3(1.0), vgDiffraction(e, bevel), w);
  }

  // The BACKDROP ESTIMATE arrives from the probe as one value per surface: computing it here
  // from samples isn't an option — a kink in density used to turn the estimate's discreteness
  // into ghost copies of text.
  float3 wide;
  float busy;
  if (u_probeLuma >= 0.0) {
    wide = u_probe;
    busy = u_probeBusy;
  } else {
    // The probe hasn't reported yet (first frames) — fall back to our own samples.
    float2 wx = float2(u_adaptRadius, 0.0);
    float2 wy = float2(0.0, u_adaptRadius);
    float3 w0 = vgUnpack(content.eval(vgInContent(s + wx)));
    float3 w1 = vgUnpack(content.eval(vgInContent(s - wx)));
    float3 w2 = vgUnpack(content.eval(vgInContent(s + wy)));
    float3 w3 = vgUnpack(content.eval(vgInContent(s - wy)));
    wide = (w0 + w1 + w2 + w3) * 0.25;
    float lw = vgLuma(wide);
    // The same statistic the probe uses (twice the mean deviation): both blur and the ink's
    // contrast margin depend on it, and the two paths' scales must not diverge.
    busy = clamp(0.5 * (abs(vgLuma(w0) - lw) + abs(vgLuma(w1) - lw)
      + abs(vgLuma(w2) - lw) + abs(vgLuma(w3) - lw)), 0.0, 1.0);
  }
  // Lightness AT THIS SPOT on the surface: the probe's plane, clamped to the measured range.
  float2 nrm = p / max(u_halfSize, float2(1.0));
  float local = u_probeLuma >= 0.0
    ? clamp(u_probeLuma + dot(u_probeSlope, nrm), u_probeRange.x, u_probeRange.y)
    : vgLuma(wide);
  float mean = u_probeLuma >= 0.0 ? u_probeLuma : vgLuma(wide);

  // SCATTERING. Regular mutes foreign structure under its own ink with blur, not a fill (M
  // 11:47): text under a capsule turns into blotches. Uniform across the whole lens; the radius
  // is measured in backdrop space — the lens compresses it at the silhouette.
  float structure = 1.0 - exp(-busy * VG_STRUCTURE_GAIN);
  // Under ink, Regular always scatters the backdrop; over a busy one, more strongly.
  float adaptBlur = max(
    (structure * VG_SCATTER_MAX + VG_SCATTER_BASE) * u_legibility * u_adaptRadius
      * min(max(footprint, 1.0), VG_FOOTPRINT_MAX),
    u_frost) * u_appear;
  if (adaptBlur > 0.5) {
    float reach = max(u_reach - length(p), 1.0);
    float4 g = vgGather(s, min(adaptBlur, reach), xy);
    float ga = g.a;
    float3 blurred = ga > 0.004 ? g.rgb / ga : float3(0.0);
    rgb = mix(rgb, blurred, smoothstep(0.5, 2.0, adaptBlur));
  }

  // AFTER scattering, not before: scattering is a property of TRANSMITTED light and replaces rgb
  // wholesale, so doing it the other way around erased the reflection over the whole element
  // (issue #106).
  rgb = mix(rgb, env * spectral, fres);

  // BODY. Tint and dynamic range under the glass compress just enough for ink over it to stay
  // legible (M 6:42). u_ink is ink POLARITY (1 light, 0 dark): the requirements are computed at
  // the two ends and blended by it, otherwise the glass dips toward the middle during a recolor.
  float strict = clamp(u_legibility * 2.0, 0.0, 1.0);
  float capLight = mix(VG_BODY_CAP_LOOSE, VG_BODY_CAP_TIGHT, strict);
  float floorDark = 1.0 - capLight;
  float pol = clamp(u_ink, 0.0, 1.0);
  // The requirement fades together with legibility: an element with no ink is promised
  // transparent glass by the model.
  float demand = clamp(u_legibility * 4.0, 0.0, 1.0);

  // Where there's no ink, the glass tints away from the backdrop. The direction is chosen by the
  // average lightness under the element, not the local spot's lightness: otherwise on a gradient
  // the threshold cuts across the body as a diagonal step.
  float darkSide = smoothstep(${BODY.darkSideFrom}, ${BODY.darkSideTo}, mean);
  float away = mix(VG_TINT_LIGHT, VG_TINT_DARK, darkSide);
  float tintLuma = mix(away, mix(VG_TINT_LIGHT, VG_TINT_DARK, pol), demand);

  // How much medium it takes to push lightness under the ink past the threshold — locally.
  // Computed from whichever edge of the backdrop's spread is closer to the ink: a light ink
  // drowns in a light spot right beneath it, and the spot's average lightness knows nothing
  // about that spot.
  float edge = busy * VG_BUSY_EDGE;
  float inkHi = min(local + edge, 1.0);
  float inkLo = max(local - edge, 0.0);
  float needForLight = inkHi > capLight
    ? clamp((inkHi - capLight) / max(inkHi - VG_TINT_DARK, 1e-4), 0.0, ${BODY.maxDemand})
    : 0.0;
  float needForDark = inkLo < floorDark
    ? clamp((floorDark - inkLo) / max(VG_TINT_LIGHT - inkLo, 1e-4), 0.0, ${BODY.maxDemand})
    : 0.0;
  float needForInk = mix(needForDark, needForLight, pol) * demand;

  float ground = structure * u_legibility * VG_GROUND_SPAN;
  float density = max(max(u_bodyDensity, ground), needForInk);

  // PRESENCE (§3). Over a uniform backdrop there is nothing to refract, and an element that is
  // only a rim honestly disappears — right for a piece of background, wrong for a control.
  //
  // This used to live on the rim line alone, as lit = max(rimKey, u_presence x 2), while the
  // DOM path has always implemented it as a floor on the BODY. Two renderers, one field, two
  // meanings. Measured on Apple's own control over a flat page (frames/verify/m-707), the body
  // carries 16 levels of separation there and the rim 11.6 — so the body is where it belongs,
  // and the rim's reading was the wrong one.
  // The separation asked for is capped by the range that is left: over a backdrop at 0.96 there
  // is no room to go 0.05 lighter. And what it is DIVIDED by is the distance to the tint's own
  // end, not to the tint the body currently sits at — dividing by the latter explodes wherever
  // the two are close, which is how the first version of this drove density to its ceiling at
  // both extremes and took the window down to 7%.
  bool lighter = local < 0.5;
  float target = lighter ? min(local + u_presence, 1.0) : max(local - u_presence, 0.0);
  float separation = abs(target - local);
  float reached = abs(tintLuma - local) * density;
  if (u_presence > 0.0 && reached < separation) {
    float toEnd = abs((lighter ? VG_TINT_LIGHT : VG_TINT_DARK) - local);
    density = max(density, min(separation / max(toEnd, 1e-4), ${BODY.maxDemand}));
  }

  // Glass has no color of its own — only the color of what's beneath it (HIG "Color").
  float3 tintHue = mix(float3(1.0), vgHue(wide * 0.5 + ambient * 0.5), u_colorPickup);
  // The element appears by the lens and body building up, not by fading in (M 2:55): at
  // u_appear = 0 it's indistinguishable from the backdrop beneath it.
  rgb = mix(rgb, tintHue * tintLuma, density * u_appear);
  rgb += tintHue * (u_legibility * VG_MATTE_LIFT * u_appear);

  // TINTING — colored glass, not a fill (M 16:31, 17:03): the backdrop's lightness drives the
  // tone — deeper over dark, lighter over light — and the content's texture still shows through
  // the color.
  if (u_accent.a > 0.0) {
    float3 tone = u_accent.rgb * mix(${ACCENT.deep}, ${ACCENT.light}, local);
    float3 through = tone * (0.85 + 0.3 * vgLuma(rgb));
    rgb = mix(rgb, clamp(through, float3(0.0), float3(1.0)), u_accent.a * u_appear);
  }

  // CONTRAST COMPRESSION. The medium removes some light and mixes in scattered light, so content
  // under the glass moves toward the middle rather than simply getting lighter (M 2:35). The
  // previous layer only added light and, over a light backdrop, pushed the body the opposite way
  // from the reference.
  rgb = mix(rgb, vgHue(ambient) * VG_MEDIUM_LUMA, VG_MEDIUM_PULL * u_appear);
  // Ambient light reaches the body the same way across the whole element.
  rgb += ambient * u_edgeLight * VG_AMBIENT_SPILL * u_appear;
  // Glass concentrates light; the played portion is the segment where there's more of it.
  float glow = VG_CONCENTRATE + 0.08 * vgProgress(p, u_halfSize, u_progress);
  rgb += (1.0 - rgb) * glow * lens;

  // Under the finger and during morphing, glass concentrates light into a spot (M 4:56, 5:11).
  // This is a CONCENTRATION of the surroundings, not the glass's own whiteness: over a dark
  // backdrop the element lightens but never turns white, and ink over it stays legible.
  if (u_touchPress > 0.001) {
    float2 fromTouch = p - u_touch;
    float spotR = max(min(u_halfSize.x, u_halfSize.y) * 1.2, 1.0);
    float spot = u_touchPress * (0.3 + 0.55 * exp(-dot(fromTouch, fromTouch) / (spotR * spotR)));
    rgb = mix(rgb, clamp(ambient * 1.6 + float3(0.1), float3(0.0), float3(1.0)), spot * lens);
  }

  // RIM LIGHT — a separate layer, a line about 1 pt wide along the silhouette (M 2:36, 11:04):
  // brighter where the face faces the key light, weaker opposite it; where no light falls, a
  // dark outline. This line is what holds the element's presence, not a fill on the body: over a
  // flat backdrop a control is visible along its whole silhouette because of it.
  float line = (1.0 - smoothstep(0.0, lineW, e)) * lens;
  float outline = (1.0 - smoothstep(0.0, lineW * 0.6, e)) * lens;
  float lit = clamp(max(rimKey * 1.4, u_presence * 2.0), 0.0, 1.0);
  // The dark rim is its own layer around the whole silhouette, and the highlight sits ON TOP of
  // it (iOS 27). While the outline used to fade via a (1 − lit) multiplier, the silhouette read
  // as a single arc: highlight OR shadow.
  rgb *= 1.0 - ${RIM.darkEdge} * outline;
  rgb = mix(rgb, mix(refl, float3(1.0), 0.75), line * lit);

  if (u_debug > 9.5 && u_debug < 10.5) { rgb = spectral * 0.5; }
  if (u_debug > 10.5 && u_debug < 11.5) { rgb = float3(density, needForInk, structure); }
  // WHAT THE PROBE SAID ABOUT THE BACKDROP — three values that drive all the tinting: the
  // average lightness under the element, the vertical lightness slope, and the lightness AT THIS
  // SPOT. The slope is shown offset and squeezed by half: it's signed and rarely exceeds a
  // magnitude of one half.
  if (u_debug > 11.5) { rgb = float3(max(u_probeLuma, 0.0), 0.5 + u_probeSlope.y * 0.5, local); }

  rgb = vgSoftClip(rgb);

  // Sample alpha has to survive to the result: un-premultiplying color by its original alpha and
  // then returning it with a different one (the shape mask) would make a transparent backdrop
  // opaque and blow it out.
  float alpha = srcA * (1.0 - smoothstep(-1.0, 1.0, sd));
  return half4(half3(clamp(rgb, float3(0.0), float3(1.0)) * alpha), half(alpha));
}
`;
