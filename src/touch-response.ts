// The element's response to a finger — PART OF THE MATERIAL, not the app: the springs here
// describe what the medium feels like, exactly the way ior describes what it looks like through.
// Keeping them with the consumer would mean web and Android end up with two different glasses
// under one name.
//
// It's the FIELD around the touch point that deforms (vgTouchWarp in sdf.ts), so four values are
// computed here: where it was touched, how far it's being dragged, how deep the press is, and
// what wave is currently running.
//
// The key point: drag is anchored to the touch BLOB. Pull the right edge and the right edge
// moves, the left stays put; the finger has area, not a point — the plateau inside `vgTouchWarp`.
// Scaling the shape's bounding box isn't an option: that would make a rightward pull also bulge
// the left side, which liquid doesn't do.
//
//   PRESS is viscous: it dents shallow and releases slowly.
//   DRAG is thick: the body noticeably lags the finger, travel is short, and on release it snaps
//   back quickly with almost no overshoot. A wide, springy overshoot would be liquid jelly, not
//   dense glass.
//   WAVE: touch and lift-off each throw a short ring that decays within a quarter second.

import { ACCESSIBILITY } from './law';

export type DeformSample = {
  /** Touch point relative to the element's center, CSS pixels. */
  touchX: number;
  touchY: number;
  pullX: number;
  pullY: number;
  press: number;
  active: number;
  /** Wave amplitude in CSS pixels and its phase in turns. */
  waveAmp: number;
  wavePhase: number;
};

const HOLD_STIFFNESS = 260;
const HOLD_DAMPING = 46;
/** Release is stiffer than hold, but damping is high: a dense medium snaps back fast with almost
 *  no overshoot. A visible overshoot would be liquid jelly, not dense glass. */
const RELEASE_STIFFNESS = 420;
const RELEASE_DAMPING = 34;

const PRESS_ATTACK = 0.07;
const PRESS_RELEASE = 0.16;

/** The wave is short and weak: in a viscous medium ripples decay within a quarter second rather
 *  than oscillating. */
const WAVE_DECAY = 0.22;
const WAVE_TURNS_PER_SECOND = 3.0;

/**
 * `elastic: false` is reduced motion (§9): the spring and the ripple are the material's elastic
 * properties and stop, the press stays and is damped. An element that goes dead under the setting
 * would not be reduced motion — it would be no feedback at all, and the press is what lights the
 * element from within (§5), which is light rather than movement.
 */
export type DeformOptions = { elastic?: boolean };

export function createDeform(options: DeformOptions = {}) {
  let elastic = options.elastic !== false;
  let pressCeiling = elastic ? 1 : ACCESSIBILITY.stillPress;
  let touchX = 0;
  let touchY = 0;
  let targetTouchX = 0;
  let targetTouchY = 0;
  let pullX = 0;
  let pullY = 0;
  let vx = 0;
  let vy = 0;
  let targetX = 0;
  let targetY = 0;
  let held = false;
  let press = 0;
  let active = 0;
  let waveAmp = 0;
  let wavePhase = 0;

  /** `x`, `y` — touch point relative to the element's center, CSS pixels. */
  function grab(x: number, y: number, waveStart: number): void {
    // Rest is checked BEFORE the grab: idle() looks at !held, and after `held = true` it's
    // always false — the point would then jump even on a first touch of a resting element.
    const atRest = idle();
    held = true;
    targetTouchX = x;
    targetTouchY = y;
    // On a resting element the finger lands instantly; if it hasn't settled yet from the
    // previous touch, the point travels there over a couple of frames. An instant jump tears the
    // deformation, and on rapid taps that reads as jitter.
    if (atRest) {
      touchX = x;
      touchY = y;
    }
    targetX = 0;
    targetY = 0;
    // Impulses ADD UP rather than restart, and phase isn't reset: resetting it would cut off a
    // running wave mid-period, which is exactly what causes a jolt on rapid clicks.
    if (elastic) waveAmp = Math.min(waveAmp + waveStart, waveStart * 1.6);
  }

  function drag(dx: number, dy: number, limit: number): void {
    if (!held || !elastic) return;
    const len = Math.hypot(dx, dy);
    // Travel saturates rather than clips: near the limit the finger keeps moving while the field
    // barely does — that's how a thick liquid behaves once it hits its limit.
    const scale = len > 1e-3 ? (limit * Math.tanh(len / limit)) / len : 0;
    targetX = dx * scale;
    targetY = dy * scale;
  }

  /** Lifting the finger throws a second wave — weaker than the one from touching down. */
  function release(waveStart: number): void {
    held = false;
    targetX = 0;
    targetY = 0;
    if (elastic) waveAmp = Math.min(waveAmp + waveStart, waveStart * 2);
  }

  function integrate(dt: number): void {
    const k = held ? HOLD_STIFFNESS : RELEASE_STIFFNESS;
    const c = held ? HOLD_DAMPING : RELEASE_DAMPING;
    vx += (k * (targetX - pullX) - c * vx) * dt;
    vy += (k * (targetY - pullY) - c * vy) * dt;
    pullX += vx * dt;
    pullY += vy * dt;

    const pressTarget = held ? pressCeiling : 0;
    const tau = held ? PRESS_ATTACK : PRESS_RELEASE;
    press += (pressTarget - press) * (1 - Math.exp(-dt / tau));
    active += (pressTarget - active) * (1 - Math.exp(-dt / 0.09));

    // The touch point catches up to the finger fast, but not instantly — see grab().
    const follow = 1 - Math.exp(-dt / 0.045);
    touchX += (targetTouchX - touchX) * follow;
    touchY += (targetTouchY - touchY) * follow;

    wavePhase += dt * WAVE_TURNS_PER_SECOND;
    waveAmp *= Math.exp(-dt / WAVE_DECAY);
    if (waveAmp < 0.01) waveAmp = 0;
  }

  /**
   * The step is fixed, the frame isn't: on a software renderer there can be as few as ten frames
   * a second, and integrating "however much time passed" makes the response lag behind real time
   * (and at a large step the spring can even diverge). So time is caught up in sub-steps.
   */
  function step(dt: number): void {
    let rest = Math.min(Math.max(dt, 0), 0.25);
    const h = 1 / 120;
    while (rest > 1e-6) {
      const slice = Math.min(h, rest);
      integrate(slice);
      rest -= slice;
    }
    // Settled means exactly at rest. The `idle()` threshold stops rendering, but the values
    // themselves only approach zero asymptotically, and the element would stay forever very
    // slightly deformed: invisible to the eye, but a frame-vs-reference comparison would flag the
    // mismatch forever.
    if (idle()) {
      pullX = 0;
      pullY = 0;
      vx = 0;
      vy = 0;
      press = 0;
      active = 0;
      wavePhase = 0;
    }
  }

  /** Whether the element has settled — the bench uses this to decide whether to keep drawing frames. */
  function idle(): boolean {
    return (
      !held &&
      Math.abs(pullX) < 0.05 &&
      Math.abs(pullY) < 0.05 &&
      Math.hypot(vx, vy) < 0.5 &&
      press < 0.004 &&
      active < 0.004 &&
      waveAmp === 0
    );
  }

  /** The setting can be turned on while the page is open, and a deformation already in flight has
   *  to stop rather than finish. */
  function setElastic(on: boolean): void {
    if (on === elastic) return;
    elastic = on;
    pressCeiling = on ? 1 : ACCESSIBILITY.stillPress;
    if (!on) {
      pullX = 0;
      pullY = 0;
      vx = 0;
      vy = 0;
      targetX = 0;
      targetY = 0;
      waveAmp = 0;
      wavePhase = 0;
    }
  }

  function sample(): DeformSample {
    return { touchX, touchY, pullX, pullY, press, active, waveAmp, wavePhase };
  }

  return { grab, drag, release, step, idle, sample, setElastic };
}

/**
 * RAISING INTO GLASS (reference §5, M 4:10–4:30). A control that isn't glass at rest — a switch
 * knob, a slider handle — stops being frosted under the finger and becomes a lens: whatever is
 * beneath it shows through.
 *
 * Glass comes in FASTER than frost leaves: the two fractions overlap, otherwise midway through
 * the transition the backdrop flashes through the knob for an instant — a hole where the control
 * should be.
 *
 * Lifting off the backdrop is NOT part of this. The shader's `u_lift` is a direction ("this kind
 * of element sinks in or rises"), not a magnitude — how far it has already risen is carried by
 * the press value that `u_lift` gets multiplied by. Returning a third fraction here would mean
 * multiplying press by itself — which is exactly what happened the first time the web bench wired
 * this up.
 */
export function raiseIntoGlass(press: number): { glass: number; solid: number } {
  const t = press < 0 ? 0 : press > 1 ? 1 : press;
  return { glass: Math.pow(t, 0.6), solid: 1 - Math.pow(t, 1.4) };
}
