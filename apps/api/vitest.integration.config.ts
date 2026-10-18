import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/__integration__/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    setupFiles: ['src/__integration__/setup.ts'],
    pool: 'forks',
    fileParallelism: false,
  },
});
