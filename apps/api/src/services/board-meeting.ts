import type {
  PrismaClient,
  Task,
  TenantMember,
  BusinessProfile as DbBusinessProfile,
  ModuleInsight as DbModuleInsight,
  AnalyticsSnapshot as DbAnalyticsSnapshot,
  BoardActionItem as DbBoardActionItem,
} from '@ocsuite/db';
import type {
  AnalyticsSnapshot,
  BoardActionItemRecord,
  BoardActionItemWithAssignee,
  BoardMeetingAgendaItem,
  BoardMeetingAgendaStatus,
  BoardMeetingMetrics,
  BoardMeetingSummary,
  BoardPersonaAnalysis,
  BoardPersonaRecommendation,
  ModuleInsight,
  BusinessProfile,
  BoardActionStatus,
  ActionItem,
  InsightSeverity,
} from '@ocsuite/types';
import { parseJsonRecord } from '../utils/json.js';

export type PersonaId = 'ceo' | 'cfo' | 'cmo';

export function isPersonaId(value: unknown): value is PersonaId {
  return value === 'ceo' || value === 'cfo' || value === 'cmo';
}

export interface AgendaTemplateItem {
  id: string;
  title: string;
  personaId: PersonaId;
  dependsOn?: string | null;
}

const ACTION_PRIORITIES = ['low', 'medium', 'high'] as const;
const VALID_SEVERITIES = ['info', 'warning', 'critical'] as const;
const DEFAULT_INSIGHT_SEVERITY: InsightSeverity = 'info';

function isActionPriority(value: string): value is ActionItem['priority'] {
  return (ACTION_PRIORITIES as readonly string[]).includes(value);
}

function normalizeHighlights(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => String(entry ?? '')).filter((entry) => entry.length > 0);
}

function normalizeActionItems(value: unknown): ActionItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return (value as unknown[])
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => {
      const priorityValue = typeof item.priority === 'string' ? item.priority.toLowerCase() : 'medium';
      const priority = isActionPriority(priorityValue) ? priorityValue : 'medium';

      return {
        title: String(item.title ?? ''),
        priority,
        description: item.description ? String(item.description) : undefined,
      } satisfies ActionItem;
    });
}

export interface BoardMeetingContext {
  businessProfile: BusinessProfile | null;
  latestInsights: ModuleInsight[];
  analyticsSnapshots: AnalyticsSnapshot[];
  existingActionItems: BoardActionItemRecord[];
  recentWins: string[];
  personaQuestions: Record<PersonaId, string[]>;
  metricsSummary?: Record<string, unknown>;
}

const PERSONA_HINTS: Record<PersonaId, readonly string[]> = {
  ceo: ['strategy', 'executive', 'summary', 'overall'],
  cfo: ['finance', 'cash', 'revenue', 'margin'],
  cmo: ['marketing', 'growth', 'pipeline', 'demand'],
} as const;

export const DEFAULT_AGENDA: AgendaTemplateItem[] = [
  {
    id: 'agenda-executive-overview',
    title: 'Executive Overview & Top Wins',
    personaId: 'ceo',
  },
  {
    id: 'agenda-financial-health',
    title: 'Financial Health & Runway',
    personaId: 'cfo',
    dependsOn: 'agenda-executive-overview',
  },
  {
    id: 'agenda-growth-outlook',
    title: 'Growth Outlook & GTM Priorities',
    personaId: 'cmo',
    dependsOn: 'agenda-financial-health',
  },
];

/**
 * Load contextual data required for board meeting prompts.
 */
export async function loadBoardMeetingContext(
  prisma: PrismaClient,
  tenantId: string
): Promise<BoardMeetingContext> {
  const twoWeeksAgo = new Date(Date.now() - 1000 * 60 * 60 * 24 * 14);

  const [businessProfile, insights, analytics, actionItems, recentTasks] = await Promise.all([
    prisma.businessProfile.findUnique({ where: { tenantId } }),
    prisma.moduleInsight.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 15,
    }),
    prisma.analyticsSnapshot.findMany({
      where: { tenantId },
      orderBy: { date: 'desc' },
      take: 90,
    }),
    prisma.boardActionItem.findMany({
      where: {
        tenantId,
        status: { in: ['open', 'in_progress'] },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.task.findMany({
      where: {
        tenantId,
        status: 'completed',
        executedAt: { gte: twoWeeksAgo },
      },
      orderBy: { executedAt: 'desc' },
      take: 12,
    }),
  ]);

  const existingActionItems = actionItems.map(mapBoardActionItemRecord);
  const mappedInsights = insights.map(mapModuleInsight);
  const analyticsSnapshots = analytics.map(mapAnalyticsSnapshot);
  const recentWins = deriveRecentWins(recentTasks);
  const personaQuestions = derivePersonaQuestions(mappedInsights);
  const metricsSummary = buildMetricsSummary(analyticsSnapshots);

  return {
    businessProfile: businessProfile ? mapBusinessProfile(businessProfile) : null,
    latestInsights: mappedInsights,
    analyticsSnapshots,
    existingActionItems,
    recentWins,
    personaQuestions,
    metricsSummary,
  };
}

function mapBusinessProfile(profile: DbBusinessProfile): BusinessProfile {
  return {
    ...profile,
    createdAt: new Date(profile.createdAt),
    updatedAt: new Date(profile.updatedAt),
  };
}

function mapModuleInsight(insight: DbModuleInsight): ModuleInsight {
  const metadata =
    insight.metadata && typeof insight.metadata === 'object' && !Array.isArray(insight.metadata)
      ? parseJsonRecord(insight.metadata)
      : null;

  const severity: InsightSeverity =
    typeof insight.severity === 'string' &&
    (VALID_SEVERITIES as readonly string[]).includes(insight.severity)
      ? (insight.severity as InsightSeverity)
      : DEFAULT_INSIGHT_SEVERITY;

  return {
    ...insight,
    createdAt: new Date(insight.createdAt),
    updatedAt: new Date(insight.updatedAt),
    highlights: normalizeHighlights(insight.highlights),
    actionItems: normalizeActionItems(insight.actionItems),
    severity,
    metadata,
  };
}

function mapAnalyticsSnapshot(snapshot: DbAnalyticsSnapshot): AnalyticsSnapshot {
  return {
    ...snapshot,
    date: new Date(snapshot.date),
    createdAt: new Date(snapshot.createdAt),
  };
}

export function mapBoardActionItemRecord(item: DbBoardActionItem): BoardActionItemRecord {
  const metadata =
    item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata)
      ? parseJsonRecord(item.metadata)
      : null;

  return {
    id: item.id,
    meetingId: item.meetingId,
    tenantId: item.tenantId,
    title: item.title,
    description: item.description,
    status: item.status,
    priority: item.priority,
    assigneeId: item.assigneeId,
    dueDate: item.dueDate ? item.dueDate.toISOString() : null,
    metadata,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

function deriveRecentWins(tasks: Task[]): string[] {
  return tasks.slice(0, 6).map((task) => {
    const descriptor = task.payload && typeof task.payload === 'object' && 'title' in task.payload
      ? String((task.payload as Record<string, unknown>).title)
      : task.type;
    const completedAt = task.executedAt
      ? new Date(task.executedAt).toLocaleDateString()
      : new Date(task.updatedAt).toLocaleDateString();
    return `${descriptor} completed on ${completedAt}`;
  });
}

function derivePersonaQuestions(insights: ModuleInsight[]): Record<PersonaId, string[]> {
  const prompts: Record<PersonaId, string[]> = { ceo: [], cfo: [], cmo: [] };

  insights.forEach((insight) => {
    const question = `${capitalize(insight.moduleSlug)} insight: ${insight.summary}`;

    const persona = resolvePersonaForInsight(insight);
    if (!prompts[persona]) {
      prompts[persona] = [];
    }
    if (insight.severity !== 'info') {
      prompts[persona].push(question);
    }
  });

  return prompts;
}

function resolvePersonaForInsight(insight: ModuleInsight): PersonaId {
  const slug = insight.moduleSlug.toLowerCase();
  if (PERSONA_HINTS.cfo.some((token) => slug.includes(token))) {
    return 'cfo';
  }
  if (PERSONA_HINTS.cmo.some((token) => slug.includes(token))) {
    return 'cmo';
  }
  return 'ceo';
}

function buildMetricsSummary(analytics: AnalyticsSnapshot[]): Record<string, unknown> | undefined {
  if (!analytics.length) {
    return undefined;
  }

  const sorted = [...analytics].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
  const [latest, previous] = sorted;

  if (!latest) {
    return undefined;
  }

  const conversionRate = latest.sessions
    ? (latest.conversions / latest.sessions) * 100
    : 0;

  const revenueChange = previous
    ? ((latest.revenue - previous.revenue) / Math.max(previous.revenue, 1)) * 100
    : null;

  return {
    latestDate: new Date(latest.date).toISOString(),
    sessions: latest.sessions,
    users: latest.users,
    conversions: latest.conversions,
    revenue: latest.revenue,
    conversionRate: Number(conversionRate.toFixed(2)),
    revenueChangePct: revenueChange !== null ? Number(revenueChange.toFixed(2)) : null,
  };
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function agendaToSummary(agenda: AgendaTemplateItem[]): string {
  return agenda
    .map((item, index) => `${index + 1}. ${item.title} (${item.personaId.toUpperCase()})`)
    .join('\n');
}

export function agendaTemplateToDisplay(
  template: AgendaTemplateItem[]
): BoardMeetingAgendaItem[] {
  return template.map((item) => ({
    ...item,
    status: 'pending' satisfies BoardMeetingAgendaStatus,
  }));
}

export interface ParsedPersonaPayload {
  summary: string;
  risks: string[];
  opportunities: string[];
  recommendations: BoardPersonaRecommendation[];
  metrics?: Record<string, unknown> | null;
}

type RawRecommendation = {
  title?: unknown;
  ownerHint?: unknown;
  dueDateHint?: unknown;
  priority?: unknown;
  rationale?: unknown;
};

export function parsePersonaPayload(raw: string): ParsedPersonaPayload {
  const trimmed = raw.trim();

  try {
    const parsed = JSON.parse(trimmed);

    return {
      summary: String(parsed.summary ?? ''),
      risks: Array.isArray(parsed.risks) ? parsed.risks.map(String) : [],
      opportunities: Array.isArray(parsed.opportunities)
        ? parsed.opportunities.map(String)
        : [],
      recommendations: Array.isArray(parsed.recommendations)
        ? (parsed.recommendations as unknown[])
            .filter((item): item is RawRecommendation => typeof item === 'object' && item !== null)
            .map((item) => ({
              title: String(item.title ?? ''),
              ownerHint: item.ownerHint ? String(item.ownerHint) : undefined,
              dueDateHint: item.dueDateHint ? String(item.dueDateHint) : undefined,
              priority: item.priority ? String(item.priority) : undefined,
              rationale: item.rationale ? String(item.rationale) : undefined,
            }))
        : [],
      metrics:
        parsed.metrics && typeof parsed.metrics === 'object' && !Array.isArray(parsed.metrics)
          ? (parsed.metrics as Record<string, unknown>)
          : undefined,
    };
  } catch (error) {
    return {
      summary: trimmed,
      risks: [],
      opportunities: [],
      recommendations: [],
      metrics: undefined,
    };
  }
}

export function buildPersonaAnalysis(
  personaId: PersonaId,
  personaName: string,
  payload: ParsedPersonaPayload,
  sequence: number,
  rawContent: string
): BoardPersonaAnalysis {
  return {
    personaId,
    personaName,
    summary: payload.summary,
    risks: payload.risks,
    opportunities: payload.opportunities,
    recommendations: payload.recommendations,
    metrics: payload.metrics ?? null,
    rawContent,
    sequence,
    createdAt: new Date().toISOString(),
  };
}

export function buildMeetingSummary(
  analyses: BoardPersonaAnalysis[]
): BoardMeetingSummary {
  const highlights = analyses.flatMap((analysis) => analysis.opportunities.slice(0, 3));
  const risks = analyses.flatMap((analysis) => analysis.risks.slice(0, 3));
  const nextSteps = analyses.flatMap((analysis) =>
    analysis.recommendations.slice(0, 3).map((rec) => rec.title)
  );

  return {
    narrative: analyses
      .map((analysis) => `${analysis.personaName}: ${analysis.summary}`)
      .join('\n\n'),
    highlights,
    risks,
    blockers: risks.filter((risk) => /blocker|urgent|critical/i.test(risk)),
    nextSteps,
  };
}

export function buildMeetingMetrics(
  startedAt: Date,
  endedAt: Date,
  tokenUsage: Record<string, { input: number; output: number; total: number }>,
  actionItems: Array<{ status: BoardActionStatus; personaId?: PersonaId }>,
  personaLatencyMs?: Record<string, number>
): BoardMeetingMetrics {
  const durationMs = Math.max(0, endedAt.getTime() - startedAt.getTime());

  const actionCounts: Record<BoardActionStatus, number> = {
    open: 0,
    in_progress: 0,
    completed: 0,
  };

  actionItems.forEach((item) => {
    actionCounts[item.status] = (actionCounts[item.status] ?? 0) + 1;
  });

  return {
    durationMs,
    personaTokens: tokenUsage,
    actionItems: actionCounts,
    personaLatencyMs,
    tokenCostUsd: null,
    userFeedback: null,
  };
}

export function enrichActionItemWithAssignee(
  item: BoardActionItemRecord,
  assignee: (TenantMember & { user?: { name: string | null; email: string | null } | null }) | null
): BoardActionItemWithAssignee {
  return {
    ...item,
    assignee: assignee
      ? {
          id: assignee.id,
          name: assignee.user?.name ?? null,
          email: assignee.user?.email ?? null,
        }
      : null,
  };
}
