import { describe, expect, it, vi, afterEach } from 'vitest';
import { MockAIProvider } from './mock-provider.js';
import { OpenAIProvider } from './openai-provider.js';

vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: { completions: { create: vi.fn() } },
    })),
  };
});

import { createAIProvider, checkAIHealth } from './factory.js';

describe('createAIProvider', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns MockAIProvider by default', () => {
    const provider = createAIProvider();
    expect(provider).toBeInstanceOf(MockAIProvider);
  });

  it('returns MockAIProvider for "mock"', () => {
    const provider = createAIProvider('mock');
    expect(provider).toBeInstanceOf(MockAIProvider);
  });

  it('returns OpenAIProvider for "openai" with apiKey', () => {
    const provider = createAIProvider('openai', { apiKey: 'sk-test' });
    expect(provider).toBeInstanceOf(OpenAIProvider);
  });

  it('throws when "openai" is requested without apiKey', () => {
    delete process.env['OPENAI_API_KEY'];
    expect(() => createAIProvider('openai')).toThrow('OPENAI_API_KEY is required');
  });

  it('falls back to process.env OPENAI_API_KEY', () => {
    process.env['OPENAI_API_KEY'] = 'sk-from-env';
    const provider = createAIProvider('openai');
    expect(provider).toBeInstanceOf(OpenAIProvider);
  });

  it('passes model through to OpenAIProvider', () => {
    const provider = createAIProvider('openai', { apiKey: 'sk-test', model: 'auto:smart' });
    expect(provider).toBeInstanceOf(OpenAIProvider);
  });

  it('passes baseURL through to OpenAIProvider', () => {
    const provider = createAIProvider('openai', {
      apiKey: 'sk-test',
      baseURL: 'http://localhost:3001/v1',
    });
    expect(provider).toBeInstanceOf(OpenAIProvider);
  });

  it('falls back to process.env OPENAI_BASE_URL', () => {
    process.env['OPENAI_BASE_URL'] = 'http://localhost:3001/v1';
    const provider = createAIProvider('openai', { apiKey: 'sk-test' });
    expect(provider).toBeInstanceOf(OpenAIProvider);
  });
});

describe('checkAIHealth', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns ok for mock provider', () => {
    const result = checkAIHealth({ provider: 'mock' });
    expect(result).toEqual({ ok: true, provider: 'mock', model: 'mock' });
  });

  it('returns error when openai has no API key', () => {
    delete process.env['OPENAI_API_KEY'];
    const result = checkAIHealth({ provider: 'openai' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('OPENAI_API_KEY');
  });

  it('returns ok for configured openai provider', () => {
    const result = checkAIHealth({
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'auto',
    });
    expect(result).toEqual({ ok: true, provider: 'openai', model: 'auto' });
  });

  it('includes baseURL when configured', () => {
    const result = checkAIHealth({
      provider: 'openai',
      apiKey: 'sk-test',
      baseURL: 'http://localhost:3001/v1',
      model: 'auto',
    });
    expect(result.ok).toBe(true);
    expect(result.baseURL).toBe('http://localhost:3001/v1');
  });

  it('defaults to mock when no provider specified and env unset', () => {
    delete process.env['AI_PROVIDER'];
    const result = checkAIHealth();
    expect(result).toEqual({ ok: true, provider: 'mock', model: 'mock' });
  });
});
