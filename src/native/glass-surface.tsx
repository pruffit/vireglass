import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  findNodeHandle,
  PixelRatio,
  Platform,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {
  Canvas,
  ColorShader,
  Fill,
  ImageShader,
  Shader,
  Skia,
  type SkImage,
} from '@shopify/react-native-skia';
import Animated, {
  useAnimatedProps,
  useDerivedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { GlassLens as GlassLensNative, isGlassLensSupported } from './lens';
import {
  lensMagnify,
  toLensProps,
  toSurfaceUniforms,
  type VireGlassMorph,
} from '../adapters';
import {
  lensPadDp,
  shadowOpacityFrom,
  surfacePadDp,
  type VireGlassGeometry,
} from '../geometry';
import {
  ambientFrom,
  type BackdropSample,
} from '../adaptation';
import type { DeformSample } from '../touch-response';
import type { VireGlassDebugMode, VireGlassOptics } from '../material';
import { LENS_SHADER } from '../lens-shader';
import { SURFACE_SHADER } from '../surface-shader';
import { useBackdropEnabled, useResolvedOptics } from './provider';
import { useGlassSurfaceRegistration } from './surface-registry';

function compile(src: string) {
  const effect = Skia.RuntimeEffect.Make(src);
  if (!effect) throw new Error('VireGlass: surface SKSL failed to compile');
  return effect;
}

/** The fraction of activity that a touch alone raises, matching the same fraction the web
 *  implementation's own button logic uses. */
const ACTIVE_ON_TOUCH = 0.3;

const SURFACE = compile(SURFACE_SHADER);

/** The lens takes pull as an animated prop: it and the surface must bend in the SAME frame.
 *  Through an ordinary prop the value would travel from the JS thread while the surface travels
 *  from the UI thread, and the layers would drift apart exactly the way they once did with the
 *  transform. The wrapper is created once: `createAnimatedComponent` inside render would
 *  recreate the type and drop the view every frame. */
const AnimatedGlassLens = GlassLensNative
  ? Animated.createAnimatedComponent(GlassLensNative)
  : null;

export type GlassDynamics = {
  shiftX: SharedValue<number>;
  shiftY: SharedValue<number>;
  press: SharedValue<number>;
  active: SharedValue<number>;
  /** Key light direction in screen coordinates (unit vector). */
  light: SharedValue<readonly number[]>;
};

export type GlassIcon = {
  image: SkImage | null;
  /** Mask scale: it's built in device pixels, and mushes on 3x screens at dp. */
  scale: number;
  inkIdle: number[];
  inkActive: number[];
  /** A colored layer ON the glass: the currently playing track's cover art, same idea as the web
   *  mini-player. The mask is single-channel and colored by polarity, while this layer carries
   *  its own color as-is. It shares the mask's box: the shader samples both at the same `inkUv`. */
  overlay?: SkImage | null;
};

type GlassBackdropRead = { ambient: [number, number, number]; shadow: number };

export function VireGlassSurface({
  geometry,
  optics,
  dynamics,
  debug = 'normal',
  morph,
  blurTarget,
  backdrop = true,
  shadow,
  dragLimit = 0,
  icon,
  progress,
  touch,
  appear,
  lift = 0,
  dim = 0,
  topLayer = false,
  onBackdropSample,
  style,
}: {
  geometry: VireGlassGeometry;
  optics: VireGlassOptics;
  dynamics: GlassDynamics;
  debug?: VireGlassDebugMode;
  morph?: VireGlassMorph;
  /** Target of the live blur — the current screen's own content view. */
  blurTarget?: RefObject<View | null> | null;
  /** Turning this off mounts the surface with no backdrop: a reference point for comparing
   *  against it in the lab. */
  backdrop?: boolean;
  /** Manual shadow density. Without it, the probe drives it from what's under the element. */
  shadow?: number;
  dragLimit?: number;
  icon?: GlassIcon;
  /** Played fraction, 0…1: to the left of the boundary the element is active, to the right it
   *  isn't. Travels as a shared value — through an ordinary prop it would rebuild the whole
   *  uniform channel and overwrite the pull drop the worklet had already substituted in, exactly
   *  as it once did with the static `uniformValues`. */
  progress?: SharedValue<number>;
  /** Response to a finger BY THE CORE MODEL (`createDeform`): touch point, pull around the spot,
   *  the dent, and the wave. This didn't exist here at all before — the shader got `NO_TOUCH`,
   *  i.e. zeros, and no deformation existed for any gesture. The web runs the exact same fields
   *  (`web/renderer.ts`); the adapter contract is shared and specified in dp. */
  touch?: SharedValue<DeformSample>;
  /** Fraction in which the element EXISTS, 0…1: the glass builds up rather than fading in
   *  through opacity (reference §12). Travels as a shared value for the same reason as
   *  `progress`. */
  appear?: SharedValue<number>;
  /** 0 — under the finger the element sinks in, 1 — it rises into glass and its shadow pulls
   *  back (reference §5). A property of the element itself, not of its motion, so an ordinary
   *  prop. */
  lift?: number;
  /** Lightness of the backdrop UNDER the glass, about every 200 ms. This is how the screen finds
   *  out the glass has hit its own limit and it's time to recolor the ink (`adaptation.ts`). */
  onBackdropSample?: (e: { nativeEvent: BackdropSample }) => void;
  /** Dimming of the lens under the screen's scrim: BlurView targets the content directly and
   *  can't see a darkening overlay drawn above it — without this the lens glows through the
   *  scrim like a hole. */
  dim?: number;
  /** Top-layer surface: not muted by the screen's own overlay. */
  topLayer?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { width, height, cornerRadius } = geometry;
  const pad = surfacePadDp(geometry, dragLimit, morph);

  // The lens view must not change size on the fly: every change is a relayout plus a new
  // `RenderEffect`, and to the eye it reads as a jolt. Morphing, though, moves the second shape
  // every frame, meaning the required margin changes continuously. So the margin only GROWS: it
  // reaches its maximum on the first pass, and stays fixed from then on. It only resets when the
  // element's own size changes.
  const padRef = useRef(0);
  const geometryKey = `${width}x${height}x${cornerRadius}`;
  const geometryRef = useRef(geometryKey);
  if (geometryRef.current !== geometryKey) {
    geometryRef.current = geometryKey;
    padRef.current = 0;
  }
  // The probe already computes both the ambient color (it bleeds into the shadow, reference §7)
  // and the variegation (shadow density follows it, 219 @11:47) — the only job left is not to
  // lose them along the way. The subscription sits right where the measurement already happens:
  // glass with a hand-pinned polarity has no probe, and its shadow doesn't adapt.
  const [sampled, setSampled] = useState<GlassBackdropRead | undefined>(undefined);
  const handleSample = useMemo(() => {
    if (!onBackdropSample) return undefined;
    return (event: { nativeEvent: BackdropSample }) => {
      const ambient = ambientFrom(event.nativeEvent);
      const shade = shadowOpacityFrom(event.nativeEvent);
      setSampled((prev) =>
        prev &&
        prev.shadow === shade &&
        prev.ambient[0] === ambient[0] &&
        prev.ambient[1] === ambient[1] &&
        prev.ambient[2] === ambient[2]
          ? prev
          : { ambient, shadow: shade },
      );
      onBackdropSample(event);
    };
  }, [onBackdropSample]);

  // The user's clarity and the system's settings, in that order (reference §3, §9). Applied right
  // here: every piece of the app's glass passes through this surface, and one place is enough.
  const tuned = useResolvedOptics(optics);

  padRef.current = Math.max(padRef.current, lensPadDp(geometry, tuned, morph, dragLimit));
  const lensPad = padRef.current;

  // The blur target is a ref, and it's still empty on the first render: by itself it doesn't
  // trigger a repaint. Without this effect the glass stays without a backdrop until the first
  // unrelated re-render — forever, on a static screen.
  const [hasTarget, setHasTarget] = useState(false);
  // The native lens needs the target's TAG: it uses it to find its own capture inside it.
  const [backdropId, setBackdropId] = useState<number | null>(null);
  useEffect(() => {
    const node = blurTarget?.current ?? null;
    setHasTarget(node != null);
    setBackdropId(node ? findNodeHandle(node) : null);
  }, [blurTarget]);

  // The single point where whether the backdrop lives gets decided. ALL of the app's glass
  // passes through it, so both the settings toggle and suppression under an open sheet sit here
  // rather than being smeared across consumers. Suppression under a sheet is mandated by the kit
  // itself: the layers below the scrim have nothing left to refract, and it's also what keeps
  // the surface count within the green zone (`surface-registry.ts`).
  const backdropAllowed = useBackdropEnabled(topLayer);
  const liveBackdrop = backdrop && backdropAllowed;
  const refracting = isGlassLensSupported && GlassLensNative !== null;
  const backdropReady = liveBackdrop && hasTarget && blurTarget?.current != null;
  // The view with the probe below is mounted by this same expression — the two conditions have
  // nothing to diverge on. And there is something for them to diverge on: the lens goes away
  // both under an open sheet and under reduced transparency, while the shadow always renders,
  // and the color of a backdrop that's gone would otherwise freeze in it.
  const measuring = backdropReady && refracting && AnimatedGlassLens !== null;
  const read = measuring ? sampled : undefined;
  const ambient = read?.ambient;
  // Shadow density follows what's UNDER THE ELEMENT (219 @11:47), computed by the same probe as
  // the color.
  const shade = shadow ?? read?.shadow ?? 1;

  // The lens draws the glass body when it's live: only there is the backdrop visible, and
  // without a backdrop there's no such thing as point-wise adaptation. The surface is then left
  // with the highlight, the shadow, and the icon.
  const bodyInLens = isGlassLensSupported && GlassLensNative !== null && hasTarget;
  const statics = useMemo(
    () => toSurfaceUniforms(tuned, geometry, { debug, morph, dragLimit, shadow: shade, bodyInLens, ambient, lift }),
    [tuned, geometry, debug, morph, dragLimit, shade, bodyInLens, ambient, lift],
  );
  // The shader source is part of the result, so it's in the dependency list. Formally it's a
  // module constant, but hot reload changes it, and a memo with the old dependencies keeps
  // handing back the OLD shader: an optics edit silently fails to arrive.
  const lensProps = useMemo(
    // The backdrop estimate is the lens's OWN probe, as on the web. A group estimate used to
    // override it and was an Android-only invention: on the web there's no `groupProbe` at all —
    // there, every element adapts by its own probe. Because of that override, the nav bar and
    // the feed screen adapted to the surroundings differently under one and the same material.
    () => toLensProps(tuned, geometry, PixelRatio.get(), { debug, morph }),
    [tuned, geometry, debug, morph, LENS_SHADER],
  );
  const iconUniforms = useMemo(
    () => ({
      u_iconOn: icon?.image ? 1 : 0,
      u_iconScale: icon?.scale ?? 1,
      // The shader slot must always be occupied: Skia hands out child shaders in declaration
      // order, and an empty slot would shift the ink mask.
      u_overlayOn: icon?.overlay ? 1 : 0,
      u_inkIdle: icon?.inkIdle ?? [1, 1, 1, 1],
      u_inkActive: icon?.inkActive ?? [1, 1, 1, 1],
    }),
    [icon],
  );

  const { press, active, light } = dynamics;

  const halfMin = Math.min(geometry.width, geometry.height) / 2;
  /** A finger is an area, not a point. The radius is taken from the SMALLER half-size: otherwise
   *  on a wide plate the touch would spread across its whole length. Same fraction the web
   *  implementation uses for its own touch handling. */
  const touchRadius = 0.72 * halfMin;
  // The lens channel is in pixels, while the whole model's geometry is in dp. Read once:
  // `PixelRatio` isn't available inside a worklet.
  const density = PixelRatio.get();

  // Where each value sits in the lens's flat uniform channel. Names and sizes are fixed, so the
  // offsets are computed once, leaving the worklet to just plug in the numbers.
  const slots = useMemo(() => {
    const at: Record<string, number> = {};
    let i = 0;
    for (let k = 0; k < lensProps.uniformNames.length; k += 1) {
      at[lensProps.uniformNames[k]] = i;
      i += lensProps.uniformSizes[k];
    }
    return {
      progress: at.u_progress ?? -1,
      touch: at.u_touch ?? -1,
      pull: at.u_pull ?? -1,
      touchPress: at.u_touchPress ?? -1,
      touchRadius: at.u_touchRadius ?? -1,
      wave: at.u_wave ?? -1,
      light: at.u_light ?? -1,
    };
  }, [lensProps]);

  // Uniform values travel ONLY through the animated prop. While they still also went through the
  // ordinary one, with an active group (which repaints the block a couple dozen times a second)
  // the ordinary prop kept overwriting the drop the worklet had substituted in, and on a given
  // frame it simply wasn't there.
  const { uniformValues: _values, ...lensStatic } = lensProps;

  const lensAnimatedProps = useAnimatedProps<{ uniformValues: number[] }>(() => {
    const values = lensProps.uniformValues.slice();
    if (slots.progress >= 0 && progress) values[slots.progress] = progress.value;
    // The lens computes the rim light, while device tilt arrives via the worklet — into the
    // same slot.
    if (slots.light >= 0) {
      values[slots.light] = light.value[0];
      values[slots.light + 1] = light.value[1];
    }
    // Response to a finger. The lens channel is in PIXELS while the model is in dp: geometric
    // fields get multiplied by density, the wave phase and the dent are dimensionless. The web
    // does the same conversion (`web/renderer.ts`); the adapter contract can't be touched — it's
    // shared.
    if (touch) {
      const t = touch.value;
      if (slots.touch >= 0) {
        values[slots.touch] = t.touchX * density;
        values[slots.touch + 1] = t.touchY * density;
      }
      if (slots.pull >= 0) {
        values[slots.pull] = t.pullX * density;
        values[slots.pull + 1] = t.pullY * density;
      }
      if (slots.touchPress >= 0) values[slots.touchPress] = t.press;
      if (slots.touchRadius >= 0) values[slots.touchRadius] = touchRadius * density;
      if (slots.wave >= 0) {
        values[slots.wave] = t.waveAmp * density;
        values[slots.wave + 1] = t.wavePhase;
      }
    }
    return { uniformValues: values };
  }, [lensProps, slots, density, progress, touch, touchRadius, light]);

  const uniforms = useDerivedValue(() => {
    return {
      ...statics,
      ...iconUniforms,
      // Response to a finger by the core model. Nothing used to arrive here at all, and the
      // shader ran on `NO_TOUCH` — zeros: no touch point, no pull, no wave existed.
      u_touch: touch ? [touch.value.touchX, touch.value.touchY] : statics.u_touch,
      u_pull: touch ? [touch.value.pullX, touch.value.pullY] : statics.u_pull,
      u_touchPress: touch ? touch.value.press : statics.u_touchPress,
      u_touchRadius: touch ? touchRadius : statics.u_touchRadius,
      u_wave: touch ? [touch.value.waveAmp, touch.value.wavePhase] : statics.u_wave,
      u_press: touch ? touch.value.press : press.value,
      // Touch and activity feed one uniform: the stronger of the two wins, otherwise pressing an
      // already-active element would read as switching it off. Same fraction as the web
      // implementation's own button logic: a touch raises activity by a third, not to the full
      // value.
      u_active: touch ? Math.max(touch.value.active * ACTIVE_ON_TOUCH, active.value) : active.value,
      u_progress: progress ? progress.value : statics.u_progress,
      // The element builds up as glass, not through opacity: zero means it doesn't exist at all.
      u_appear: appear ? appear.value : statics.u_appear,
    };
  }, [statics, iconUniforms, progress, touch, touchRadius, appear]);

  const magnify = lensMagnify(tuned);

  // Guards the ACTUAL count of live surfaces; a consuming app's own test guards the declared
  // model.
  useGlassSurfaceRegistration(liveBackdrop && hasTarget);

  return (
    <View collapsable={false} style={[styles.host, style, { width, height }]}>
      {/* The kit's "reduced" state: glass is off — the panel is opaque, blur is removed. */}
      {!backdropAllowed && (
        <View
          style={[styles.opaque, { width, height, borderRadius: cornerRadius }]}
          pointerEvents="none"
        />
      )}
      {/* A screenshot (makeImageFromView) is a non-starter for the backdrop in principle: about
          1000 ms per frame, and any refraction against it would lag. BlurView with blurTarget
          draws the screen's content natively, frame by frame, and is aligned with it by
          construction. */}
      {/* collapsable={false} is required on both: the static style has no transform, it only
          arrives from the worklet, and Android RN treats such a node as redundant and collapses
          it into its parent — the deformation then has simply nowhere to apply. */}
      <View
        style={[styles.moving, { width, height }]}
        pointerEvents="none"
        collapsable={false}
      >
        <View style={[styles.lens, { width, height }]}>
        {backdropReady ? (
          measuring && AnimatedGlassLens ? (
            // The lens view is DELIBERATELY bigger than the glass — at the rim the sample runs
            // past its bounds, and the shader itself carves out the shape.
            <AnimatedGlassLens
              {...lensStatic}
              animatedProps={lensAnimatedProps}
              backdropId={backdropId}
              onBackdropSample={handleSample}
              style={{
                position: 'absolute',
                width: width + lensPad * 2,
                height: height + lensPad * 2,
              }}
            />
          ) : (
            // Fallback below Android 13: uniform magnification. This is a magnifying glass, not
            // a lens — an affine transform can't express a radially varying shift.
            <View style={[styles.clip, { width, height, borderRadius: cornerRadius }]}>
              <View
                style={{
                  position: 'absolute',
                  left: (width * (1 - 1 / magnify)) / 2,
                  top: (height * (1 - 1 / magnify)) / 2,
                  width: width / magnify,
                  height: height / magnify,
                  transform: [{ scale: magnify }],
                }}
              >
                {/* The fallback has no shader — there's nothing but BlurView left to blur with. */}
                <BlurView
                  intensity={tuned.blur}
                  tint="dark"
                  blurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
                  blurTarget={blurTarget}
                  style={StyleSheet.absoluteFill}
                />
              </View>
            </View>
          )
        ) : null}
        {dim > 0 ? (
          <View
            style={[styles.scrim, { width, height, borderRadius: cornerRadius, opacity: dim }]}
          />
        ) : null}
        </View>
        <Canvas
        style={[
          styles.canvas,
          { width: width + pad * 2, height: height + pad * 2, left: -pad, top: -pad },
        ]}
      >
        {/* dither is OFF: Skia mixes it in while rasterizing to an 8-bit surface, and on dark
            content that reads as grain. Measured in the lab: with the backdrop off, leaving only
            this layer, grain inside comes to 3.5 against 0.04 outside. */}
        <Fill dither={false}>
          <Shader source={SURFACE} uniforms={uniforms}>
            {icon?.image ? (
              <ImageShader image={icon.image} tx="decal" ty="decal" />
            ) : (
              <ColorShader color="#00000000" />
            )}
            {/* Second slot — the colored layer (u_overlay): the mini-player's cover art. */}
            {icon?.overlay ? (
              <ImageShader image={icon.overlay} tx="decal" ty="decal" />
            ) : (
              <ColorShader color="#00000000" />
            )}
          </Shader>
        </Fill>
        </Canvas>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { overflow: 'visible' },
  moving: { position: 'absolute' },
  lens: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  clip: { position: 'absolute', overflow: 'hidden' },
  canvas: { position: 'absolute' },
  scrim: { position: 'absolute', backgroundColor: '#0d0b09' },
  // Opaque backdrop for the "glass off" state. The colour comes from the host kit's reduced
  // state, which is not part of this package — a literal here rather than a dangling citation.
  opaque: { position: 'absolute', backgroundColor: '#0b0908' },
});
