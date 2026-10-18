import { resolve } from 'node:path';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // SWC (not esbuild) so Nest's decorator metadata is emitted in tests.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  resolve: {
    // Test against workspace sources, so `npm test` doesn't need a prior build.
    alias: {
      '@fleet/engine': resolve(__dirname, '../../packages/engine/src/index.ts'),
      '@fleet/protocol': resolve(__dirname, '../../packages/protocol/src/index.ts'),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 20_000,
  },
});
