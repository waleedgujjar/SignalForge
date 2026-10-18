import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockCreate = vi.fn();

vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: { completions: { create: mockCreate } },
    })),
  };
});

import OpenAI from 'openai';
import { OpenAIProvider } from './openai-provider.js';

const MockedOpenAI = vi.mocked(OpenAI);

describe('OpenAIProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('passes baseURL to OpenAI client', () => {
      new OpenAIProvider('sk-test', 'gpt-4o', { baseURL: 'http://localhost:3001/v1' });

      expect(MockedOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({ baseURL: 'http://localhost:3001/v1' }),
      );
    });

    it('omits baseURL when not provided', () => {
      new OpenAIProvider('sk-test', 'gpt-4o');

      const callArgs = MockedOpenAI.mock.calls[0]?.[0];
      expect(callArgs).not.toHaveProperty('baseURL');
    });

    it('sets default headers', () => {
      new OpenAIProvider('sk-test', 'gpt-4o');

      expect(MockedOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultHeaders: expect.objectContaining({
            'X-Title': 'SignalForge',
          }),
        }),
      );
    });
  });

  describe('chat method (via scoreLead)', () => {
    it('requests JSON mode', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: '{"score":80,"reasons":["Good fit"],"category":"WARM"}' } }],
      });

      const provider = new OpenAIProvider('sk-test', 'auto');
      await provider.scoreLead({ leadId: 'lead_1', company: 'Acme' });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          response_format: { type: 'json_object' },
        }),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it('uses the configured model', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: '{"score":80,"reasons":["Good fit"],"category":"WARM"}' } }],
      });

      const provider = new OpenAIProvider('sk-test', 'auto:smart');
      await provider.scoreLead({ leadId: 'lead_1' });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'auto:smart' }),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it('parses valid JSON response', async () => {
      const expected = { score: 85, reasons: ['Strong title'], category: 'HOT' };
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify(expected) } }],
      });

      const provider = new OpenAIProvider('sk-test', 'gpt-4o');
      const result = await provider.scoreLead({ leadId: 'lead_1', company: 'Test Corp', title: 'CEO' });

      expect(result).toEqual(expected);
    });

    it('throws descriptive error on empty response', async () => {
      mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: null } }] });

      const provider = new OpenAIProvider('sk-test', 'auto');
      await expect(provider.scoreLead({ leadId: 'lead_1' })).rejects.toThrow(
        'AI provider returned an empty response (model: auto)',
      );
    });

    it('throws descriptive error on empty choices', async () => {
      mockCreate.mockResolvedValueOnce({ choices: [] });

      const provider = new OpenAIProvider('sk-test', 'auto');
      await expect(provider.scoreLead({ leadId: 'lead_1' })).rejects.toThrow(
        'AI provider returned an empty response',
      );
    });

    it('throws descriptive error on invalid JSON', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'This is not JSON at all' } }],
      });

      const provider = new OpenAIProvider('sk-test', 'auto');
      await expect(provider.scoreLead({ leadId: 'lead_1' })).rejects.toThrow(
        'AI provider returned invalid JSON (model: auto): This is not JSON at all',
      );
    });

    it('truncates long invalid content in error message', async () => {
      const longContent = 'x'.repeat(500);
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: longContent } }],
      });

      const provider = new OpenAIProvider('sk-test', 'auto');
      try {
        await provider.scoreLead({ leadId: 'lead_1' });
        expect.fail('Should have thrown');
      } catch (e) {
        const msg = (e as Error).message;
        expect(msg).toContain('invalid JSON');
        expect(msg.length).toBeLessThan(300);
      }
    });

    it('sets temperature to 0.3', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: '{"score":80,"reasons":[],"category":"WARM"}' } }],
      });

      const provider = new OpenAIProvider('sk-test', 'gpt-4o');
      await provider.scoreLead({ leadId: 'lead_1' });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ temperature: 0.3 }),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
  });
});
