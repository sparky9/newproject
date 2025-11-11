import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { streamCompletion, estimateTokens, estimateMessagesTokens } from '../../../src/services/llm/fireworks-client.js';
import type { LLMMessage } from '../../../src/services/llm/fireworks-client.js';

// Mock the config
vi.mock('../../../src/config/index.js', () => ({
  config: {
    fireworks: {
      apiKey: 'test-api-key',
      model: 'test-model',
      maxTokens: 2048,
      temperature: 0.7,
    },
  },
}));

// Mock the logger
vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('Fireworks Client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('estimateTokens', () => {
    it('should estimate tokens for empty string', () => {
      expect(estimateTokens('')).toBe(0);
    });

    it('should estimate tokens for short text', () => {
      const text = 'Hello world';
      const tokens = estimateTokens(text);
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBe(Math.ceil(text.length / 4));
    });

    it('should estimate tokens for longer text', () => {
      const text = 'This is a longer piece of text that should result in more tokens being estimated.';
      const tokens = estimateTokens(text);
      expect(tokens).toBe(Math.ceil(text.length / 4));
      expect(tokens).toBeGreaterThan(10);
    });

    it('should handle special characters', () => {
      const text = 'Hello! @#$%^&*() 123';
      const tokens = estimateTokens(text);
      expect(tokens).toBeGreaterThan(0);
    });
  });

  describe('estimateMessagesTokens', () => {
    it('should estimate tokens for empty message array', () => {
      expect(estimateMessagesTokens([])).toBe(0);
    });

    it('should estimate tokens for single message', () => {
      const messages: LLMMessage[] = [
        { role: 'user', content: 'Hello world' },
      ];
      const tokens = estimateMessagesTokens(messages);
      // Should include content tokens + overhead
      expect(tokens).toBeGreaterThan(estimateTokens('Hello world'));
    });

    it('should estimate tokens for multiple messages', () => {
      const messages: LLMMessage[] = [
        { role: 'system', content: 'You are a helpful assistant' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];
      const tokens = estimateMessagesTokens(messages);

      // Should include all message tokens + overhead per message
      const expectedMin = estimateTokens('You are a helpful assistant') +
                          estimateTokens('Hello') +
                          estimateTokens('Hi there!');

      expect(tokens).toBeGreaterThan(expectedMin);
    });
  });

  describe('streamCompletion', () => {
    it('should handle successful streaming response', async () => {
      const mockStream = createMockSSEStream([
        'data: {"choices":[{"delta":{"content":"Hello"}}],"model":"test-model"}\n\n',
        'data: {"choices":[{"delta":{"content":" world"}}],"model":"test-model"}\n\n',
        'data: [DONE]\n\n',
      ]);

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        body: mockStream,
      });

      const messages: LLMMessage[] = [
        { role: 'user', content: 'Test message' },
      ];

      const chunks: string[] = [];
      for await (const chunk of streamCompletion({
        messages,
        tenantId: 'test-tenant',
        userId: 'test-user',
      })) {
        if (!chunk.done) {
          chunks.push(chunk.content);
        }
      }

      expect(chunks).toEqual(['Hello', ' world']);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.fireworks.ai/inference/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-api-key',
            'Content-Type': 'application/json',
          }),
        })
      );
    });

    it('should handle API errors', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: vi.fn().mockResolvedValue('Error details'),
      });

      const messages: LLMMessage[] = [
        { role: 'user', content: 'Test message' },
      ];

      await expect(async () => {
        for await (const chunk of streamCompletion({
          messages,
          tenantId: 'test-tenant',
          userId: 'test-user',
        })) {
          // Should not reach here
        }
      }).rejects.toThrow('Fireworks API error');
    });

    it('should skip empty content chunks', async () => {
      const mockStream = createMockSSEStream([
        'data: {"choices":[{"delta":{"content":""}}],"model":"test-model"}\n\n',
        'data: {"choices":[{"delta":{"content":"Hello"}}],"model":"test-model"}\n\n',
        'data: {"choices":[{"delta":{}}],"model":"test-model"}\n\n',
        'data: [DONE]\n\n',
      ]);

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        body: mockStream,
      });

      const messages: LLMMessage[] = [
        { role: 'user', content: 'Test' },
      ];

      const chunks: string[] = [];
      for await (const chunk of streamCompletion({
        messages,
        tenantId: 'test-tenant',
        userId: 'test-user',
      })) {
        if (!chunk.done) {
          chunks.push(chunk.content);
        }
      }

      expect(chunks).toEqual(['Hello']);
    });

    it('should handle malformed SSE chunks gracefully', async () => {
      const mockStream = createMockSSEStream([
        'data: {"choices":[{"delta":{"content":"Hello"}}],"model":"test-model"}\n\n',
        'data: {invalid json}\n\n',
        'data: {"choices":[{"delta":{"content":" world"}}],"model":"test-model"}\n\n',
        'data: [DONE]\n\n',
      ]);

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        body: mockStream,
      });

      const messages: LLMMessage[] = [
        { role: 'user', content: 'Test' },
      ];

      const chunks: string[] = [];
      for await (const chunk of streamCompletion({
        messages,
        tenantId: 'test-tenant',
        userId: 'test-user',
      })) {
        if (!chunk.done) {
          chunks.push(chunk.content);
        }
      }

      // Should skip the malformed chunk but continue processing
      expect(chunks).toEqual(['Hello', ' world']);
    });

    it('should include metadata in chunks', async () => {
      const mockStream = createMockSSEStream([
        'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}],"model":"test-model"}\n\n',
        'data: [DONE]\n\n',
      ]);

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        body: mockStream,
      });

      const messages: LLMMessage[] = [
        { role: 'user', content: 'Test' },
      ];

      const chunks: any[] = [];
      for await (const chunk of streamCompletion({
        messages,
        tenantId: 'test-tenant',
        userId: 'test-user',
      })) {
        chunks.push(chunk);
      }

      expect(chunks[0].metadata).toBeDefined();
      expect(chunks[0].metadata?.model).toBe('test-model');
    });
  });
});

// Helper function to create a mock SSE stream
function createMockSSEStream(data: string[]) {
  const encoder = new TextEncoder();
  let index = 0;

  return {
    getReader: () => ({
      read: async () => {
        if (index >= data.length) {
          return { done: true, value: undefined };
        }
        const value = encoder.encode(data[index]);
        index++;
        return { done: false, value };
      },
      releaseLock: () => {},
    }),
  };
}
