import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import { trackLLMTokens } from '../../utils/metrics.js';
import { estimateTokens } from './fireworks-client.js';

export interface EmbeddingRequest {
  /** Text chunks to embed */
  inputs: string[];
  /** Override Fireworks embedding model */
  model?: string;
  /** Tenant context for logging */
  tenantId: string | null;
  /** Optional user id for audit */
  userId?: string;
}

export interface EmbeddingResponse {
  vectors: number[][];
  usage: {
    totalTokens: number;
    model: string;
  };
}

export class FireworksEmbeddingError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'FireworksEmbeddingError';
  }
}

function buildRequestBody(request: EmbeddingRequest) {
  return {
    model: request.model ?? config.fireworks.embeddingModel,
    input: request.inputs,
  };
}

export async function generateEmbeddings(request: EmbeddingRequest): Promise<EmbeddingResponse> {
  if (!request.inputs.length) {
    return {
      vectors: [],
      usage: {
        totalTokens: 0,
        model: request.model ?? config.fireworks.embeddingModel,
      },
    };
  }

  const body = buildRequestBody(request);
  const estimatedTokens = request.inputs.reduce((total, chunk) => total + estimateTokens(chunk), 0);

  logger.debug('Generating embeddings via Fireworks', {
    tenantId: request.tenantId,
    userId: request.userId,
    chunkCount: request.inputs.length,
    model: body.model,
    estimatedTokens,
  });

  const response = await fetch('https://api.fireworks.ai/inference/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.fireworks.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    logger.error('Fireworks embeddings request failed', {
      status: response.status,
      statusText: response.statusText,
      error: errorText,
      tenantId: request.tenantId,
      userId: request.userId,
    });
    throw new FireworksEmbeddingError(
      `Fireworks embeddings error: ${response.status} ${response.statusText}`,
      response.status,
    );
  }

  const payload = await response.json() as {
    data: Array<{ embedding: number[]; index: number }>;
    usage?: { prompt_tokens?: number; total_tokens?: number };
    model?: string;
  };

  if (!payload?.data?.length) {
    throw new FireworksEmbeddingError('Fireworks embeddings response missing data');
  }

  const vectors = payload.data
    .sort((a, b) => a.index - b.index)
    .map((item) => item.embedding);

  const totalTokens = payload.usage?.total_tokens ?? payload.usage?.prompt_tokens ?? estimatedTokens;

  const tokenAttributes: Record<string, string> = {
    operation: 'embedding',
    model: payload.model ?? body.model,
  };

  if (request.tenantId) {
    tokenAttributes.tenantId = request.tenantId;
  }

  trackLLMTokens(totalTokens, 0, tokenAttributes);

  const modelUsed = payload.model ?? body.model;

  return {
    vectors,
    usage: {
      totalTokens,
      model: modelUsed,
    },
  };
}
