// Packs the package, installs it into an empty project, and loads every entry point — in CommonJS
// and in ESM.
//
// This exists because reading the source could not have found the bug it was written for: the core
// pulled React through a barrel re-export, so `require('vireglass')` threw "Cannot find module
// 'react'" in any project that did not already have it. Every test passed, the build was clean, and
// the package was broken for its main use. An entry point is only real if it loads from a node_modules
// it was installed into.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WINDOWS = process.platform === 'win32';
const npm = WINDOWS ? 'npm.cmd' : 'npm';
// npm is a .cmd on Windows and only spawns through a shell there; a shell then needs the paths
// quoted, because a temp directory can have a space in it.
const run = (cmd, args, cwd) => {
  const shell = WINDOWS && cmd === npm;
  const argv = shell ? args.map((a) => (/[s"]/.test(a) ? `"${a}"` : a)) : args;
  return execFileSync(cmd, argv, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell });
};

let failed = false;
const fail = (m) => { console.error(`check-package: ${m}`); failed = true; };

const stale = readdirSync(ROOT).filter((f) => /^vireglass-.*\.tgz$/.test(f));
for (const f of stale) unlinkSync(join(ROOT, f));

const tarball = run(npm, ['pack', '--silent'], ROOT).trim().split(/\r?\n/).pop();
const sandbox = mkdtempSync(join(tmpdir(), 'vireglass-consume-'));

try {
  writeFileSync(join(sandbox, 'package.json'), JSON.stringify({ name: 'consume', private: true, version: '1.0.0' }));
  run(npm, ['install', '--silent', '--no-audit', '--no-fund', join(ROOT, tarball)], sandbox);

  // Deliberately NOT installing react: the core must not need it.
  const entries = ['vireglass', 'vireglass/law', 'vireglass/dom', 'vireglass/web', 'vireglass/reference'];
  const cjs = entries.map((e) => `require(${JSON.stringify(e)});`).join('\n');
  const esm = entries.map((e, i) => `import * as m${i} from ${JSON.stringify(e)};`).join('\n');

  writeFileSync(join(sandbox, 'cjs.cjs'), `${cjs}\nconst { RIM } = require('vireglass/law');\nconst { resolveOptics } = require('vireglass');\nif (typeof resolveOptics().ior !== 'number') throw new Error('optics did not resolve');\nif (typeof RIM.lobeExponent !== 'number') throw new Error('the law is not readable');\nconsole.log('cjs ok');`);
  writeFileSync(join(sandbox, 'esm.mjs'), `${esm}\nimport { resolveOptics } from 'vireglass';\nif (typeof resolveOptics().ior !== 'number') throw new Error('optics did not resolve');\nconsole.log('esm ok');`);

  for (const [kind, file] of [['CommonJS', 'cjs.cjs'], ['ESM', 'esm.mjs']]) {
    try {
      run(process.execPath, [join(sandbox, file)], sandbox);
    } catch (error) {
      fail(`${kind}: ${String(error.stderr || error.message).split('\n').slice(0, 4).join(' ')}`);
    }
  }

  // The Android entry ships as TypeScript on purpose — Metro transpiles it, and its peers are
  // React Native's, which a Node import cannot resolve. So it is checked structurally instead:
  // the source has to be IN the tarball, and every bare module it imports has to be declared.
  // An undeclared import there fails in someone's Expo build, which is the worst place to find it.
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const declared = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
  ]);
  const nativeDir = join(sandbox, 'node_modules', 'vireglass', 'src', 'native');
  let nativeFiles = [];
  try {
    nativeFiles = readdirSync(nativeDir).filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'));
  } catch {
    fail('vireglass/native ships no source — the Android entry points at files that are not in the tarball');
  }
  if (nativeFiles.length > 0) {
    const undeclared = new Set();
    for (const file of nativeFiles) {
      const text = readFileSync(join(nativeDir, file), 'utf8');
      for (const m of text.matchAll(/froms+'([^']+)'/g)) {
        const spec = m[1];
        if (spec.startsWith('.')) continue;
        const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
        if (!declared.has(name)) undeclared.add(`${name} (in src/native/${file})`);
      }
    }
    if (undeclared.size > 0) {
      fail(`vireglass/native imports modules the package does not declare: ${[...undeclared].join(', ')}`);
    }
  }

  // React belongs on its own subpath, and asking for it without react installed must fail loudly
  // rather than the core dragging it in.
  writeFileSync(join(sandbox, 'react.cjs'), `require('vireglass/react');`);
  let reactThrew = false;
  try { run(process.execPath, [join(sandbox, 'react.cjs')], sandbox); } catch { reactThrew = true; }
  if (!reactThrew) fail('vireglass/react loaded without react installed — it cannot be doing anything');

  if (!failed) {
    console.log(
      `check-package: every entry point loads from an install, in CommonJS and ESM, with no react ` +
        `present; the Android source ships and imports nothing undeclared (${nativeFiles.length} files)`,
    );
  }
} finally {
  rmSync(sandbox, { recursive: true, force: true });
  try { unlinkSync(join(ROOT, tarball)); } catch {}
}
process.exit(failed ? 1 : 0);
