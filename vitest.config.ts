import { defineConfig } from 'vitest/config';
import { inlineWorkerVite } from './scripts/inline-worker.mjs';

export default defineConfig({
  plugins: [inlineWorkerVite()],
  test: {
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
  },
});
