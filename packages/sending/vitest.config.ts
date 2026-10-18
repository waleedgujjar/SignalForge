import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // job-service.test.ts exercises scheduleNextStep, which walks the whole
    // sequence/schedule path and takes ~1.5s per case even fully mocked. Under
    // a full `turbo run test` the machine is running dozens of vitest workers
    // at once and these cases intermittently fall over the 5s default.
    // apps/api raises its timeout for the same reason (slow Argon2 hashing).
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
