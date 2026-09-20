// A row of glass that agrees with itself.
//
// Each element probing on its own is not merely wasteful — it is wrong. Neighbouring pieces of one
// control sit over slightly different patches of backdrop, reach different polarities, and a tab
// bar ends up with two light glyphs and two dark ones. §3 is explicit that small elements switch
// WHOLESALE; a group is what "wholesale" means when the element is really four of them.
//
// Every decision is the core's (`../group-model`): the lightness plane, the smoothing, the polarity
// requirement and its hysteresis. This binds them to real elements.
import { createGroupState, type GroupPlane } from '../group-model';
import { TOUCH } from '../law';
import { probeBackdrop } from './probe';
import type { BackdropSample } from '../adaptation';
import type { GlassHandle } from './index';

export type GroupEntry = {
  el: HTMLElement;
  handle: GlassHandle;
  /** Set by the group: pass it to this member's own `attachGlass` as `onGlow`. */
  onGlow?: (glow: { pageX: number; pageY: number; strength: number } | null) => void;
  /** How strongly this member needs its ink to stay legible. The strictest in the group wins. */
  legibility?: number;
};

export type GlassGroupHandle = {
  /** Re-read every member and settle on one answer for all of them. */
  update(): void;
  /** The polarity the whole group agreed on, 1 light and 0 dark. */
  ink(): number;
  /** The group's current estimate, or null before the first reading. */
  plane(): GroupPlane | null;
  /** Spread a glow from one member to the rest. Members wired through `onGlow` call this for you. */
  carryGlow(from: number, glow: { pageX: number; pageY: number; strength: number } | null): void;
  destroy(): void;
};

export type GlassGroupOptions = {
  /** Where a member reads its backdrop. Defaults to the DOM probe. */
  probe?: (el: HTMLElement) => BackdropSample;
};

export function createGlassGroup(
  members: readonly GroupEntry[],
  opts: GlassGroupOptions = {},
): GlassGroupHandle {
  let polarity = 1;
  let destroyed = false;

  const state = createGroupState({
    plane: () => {},
    flip: (next) => {
      polarity = next;
      // One flip, everyone at once — that is the whole point of the group.
      for (const { handle } of members) handle.update();
    },
  });

  /**
   * "Starting right under your fingertips, the glow spreads throughout the element and onto any
   * Liquid Glass elements nearby" (§5, 219 @12:11). The element being touched cannot know who is
   * nearby; the group does.
   */
  function carryGlow(from: number, glow: { pageX: number; pageY: number; strength: number } | null): void {
    members.forEach(({ el, handle }, index) => {
      if (index === from) return;
      if (!glow) {
        handle.setNeighbourGlow(null);
        return;
      }
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const reach = (Math.min(rect.width, rect.height) / 2) * TOUCH.glowReach;
      const distance = Math.hypot(glow.pageX - cx, glow.pageY - cy);
      // Falls off with distance and stops: a glow that reached the whole screen would read as the
      // page flashing rather than as light travelling through neighbouring glass.
      const falloff = reach > 0 ? Math.max(0, 1 - distance / reach) : 0;
      handle.setNeighbourGlow(falloff <= 0 ? null : { ...glow, strength: glow.strength * falloff });
    });
  }

  /** Wire each member's own touch to the rest of the group. */
  function connect(): void {
    members.forEach((entry, index) => {
      entry.onGlow = (glow) => carryGlow(index, glow);
    });
  }

  function update(): void {
    if (destroyed) return;
    const probe = opts.probe ?? probeBackdrop;
    members.forEach(({ el, legibility }, index) => {
      const rect = el.getBoundingClientRect();
      // A member with no box has nothing behind it to read; reporting it anyway would drag the
      // group's estimate toward whatever sits at the page's origin.
      if (rect.width <= 0 || rect.height <= 0) {
        state.release(String(index));
        return;
      }
      state.report(
        String(index),
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
        probe(el),
        legibility ?? 0,
      );
    });
  }

  connect();
  update();

  return {
    update,
    ink: () => polarity,
    plane: () => state.plane(),
    carryGlow,
    destroy() {
      destroyed = true;
      carryGlow(-1, null);
      members.forEach((_, index) => state.release(String(index)));
    },
  };
}
