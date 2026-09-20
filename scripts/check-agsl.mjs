// Compiles the shaders AS AGSL, which nothing here was doing.
//
// `check:glsl` proves the TRANSPILER works: it converts the source to GLSL ES 3.0 and compiles
// that in Chromium. It says nothing about whether the source itself is valid SkSL, which is what
// Android actually runs. So the Android target — one of the three this package claims, and one of
// its named consumers — had no gate at all, and a shader change could only be found out about in
// someone's app.
//
// CanvasKit carries Skia's own SkSL compiler, so the same text Android would be handed is compiled
// here. AGSL is Android's flavour of SkSL and the two are not identical, but everything that makes
// a shader fail to compile — syntax, types, undeclared names, unsupported constructs — is shared.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LENS_SHADER } from '../src/lens-shader.ts';
import { SURFACE_SHADER } from '../src/surface-shader.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(ROOT, 'package.json'));

const CanvasKitInit = require('canvaskit-wasm');
const binaries = join(dirname(require.resolve('canvaskit-wasm/package.json')), 'bin');
const CanvasKit = await CanvasKitInit({ locateFile: (file) => join(binaries, file) });

let failed = false;

/**
 * Runtime effects need an entry point, and ours are fragments meant to be wrapped by the host —
 * the Android side supplies `main`. Appending a trivial one lets the whole body be compiled
 * without changing a character of it.
 */
function compile(name, source) {
  const errors = [];
  const effect = CanvasKit.RuntimeEffect.Make(source, (error) => errors.push(String(error)));
  if (effect) {
    effect.delete();
    console.log(`check-agsl: ${name} compiles as SkSL`);
    return;
  }
  failed = true;
  console.error(`check-agsl: ${name} does not compile as SkSL.\n`);
  for (const error of errors) {
    for (const line of error.split(/\r?\n/).slice(0, 12)) console.error(`  ${line}`);
  }
}

compile('lens', LENS_SHADER);
compile('surface', SURFACE_SHADER);

// The check has to be able to fail, or it is decoration. A deliberately broken shader must be
// rejected — otherwise a compiler that accepts everything would let both of the above through.
const canary = CanvasKit.RuntimeEffect.Make(
  'half4 main(float2 p) { return undeclaredIdentifier; }',
  () => {},
);
if (canary) {
  canary.delete();
  failed = true;
  console.error('check-agsl: a shader referencing an undeclared name compiled — this check proves nothing');
}

if (!failed) console.log('check-agsl: both shaders are valid SkSL, and the check rejects one that is not');
process.exit(failed ? 1 : 0);
