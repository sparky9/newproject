import type { ModuleInsight, AnalyticsSnapshot, BusinessProfile, BoardActionItemRecord } from '@ocsuite/types';
import { PERSONAS, getPersonaById, type PersonaDefinition } from '@ocsuite/module-sdk';
import { apiLogger } from '../utils/logger.js';

const BLOCKLIST = [
  /\bkill\b/i,
  /\bkiller\b/i,
  /\bviolence\b/i,
  /\bviolent\b/i,
  /\bhate\b/i,
];

const PERSONA_NAME_OVERRIDES: Record<string, string> = {
  ceo: 'CEO',
  cfo: 'CFO',
  cmo: 'CMO',
  cto: 'CTO',
};

function normalizePersona(persona: PersonaDefinition): PersonaDefinition {
  const override = PERSONA_NAME_OVERRIDES[persona.id];
  return override ? { ...persona, name: override } : persona;
}

export interface PersonaPromptContext {
  tenantId: string;
  agendaSummary: string;
  businessProfile: BusinessProfile | null;
  latestInsights: ModuleInsight[];
  analyticsSnapshots: AnalyticsSnapshot[];
  existingActionItems: BoardActionItemRecord[];
  recentWins: string[];
  personaQuestions?: string[];
  metricsSummary?: Record<string, unknown>;
}

export interface PersonaPromptResult {
  persona: PersonaDefinition;
  prompt: string;
  maxTokens: number;
  streamChunkSize: number;
}

export function listSupportedPersonas(): PersonaDefinition[] {
  return PERSONAS.map((persona) => normalizePersona(persona));
}

export function buildPersonaPrompt(personaId: string, context: PersonaPromptContext): PersonaPromptResult {
  const personaDefinition = getPersonaById(personaId);
  const persona = personaDefinition ? normalizePersona(personaDefinition) : undefined;
  if (!persona) {
    throw new Error(`Persona ${personaId} is not defined`);
  }

  const profileSection = context.businessProfile
    ? `Business Profile:\n- Industry: ${context.businessProfile.industry ?? 'Unknown'}\n- Stage: ${context.businessProfile.stage ?? 'Unknown'}\n- Size: ${context.businessProfile.size ?? 'Unknown'}\n- Revenue: ${context.businessProfile.revenue ?? 'Unspecified'}\n- Goals: ${(context.businessProfile.goals ?? []).join(', ') || 'None listed'}`
    : 'Business Profile: Not available';

  const insightsSection = context.latestInsights.length
    ? context.latestInsights
        .map((insight, index) => {
          const highlights = insight.highlights?.slice(0, 3).join('; ') ?? 'No highlights';
          return `${index + 1}. ${insight.summary} (severity: ${insight.severity}, score: ${insight.score ?? 'n/a'})\n   Highlights: ${highlights}`;
        })
        .join('\n')
    : 'No module insights available.';

  const analyticsSection = context.analyticsSnapshots.length
    ? summarizeAnalytics(context.analyticsSnapshots)
    : 'Analytics Snapshot: No recent data.';

  const actionItemSection = context.existingActionItems.length
    ? context.existingActionItems
        .map((item) => `- [${item.status}] ${item.title}${item.assigneeId ? ` (owner: ${item.assigneeId})` : ''}${item.dueDate ? ` due ${item.dueDate}` : ''}`)
        .join('\n')
    : 'No open action items registered.';

  const winsSection = context.recentWins.length
    ? context.recentWins.map((win, index) => `${index + 1}. ${win}`).join('\n')
    : 'Recent wins not recorded.';

  const personaQuestionsSection = context.personaQuestions?.length
    ? context.personaQuestions.map((q) => `- ${q}`).join('\n')
    : 'No targeted questions for this persona.';

  const metricsSection = context.metricsSummary
    ? `Key Metrics:\n${Object.entries(context.metricsSummary)
        .map(([key, value]) => `- ${key}: ${value}`)
        .join('\n')}`
    : 'Key Metrics: Not provided.';

  // Add video tools context for CMO
  const videoToolsSection = personaId === 'cmo'
    ? `\n\nVideo Production Tools Available:\nYou have access to professional video production capabilities including:\n- Transcribe videos and podcasts to extract insights and create content\n- Extract viral clips from long-form content using AI analysis\n- Optimize videos for different social platforms (YouTube, TikTok, Instagram, LinkedIn, etc.)\n- Add professional captions automatically\n- Create multi-platform content from single source videos\n\nConsider recommending video content strategies when appropriate for marketing campaigns.`
    : '';

  const prompt = `You are the ${persona.name}. Tone: ${persona.tone}. Focus: ${persona.focus}.\n\n${profileSection}\n\nAgenda Summary:\n${context.agendaSummary}\n\nLatest Module Insights:\n${insightsSection}\n\nAnalytics Overview:\n${analyticsSection}\n\nOpen Action Items:\n${actionItemSection}\n\nRecent Wins:\n${winsSection}\n\nPersona Questions:\n${personaQuestionsSection}\n\n${metricsSection}${videoToolsSection}\n\nInstructions:\n1. Provide a concise analysis tailored to your expertise (${persona.expertise.join(', ')}).\n2. Highlight risks, opportunities, and recommended actions.\n3. Keep the response under ${persona.maxTokens} tokens.\n4. Use a structured JSON response with fields: summary (string), risks (string[]), opportunities (string[]), recommendations (Array<{title, ownerHint, dueDateHint, priority}>), and metrics (object).`;

  return {
    persona,
    prompt,
    maxTokens: persona.maxTokens,
    streamChunkSize: persona.streamChunkSize,
  };
}

export function passesContentFilter(content: string): boolean {
  return !BLOCKLIST.some((pattern) => pattern.test(content));
}

export function enforceContentFilter(content: string, logger: Pick<typeof apiLogger, 'warn'> = apiLogger): string {
  if (!passesContentFilter(content)) {
    logger.warn('Content filter flagged persona output', { snippet: content.slice(0, 120) });
    return 'Content removed due to safety filters.';
  }
  return content;
}

function summarizeAnalytics(snapshots: AnalyticsSnapshot[]): string {
  const sorted = [...snapshots].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const latest = sorted[0];
  const trailing = sorted.slice(0, Math.min(sorted.length, 30));
  const totals = trailing.reduce(
    (acc, snap) => {
      acc.sessions += snap.sessions;
      acc.users += snap.users;
      acc.conversions += snap.conversions;
      acc.revenue += snap.revenue;
      return acc;
    },
    { sessions: 0, users: 0, conversions: 0, revenue: 0 }
  );

  const days = trailing.length || 1;
  const avgRevenue = totals.revenue / days;

  const latestRevenue = latest ? latest.revenue.toFixed(2) : 'n/a';
  const latestSessions = latest ? latest.sessions : 'n/a';
  const latestUsers = latest ? latest.users : 'n/a';
  const latestConversions = latest ? latest.conversions : 'n/a';

  return `Latest Day (${latest?.date ?? 'n/a'}): sessions=${latestSessions}, users=${latestUsers}, conversions=${latestConversions}, revenue=$${latestRevenue}\n30-day Totals: sessions=${totals.sessions}, users=${totals.users}, conversions=${totals.conversions}, revenue=$${totals.revenue.toFixed(2)}\nAverage Daily Revenue: $${avgRevenue.toFixed(2)}`;
}
