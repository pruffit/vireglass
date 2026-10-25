import { defineConfig } from 'tsup';
import { inlineWorkerEsbuild } from './scripts/inline-worker.mjs';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    react: 'src/react.ts',
    'web/index': 'src/web/index.ts',
    dom: 'src/dom/index.ts',
    law: 'src/law.ts',
    reference: 'src/reference.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  target: 'es2022',
  esbuildPlugins: [inlineWorkerEsbuild()],
});
