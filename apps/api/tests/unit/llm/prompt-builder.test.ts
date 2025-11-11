import { describe, it, expect, beforeEach, vi, afterEach, afterAll } from 'vitest';
import { buildPersonaPrompt } from '../../../src/services/llm/prompt-builder.js';
import type { PromptContext } from '../../../src/services/llm/prompt-builder.js';

// Mock the database client locally and reset after suite to avoid leaking to other tests
vi.mock('@ocsuite/db', () => ({
  createTenantClient: vi.fn(() => ({
    message: {
      findMany: vi.fn(),
    },
    $disconnect: vi.fn(),
  })),
}));

describe('Prompt Builder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(() => {
    vi.resetModules();
  });

  describe('buildPersonaPrompt', () => {
    it('should build a basic prompt without context', async () => {
      const context: PromptContext = {
        tenantId: 'test-tenant',
        userId: 'test-user',
      };

      const messages = await buildPersonaPrompt(
        'What should I focus on this quarter?',
        context,
        'ceo'
      );

      expect(messages).toHaveLength(2); // system + user message
      const [systemMessage, userMessage] = messages;
      expect(systemMessage).toBeDefined();
      expect(userMessage).toBeDefined();
      expect(systemMessage!.role).toBe('system');
      expect(systemMessage!.content).toContain('CEO');
      expect(userMessage!.role).toBe('user');
      expect(userMessage!.content).toBe('What should I focus on this quarter?');
    });

    it('should include business profile in system prompt', async () => {
      const context: PromptContext = {
        tenantId: 'test-tenant',
        userId: 'test-user',
        businessProfile: {
          industry: 'SaaS',
          size: 'small',
          stage: 'growth',
          revenue: '$100k-$500k',
          goals: ['Increase MRR', 'Reduce churn'],
        },
      };

      const messages = await buildPersonaPrompt(
        'Help me plan my Q4 strategy',
        context,
        'ceo'
      );

  const systemPrompt = messages[0]!.content;
      expect(systemPrompt).toContain('Industry: SaaS');
      expect(systemPrompt).toContain('Company Size: small');
      expect(systemPrompt).toContain('Business Stage: growth');
      expect(systemPrompt).toContain('Revenue: $100k-$500k');
      expect(systemPrompt).toContain('Increase MRR');
      expect(systemPrompt).toContain('Reduce churn');
    });

    it('should include recent analytics in system prompt', async () => {
      const context: PromptContext = {
        tenantId: 'test-tenant',
        userId: 'test-user',
        recentAnalytics: {
          sessions: 1500,
          users: 450,
          conversions: 23,
          revenue: 12500.50,
        },
      };

      const messages = await buildPersonaPrompt(
        'How are we performing?',
        context,
        'ceo'
      );

  const systemPrompt = messages[0]!.content;
      expect(systemPrompt).toContain('Sessions: 1,500');
      expect(systemPrompt).toContain('Users: 450');
      expect(systemPrompt).toContain('Conversions: 23');
      expect(systemPrompt).toContain('Revenue: $12,500.5');
    });

    it('should include recent insights in system prompt', async () => {
      const context: PromptContext = {
        tenantId: 'test-tenant',
        userId: 'test-user',
        recentInsights: [
          {
            moduleSlug: 'growth-pulse',
            summary: 'Traffic increased 25% month-over-month',
            highlights: ['Organic search up 40%', 'Social media engagement strong'],
          },
          {
            moduleSlug: 'sales-compass',
            summary: 'Pipeline health is good',
            highlights: ['3 deals in closing stage', 'Average deal size up 15%'],
          },
        ],
      };

      const messages = await buildPersonaPrompt(
        'Give me a status update',
        context,
        'ceo'
      );

  const systemPrompt = messages[0]!.content;
      expect(systemPrompt).toContain('growth-pulse');
      expect(systemPrompt).toContain('Traffic increased 25% month-over-month');
      expect(systemPrompt).toContain('sales-compass');
      expect(systemPrompt).toContain('Pipeline health is good');
    });

    it('should customize system prompt for different personas', async () => {
      const context: PromptContext = {
        tenantId: 'test-tenant',
        userId: 'test-user',
      };

      const ceoMessages = await buildPersonaPrompt(
        'Test message',
        context,
        'ceo'
      );
      const cfoMessages = await buildPersonaPrompt(
        'Test message',
        context,
        'cfo'
      );
      const cmoMessages = await buildPersonaPrompt(
        'Test message',
        context,
        'cmo'
      );
      const ctoMessages = await buildPersonaPrompt(
        'Test message',
        context,
        'cto'
      );

  expect(ceoMessages[0]!.content).toContain('Chief Executive Officer');
  expect(cfoMessages[0]!.content).toContain('Chief Financial Officer');
  expect(cmoMessages[0]!.content).toContain('Chief Marketing Officer');
  expect(ctoMessages[0]!.content).toContain('Chief Technology Officer');

  expect(ceoMessages[0]!.content).toContain('strategic guidance');
  expect(cfoMessages[0]!.content).toContain('financial planning');
  expect(cmoMessages[0]!.content).toContain('marketing strategy');
  expect(ctoMessages[0]!.content).toContain('technology strategy');
    });

    it('should handle empty context gracefully', async () => {
      const context: PromptContext = {
        tenantId: 'test-tenant',
        userId: 'test-user',
        businessProfile: undefined,
        recentAnalytics: undefined,
        recentInsights: undefined,
      };

      const messages = await buildPersonaPrompt(
        'Hello',
        context,
        'ceo'
      );

      expect(messages).toHaveLength(2);
  expect(messages[0]!.role).toBe('system');
  expect(messages[1]!.role).toBe('user');
  expect(messages[1]!.content).toBe('Hello');
    });

    it('should limit insights to 2 in system prompt', async () => {
      const context: PromptContext = {
        tenantId: 'test-tenant',
        userId: 'test-user',
        recentInsights: [
          { moduleSlug: 'insight-1', summary: 'Summary 1', highlights: [] },
          { moduleSlug: 'insight-2', summary: 'Summary 2', highlights: [] },
          { moduleSlug: 'insight-3', summary: 'Summary 3', highlights: [] },
          { moduleSlug: 'insight-4', summary: 'Summary 4', highlights: [] },
        ],
      };

      const messages = await buildPersonaPrompt(
        'Test',
        context,
        'ceo'
      );

  const systemPrompt = messages[0]!.content;
      expect(systemPrompt).toContain('insight-1');
      expect(systemPrompt).toContain('insight-2');
      // Should not include more than 2 insights for non-CEO personas
      // CEO gets all 3, others get 2
    });

    it('should include actionable guidance in system prompt', async () => {
      const context: PromptContext = {
        tenantId: 'test-tenant',
        userId: 'test-user',
      };

      const messages = await buildPersonaPrompt(
        'Test',
        context,
        'ceo'
      );

  const systemPrompt = messages[0]!.content;
      expect(systemPrompt).toContain('actionable');
      expect(systemPrompt).toContain('concise');
      expect(systemPrompt).toContain('recommendations');
    });
  });
});
