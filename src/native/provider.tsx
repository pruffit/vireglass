import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { mergeAccessibility, useSystemAccessibility } from './system-accessibility';
import type { VireGlassAccessibility } from '../accessibility';

/**
 * Host app policy for VireGlass, provided once at the root.
 *
 * `glassEnabled` is the app's escape hatch: the performance envelope here was measured on one
 * flagship device, and behaviour on weak hardware is unknown, so the host must be able to turn
 * all glass off at once. `backdropAllowed` lets the host suppress live backdrops on its own terms
 * (e.g. while a sheet is open) — without it, `glassEnabled` is the fallback for that too.
 */
type VireGlassContextValue = {
  glassEnabled: boolean;
  reduceMotion: boolean;
  backdropAllowed?: (topLayer: boolean) => boolean;
};

const DEFAULT_CONTEXT: VireGlassContextValue = {
  glassEnabled: true,
  reduceMotion: false,
};

/** A default value, not a throw: a host that hasn't mounted the provider still gets working
 *  glass with sane defaults, rather than a crash on first render. */
const VireGlassContext = createContext<VireGlassContextValue>(DEFAULT_CONTEXT);

export function VireGlassProvider({
  glassEnabled = true,
  reduceMotion = false,
  backdropAllowed,
  children,
}: {
  glassEnabled?: boolean;
  reduceMotion?: boolean;
  backdropAllowed?: (topLayer: boolean) => boolean;
  children: ReactNode;
}) {
  const value = useMemo<VireGlassContextValue>(
    () => ({ glassEnabled, reduceMotion, backdropAllowed }),
    [glassEnabled, reduceMotion, backdropAllowed],
  );
  return <VireGlassContext.Provider value={value}>{children}</VireGlassContext.Provider>;
}

/** System accessibility settings merged with the host's own motion toggle. Memoized, as the
 *  original store-backed version was: it feeds shader uniforms downstream, and an unstable
 *  reference there would recompute them on every render for no reason. */
export function useAccessibilityModifiers(): VireGlassAccessibility {
  const { reduceMotion } = useContext(VireGlassContext);
  const system = useSystemAccessibility();
  return useMemo(() => mergeAccessibility(system, reduceMotion), [system, reduceMotion]);
}

export function useBackdropEnabled(topLayer?: boolean): boolean {
  const { glassEnabled, backdropAllowed } = useContext(VireGlassContext);
  return backdropAllowed?.(topLayer ?? false) ?? glassEnabled;
}
