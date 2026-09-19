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
import { probeBackdrop } from './probe';
import type { BackdropSample } from '../adaptation';
import type { GlassHandle } from './index';

export type GroupEntry = {
  el: HTMLElement;
  handle: GlassHandle;
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

  update();

  return {
    update,
    ink: () => polarity,
    plane: () => state.plane(),
    destroy() {
      destroyed = true;
      members.forEach((_, index) => state.release(String(index)));
    },
  };
}
