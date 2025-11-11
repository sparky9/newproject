# Fireworks LLM Integration

This directory contains the LLM (Large Language Model) integration layer for the Online C-Suite platform, powered by Fireworks AI using the Qwen 2.5 72B model.

## Overview

The LLM integration provides AI-powered conversations with different C-suite personas (CEO, CFO, CMO, CTO) with:

- Real-time streaming responses
- Context-aware prompts with business data
- Conversation memory and history
- Token usage tracking
- Rate limiting for cost control
- Tenant isolation

## Architecture

### Components

1. **fireworks-client.ts** - Core API client for Fireworks AI
   - Handles streaming SSE responses
   - Token estimation
   - Error handling and retries

2. **prompt-builder.ts** - Context-aware prompt construction
   - System prompts for each persona
   - Conversation history management
   - Business context injection
   - Analytics and insights integration

## Usage

### Basic Chat Example

```typescript
import { streamCompletion } from './services/llm/fireworks-client';
import { buildPersonaPrompt } from './services/llm/prompt-builder';

// Build prompt with context
const messages = await buildPersonaPrompt(
  'What should I focus on this quarter?',
  {
    tenantId: 'tenant-123',
    userId: 'user-456',
    businessProfile: {
      industry: 'SaaS',
      size: 'small',
      stage: 'growth',
      revenue: '$100k-$500k',
    },
    recentAnalytics: {
      sessions: 1500,
      users: 450,
      conversions: 23,
      revenue: 12500.50,
    },
  },
  'ceo'
);

// Stream response
for await (const chunk of streamCompletion({
  messages,
  tenantId: 'tenant-123',
  userId: 'user-456',
})) {
  if (chunk.done) {
    console.log('Streaming complete');
    break;
  }
  process.stdout.write(chunk.content);
}
```

### Configuration

Set the following environment variables:

```bash
FIREWORKS_API_KEY=your-api-key
FIREWORKS_MODEL=accounts/fireworks/models/qwen2p5-72b-instruct
FIREWORKS_MAX_TOKENS=2048
FIREWORKS_TEMPERATURE=0.7
```

## Features

### 1. Streaming Responses

The integration uses Server-Sent Events (SSE) for real-time streaming:

```typescript
for await (const chunk of streamCompletion(options)) {
  if (chunk.done) break;

  console.log(chunk.content); // "Hello", " world", "!"
  console.log(chunk.metadata?.model); // "qwen2p5-72b-instruct"
}
```

### 2. Context-Aware Prompts

Prompts automatically include:

- **Business Profile**: Industry, size, stage, revenue, goals
- **Recent Analytics**: Sessions, users, conversions, revenue
- **Module Insights**: Latest insights from connected modules
- **Conversation History**: Last 5 exchanges for memory

### 3. Persona-Specific Guidance

Each persona has customized system prompts:

- **CEO**: Strategic guidance, growth focus
- **CFO**: Financial planning, budget optimization
- **CMO**: Marketing strategy, customer acquisition
- **CTO**: Technology roadmap, technical architecture

### 4. Token Tracking

All messages include token metadata:

```typescript
{
  metadata: {
    model: 'qwen2p5-72b-instruct',
    tokens: {
      input: 245,
      output: 128,
      total: 373
    }
  }
}
```

### 5. Rate Limiting

Chat endpoints are protected by rate limits:

- **Chat**: 10 requests/minute per tenant
- **General API**: 100 requests/15 minutes per tenant
- **Strict Operations**: 5 requests/hour per tenant

## API Reference

### `streamCompletion(options)`

Streams completion from Fireworks API.

**Parameters:**
- `messages: LLMMessage[]` - Array of conversation messages
- `model?: string` - Model name (default: config.fireworks.model)
- `temperature?: number` - Response randomness (default: 0.7)
- `maxTokens?: number` - Maximum response length (default: 2048)
- `tenantId: string` - Tenant ID for logging
- `userId: string` - User ID for logging

**Returns:** `AsyncGenerator<LLMStreamChunk>`

### `buildPersonaPrompt(userMessage, context, personaType)`

Builds a context-aware prompt for a specific persona.

**Parameters:**
- `userMessage: string` - User's current message
- `context: PromptContext` - Business context and history
- `personaType: 'ceo' | 'cfo' | 'cmo' | 'cto'` - Persona type

**Returns:** `Promise<LLMMessage[]>`

### `estimateTokens(text)`

Estimates token count for a text string.

**Parameters:**
- `text: string` - Text to estimate

**Returns:** `number` - Estimated token count

## Error Handling

The integration includes comprehensive error handling:

```typescript
try {
  for await (const chunk of streamCompletion(options)) {
    // Process chunk
  }
} catch (error) {
  if (error.message.includes('Fireworks API error')) {
    // API error (4xx, 5xx)
  } else if (error.message.includes('No response body')) {
    // Streaming error
  } else {
    // Other errors
  }
}
```

## Rate Limiting

### Chat Rate Limiter

Applied to `/chat` endpoint:

```typescript
import { chatRateLimiter } from '../middleware/rate-limit';

router.post('/chat',
  requireAuth(),
  resolveTenant(),
  chatRateLimiter,  // 10 req/min per tenant
  chatHandler
);
```

### Custom Rate Limits

Create custom rate limiters:

```typescript
import { rateLimit } from 'express-rate-limit';
import { getRedisConnection } from '../queue';

const customLimiter = rateLimit({
  store: new RedisStore({
    sendCommand: (...args) => getRedisConnection().call(...args),
    prefix: 'rate_limit:custom:',
  }),
  windowMs: 60 * 1000,
  max: 20,
});
```

## Testing

### Unit Tests

Run unit tests:

```bash
npm test tests/unit/llm
```

### Test Coverage

- Prompt building with various contexts
- Token estimation accuracy
- Streaming parser with SSE
- Error handling scenarios
- Rate limiting behavior

### Example Test

```typescript
import { buildPersonaPrompt } from './prompt-builder';

describe('Prompt Builder', () => {
  it('should include business context', async () => {
    const messages = await buildPersonaPrompt(
      'Help me',
      {
        tenantId: 'test',
        userId: 'test',
        businessProfile: { industry: 'SaaS', ... },
      },
      'ceo'
    );

    expect(messages[0].content).toContain('Industry: SaaS');
  });
});
```

## Monitoring

### Logging

All LLM operations are logged:

```typescript
// Stream start
logger.info('Starting Fireworks API stream', {
  tenantId,
  userId,
  model,
  messageCount,
});

// Stream completion
logger.info('Fireworks stream completed', {
  tenantId,
  userId,
  tokens: { input, output, total },
});

// Errors
logger.error('Error in Fireworks stream', {
  error: error.message,
  tenantId,
  userId,
});
```

### Metrics to Track

1. **Token Usage**
   - Input tokens per request
   - Output tokens per request
   - Total tokens per tenant

2. **Performance**
   - Time to first token (TTFT)
   - Tokens per second
   - Total request duration

3. **Errors**
   - API error rate
   - Streaming errors
   - Rate limit hits

## Cost Management

### Token Costs

Track token usage in message metadata:

```typescript
await prisma.message.create({
  data: {
    content: fullResponse,
    metadata: {
      tokens: {
        input: 245,
        output: 128,
        total: 373
      }
    }
  }
});
```

### Query Usage

```sql
-- Total tokens by tenant (last 30 days)
SELECT
  tenant_id,
  SUM((metadata->>'tokens'->'total')::int) as total_tokens
FROM messages
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY tenant_id;
```

### Cost Estimation

```typescript
const COST_PER_1K_TOKENS = 0.002; // $0.002 per 1k tokens

function estimateCost(tokens: number): number {
  return (tokens / 1000) * COST_PER_1K_TOKENS;
}
```

## Best Practices

1. **Rate Limiting**: Always apply rate limiters to prevent abuse
2. **Context Size**: Keep prompts under 4k tokens for optimal performance
3. **Error Handling**: Always handle streaming errors gracefully
4. **Token Tracking**: Log all token usage for cost monitoring
5. **Caching**: Cache business context to reduce database queries
6. **Testing**: Mock Fireworks API in tests to avoid real API calls

## Troubleshooting

### Common Issues

**Issue**: Streaming stops mid-response
- Check network stability
- Verify Redis connection
- Review Fireworks API status

**Issue**: Rate limit exceeded
- Check tenant request volume
- Adjust rate limits if needed
- Implement request queuing

**Issue**: High token costs
- Review prompt sizes
- Optimize system prompts
- Implement response caching

**Issue**: Slow responses
- Check Fireworks API latency
- Optimize context fetching
- Consider using smaller model

## Future Enhancements

- [ ] Response caching for common queries
- [ ] Fine-tuned models per persona
- [ ] Multi-turn conversation optimization
- [ ] Advanced token prediction
- [ ] Cost alerts and budgets
- [ ] A/B testing different models
- [ ] Conversation analytics dashboard
- [ ] Smart context selection (RAG)

## References

- [Fireworks API Documentation](https://docs.fireworks.ai/)
- [Qwen 2.5 Model Card](https://huggingface.co/Qwen/Qwen2.5-72B-Instruct)
- [SSE Specification](https://html.spec.whatwg.org/multipage/server-sent-events.html)
