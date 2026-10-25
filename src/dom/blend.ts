// The last resort of a landing: the destination pair was not ready, so the shown pair is mixed into it over a few
// frames. Two extra feImages and two arithmetic composites are put in the filter for the blend and taken out after it;
// every frame in between is an attribute.
const SVG_NS = 'http://www.w3.org/2000/svg';

export const BLEND_MS = 120;

export type BlendTarget = { mapUrl: string; hueUrl: string | null };

type Slot = { image: Element; incoming: Element; mix: Element; result: string };

export type Blend = {
  /** Ends the blend where it is: the filter is back to its own structure and the host writes what stays. */
  stop(): void;
};

function open(image: Element | undefined, url: string | null, result: string): Slot | null {
  if (!image || !url) return null;
  const incoming = document.createElementNS(SVG_NS, 'feImage');
  incoming.setAttribute('href', url);
  incoming.setAttribute('preserveAspectRatio', 'none');
  incoming.setAttribute('result', `${result}B`);
  image.setAttribute('result', `${result}A`);
  const mix = document.createElementNS(SVG_NS, 'feComposite');
  mix.setAttribute('in', `${result}A`);
  mix.setAttribute('in2', `${result}B`);
  mix.setAttribute('operator', 'arithmetic');
  mix.setAttribute('k1', '0');
  mix.setAttribute('k2', '1');
  mix.setAttribute('k3', '0');
  mix.setAttribute('k4', '0');
  mix.setAttribute('result', result);
  image.after(incoming, mix);
  return { image, incoming, mix, result };
}

function close(slot: Slot | null): void {
  if (!slot) return;
  slot.image.setAttribute('result', slot.result);
  slot.incoming.remove();
  slot.mix.remove();
}

function mixAt(slot: Slot | null, t: number): void {
  if (!slot) return;
  slot.mix.setAttribute('k2', String(1 - t));
  slot.mix.setAttribute('k3', String(t));
}

/** Mixes the images of `filter` into `to` over `BLEND_MS`, then calls `done`. A hidden page, with no frames, ends at once. */
export function startBlend(filter: SVGFilterElement, to: BlendTarget, done: () => void): Blend {
  const images = filter.querySelectorAll('feImage');
  const slots = [open(images[0], to.mapUrl, 'map'), open(images[1], to.hueUrl, 'hue')];
  let frame: number | null = null;
  let ended = false;
  const stop = () => {
    if (ended) return;
    ended = true;
    if (frame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
    for (const slot of slots) close(slot);
  };
  const finish = () => {
    stop();
    done();
  };
  if (typeof requestAnimationFrame !== 'function' || document.hidden) {
    finish();
    return { stop };
  }
  let began: number | null = null;
  const step = (now: number) => {
    frame = null;
    began ??= now;
    const t = Math.min((now - began) / BLEND_MS, 1);
    for (const slot of slots) mixAt(slot, t);
    if (t >= 1) finish();
    else frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
  return { stop };
}
