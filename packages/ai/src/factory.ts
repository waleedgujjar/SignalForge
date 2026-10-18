import type { AIProvider, AIProviderName } from './types.js';
import { MockAIProvider } from './mock-provider.js';
import { OpenAIProvider } from './openai-provider.js';

export function createAIProvider(
  provider: AIProviderName = 'mock',
  options?: { apiKey?: string; model?: string; baseURL?: string },
): AIProvider {
  switch (provider) {
    case 'mock':
      return new MockAIProvider();
    case 'openai': {
      const apiKey = options?.apiKey ?? process.env['OPENAI_API_KEY'];
      if (!apiKey) throw new Error('OPENAI_API_KEY is required for the OpenAI provider.');
      const model = options?.model ?? process.env['OPENAI_MODEL'] ?? 'gpt-4o';
      const baseURL = options?.baseURL ?? process.env['OPENAI_BASE_URL'];
      return new OpenAIProvider(apiKey, model, baseURL ? { baseURL } : undefined);
    }
    default: {
      const exhaustiveCheck: never = provider;
      throw new Error(`Unsupported AI provider: ${exhaustiveCheck as string}`);
    }
  }
}

export function checkAIHealth(options?: {
  provider?: AIProviderName;
  apiKey?: string;
  baseURL?: string;
  model?: string;
}): { ok: boolean; provider: string; model: string; baseURL?: string; error?: string } {
  const provider = options?.provider ?? (process.env['AI_PROVIDER'] as AIProviderName) ?? 'mock';
  const model = options?.model ?? process.env['OPENAI_MODEL'] ?? 'gpt-4o';

  if (provider === 'mock') {
    return { ok: true, provider: 'mock', model: 'mock' };
  }

  const apiKey = options?.apiKey ?? process.env['OPENAI_API_KEY'];
  if (!apiKey) {
    return { ok: false, provider: 'openai', model, error: 'OPENAI_API_KEY is not configured' };
  }

  const baseURL = options?.baseURL ?? process.env['OPENAI_BASE_URL'];

  try {
    createAIProvider(provider, { apiKey, model, baseURL });
    return { ok: true, provider: 'openai', model, ...(baseURL ? { baseURL } : {}) };
  } catch (e) {
    return {
      ok: false,
      provider: 'openai',
      model,
      error: e instanceof Error ? e.message : 'Unknown error',
    };
  }
}
