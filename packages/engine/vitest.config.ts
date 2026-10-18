import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    // Golden-scenario tests spawn the CLI; give them room on slow CI machines.
    testTimeout: 20_000,
  },
});
