import { useEffect } from 'react';
import { Accelerometer } from 'expo-sensors';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';
import { REST_LIGHT } from '../adapters';

// Raw accelerometer readings don't go straight into the shader. Pipeline: sensor → normalized
// tilt → low-pass filter → deadzone → light direction. Without the filter and the deadzone, a
// phone at rest still shows visible highlight jitter — sensor noise exceeds the highlight's
// noticeability threshold.
const INTERVAL_MS = 50;
const SMOOTHING = 0.12;
const DEADZONE = 0.008;
/** How far the key light swings at full tilt, radians. */
const MAX_SWING = 0.55;

function rotate(v: readonly number[], angle: number): number[] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c];
}

// Tilt is shared across every surface — there's one sensor per device. The subscription is
// shared too: with `environment > 0` in the default material, otherwise each piece of glass (up
// to six at once) got its own listener and recomputed the same filter from scratch.
const listeners = new Set<(tilt: number) => void>();
let subscription: { remove: () => void } | null = null;
let tilt = 0;

function subscribe(cb: (tilt: number) => void): () => void {
  listeners.add(cb);
  if (!subscription) {
    Accelerometer.setUpdateInterval(INTERVAL_MS);
    subscription = Accelerometer.addListener(({ x, y }) => {
      const raw = Math.max(-1, Math.min(1, x * 0.7 + y * 0.3));
      tilt += (raw - tilt) * SMOOTHING;
      for (const listener of listeners) listener(tilt);
    });
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0) {
      subscription?.remove();
      subscription = null;
      tilt = 0;
    }
  };
}

/**
 * Key light direction. `strength = 0` doesn't subscribe to the sensor at all and keeps the light
 * locked to the screen.
 */
export function useEnvironmentLight(strength: number): SharedValue<readonly number[]> {
  const light = useSharedValue<readonly number[]>(REST_LIGHT);

  useEffect(() => {
    if (strength <= 0) {
      light.value = REST_LIGHT;
      return;
    }
    let emitted = 0;
    return subscribe((next) => {
      if (Math.abs(next - emitted) < DEADZONE) return;
      emitted = next;
      light.value = rotate(REST_LIGHT, -next * MAX_SWING * strength);
    });
  }, [strength, light]);

  return light;
}
