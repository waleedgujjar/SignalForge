import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      DATABASE_URL: 'postgres://user:pass@localhost:5432/test',
      REDIS_URL: 'redis://localhost:6379',
      ENCRYPTION_KEY: 'a'.repeat(64),
      APP_URL: 'http://localhost:3000',
      API_URL: 'http://localhost:4000',
      SESSION_SECRET: 'a'.repeat(48),
    },
  },
});
