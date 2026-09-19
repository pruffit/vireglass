// System accessibility settings (reference `docs/reference.md` §9): the material has to listen
// to them on its own, without help from screens. This module only READS the system; the host
// app's own toggle is mixed in by the provider (`provider.tsx`), so this module knows nothing
// about the app.
import { useSyncExternalStore } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import type { VireGlassAccessibility } from '../accessibility';

export type SystemAccessibility = {
  reduceMotion: boolean;
  reduceTransparency: boolean;
  increaseContrast: boolean;
};

const OFF: SystemAccessibility = {
  reduceMotion: false,
  reduceTransparency: false,
  increaseContrast: false,
};

let state: SystemAccessibility = OFF;
const listeners = new Set<() => void>();
let subscriptions: { remove: () => void }[] = [];

function put(key: keyof SystemAccessibility, value: boolean): void {
  if (state[key] === value) return;
  state = { ...state, [key]: value };
  for (const notify of listeners) notify();
}

/** Contrast is named differently per system: on Android it's high-contrast text, on iOS it's
 *  darker system colors. The signal is one and the same, and the material responds to it
 *  identically. */
const CONTRAST =
  Platform.OS === 'ios'
    ? { read: () => AccessibilityInfo.isDarkerSystemColorsEnabled(), event: 'darkerSystemColorsChanged' as const }
    : { read: () => AccessibilityInfo.isHighTextContrastEnabled(), event: 'highTextContrastChanged' as const };

function start(): void {
  // The first answer arrives as a promise, later ones as an event: without the first, a setting
  // only gets picked up after someone toggles it — i.e. never, on a screen that's already open.
  AccessibilityInfo.isReduceMotionEnabled().then((on) => put('reduceMotion', on)).catch(() => {});
  AccessibilityInfo.isReduceTransparencyEnabled().then((on) => put('reduceTransparency', on)).catch(() => {});
  CONTRAST.read().then((on) => put('increaseContrast', on)).catch(() => {});
  subscriptions = [
    AccessibilityInfo.addEventListener('reduceMotionChanged', (on) => put('reduceMotion', on)),
    AccessibilityInfo.addEventListener('reduceTransparencyChanged', (on) => put('reduceTransparency', on)),
    AccessibilityInfo.addEventListener(CONTRAST.event, (on) => put('increaseContrast', on)),
  ];
}

function stop(): void {
  for (const subscription of subscriptions) subscription.remove();
  subscriptions = [];
}

/**
 * ONE subscription per app, not per surface: a screen can hold up to a dozen glass elements at
 * once, and a pair of bridge requests for each of them would be a real cost for no reason.
 * Native listeners live as long as there's at least one reader.
 */
export function subscribeToSystemAccessibility(listener: () => void): () => void {
  if (listeners.size === 0) start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stop();
  };
}

const read = (): SystemAccessibility => state;

export function useSystemAccessibility(): SystemAccessibility {
  return useSyncExternalStore(subscribeToSystemAccessibility, read, read);
}

/**
 * The app's own setting combines with the system one and can only TIGHTEN it: someone who asked
 * the system to remove motion shouldn't get it back because of a toggle inside the kit.
 */
export function mergeAccessibility(
  system: SystemAccessibility,
  appReduceMotion: boolean,
): VireGlassAccessibility {
  return {
    reduceTransparency: system.reduceTransparency,
    increaseContrast: system.increaseContrast,
    reduceMotion: system.reduceMotion || appReduceMotion,
  };
}
