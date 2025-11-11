import { LLMMessage } from './fireworks-client.js';
import { prisma, createTenantClient } from '@ocsuite/db';
import { logger } from '../../utils/logger.js';
import { KnowledgeResolver, type KnowledgeSearchResult } from '../knowledge-resolver.js';
import { generateEmbeddings } from './embedding-client.js';

export interface PromptContext {
  tenantId: string;
  userId: string;
  conversationId?: string;
  businessProfile?: {
    industry: string;
    size: string;
    stage: string;
    revenue?: string;
    goals?: string[];
  };
  recentInsights?: Array<{
    moduleSlug: string;
    summary: string;
    highlights: string[];
  }>;
  recentAnalytics?: {
    sessions: number;
    users: number;
    conversions: number;
    revenue: number;
  };
}

/**
 * Build a prompt with context for the CEO persona
 *
 * Fetches conversation history and builds a context-aware prompt
 * with business profile, recent insights, and analytics data
 *
 * @param userMessage - The user's current message
 * @param context - Context including tenant ID, user ID, and business data
 * @returns Array of LLM messages ready for the API
 */
export async function buildCEOPrompt(
  userMessage: string,
  context: PromptContext
): Promise<LLMMessage[]> {
  const messages: LLMMessage[] = [];

  // System prompt for CEO persona
  const knowledgeSnippets = await resolveKnowledgeSnippets(userMessage, context, 'ceo');
  let systemPrompt = buildSystemPrompt(context);

  if (knowledgeSnippets.length) {
    systemPrompt += `

Relevant Knowledge Entries:
${knowledgeSnippets.join('\n\n')}

Incorporate the above organization knowledge when crafting your response.`;
  }

  messages.push({
    role: 'system',
    content: systemPrompt,
  });

  // Add conversation history (last 5 exchanges for memory)
  if (context.conversationId) {
    try {
      const prisma = createTenantClient({
        tenantId: context.tenantId,
        userId: context.userId,
      });

      const history = await prisma.message.findMany({
        where: {
          conversationId: context.conversationId,
        },
        orderBy: { createdAt: 'desc' },
        take: 10, // Last 5 exchanges (10 messages)
      });

      // Reverse to get chronological order
      for (const msg of history.reverse()) {
        // Skip system messages from history
        if (msg.role === 'system') continue;

        messages.push({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        });
      }

      await prisma.$disconnect();

      logger.info('Loaded conversation history', {
        conversationId: context.conversationId,
        messageCount: history.length,
        tenantId: context.tenantId,
      });
    } catch (error) {
      logger.error('Failed to load conversation history', {
        conversationId: context.conversationId,
        error: error instanceof Error ? error.message : 'Unknown error',
        tenantId: context.tenantId,
      });
      // Continue without history rather than failing
    }
  }

  // Add current user message
  messages.push({
    role: 'user',
    content: userMessage,
  });

  return messages;
}

/**
 * Build the system prompt for the CEO persona
 *
 * Includes role definition, business context, recent metrics, and insights
 *
 * @param context - Context including business profile and analytics
 * @returns System prompt string
 */
function buildSystemPrompt(context: PromptContext): string {
  const { businessProfile, recentInsights, recentAnalytics } = context;

  let prompt = `You are the CEO persona of Online C-Suite, an AI-powered board of advisors for solopreneurs and small businesses.

Your role:
- Provide strategic guidance and executive-level insights
- Be direct, actionable, and results-oriented
- Reference specific data when making recommendations
- Keep responses concise (2-3 paragraphs max)
- Use a confident but supportive tone
- Focus on growth, efficiency, and strategic decision-making`;

  if (businessProfile) {
    prompt += `\n\nBusiness Context:`;
    if (businessProfile.industry) {
      prompt += `\n- Industry: ${businessProfile.industry}`;
    }
    if (businessProfile.size) {
      prompt += `\n- Company Size: ${businessProfile.size}`;
    }
    if (businessProfile.stage) {
      prompt += `\n- Business Stage: ${businessProfile.stage}`;
    }
    if (businessProfile.revenue) {
      prompt += `\n- Revenue: ${businessProfile.revenue}`;
    }
    if (businessProfile.goals && businessProfile.goals.length > 0) {
      prompt += `\n- Goals: ${businessProfile.goals.join(', ')}`;
    }
  }

  if (recentAnalytics) {
    prompt += `\n\nRecent Performance Metrics (Last 30 Days):`;
    prompt += `\n- Sessions: ${recentAnalytics.sessions.toLocaleString()}`;
    prompt += `\n- Users: ${recentAnalytics.users.toLocaleString()}`;
    prompt += `\n- Conversions: ${recentAnalytics.conversions}`;
    prompt += `\n- Revenue: $${recentAnalytics.revenue.toLocaleString()}`;
  }

  if (recentInsights && recentInsights.length > 0) {
    prompt += `\n\nRecent Module Insights:`;
    for (const insight of recentInsights) {
      prompt += `\n\n${insight.moduleSlug}:`;
      prompt += `\n- ${insight.summary}`;
      if (insight.highlights.length > 0) {
        prompt += `\n- Key highlights: ${insight.highlights.slice(0, 3).join(', ')}`;
      }
    }
  }

  prompt += `\n\nRemember: Be specific, reference the data above when relevant, and focus on actionable next steps. Think like a strategic CEO advising their business.`;

  return prompt;
}

/**
 * Build a prompt for other personas (CFO, CMO, CTO)
 *
 * Similar to CEO prompt but with persona-specific focus
 *
 * @param userMessage - The user's current message
 * @param context - Context including tenant ID, user ID, and business data
 * @param personaType - The persona to build for
 * @returns Array of LLM messages ready for the API
 */
export async function buildPersonaPrompt(
  userMessage: string,
  context: PromptContext,
  personaType: 'ceo' | 'cfo' | 'cmo' | 'cto'
): Promise<LLMMessage[]> {
  // For now, all personas use similar structure
  // In future iterations, we can customize per persona
  const messages: LLMMessage[] = [];

  const knowledgeSnippets = await resolveKnowledgeSnippets(userMessage, context, personaType);
  let systemPrompt = buildPersonaSystemPrompt(context, personaType);

  if (knowledgeSnippets.length) {
    systemPrompt += `

Relevant Knowledge Entries:
${knowledgeSnippets.join('\n\n')}

Blend this knowledge with current analytics when responding.`;
  }

  messages.push({
    role: 'system',
    content: systemPrompt,
  });

  // Add conversation history
  if (context.conversationId) {
    try {
      const prisma = createTenantClient({
        tenantId: context.tenantId,
        userId: context.userId,
      });

      const history = await prisma.message.findMany({
        where: {
          conversationId: context.conversationId,
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });

      for (const msg of history.reverse()) {
        if (msg.role === 'system') continue;

        messages.push({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        });
      }

      await prisma.$disconnect();
    } catch (error) {
      logger.error('Failed to load conversation history', {
        conversationId: context.conversationId,
        error: error instanceof Error ? error.message : 'Unknown error',
        tenantId: context.tenantId,
      });
    }
  }

  messages.push({
    role: 'user',
    content: userMessage,
  });

  return messages;
}

/**
 * Build system prompt for different personas
 */
function buildPersonaSystemPrompt(
  context: PromptContext,
  personaType: 'ceo' | 'cfo' | 'cmo' | 'cto'
): string {
  const personaConfig = {
    ceo: {
      title: 'CEO',
      role: 'Chief Executive Officer',
      focus: 'strategic guidance, growth, and executive-level insights',
      style: 'confident, results-oriented, and strategic',
    },
    cfo: {
      title: 'CFO',
      role: 'Chief Financial Officer',
      focus: 'financial planning, budgeting, and fiscal responsibility',
      style: 'analytical, data-driven, and financially prudent',
    },
    cmo: {
      title: 'CMO',
      role: 'Chief Marketing Officer',
      focus: 'marketing strategy, customer acquisition, and brand growth',
      style: 'creative, customer-focused, and growth-oriented',
    },
    cto: {
      title: 'CTO',
      role: 'Chief Technology Officer',
      focus: 'technology strategy, systems architecture, and technical excellence',
      style: 'technical, innovative, and solution-focused',
    },
  };

  const config = personaConfig[personaType];
  const { businessProfile, recentAnalytics, recentInsights } = context;

  let prompt = `You are the ${config.role} (${config.title}) of Online C-Suite, an AI-powered board of advisors for solopreneurs and small businesses.

Your role:
- Provide ${config.focus}
- Be ${config.style}
- Reference specific data when making recommendations
- Keep responses concise (2-3 paragraphs max)
- Focus on practical, actionable advice`;

  if (businessProfile) {
    prompt += `\n\nBusiness Context:`;
    if (businessProfile.industry) {
      prompt += `\n- Industry: ${businessProfile.industry}`;
    }
    if (businessProfile.size) {
      prompt += `\n- Company Size: ${businessProfile.size}`;
    }
    if (businessProfile.stage) {
      prompt += `\n- Business Stage: ${businessProfile.stage}`;
    }
    if (businessProfile.revenue) {
      prompt += `\n- Revenue: ${businessProfile.revenue}`;
    }
    if (businessProfile.goals && businessProfile.goals.length > 0) {
      prompt += `\n- Goals: ${businessProfile.goals.join(', ')}`;
    }
  }

  if (recentAnalytics) {
    prompt += `\n\nRecent Metrics:`;
    prompt += `\n- Sessions: ${recentAnalytics.sessions.toLocaleString()}`;
    prompt += `\n- Users: ${recentAnalytics.users.toLocaleString()}`;
    prompt += `\n- Conversions: ${recentAnalytics.conversions}`;
    prompt += `\n- Revenue: $${recentAnalytics.revenue.toLocaleString()}`;
  }

  if (recentInsights && recentInsights.length > 0) {
    prompt += `\n\nRecent Insights:`;
    for (const insight of recentInsights.slice(0, 2)) {
      prompt += `\n- ${insight.moduleSlug}: ${insight.summary}`;
    }
  }

  prompt += `\n\nRemember: Provide specific, actionable recommendations from your ${config.title} perspective.`;

  return prompt;
}

async function resolveKnowledgeSnippets(
  userMessage: string,
  context: PromptContext,
  persona: 'ceo' | 'cfo' | 'cmo' | 'cto'
): Promise<string[]> {
  if (!context.tenantId || !userMessage.trim()) {
    return [];
  }

  try {
    const embeddings = await generateEmbeddings({
      inputs: [userMessage],
      tenantId: context.tenantId,
      userId: context.userId,
    });

    const [vector] = embeddings.vectors;
    if (!vector || !vector.length) {
      return [];
    }

    const resolver = new KnowledgeResolver({
      prisma,
      tenantId: context.tenantId,
      userId: context.userId,
      defaultLimit: 6,
    });

    const results = await resolver.resolveContext({
      embedding: vector,
      persona,
      limit: 6,
    });

    return results.map((result, index) => formatKnowledgeSnippet(result, index));
  } catch (error) {
    logger.warn('Failed to resolve knowledge snippets for prompt', {
      tenantId: context.tenantId,
      userId: context.userId,
      persona,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return [];
  }
}

function formatKnowledgeSnippet(result: KnowledgeSearchResult, index: number): string {
  const metadata = result.entry.metadata ?? {};
  const title = typeof metadata.documentTitle === 'string'
    ? metadata.documentTitle
    : result.entry.sourceName ?? result.entry.source;
  const personas = Array.isArray(metadata.personas)
    ? metadata.personas.filter((value: unknown): value is string => typeof value === 'string')
    : [];
  const tags = Array.isArray(metadata.tags)
    ? metadata.tags.filter((value: unknown): value is string => typeof value === 'string')
    : [];

  const snippet = result.content.replace(/\s+/g, ' ').trim();
  const truncated = snippet.length > 480 ? `${snippet.slice(0, 477)}...` : snippet;

  const personaLabel = personas.length ? ` (personas: ${personas.join(', ')})` : '';
  const tagLabel = tags.length ? ` [tags: ${tags.join(', ')}]` : '';
  const score = result.score.toFixed(2);

  return `${index + 1}. ${title}${personaLabel}${tagLabel}
Confidence: ${score}
${truncated}`;
}
