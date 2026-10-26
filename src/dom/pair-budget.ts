// A byte budget over the pairs of maps lenses keep decoded: a page of many lenses must not hold them all for good.

/** What a decoded pair is estimated to weigh: four bytes a pixel of each image. */
export const PAIR_BUDGET_BYTES = 24 * 1024 * 1024;

export type BudgetEntry = {
  bytes: number;
  /** Whether the lens of this pair is out of the document or off the viewport: those go first. */
  offscreen(): boolean;
  /** A pair on a filter, held for a landing or under a blend is never taken. */
  pinned(): boolean;
  evict(): void;
};

let budget = PAIR_BUDGET_BYTES;
const entries = new Set<BudgetEntry>();

export const pairBytes = (...images: ({ width: number; height: number } | null)[]): number =>
  images.reduce((sum, image) => sum + (image ? image.width * image.height * 4 : 0), 0);

export function track(entry: BudgetEntry): void {
  entries.add(entry);
  enforce();
}

export function touch(entry: BudgetEntry): void {
  if (entries.delete(entry)) entries.add(entry);
}

export function untrack(entry: BudgetEntry): void {
  entries.delete(entry);
}

function enforce(): void {
  let total = 0;
  for (const entry of entries) total += entry.bytes;
  if (total <= budget) return;
  for (const offscreenOnly of [true, false]) {
    for (const entry of [...entries]) {
      if (total <= budget) return;
      if (entry.pinned() || (offscreenOnly && !entry.offscreen())) continue;
      total -= entry.bytes;
      entry.evict();
      entries.delete(entry);
    }
  }
}

/** Test-only. */
export function setPairBudget(bytes: number): void {
  budget = bytes;
}

export function trackedPairs(): number {
  return entries.size;
}
