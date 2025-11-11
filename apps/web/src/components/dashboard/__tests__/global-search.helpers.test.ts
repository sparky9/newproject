import { describe, expect, it } from 'vitest';
import type {
  Alert,
  Connector,
  Conversation,
  MarketplaceWidgetWithInstall,
  Task,
} from '@ocsuite/types';
import type { BoardMeetingListItem, KnowledgeSearchResult } from '@/lib/api';
import { buildSearchResults, MIN_QUERY_LENGTH } from '../global-search.helpers';

describe('buildSearchResults', () => {
  it('returns empty array when query shorter than minimum length', () => {
    const result = buildSearchResults({
      query: 'a',
      caches: {},
    });

    expect(result).toEqual([]);
  });

  it('merges cached entities and knowledge matches into ordered search results', () => {
    const conversations: Conversation[] = [
      {
        id: 'conv-growth-1',
        tenantId: 'tenant-1',
        userId: 'user-1',
        personaType: 'ceo',
        title: 'Growth expansion plan',
        createdAt: new Date('2024-01-01T00:00:00Z'),
        updatedAt: new Date('2024-01-05T00:00:00Z'),
      },
    ];

    const tasks: Task[] = [
      {
        id: 'task-growth-1',
        tenantId: 'tenant-1',
        userId: 'user-1',
        type: 'growth_initiative',
        status: 'in_progress',
        priority: 'high',
        payload: {},
        result: null,
        error: null,
        executedAt: null,
        createdAt: new Date('2024-01-02T00:00:00Z'),
        updatedAt: new Date('2024-01-04T00:00:00Z'),
      },
    ];

    const alerts: Alert[] = [
      {
        id: 'alert-growth-1',
        tenantId: 'tenant-1',
        severity: 'warning',
        title: 'Growth KPI threshold',
        summary: 'Growth KPI triggered review',
        status: 'pending',
        createdAt: '2024-01-03T00:00:00Z',
        updatedAt: '2024-01-03T00:00:00Z',
      },
    ];

    const connectors: Connector[] = [
      {
        id: 'growth-connector-1',
        tenantId: 'tenant-1',
        provider: 'google',
        status: 'active',
        encryptedAccessToken: 'token',
        encryptedRefreshToken: null,
        tokenExpiresAt: null,
        scopes: [],
        metadata: null,
        lastSyncedAt: null,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        updatedAt: new Date('2024-01-04T00:00:00Z'),
      },
    ];

    const boardMeetings: BoardMeetingListItem[] = [
      {
        id: 'board-growth-1',
        tenantId: 'tenant-1',
        startedAt: '2024-01-01T10:00:00Z',
        endedAt: null,
        agenda: { items: [] },
        agendaVersion: 2,
        outcomeSummary: '<p>Discussed <em>growth</em> targets</p>',
        tokenUsage: null,
        rating: null,
        metadata: null,
        createdAt: '2024-01-01T10:00:00Z',
        updatedAt: '2024-01-01T12:00:00Z',
        personaCount: 3,
        actionItemCounts: { open: 1, in_progress: 0, completed: 2 },
      },
    ];

    const marketplace: MarketplaceWidgetWithInstall[] = [
      {
        slug: 'growth-insights',
        name: 'Growth Insights',
        description: 'Premium <strong>growth</strong> analytics',
        category: 'analytics',
        requiredCapabilities: [],
        metadata: {},
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-04T00:00:00Z',
        installed: false,
        dashboard: {
          tile: {
            title: 'Growth Insights',
            description: '<p>KPIs for growth</p>',
          },
        },
      },
    ];

    const knowledgeMatches: KnowledgeSearchResult[] = [
      {
        entry: {
          id: 'knowledge-growth-1',
          tenantId: 'tenant-1',
          source: 'manual',
          sourceId: null,
          sourceName: 'Strategy Hub',
          metadata: { title: 'Growth handbook' },
          checksum: null,
          chunkSize: null,
          tokenCount: null,
          embeddingMetadata: null,
          storageKey: null,
          retentionExpiresAt: null,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        content: '<p>Growth trends for upcoming quarter</p>',
        score: 0.9,
      },
    ];

    const results = buildSearchResults({
      query: 'growth',
      caches: {
        conversations,
        tasks,
        alerts,
        connectors,
        boardMeetings,
        marketplace,
      },
      knowledgeMatches,
    });

  expect(results.length).toBe(7);
    expect(results.map((item) => item.type)).toEqual([
      'conversation',
      'task',
      'alert',
      'connector',
      'board-meeting',
      'marketplace',
      // knowledge comes last
      'knowledge',
    ]);

    const conversation = results.find((item) => item.type === 'conversation');
    expect(conversation).toMatchObject({
      id: 'conversation-conv-growth-1',
      title: 'Growth expansion plan',
      badge: 'CEO',
      href: '/chat?persona=ceo',
    });
    expect(conversation?.description).toContain('Updated');

    const boardMeeting = results.find((item) => item.type === 'board-meeting');
    expect(boardMeeting).toMatchObject({
      id: 'board-meeting-board-growth-1',
      badge: 'In progress',
      href: '/board',
    });
    expect(boardMeeting?.description).toBe('Discussed growth targets • 3 persona turns • Agenda v2');

    const marketplaceResult = results.find((item) => item.type === 'marketplace');
    expect(marketplaceResult).toMatchObject({
      id: 'marketplace-growth-insights',
      title: 'Growth Insights',
      badge: 'Analytics',
    });
    expect(marketplaceResult?.description).toBe('Premium growth analytics');

    const knowledge = results.find((item) => item.type === 'knowledge');
    expect(knowledge).toMatchObject({
      id: 'knowledge-knowledge-growth-1',
      title: 'Growth handbook',
      badge: 'Knowledge',
      href: '/knowledge?q=growth',
      description: 'Growth trends for upcoming quarter',
    });
  });

  it('ignores non-matching cached entities while still returning knowledge hits', () => {
    const knowledgeMatches: KnowledgeSearchResult[] = [
      {
        entry: {
          id: 'knowledge-strategy-1',
          tenantId: 'tenant-1',
          source: 'manual',
          sourceId: null,
          sourceName: 'Strategy Hub',
          metadata: { title: 'Strategy digest' },
          checksum: null,
          chunkSize: null,
          tokenCount: null,
          embeddingMetadata: null,
          storageKey: null,
          retentionExpiresAt: null,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        content: 'Strategic insights overview',
        score: 0.42,
      },
    ];

    const results = buildSearchResults({
      query: 'strategy',
      caches: {
        conversations: [
          {
            id: 'conv-unrelated-1',
            tenantId: 'tenant-1',
            userId: 'user-1',
            personaType: 'cfo',
            title: 'Unrelated topic',
            createdAt: new Date('2024-01-01T00:00:00Z'),
            updatedAt: new Date('2024-01-01T00:00:00Z'),
          },
        ],
      },
      knowledgeMatches,
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ type: 'knowledge', title: 'Strategy digest' });
  });

  it('uses MIN_QUERY_LENGTH to guard short queries', () => {
    const shortQuery = 'g'.repeat(MIN_QUERY_LENGTH - 1);

    const results = buildSearchResults({
      query: shortQuery,
      caches: {
        conversations: [
          {
            id: 'conv-1',
            tenantId: 'tenant-1',
            userId: 'user-1',
            personaType: 'ceo',
            title: 'Growth conversation',
            createdAt: new Date('2024-01-01T00:00:00Z'),
            updatedAt: new Date('2024-01-01T00:00:00Z'),
          },
        ],
      },
    });

    expect(results).toEqual([]);
  });
});
