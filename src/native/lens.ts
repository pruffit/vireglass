import type { ComponentType, ReactNode } from 'react';
import { Platform, type StyleProp, type ViewStyle } from 'react-native';
// Through `expo`, not directly from `expo-modules-core`: in this layout the latter is a
// transitive dependency, and pnpm doesn't hoist it into the app's node_modules.
import { requireNativeModule, requireNativeView } from 'expo';

/**
 * Props of the native lens. Names MUST match the `Prop("…")` calls in `GlassLensModule.kt`:
 * Expo swallows an unknown prop silently, and the lens just doesn't turn on — that's exactly how
 * refraction ended up disabled in production for an entire phase. Parity is pinned down by a
 * consuming app's own material-parity test.
 *
 * Material values aren't assembled here by hand — they come from `toLensProps` (`adapters.ts`).
 */
export type GlassLensProps = {
  /** Tag of the GlassBackdrop whose frame snapshot the lens uses for refraction. */
  backdropId?: number | null;
  /** AGSL source. Assembled in JS so the lens and the surface share one geometry string. */
  shaderSource: string;
  /** Size of the VISIBLE glass, in dp. The view itself must be bigger than it: the rim gathers
   *  light from OUTSIDE the shape, and scattering blurs the backdrop around a point — without
   *  the margin the shader has nothing there to sample. The lightness probe's rectangle is taken
   *  from the same size. */
  glassWidth: number;
  glassHeight: number;
  /** Material uniforms as one channel (`toLensProps`): name ↔ size ↔ values. There used to be a
   *  separate prop per value, and a typo would silently turn the whole lens off. */
  uniformNames: string[];
  uniformSizes: number[];
  /** Values arrive through the animated prop: the pull worklet substitutes them in. They CANNOT
   *  also be sent through the ordinary prop at the same time — on frequent repaints it
   *  overwrites what was substituted in. */
  uniformValues?: number[];
  /** Lightness, variegation and average color of the backdrop UNDER the glass. The app listens
   *  to this to recolor the ink once the glass has worked past its own limit. */
  onBackdropSample?: (e: {
    nativeEvent: {
      luma: number;
      busy: number;
      lo: number;
      hi: number;
      r: number;
      g: number;
      b: number;
    };
  }) => void;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
};


const native = (() => {
  if (Platform.OS !== 'android') return null;
  try {
    const view = requireNativeView('GlassLens', 'GlassLensView') as ComponentType<GlassLensProps>;
    const constants = requireNativeModule('GlassLens') as { isSupported?: boolean };
    return { view, supported: constants.isSupported === true };
  } catch (e) {
    console.warn('GlassLens: native view failed to load', e);
    return null;
  }
})();

export type GlassBackdropProps = { style?: StyleProp<ViewStyle>; children?: ReactNode };

/**
 * Backdrop capture WITHOUT blur. expo-blur hands back a dithered copy: on Android 13+ it routes
 * the capture through `createBlurEffect`, and Skia dithers the blur's output (measured in the
 * lab, see `docs/benchmarks.md`).
 */
export const GlassBackdrop: ComponentType<GlassBackdropProps> | null =
  Platform.OS === 'android'
    ? (() => {
        try {
          return requireNativeView('GlassLens', 'GlassBackdropView') as ComponentType<GlassBackdropProps>;
        } catch {
          return null;
        }
      })()
    : null;

/** Diagnostic probe: exactly what arrives in `createRuntimeShaderEffect`.
 *  Lab-only, not used in production UI. */
export type GlassProbeProps = {
  /** 0 — raw sample, 1 — sample + a shader-liveness marker, 2 — alpha map. */
  mode?: number;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
};

export const GlassProbe: ComponentType<GlassProbeProps> | null =
  Platform.OS === 'android'
    ? (() => {
        try {
          return requireNativeView('GlassLens', 'GlassProbeView') as ComponentType<GlassProbeProps>;
        } catch {
          return null;
        }
      })()
    : null;

/** `RenderEffect.createRuntimeShaderEffect` — Android 13+. Below it, the caller must stay on the
 *  previous affine magnification: the view there just works as an ordinary container. */
export const isGlassLensSupported: boolean = native?.supported ?? false;

export const GlassLens: ComponentType<GlassLensProps> | null = native?.view ?? null;
