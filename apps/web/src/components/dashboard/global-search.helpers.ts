import type { Alert, Connector, Conversation, MarketplaceWidgetWithInstall, Task } from '@ocsuite/types';
import type { BoardMeetingListItem, KnowledgeSearchResult } from '@/lib/api';

export const MIN_QUERY_LENGTH = 2;

export type SearchResultType =
  | 'conversation'
  | 'task'
  | 'knowledge'
  | 'alert'
  | 'connector'
  | 'board-meeting'
  | 'marketplace'
  | 'page';

export interface SearchResultItem {
  id: string;
  type: SearchResultType;
  title: string;
  description?: string;
  href: string;
  badge?: string;
}

export interface SearchCaches {
  conversations?: Conversation[] | null;
  tasks?: Task[] | null;
  alerts?: Alert[] | null;
  connectors?: Connector[] | null;
  boardMeetings?: BoardMeetingListItem[] | null;
  marketplace?: MarketplaceWidgetWithInstall[] | null;
}

export interface BuildSearchContext {
  query: string;
  caches: SearchCaches;
  knowledgeMatches?: KnowledgeSearchResult[];
}

const ALERT_SEVERITY_LABELS: Record<Alert['severity'], string> = {
  critical: 'Critical',
  warning: 'Warning',
  info: 'Informational',
};

const MAX_RESULTS = {
  conversations: 4,
  tasks: 4,
  alerts: 4,
  connectors: 4,
  boardMeetings: 4,
  marketplace: 4,
  knowledge: 5,
} as const;

export function formatDateTime(value: Date | string | undefined | null): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      return undefined;
    }

    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return undefined;
  }
}

export function titleCase(value: string | undefined | null): string {
  if (!value) {
    return '';
  }

  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

export function stripHtml(value: string | undefined | null): string | undefined {
  if (!value) {
    return undefined;
  }

  return value.replace(/<[^>]+>/g, '').trim() || undefined;
}

export function buildSearchResults({
  query,
  caches,
  knowledgeMatches = [],
}: BuildSearchContext): SearchResultItem[] {
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH) {
    return [];
  }

  const needle = trimmed.toLowerCase();
  const results: SearchResultItem[] = [];

  const { conversations, tasks, alerts, connectors, boardMeetings, marketplace } = caches;

  if (conversations?.length) {
    results.push(
      ...conversations
        .filter((conversation) => {
          const title = conversation.title ?? '';
          return (
            title.toLowerCase().includes(needle) ||
            conversation.personaType.toLowerCase().includes(needle)
          );
        })
        .slice(0, MAX_RESULTS.conversations)
        .map((conversation) => ({
          id: `conversation-${conversation.id}`,
          type: 'conversation' as const,
          title: conversation.title || `Conversation · ${conversation.personaType.toUpperCase()}`,
          description:
            formatDateTime(conversation.updatedAt) != null
              ? `Updated ${formatDateTime(conversation.updatedAt)}`
              : 'AI conversation',
          href: `/chat?persona=${conversation.personaType}`,
          badge: conversation.personaType.toUpperCase(),
        }))
    );
  }

  if (tasks?.length) {
    results.push(
      ...tasks
        .filter((task) => {
          const parts = [task.type, task.status, task.id];
          return parts.some((part) => part.toLowerCase().includes(needle));
        })
        .slice(0, MAX_RESULTS.tasks)
        .map((task) => ({
          id: `task-${task.id}`,
          type: 'task' as const,
          title: `Task · ${titleCase(task.type)}`,
          description: `Status: ${titleCase(task.status)}`,
          href: '/tasks',
          badge: 'Task',
        }))
    );
  }

  if (alerts?.length) {
    results.push(
      ...alerts
        .filter((alert) => {
          const parts = [alert.title ?? '', alert.summary ?? '', alert.severity, alert.status];
          return parts.some((part) => (part ?? '').toLowerCase().includes(needle));
        })
        .slice(0, MAX_RESULTS.alerts)
        .map((alert) => {
          const severity = ALERT_SEVERITY_LABELS[alert.severity] ?? 'Alert';
          return {
            id: `alert-${alert.id}`,
            type: 'alert' as const,
            title: alert.title || `${severity} alert`,
            description:
              alert.summary ??
              (formatDateTime(alert.createdAt) ? `Triggered ${formatDateTime(alert.createdAt)}` : undefined),
            href: '/dashboard',
            badge: severity,
          } satisfies SearchResultItem;
        })
    );
  }

  if (connectors?.length) {
    results.push(
      ...connectors
        .filter((connector) => {
          const parts = [connector.provider, connector.status, connector.id];
          return parts.some((part) => part.toLowerCase().includes(needle));
        })
        .slice(0, MAX_RESULTS.connectors)
        .map((connector) => ({
          id: `connector-${connector.id}`,
          type: 'connector' as const,
          title: `${titleCase(connector.provider)} integration`,
          description:
            formatDateTime(connector.updatedAt) != null
              ? `Status: ${titleCase(connector.status)} • Updated ${formatDateTime(connector.updatedAt)}`
              : `Status: ${titleCase(connector.status)}`,
          href: '/connectors',
          badge: 'Integration',
        }))
    );
  }

  if (boardMeetings?.length) {
    results.push(
      ...boardMeetings
        .filter((meeting) => {
          const status = meeting.endedAt ? 'completed' : 'in progress';
          const parts = [
            meeting.id,
            status,
            meeting.outcomeSummary ?? '',
            meeting.agendaVersion?.toString() ?? '',
          ];
          return parts.some((part) => part.toLowerCase().includes(needle));
        })
        .slice(0, MAX_RESULTS.boardMeetings)
        .map((meeting) => {
          const summary = stripHtml(meeting.outcomeSummary);
          const details = [
            meeting.personaCount ? `${meeting.personaCount} persona turns` : undefined,
            meeting.agendaVersion ? `Agenda v${meeting.agendaVersion}` : undefined,
          ]
            .filter(Boolean)
            .join(' • ');

          let description = summary ?? undefined;
          if (description && details) {
            description = `${description} • ${details}`;
          } else if (!description && details) {
            description = details;
          }

          return {
            id: `board-meeting-${meeting.id}`,
            type: 'board-meeting' as const,
            title: `Board meeting · ${formatDateTime(meeting.startedAt) ?? meeting.id.slice(0, 6)}`,
            description,
            href: '/board',
            badge: meeting.endedAt ? 'Completed' : 'In progress',
          } satisfies SearchResultItem;
        })
    );
  }

  if (marketplace?.length) {
    results.push(
      ...marketplace
        .filter((widget) => {
          const parts = [widget.name, widget.category, widget.description ?? '', widget.slug];
          return parts.some((part) => part.toLowerCase().includes(needle));
        })
        .slice(0, MAX_RESULTS.marketplace)
        .map((widget) => {
          const description =
            stripHtml(widget.description) ?? stripHtml(widget.dashboard?.tile?.description) ?? undefined;

          return {
            id: `marketplace-${widget.slug}`,
            type: 'marketplace' as const,
            title: widget.name,
            description,
            href: '/marketplace',
            badge: widget.installed ? 'Installed' : titleCase(widget.category),
          } satisfies SearchResultItem;
        })
    );
  }

  if (knowledgeMatches.length) {
    results.push(
      ...knowledgeMatches
        .slice(0, MAX_RESULTS.knowledge)
        .map((match) => {
          const snippet = stripHtml(match.content);
          return {
            id: `knowledge-${match.entry.id}`,
            type: 'knowledge' as const,
            title: match.entry.metadata?.title
              ? String(match.entry.metadata.title)
              : `Knowledge entry · ${match.entry.id.slice(0, 6)}`,
            description: snippet,
            href: `/knowledge?q=${encodeURIComponent(trimmed)}`,
            badge: 'Knowledge',
          } satisfies SearchResultItem;
        })
    );
  }

  return results;
}
