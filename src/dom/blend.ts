// A landing whose destination pair is not ready mixes the shown pair into it. The extra feImages and composites live in
// the filter only for the blend, and every frame in between writes attributes.
const SVG_NS = 'http://www.w3.org/2000/svg';

export const BLEND_MS = 120;

/** Images a filter may hold at once while a blend is retargeted: the shown pair and two incoming. */
const MAX_STAGES = 2;
/** At the cap, a newest stage this near its start is swapped for the new target; the jump is at most this share of the distance. */
const SWAP_BELOW = 0.1;

export type BlendTarget = { mapUrl: string; hueUrl: string | null };

type Node = { incoming: Element; mix: Element; url: string };
type Slot = { image: Element; result: string; stages: Node[]; base: string; tail: Element; kept: Element | null; keptUrl: string | null; n: number };
type Stage = { began: number | null; w: number };

export type Blend = {
  /** Ends the blend where it is: the filter is back to its own structure and the host writes what stays. */
  stop(): void;
  /** Mixes toward another pair from what is shown now: the current mix becomes the outgoing input of a new stage that ramps from 0. */
  retarget(to: BlendTarget): void;
  /** Whether an image of this url is among the inputs of the filter now. */
  shows(url: string): boolean;
};

function open(image: Element | undefined, result: string): Slot | null {
  if (!image) return null;
  return { image, result, stages: [], base: `${result}A`, tail: image, kept: null, keptUrl: null, n: 0 };
}

function push(slot: Slot, url: string): void {
  const last = slot.stages.at(-1);
  if (slot.n === 0) slot.image.setAttribute('result', slot.base);
  const index = (slot.n += 1);
  if (last) last.mix.setAttribute('result', `${slot.result}M${index}`);
  const incoming = document.createElementNS(SVG_NS, 'feImage');
  incoming.setAttribute('href', url);
  incoming.setAttribute('preserveAspectRatio', 'none');
  incoming.setAttribute('result', `${slot.result}B${index}`);
  const mix = document.createElementNS(SVG_NS, 'feComposite');
  mix.setAttribute('in', last ? `${slot.result}M${index}` : slot.base);
  mix.setAttribute('in2', `${slot.result}B${index}`);
  mix.setAttribute('operator', 'arithmetic');
  mix.setAttribute('k1', '0');
  mix.setAttribute('k2', '1');
  mix.setAttribute('k3', '0');
  mix.setAttribute('k4', '0');
  mix.setAttribute('result', slot.result);
  slot.tail.after(incoming, mix);
  slot.tail = mix;
  slot.stages.push({ incoming, mix, url });
}

function close(slot: Slot | null): void {
  if (!slot) return;
  slot.image.setAttribute('result', slot.result);
  for (const stage of slot.stages) {
    stage.incoming.remove();
    stage.mix.remove();
  }
  slot.kept?.remove();
  slot.stages = [];
}

/** Keeps only the newest incoming image, as the input of what comes next. */
function collapse(slot: Slot): void {
  const newest = slot.stages.at(-1);
  if (!newest) return;
  for (const stage of slot.stages) {
    stage.mix.remove();
    if (stage !== newest) stage.incoming.remove();
  }
  slot.kept?.remove();
  slot.kept = newest.incoming;
  slot.keptUrl = newest.url;
  slot.base = newest.incoming.getAttribute('result')!;
  slot.tail = newest.incoming;
  slot.stages = [];
}

function weigh(slot: Slot | null, w: number): void {
  const stage = slot?.stages.at(-1);
  if (!stage) return;
  stage.mix.setAttribute('k2', String(1 - w));
  stage.mix.setAttribute('k3', String(w));
}

/** Mixes the images of `filter` into `to` over `BLEND_MS`, then calls `done`. A hidden page, with no frames, ends at once. */
export function startBlend(filter: SVGFilterElement, to: BlendTarget, done: () => void): Blend {
  const images = filter.querySelectorAll('feImage');
  const slots = [open(images[0], 'map'), open(images[1], 'hue')];
  const stages: Stage[] = [];
  let queued: BlendTarget | null = null;
  let frame: number | null = null;
  let ended = false;

  const add = (target: BlendTarget) => {
    if (slots[0]) push(slots[0], target.mapUrl);
    const hue = slots[1];
    if (hue) {
      const url = target.hueUrl ?? hue.stages.at(-1)?.url;
      if (url) push(hue, url);
    }
    stages.push({ began: null, w: 0 });
  };
  const stop = () => {
    if (ended) return;
    ended = true;
    if (frame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
    for (const slot of slots) close(slot);
  };
  const retarget = (next: BlendTarget) => {
    if (ended) return;
    const newest = slots[0]?.stages.at(-1);
    const sameAsNewest = newest?.url === next.mapUrl && (!next.hueUrl || slots[1]?.stages.at(-1)?.url === next.hueUrl);
    if (sameAsNewest) {
      queued = null;
      return;
    }
    if (stages.length < MAX_STAGES) add(next);
    else if (stages.at(-1)!.w <= SWAP_BELOW) {
      slots[0]?.stages.at(-1)?.incoming.setAttribute('href', next.mapUrl);
      if (slots[0]) slots[0].stages.at(-1)!.url = next.mapUrl;
      const hue = slots[1]?.stages.at(-1);
      if (hue && next.hueUrl) {
        hue.incoming.setAttribute('href', next.hueUrl);
        hue.url = next.hueUrl;
      }
    } else queued = next;
  };
  const shows = (url: string) =>
    slots.some((slot) => slot && (slot.keptUrl === url || slot.stages.some((stage) => stage.url === url)));
  const finish = () => {
    stop();
    done();
  };
  add(to);
  if (typeof requestAnimationFrame !== 'function' || document.hidden) {
    finish();
    return { stop, retarget, shows };
  }
  const step = (now: number) => {
    frame = null;
    const last = stages.at(-1)!;
    last.began ??= now;
    last.w = Math.min((now - last.began) / BLEND_MS, 1);
    weigh(slots[0], last.w);
    weigh(slots[1], last.w);
    if (last.w < 1) {
      frame = requestAnimationFrame(step);
      return;
    }
    if (!queued) {
      finish();
      return;
    }
    const next = queued;
    queued = null;
    for (const slot of slots) if (slot) collapse(slot);
    stages.length = 0;
    add(next);
    frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
  return { stop, retarget, shows };
}
