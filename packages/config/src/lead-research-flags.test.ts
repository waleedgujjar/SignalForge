import { afterEach, describe, expect, it } from 'vitest';

import { loadEnv, resetEnvCache } from './index.js';

const BASE = {
  APP_URL: 'http://localhost:3000',
  API_URL: 'http://localhost:4000',
  DATABASE_URL: 'postgres://user:pass@localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379',
  SESSION_SECRET: 's'.repeat(32),
  ENCRYPTION_KEY: 'e'.repeat(32),
};

describe('Module 17 env flags', () => {
  afterEach(() => resetEnvCache());

  it('defaults: module off, public provider selected, public fetch on', () => {
    const env = loadEnv({ ...BASE } as NodeJS.ProcessEnv);
    expect(env.LINKEDIN_RESEARCH_ENABLED).toBe(false);
    expect(env.LINKEDIN_RESEARCH_PROVIDER).toBe('public');
    expect(env.LINKEDIN_RESEARCH_PUBLIC_FETCH_ENABLED).toBe(true);
    expect(env.LINKEDIN_RESEARCH_AGENT_REACH_MCP_ENABLED).toBe(false);
    expect(env.LINKEDIN_RESEARCH_MAX_CONCURRENCY).toBe(1);
    expect(env.LINKEDIN_RESEARCH_MAX_ATTEMPTS).toBe(2);
    expect(env.AGENT_REACH_BIN).toBe('agent-reach');
    expect(env.JINA_READER_BASE_URL).toBe('https://r.jina.ai');
    expect(env.JINA_API_KEY).toBeUndefined();
  });

  it('treats the literal string "false" as OFF (unlike the legacy coerce flags)', () => {
    const env = loadEnv({ ...BASE, LINKEDIN_RESEARCH_ENABLED: 'false', LINKEDIN_RESEARCH_PUBLIC_FETCH_ENABLED: 'false' } as NodeJS.ProcessEnv);
    expect(env.LINKEDIN_RESEARCH_ENABLED).toBe(false);
    expect(env.LINKEDIN_RESEARCH_PUBLIC_FETCH_ENABLED).toBe(false);
  });

  it('accepts "true" and "1" as ON', () => {
    resetEnvCache();
    expect(loadEnv({ ...BASE, LINKEDIN_RESEARCH_ENABLED: 'true' } as NodeJS.ProcessEnv).LINKEDIN_RESEARCH_ENABLED).toBe(true);
    resetEnvCache();
    expect(loadEnv({ ...BASE, LINKEDIN_RESEARCH_ENABLED: '1' } as NodeJS.ProcessEnv).LINKEDIN_RESEARCH_ENABLED).toBe(true);
  });

  it('treats empty strings from .env.example as unset', () => {
    const env = loadEnv({
      ...BASE,
      LINKEDIN_RESEARCH_PROVIDER: '',
      LINKEDIN_RESEARCH_MAX_CONCURRENCY: '',
      JINA_READER_BASE_URL: '',
      JINA_API_KEY: '',
    } as NodeJS.ProcessEnv);
    expect(env.LINKEDIN_RESEARCH_PROVIDER).toBe('public');
    expect(env.LINKEDIN_RESEARCH_MAX_CONCURRENCY).toBe(1);
    expect(env.JINA_READER_BASE_URL).toBe('https://r.jina.ai');
    expect(env.JINA_API_KEY).toBeUndefined();
  });

  it('rejects an unknown provider name', () => {
    expect(() => loadEnv({ ...BASE, LINKEDIN_RESEARCH_PROVIDER: 'scraper' } as NodeJS.ProcessEnv)).toThrow(/LINKEDIN_RESEARCH_PROVIDER/);
  });
});
