// Keeps `src/law.ts` honest.
//
// The first version of this check hunted for law VALUES appearing as bare literals elsewhere. It
// found fourteen and every one was a false positive: `VG_MEDIUM_PULL = 0.07` is not the dark tint,
// a debug colour's `0.42` is not the touch ridge. Two constants can share a value and mean nothing
// to each other, and the text does not carry which is which. That check could never be made
// correct, so it is not the check.
//
// What IS checkable: every law is read by someone, and every debt is visible. A constant that
// nothing imports is a law the material no longer obeys — which is exactly what a refactor leaves
// behind.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const LAW = join(SRC, 'law.ts');

function sources(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== '__tests__') sources(full, out);
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      if (full !== LAW) out.push(full);
    }
  }
  return out;
}

const law = readFileSync(LAW, 'utf8');

/** `GROUP = { name: value }` — the group is what call sites import, the name is what they read. */
const entries = [];
let group = null;
for (const line of law.split(/\r?\n/)) {
  const open = /^export const (\w+) = \{/.exec(line);
  if (open) {
    group = open[1];
    continue;
  }
  if (/^\} as const;/.test(line)) {
    group = null;
    continue;
  }
  const scalar = /^export const (\w+) = (-?[\d.e-]+);/.exec(line);
  if (scalar) {
    entries.push({ group: null, name: scalar[1], ref: scalar[1] });
    continue;
  }
  const field = /^\s{2}(\w+):\s*(-?[\d.]+),/.exec(line);
  if (field && group) entries.push({ group, name: field[1], ref: `${group}.${field[1]}` });
}

if (entries.length === 0) {
  console.error('check-law: parsed no constants out of src/law.ts — this check would pass vacuously');
  process.exit(1);
}

const corpus = sources(SRC)
  .map((f) => ({ file: relative(ROOT, f), text: readFileSync(f, 'utf8') }));

const orphans = [];
for (const entry of entries) {
  // A reader either imports the value (`RIM.darkEdge`) or interpolates it into shader text
  // (`${RIM.darkEdge}`) — the same reference either way.
  const used = corpus.some(({ text }) => text.includes(entry.ref));
  if (!used) orphans.push(entry);
}

// Debts are not failures, but they must not be quiet. A number the reference does not give is a
// number someone chose, and the bench should eventually replace it.
const unmeasured = [];
{
  const lines = law.split(/\r?\n/);
  lines.forEach((line, i) => {
    const field = /^\s{2}(\w+):/.exec(line);
    if (!field) return;
    const preamble = lines.slice(Math.max(0, i - 12), i).join('\n');
    const block = preamble.slice(preamble.lastIndexOf('/**'));
    if (/UNMEASURED/.test(block)) unmeasured.push(field[1]);
  });
}

if (orphans.length > 0) {
  console.error('check-law: a law nothing reads is a law the material no longer obeys.\n');
  for (const o of orphans) console.error(`  ${o.ref} — defined in src/law.ts, imported nowhere`);
  process.exit(1);
}

console.log(`check-law: ${entries.length} calibrated values, all read from src/law.ts`);
if (unmeasured.length > 0) {
  console.log(`check-law: ${unmeasured.length} still unmeasured — ${unmeasured.join(', ')}`);
}
