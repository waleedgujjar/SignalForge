import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    exclude: ['src/__integration__/**', 'node_modules/**'],
    // Signup and login exercise real Argon2 hashing, which is deliberately slow
    // and exceeds the 5s default on modest CI hardware.
    testTimeout: 30_000,
  },
});
