// Bundles a worker's entry into a string at build time, so the package ships no second file to serve.
import { build } from 'esbuild';

const SUFFIX = '?source';
const NAMESPACE = 'inline-worker';

async function bundle(entry) {
  const out = await build({ entryPoints: [entry], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', minify: true });
  return out.outputFiles[0].text;
}

const asModule = (text) => `export default ${JSON.stringify(text)};`;

export function inlineWorkerEsbuild() {
  return {
    name: 'inline-worker',
    setup(b) {
      b.onResolve({ filter: /\?source$/ }, async (args) => {
        const resolved = await b.resolve(args.path.slice(0, -SUFFIX.length), { resolveDir: args.resolveDir, kind: args.kind });
        if (resolved.errors.length > 0) return { errors: resolved.errors };
        return { path: resolved.path, namespace: NAMESPACE };
      });
      b.onLoad({ filter: /.*/, namespace: NAMESPACE }, async (args) => ({ contents: asModule(await bundle(args.path)), loader: 'js', watchFiles: [args.path] }));
    },
  };
}

export function inlineWorkerVite() {
  return {
    name: 'inline-worker',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (!source.endsWith(SUFFIX)) return null;
      const resolved = await this.resolve(source.slice(0, -SUFFIX.length), importer, { skipSelf: true });
      return resolved ? `\0${NAMESPACE}:${resolved.id}` : null;
    },
    async load(id) {
      if (!id.startsWith(`\0${NAMESPACE}:`)) return null;
      return asModule(await bundle(id.slice(NAMESPACE.length + 2)));
    },
  };
}
