import { describe, expect, it, vi, beforeEach } from 'vitest';
import { buildApp } from './app.js';

const mockEnv = {
  LOG_LEVEL: 'error',
  APP_URL: 'http://localhost:3000',
  API_URL: 'http://localhost:4000',
  WEB_PORT: 3000,
  API_PORT: 4000,
  DATABASE_URL: 'postgresql://localhost:5432/signalforge',
  REDIS_URL: 'redis://localhost:6379',
  SESSION_SECRET: 'test-session-secret-with-minimum-length',
  ENCRYPTION_KEY: 'test-encryption-key-with-minimum-length',
  AI_PROVIDER: 'mock' as const,
  NODE_ENV: 'test',
};

vi.mock('@signalforge/config', () => ({
  loadEnv: () => mockEnv,
  getEnv: () => mockEnv,
}));

vi.mock('@signalforge/database', () => ({
  checkDatabaseConnection: vi.fn(async () => ({ ok: true, latencyMs: 1 })),
}));

vi.mock('@signalforge/queue', () => ({
  checkRedisConnection: vi.fn(async () => ({ ok: true, latencyMs: 1 })),
}));

describe('app configuration', () => {
  it('trusts X-Forwarded-For when behind a reverse proxy', async () => {
    const app = await buildApp();
    app.get('/__test-ip', (request) => ({ ip: request.ip }));
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/__test-ip',
      headers: { 'x-forwarded-for': '203.0.113.50' },
    });
    expect(response.json().ip).toBe('203.0.113.50');
  });
});

describe('health routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns ok for GET /health', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ok',
      service: 'signalforge-api',
    });
  });

  it('rejects unauthenticated access to GET /health/ai', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/health/ai' });

    expect(response.statusCode).toBe(401);
  });
});
