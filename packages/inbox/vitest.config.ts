import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      DATABASE_URL: 'postgres://user:pass@localhost:5432/test',
    },
    // Each suite dynamically imports the module under test, which pulls in the
    // generated Prisma client; that first load can exceed the 5s default when
    // the whole monorepo runs in parallel.
    testTimeout: 30_000,
  },
});
