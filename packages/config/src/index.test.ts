import { describe, expect, it, beforeEach } from 'vitest';
import { loadEnv, resetEnvCache } from './index.js';

const validEnv = {
  NODE_ENV: 'development',
  LOG_LEVEL: 'info',
  APP_URL: 'http://localhost:3000',
  API_URL: 'http://localhost:4000',
  WEB_PORT: '3000',
  API_PORT: '4000',
  DATABASE_URL: 'postgresql://signalforge:signalforge@localhost:5432/signalforge',
  REDIS_URL: 'redis://localhost:6379',
  SESSION_SECRET: 'test-session-secret-with-minimum-length',
  ENCRYPTION_KEY: 'test-encryption-key-with-minimum-length',
  AI_PROVIDER: 'mock',
};

describe('loadEnv', () => {
  beforeEach(() => {
    resetEnvCache();
  });

  it('accepts valid environment values', () => {
    const env = loadEnv(validEnv as NodeJS.ProcessEnv);
    expect(env.AI_PROVIDER).toBe('mock');
    expect(env.API_PORT).toBe(4000);
  });

  it('rejects missing required keys', () => {
    const { DATABASE_URL: _, ...invalidEnv } = validEnv;
    expect(() => loadEnv(invalidEnv as NodeJS.ProcessEnv)).toThrow(
      /Invalid environment configuration/,
    );
  });
});
