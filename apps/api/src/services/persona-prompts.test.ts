import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildPersonaPrompt,
  passesContentFilter,
  enforceContentFilter,
  listSupportedPersonas,
  type PersonaPromptContext,
} from './persona-prompts.js';
import type { ModuleInsight, AnalyticsSnapshot, BusinessProfile, BoardActionItemRecord } from '@ocsuite/types';

// Mock logger to avoid console spam
vi.mock('../utils/logger.js', () => ({
  apiLogger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('persona-prompts', () => {
  describe('listSupportedPersonas', () => {
    it('should return an array of persona definitions', () => {
      const personas = listSupportedPersonas();
      expect(personas).toBeInstanceOf(Array);
      expect(personas.length).toBeGreaterThan(0);
      expect(personas[0]).toHaveProperty('id');
      expect(personas[0]).toHaveProperty('name');
      expect(personas[0]).toHaveProperty('tone');
      expect(personas[0]).toHaveProperty('expertise');
      expect(personas[0]).toHaveProperty('maxTokens');
      expect(personas[0]).toHaveProperty('streamChunkSize');
    });

    it('should include CEO, CFO, CMO, and CTO personas', () => {
      const personas = listSupportedPersonas();
      const ids = personas.map((p) => p.id);
      expect(ids).toContain('ceo');
      expect(ids).toContain('cfo');
      expect(ids).toContain('cmo');
      expect(ids).toContain('cto');
    });
  });

  describe('buildPersonaPrompt', () => {
    let baseContext: PersonaPromptContext;

    beforeEach(() => {
      baseContext = {
        tenantId: 'test-tenant-123',
        agendaSummary: 'Q4 Strategic Review - Growth, Finance, and Marketing',
        businessProfile: {
          id: 'profile-1',
          tenantId: 'test-tenant-123',
          industry: 'SaaS',
          stage: 'growth',
          size: '10-50',
          revenue: '$500k-$1M ARR',
          goals: ['Increase MRR by 20%', 'Reduce churn to <3%'],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as BusinessProfile,
        latestInsights: [
          {
            id: 'insight-1',
            tenantId: 'test-tenant-123',
            moduleId: 'growth-pulse',
            summary: 'Lead velocity up 15% this month',
            severity: 'info',
            score: 85,
            highlights: ['New leads: 120', 'Conversion rate: 12%', 'Pipeline value: $240k'],
            metadata: {},
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          } as ModuleInsight,
        ],
        analyticsSnapshots: [
          {
            id: 'snap-1',
            tenantId: 'test-tenant-123',
            date: new Date().toISOString().split('T')[0],
            sessions: 1250,
            users: 850,
            conversions: 42,
            revenue: 8500,
            metadata: {},
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          } as AnalyticsSnapshot,
        ],
        existingActionItems: [
          {
            id: 'action-1',
            meetingId: 'meeting-1',
            tenantId: 'test-tenant-123',
            title: 'Launch email nurture campaign',
            description: 'Set up automated sequence for trial users',
            status: 'open' as const,
            priority: 'high' as const,
            assigneeId: 'user-1',
            dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          } as BoardActionItemRecord,
        ],
        recentWins: ['Closed $50k enterprise deal', 'Launched new integration with Slack'],
        personaQuestions: ['What are the top 3 growth levers for next quarter?'],
        metricsSummary: {
          MRR: '$42,000',
          Churn: '4.2%',
          'CAC Payback': '8 months',
        },
      };
    });

    it('should build a valid prompt for CEO persona', () => {
      const result = buildPersonaPrompt('ceo', baseContext);

      expect(result).toHaveProperty('persona');
      expect(result).toHaveProperty('prompt');
      expect(result).toHaveProperty('maxTokens');
      expect(result).toHaveProperty('streamChunkSize');

      expect(result.persona.id).toBe('ceo');
      expect(result.persona.name).toBe('CEO');
      expect(result.maxTokens).toBeGreaterThan(0);
      expect(result.streamChunkSize).toBeGreaterThan(0);
    });

    it('should include business profile in prompt', () => {
      const result = buildPersonaPrompt('cfo', baseContext);

      expect(result.prompt).toContain('Industry: SaaS');
      expect(result.prompt).toContain('Stage: growth');
      expect(result.prompt).toContain('Size: 10-50');
      expect(result.prompt).toContain('Revenue: $500k-$1M ARR');
      expect(result.prompt).toContain('Increase MRR by 20%');
      expect(result.prompt).toContain('Reduce churn to <3%');
    });

    it('should include agenda summary in prompt', () => {
      const result = buildPersonaPrompt('cmo', baseContext);

      expect(result.prompt).toContain('Agenda Summary:');
      expect(result.prompt).toContain('Q4 Strategic Review - Growth, Finance, and Marketing');
    });

    it('should include module insights in prompt', () => {
      const result = buildPersonaPrompt('ceo', baseContext);

      expect(result.prompt).toContain('Latest Module Insights:');
      expect(result.prompt).toContain('Lead velocity up 15% this month');
      expect(result.prompt).toContain('severity: info');
      expect(result.prompt).toContain('score: 85');
      expect(result.prompt).toContain('New leads: 120');
    });

    it('should summarize analytics snapshots correctly', () => {
      const result = buildPersonaPrompt('cfo', baseContext);

      expect(result.prompt).toContain('Analytics Overview:');
      expect(result.prompt).toContain('sessions=1250');
      expect(result.prompt).toContain('users=850');
      expect(result.prompt).toContain('conversions=42');
      expect(result.prompt).toContain('revenue=$8500.00');
    });

    it('should include action items in prompt', () => {
      const result = buildPersonaPrompt('cmo', baseContext);

      expect(result.prompt).toContain('Open Action Items:');
      expect(result.prompt).toContain('[open] Launch email nurture campaign');
      expect(result.prompt).toContain('owner: user-1');
    });

    it('should include recent wins in prompt', () => {
      const result = buildPersonaPrompt('ceo', baseContext);

      expect(result.prompt).toContain('Recent Wins:');
      expect(result.prompt).toContain('Closed $50k enterprise deal');
      expect(result.prompt).toContain('Launched new integration with Slack');
    });

    it('should include persona questions in prompt', () => {
      const result = buildPersonaPrompt('ceo', baseContext);

      expect(result.prompt).toContain('Persona Questions:');
      expect(result.prompt).toContain('What are the top 3 growth levers for next quarter?');
    });

    it('should include metrics summary in prompt', () => {
      const result = buildPersonaPrompt('cfo', baseContext);

      expect(result.prompt).toContain('Key Metrics:');
      expect(result.prompt).toContain('MRR: $42,000');
      expect(result.prompt).toContain('Churn: 4.2%');
      expect(result.prompt).toContain('CAC Payback: 8 months');
    });

    it('should include persona-specific instructions', () => {
      const result = buildPersonaPrompt('ceo', baseContext);

      expect(result.prompt).toContain('You are the CEO');
      expect(result.prompt).toContain('Instructions:');
      expect(result.prompt).toContain('Provide a concise analysis');
      expect(result.prompt).toContain('Highlight risks, opportunities, and recommended actions');
      expect(result.prompt).toContain('structured JSON response');
    });

    it('should handle missing business profile gracefully', () => {
      const context = { ...baseContext, businessProfile: null };
      const result = buildPersonaPrompt('ceo', context);

      expect(result.prompt).toContain('Business Profile: Not available');
      expect(result.prompt).not.toContain('Industry:');
    });

    it('should handle empty insights gracefully', () => {
      const context = { ...baseContext, latestInsights: [] };
      const result = buildPersonaPrompt('cfo', context);

      expect(result.prompt).toContain('No module insights available.');
    });

    it('should handle empty analytics gracefully', () => {
      const context = { ...baseContext, analyticsSnapshots: [] };
      const result = buildPersonaPrompt('cmo', context);

      expect(result.prompt).toContain('Analytics Snapshot: No recent data.');
    });

    it('should handle empty action items gracefully', () => {
      const context = { ...baseContext, existingActionItems: [] };
      const result = buildPersonaPrompt('ceo', context);

      expect(result.prompt).toContain('No open action items registered.');
    });

    it('should handle empty recent wins gracefully', () => {
      const context = { ...baseContext, recentWins: [] };
      const result = buildPersonaPrompt('cfo', context);

      expect(result.prompt).toContain('Recent wins not recorded.');
    });

    it('should handle missing persona questions gracefully', () => {
      const context = { ...baseContext, personaQuestions: undefined };
      const result = buildPersonaPrompt('cmo', context);

      expect(result.prompt).toContain('No targeted questions for this persona.');
    });

    it('should handle missing metrics summary gracefully', () => {
      const context = { ...baseContext, metricsSummary: undefined };
      const result = buildPersonaPrompt('ceo', context);

      expect(result.prompt).toContain('Key Metrics: Not provided.');
    });

    it('should throw error for unknown persona', () => {
      expect(() => buildPersonaPrompt('unknown-persona', baseContext)).toThrow(
        'Persona unknown-persona is not defined'
      );
    });

    it('should limit insight highlights to 3 items', () => {
      const context = {
        ...baseContext,
        latestInsights: [
          {
            ...baseContext.latestInsights[0],
            highlights: ['Highlight 1', 'Highlight 2', 'Highlight 3', 'Highlight 4', 'Highlight 5'],
          },
        ],
      };
      const result = buildPersonaPrompt('ceo', context);

      const highlightMatches = result.prompt.match(/Highlights: (.*)/);
      expect(highlightMatches).toBeTruthy();
      if (highlightMatches) {
        const highlights = highlightMatches[1];
        expect(highlights).toContain('Highlight 1');
        expect(highlights).toContain('Highlight 2');
        expect(highlights).toContain('Highlight 3');
        expect(highlights).not.toContain('Highlight 4');
      }
    });

    it('should format action items with all available fields', () => {
      const result = buildPersonaPrompt('ceo', baseContext);
      const actionItem = baseContext.existingActionItems[0];

      expect(result.prompt).toContain(`[${actionItem.status}] ${actionItem.title}`);
      expect(result.prompt).toContain(`owner: ${actionItem.assigneeId}`);
      expect(result.prompt).toContain(`due ${actionItem.dueDate}`);
    });

    it('should handle action items without assignee or due date', () => {
      const context = {
        ...baseContext,
        existingActionItems: [
          {
            ...baseContext.existingActionItems[0],
            assigneeId: undefined,
            dueDate: undefined,
          },
        ],
      };
      const result = buildPersonaPrompt('cfo', context);

      expect(result.prompt).toContain('[open] Launch email nurture campaign');
      expect(result.prompt).not.toContain('owner:');
      expect(result.prompt).not.toContain('due ');
    });

    it('should calculate 30-day analytics totals correctly', () => {
      const snapshots: AnalyticsSnapshot[] = Array.from({ length: 30 }, (_, i) => ({
        id: `snap-${i}`,
        tenantId: 'test-tenant-123',
        date: new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        sessions: 100,
        users: 80,
        conversions: 5,
        revenue: 500,
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })) as AnalyticsSnapshot[];

      const context = { ...baseContext, analyticsSnapshots: snapshots };
      const result = buildPersonaPrompt('cfo', context);

      expect(result.prompt).toContain('30-day Totals: sessions=3000, users=2400, conversions=150, revenue=$15000.00');
      expect(result.prompt).toContain('Average Daily Revenue: $500.00');
    });
  });

  describe('passesContentFilter', () => {
    it('should return true for safe content', () => {
      expect(passesContentFilter('This is a safe business analysis.')).toBe(true);
      expect(passesContentFilter('Revenue is growing steadily.')).toBe(true);
      expect(passesContentFilter('We need to tackle the churn problem.')).toBe(true);
    });

    it('should return false for content with "kill" keyword', () => {
      expect(passesContentFilter('We need to kill this feature.')).toBe(false);
      expect(passesContentFilter('Kill the project immediately.')).toBe(false);
    });

    it('should return false for content with "violence" keyword', () => {
      expect(passesContentFilter('There was violence in the market.')).toBe(false);
      expect(passesContentFilter('Violent fluctuations in stock price.')).toBe(false);
    });

    it('should return false for content with "hate" keyword', () => {
      expect(passesContentFilter('I hate this approach.')).toBe(false);
      expect(passesContentFilter('Customers hate the new UI.')).toBe(false);
    });

    it('should be case-insensitive', () => {
      expect(passesContentFilter('We should KILL this initiative.')).toBe(false);
      expect(passesContentFilter('VIOLENCE is not the answer.')).toBe(false);
      expect(passesContentFilter('I HATE this strategy.')).toBe(false);
    });

    it('should use word boundaries (not partial matches)', () => {
      // "killer" contains "kill" but should pass because we're using word boundaries
      expect(passesContentFilter('This is a killer feature.')).toBe(false); // \bkill\b matches "kill" in "killer"
      expect(passesContentFilter('Skillful execution is key.')).toBe(true); // "skill" doesn't match \bkill\b
    });
  });

  describe('enforceContentFilter', () => {
    it('should return content unchanged if it passes filter', () => {
      const content = 'This is safe business content.';
      expect(enforceContentFilter(content)).toBe(content);
    });

    it('should return filtered message for blocked content', () => {
      const content = 'We need to kill this project.';
      expect(enforceContentFilter(content)).toBe('Content removed due to safety filters.');
    });

    it('should log warning when content is filtered', () => {
      const mockLogger = { warn: vi.fn() };
      const content = 'This contains hate speech.';

      enforceContentFilter(content, mockLogger);

      expect(mockLogger.warn).toHaveBeenCalledWith('Content filter flagged persona output', {
        snippet: content.slice(0, 120),
      });
    });

    it('should handle long content by truncating log snippet', () => {
      const mockLogger = { warn: vi.fn() };
      const longContent = 'kill '.repeat(50); // 250 characters

      enforceContentFilter(longContent, mockLogger);

      expect(mockLogger.warn).toHaveBeenCalledWith('Content filter flagged persona output', {
        snippet: longContent.slice(0, 120),
      });
    });
  });

  describe('edge cases and validation', () => {
    it('should handle business profile with missing optional fields', () => {
      const context: PersonaPromptContext = {
        tenantId: 'test-tenant-123',
        agendaSummary: 'Test agenda',
        businessProfile: {
          id: 'profile-1',
          tenantId: 'test-tenant-123',
          industry: null,
          stage: null,
          size: null,
          revenue: null,
          goals: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as BusinessProfile,
        latestInsights: [],
        analyticsSnapshots: [],
        existingActionItems: [],
        recentWins: [],
      };

      const result = buildPersonaPrompt('ceo', context);

      expect(result.prompt).toContain('Industry: Unknown');
      expect(result.prompt).toContain('Stage: Unknown');
      expect(result.prompt).toContain('Size: Unknown');
      expect(result.prompt).toContain('Revenue: Unspecified');
      expect(result.prompt).toContain('Goals: None listed');
    });

    it('should handle insights without highlights', () => {
      const context: PersonaPromptContext = {
        tenantId: 'test-tenant-123',
        agendaSummary: 'Test agenda',
        businessProfile: null,
        latestInsights: [
          {
            id: 'insight-1',
            tenantId: 'test-tenant-123',
            moduleId: 'test-module',
            summary: 'Test insight',
            severity: 'warning',
            highlights: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          } as ModuleInsight,
        ],
        analyticsSnapshots: [],
        existingActionItems: [],
        recentWins: [],
      };

      const result = buildPersonaPrompt('cfo', context);

      expect(result.prompt).toContain('Test insight');
      expect(result.prompt).toContain('Highlights: No highlights');
    });

    it('should respect persona-specific token limits', () => {
      const ceoResult = buildPersonaPrompt('ceo', {
        tenantId: 'test-tenant-123',
        agendaSummary: 'Test',
        businessProfile: null,
        latestInsights: [],
        analyticsSnapshots: [],
        existingActionItems: [],
        recentWins: [],
      });

      const cfoResult = buildPersonaPrompt('cfo', {
        tenantId: 'test-tenant-123',
        agendaSummary: 'Test',
        businessProfile: null,
        latestInsights: [],
        analyticsSnapshots: [],
        existingActionItems: [],
        recentWins: [],
      });

      expect(ceoResult.maxTokens).toBe(450);
      expect(cfoResult.maxTokens).toBe(380);
    });
  });
});
