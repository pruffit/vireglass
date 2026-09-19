// Keeps `src/law.ts` honest, and keeps the citations in the code pointing at something real.
//
// The first version of the value check hunted for law VALUES appearing as bare literals elsewhere.
// It found fourteen and every one was a false positive: `VG_MEDIUM_PULL = 0.07` is not the dark
// tint, a debug colour's `0.42` is not the touch ridge. Two constants can share a value and mean
// nothing to each other, and the text does not carry which is which. That check could never be
// made correct, so it is not the check.
//
// What IS checkable, and is:
//   - every law is read by someone (a law nothing imports is one the material no longer obeys);
//   - every section citation in the code resolves to a section `docs/reference.md` actually has;
//   - no NEW named constant appears outside the law without being declared as not-calibration;
//   - every value with no provenance is named out loud, every run.
//
// That third one is the structural version of the check that failed. It does not ask what a number
// MEANS, which is the question that could not be answered: it asks where a named constant lives.
// Everything that is not calibration is listed below with the reason it is not, which is a short
// list because most constants in a material library are calibration.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const LAW = join(SRC, 'law.ts');
const SECTION = '§';

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
const lawLines = law.split(/\r?\n/);

/** `GROUP = { name: value }` — the group is what call sites import, the name is what they read. */
const entries = [];
let group = null;
for (const line of lawLines) {
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
    entries.push({ name: scalar[1], ref: scalar[1] });
    continue;
  }
  const field = /^\s{2}(\w+):\s*(-?[\d.]+),/.exec(line);
  if (field && group) entries.push({ name: field[1], ref: `${group}.${field[1]}` });
}

if (entries.length === 0) {
  console.error('check-law: parsed no constants out of src/law.ts — this check would pass vacuously');
  process.exit(1);
}

const corpus = sources(SRC).map((f) => ({ file: relative(ROOT, f), text: readFileSync(f, 'utf8') }));

// A reader either imports the value or interpolates it into shader text — the same reference
// either way.
const orphans = entries.filter((e) => !corpus.some(({ text }) => text.includes(e.ref)));

if (orphans.length > 0) {
  console.error('check-law: a law nothing reads is a law the material no longer obeys.\n');
  for (const o of orphans) console.error(`  ${o.ref} — defined in src/law.ts, imported nowhere`);
  process.exit(1);
}

// A citation that leads nowhere is worse than none, because it reads as evidence. Renumbering a
// section of the reference now breaks the build instead of quietly orphaning every comment that
// pointed at it.
const referenceDoc = readFileSync(join(ROOT, 'docs/reference.md'), 'utf8');
const sections = new Set([...referenceDoc.matchAll(/^## (\d+)\./gm)].map((m) => m[1]));

if (sections.size === 0) {
  console.error('check-law: docs/reference.md has no numbered sections — citations cannot be checked');
  process.exit(1);
}

const citation = new RegExp(`${SECTION}(\\d+)`, 'g');
const dangling = [];
for (const { file, text } of corpus) {
  text.split(/\r?\n/).forEach((line, index) => {
    for (const match of line.matchAll(citation)) {
      if (!sections.has(match[1])) {
        dangling.push({ file, line: index + 1, section: match[1], text: line.trim() });
      }
    }
  });
}

if (dangling.length > 0) {
  console.error('check-law: a citation points at a section docs/reference.md does not have.\n');
  for (const d of dangling) {
    console.error(`  ${d.file}:${d.line}  ${SECTION}${d.section}`);
    console.error(`    ${d.text}`);
  }
  process.exit(1);
}

/**
 * Constants outside the law that are not calibration. Each is here with the reason; anything else
 * that turns up is a number about the material sitting somewhere the law cannot see it, which is
 * how `optics.ts` came to hold twenty of them.
 */
const NOT_CALIBRATION = new Map([
  ['NO_PROGRESS', 'a sentinel for "no progress", not a quantity'],
  ['VG_TAU', 'mathematics'],
  ['TAU', 'mathematics'],
  ['AMBIENT_STEP', 'probe sampling granularity, not a property of the material'],
  ['PAD_STEP', 'quantisation of a view margin, to stop it re-laying-out every frame'],
  ['MAX_STEP_PX', "the 8-bit displacement map's own resolution limit"],
  ['SCALE_GAIN', "the 8-bit displacement map's own headroom"],
  ['BEVEL_SAMPLES', 'how finely a map is sampled, traded against build cost'],
  ['HEADROOM', 'fixed-point headroom in the spectral map'],
  ['STOPS', 'how many stops a conic gradient is emitted with'],
  ['LIMIT', 'cache size'],
  ['GRID_COLS', 'probe grid'],
  ['GRID_ROWS', 'probe grid'],
  ['INTERVAL_MS', 'sensor poll period'],
  ['SMOOTHING', 'sensor smoothing'],
  ['DEADZONE', 'sensor deadzone'],
  ['MAX_SWING', 'sensor range'],
]);

const strays = [];
for (const { file, text } of corpus) {
  text.split(/\r?\n/).forEach((line, index) => {
    const named = /^const ([A-Z][A-Z0-9_]*) = (-?[\d.]+(?:e-?\d+)?);/.exec(line);
    if (named && !NOT_CALIBRATION.has(named[1])) {
      strays.push({ file, line: index + 1, name: named[1] });
    }
  });
}

if (strays.length > 0) {
  console.error('check-law: a calibrated constant is living outside src/law.ts.' + String.fromCharCode(10));
  for (const stray of strays) {
    console.error(`  ${stray.file}:${stray.line}  ${stray.name}`);
  }
  console.error(
    String.fromCharCode(10) + '  Move it into src/law.ts with its provenance, or — if it is not a property of the',
  );
  console.error('  material — add it to NOT_CALIBRATION in this script with the reason why.');
  process.exit(1);
}

// Debts are not failures, but they must not be quiet. A number the reference does not give is a
// number someone chose, and the bench should eventually replace it.
const unmeasured = [];
lawLines.forEach((line, index) => {
  const field = /^\s{2}(\w+):/.exec(line);
  if (!field) return;
  const preamble = lawLines.slice(Math.max(0, index - 12), index).join('\n');
  const block = preamble.slice(preamble.lastIndexOf('/**'));
  if (/UNMEASURED/.test(block)) unmeasured.push(field[1]);
});

console.log(`check-law: ${entries.length} calibrated values, all read from src/law.ts`);
console.log(`check-law: every citation resolves into docs/reference.md (${sections.size} sections)`);
console.log(
  `check-law: no calibrated constant outside the law (${NOT_CALIBRATION.size} declared not-calibration)`,
);
if (unmeasured.length > 0) {
  console.log(`check-law: ${unmeasured.length} still unmeasured — ${unmeasured.join(', ')}`);
}
