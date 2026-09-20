// Every name the documentation tells someone to import has to exist.
//
// The worst way for an open library to fail a stranger is for its first example not to run. And
// docs drift silently: a rename, a module moved to a subpath, an export dropped — the build stays
// green, the tests stay green, and the README goes on promising something that is not there.
//
// This reads the import lines out of the markdown and checks each name against the entry it names,
// loaded from `dist`. Entries whose peers cannot be resolved in Node — React Native, React — are
// checked against the source instead, which still catches a rename.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(ROOT, 'package.json'));
const PACKAGE = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

let failed = false;
const fail = (m) => { console.error(`check-readme: ${m}`); failed = true; };

function markdownFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) markdownFiles(full, out);
    else if (entry.endsWith('.md')) out.push(full);
  }
  return out;
}

/**
 * Inside a ```diff block, a line starting with `-` is the OLD call — documentation of what not to
 * write any more. Checking it would make every migration note a failure.
 */
function withoutDiffRemovals(text) {
  const out = [];
  let inDiff = false;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('```')) {
      inDiff = line.slice(3).trim() === 'diff';
      out.push(line);
      continue;
    }
    if (inDiff && line.startsWith('-')) continue;
    out.push(line);
  }
  return out.join(String.fromCharCode(10));
}

/** `import { a, b } from 'vireglass/x'` — parsed by splitting, so no escaping to get wrong. */
function importsIn(text) {
  const found = [];
  let at = 0;
  for (;;) {
    const open = text.indexOf('import {', at);
    if (open < 0) break;
    const close = text.indexOf('}', open);
    const from = text.indexOf("from '", close);
    const end = text.indexOf("'", from + 6);
    at = open + 8;
    if (close < 0 || from < 0 || end < 0 || from - close > 12) continue;
    const module = text.slice(from + 6, end);
    if (module !== 'vireglass' && !module.startsWith('vireglass/')) continue;
    const names = text
      .slice(open + 8, close)
      .split(',')
      .map((n) => n.trim().replace('type ', ''))
      .filter(Boolean);
    found.push({ module, names });
  }
  return found;
}

const SOURCE_ONLY = new Set(['vireglass/native', 'vireglass/react']);
const sourceExports = (module) => {
  const file = module === 'vireglass/react' ? 'src/react.ts' : 'src/native/index.ts';
  const seen = new Set();
  const read = (path) => {
    const text = readFileSync(join(ROOT, path), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = /^export (?:const|function|type|class|enum|interface) (\w+)/.exec(line);
      if (m) seen.add(m[1]);
      const star = /^export \* from '\.\/([\w./-]+)'/.exec(line);
      if (star) { try { read(join(dirname(path), `${star[1]}.tsx`)); } catch { try { read(join(dirname(path), `${star[1]}.ts`)); } catch {} } }
      const named = /^export \{([^}]+)\}/.exec(line);
      if (named) for (const n of named[1].split(',')) seen.add(n.trim().split(' as ').pop().trim());
    }
  };
  read(file);
  return seen;
};

const loaded = new Map();
function exportsOf(module) {
  if (loaded.has(module)) return loaded.get(module);
  let names;
  if (SOURCE_ONLY.has(module)) {
    names = sourceExports(module);
  } else {
    // Resolved through the package's own exports map, not by guessing at a filename — so a
    // subpath that is documented but not published fails here rather than in someone's install.
    const key = module === 'vireglass' ? '.' : `.${module.slice('vireglass'.length)}`;
    const entry = PACKAGE.exports?.[key];
    const file = typeof entry === 'string' ? entry : entry?.require ?? entry?.default;
    if (!file) throw new Error(`the package does not export "${key}"`);
    names = new Set(Object.keys(require(join(ROOT, file))));
  }
  loaded.set(module, names);
  return names;
}

let checked = 0;
for (const file of markdownFiles(ROOT)) {
  const text = withoutDiffRemovals(readFileSync(file, 'utf8'));
  for (const { module, names } of importsIn(text)) {
    let available;
    try {
      available = exportsOf(module);
    } catch (error) {
      fail(`${relative(ROOT, file)} imports from '${module}', which does not load: ${error.message}`);
      continue;
    }
    for (const name of names) {
      checked += 1;
      if (!available.has(name)) {
        fail(`${relative(ROOT, file)} tells the reader to import ${name} from '${module}', which does not export it`);
      }
    }
  }
}

if (checked === 0) fail('found no imports in the documentation at all — this check would pass vacuously');
if (!failed) console.log(`check-readme: all ${checked} names the documentation tells you to import exist`);
process.exit(failed ? 1 : 0);
