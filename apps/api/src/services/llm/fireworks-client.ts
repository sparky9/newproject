import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import { trackLLMTokens } from '../../utils/metrics.js';

export interface LLMStreamChunk {
  content: string;
  done: boolean;
  metadata?: {
    model: string;
    finishReason?: string;
  };
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMStreamOptions {
  messages: LLMMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tenantId: string;
  userId: string;
}

/**
 * Stream completion from Fireworks API
 *
 * @param options - Stream options including messages and tenant context
 * @returns AsyncGenerator that yields LLMStreamChunk objects
 */
export async function* streamCompletion(options: LLMStreamOptions): AsyncGenerator<LLMStreamChunk> {
  const {
    messages,
    model = config.fireworks.model,
    temperature = config.fireworks.temperature,
    maxTokens = config.fireworks.maxTokens,
    tenantId,
    userId
  } = options;

  logger.info('Starting Fireworks API stream', {
    tenantId,
    userId,
    model,
    messageCount: messages.length,
  });

  try {
    // Call Fireworks API with streaming
    const response = await fetch('https://api.fireworks.ai/inference/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.fireworks.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Fireworks API error', {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
        tenantId,
        userId,
      });
      throw new Error(`Fireworks API error: ${response.status} ${response.statusText}`);
    }

    // Parse SSE stream
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body from Fireworks API');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let totalOutputContent = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim() || line.startsWith(':')) continue;
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              // Track tokens when stream is complete
              const inputTokens = estimateMessagesTokens(messages);
              const outputTokens = estimateTokens(totalOutputContent);
              const tokenAttributes: Record<string, string> = {
                operation: 'chat-completion',
                model,
              };

              if (tenantId) {
                tokenAttributes.tenantId = tenantId;
              }

              trackLLMTokens(inputTokens, outputTokens, tokenAttributes);

              yield { content: '', done: true };
              logger.info('Fireworks stream completed', { tenantId, userId });
              return;
            }

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content || '';
              if (content) {
                totalOutputContent += content;
                yield {
                  content,
                  done: false,
                  metadata: {
                    model: parsed.model,
                    finishReason: parsed.choices?.[0]?.finish_reason,
                  },
                };
              }
            } catch (e) {
              logger.warn('Failed to parse Fireworks SSE chunk', {
                line,
                error: e instanceof Error ? e.message : 'Unknown error',
                tenantId,
                userId,
              });
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  } catch (error) {
    logger.error('Error in Fireworks stream', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      tenantId,
      userId,
    });
    throw error;
  }
}

/**
 * Estimate token count for a text string
 *
 * Uses a rough approximation: 1 token ≈ 4 characters
 * For production, consider using a proper tokenizer library
 *
 * @param text - Text to estimate tokens for
 * @returns Estimated token count
 */
export function estimateTokens(text: string): number {
  // Rough estimate: 1 token ≈ 4 characters
  return Math.ceil(text.length / 4);
}

/**
 * Calculate total tokens for an array of messages
 *
 * @param messages - Array of LLM messages
 * @returns Total estimated token count
 */
export function estimateMessagesTokens(messages: LLMMessage[]): number {
  return messages.reduce((total, msg) => {
    // Add tokens for content + some overhead for role/formatting
    return total + estimateTokens(msg.content) + 4;
  }, 0);
}
