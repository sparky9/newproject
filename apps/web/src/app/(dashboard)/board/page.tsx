'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Clock,
  History,
  Loader2,
  Play,
  Star,
  StopCircle,
  Target,
  Users,
} from 'lucide-react';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  createApiClient,
  type BoardMeetingDetail,
  type BoardMeetingListItem,
  type BoardMeetingListResponse,
  type StartBoardMeetingPayload,
} from '@/lib/api';
import type {
  BoardActionItemWithAssignee,
  BoardMeetingAgendaStatus,
  BoardMeetingMetrics,
  BoardMeetingStreamEnvelope,
  BoardMeetingSummary,
  BoardPersonaAnalysis,
} from '@ocsuite/types';

type StreamStatus = 'idle' | 'connecting' | 'running' | 'completed' | 'error';

interface StreamingState {
  meetingId: string | null;
  status: StreamStatus;
  agenda: Record<
    string,
    {
      title: string;
      personaId: string;
      status: BoardMeetingAgendaStatus;
    }
  >;
  agendaOrder: string[];
  personaTurns: BoardPersonaAnalysis[];
  actionItems: BoardActionItemWithAssignee[];
  summary: BoardMeetingSummary | null;
  metrics: BoardMeetingMetrics | null;
  tokenUsage: Record<string, unknown> | null;
  error: string | null;
  startedAt: string | null;
  endedAt: string | null;
}

const createInitialStreamState = (): StreamingState => ({
  meetingId: null,
  status: 'idle',
  agenda: {},
  agendaOrder: [],
  personaTurns: [],
  actionItems: [],
  summary: null,
  metrics: null,
  tokenUsage: null,
  error: null,
  startedAt: null,
  endedAt: null,
});

const statusLabel: Record<StreamStatus, string> = {
  idle: 'Idle',
  connecting: 'Connecting',
  running: 'In Progress',
  completed: 'Completed',
  error: 'Error',
};

const statusVariant: Record<StreamStatus, BadgeProps['variant']> = {
  idle: 'secondary',
  connecting: 'warning',
  running: 'warning',
  completed: 'success',
  error: 'destructive',
};

const statusIcon: Record<StreamStatus, typeof Clock> = {
  idle: Clock,
  connecting: Loader2,
  running: Loader2,
  completed: CheckCircle2,
  error: AlertCircle,
};

const agendaVariant: Record<BoardMeetingAgendaStatus, BadgeProps['variant']> = {
  pending: 'secondary',
  in_progress: 'warning',
  completed: 'success',
};

const priorityVariant: Record<
  BoardActionItemWithAssignee['priority'],
  BadgeProps['variant']
> = {
  low: 'secondary',
  normal: 'default',
  high: 'warning',
  urgent: 'destructive',
};

type HistoryPersonaFilter = 'all' | 'ceo' | 'cfo' | 'cmo';
type HistoryTimeframeFilter = 'all' | '7d' | '30d' | '90d';

const statusOptions: Array<{ value: 'open' | 'in_progress' | 'completed'; label: string }>
  = [
    { value: 'open', label: 'Open' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'completed', label: 'Completed' },
  ];

function formatDateTime(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : '—';
}

function formatDurationMs(duration?: number | null): string {
  if (!duration || Number.isNaN(duration)) {
    return '—';
  }
  const totalSeconds = Math.round(duration / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) {
    return `${seconds}s`;
  }
  return `${minutes}m ${seconds}s`;
}

function calculateDuration(start: string | null, end: string | null): string {
  if (!start || !end) {
    return '—';
  }
  const duration = new Date(end).getTime() - new Date(start).getTime();
  if (duration <= 0) {
    return '—';
  }
  return formatDurationMs(duration);
}

function toDateInputValue(value: string | null): string {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${date.getUTCDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function personaLabel(personaId: string, personaName?: string | null): string {
  if (personaName) {
    return personaName;
  }
  return personaId.toUpperCase();
}

function computeFromDate(timeframe: HistoryTimeframeFilter): string | null {
  const now = new Date();
  const from = new Date(now);
  switch (timeframe) {
    case '7d':
      from.setDate(now.getDate() - 7);
      break;
    case '30d':
      from.setDate(now.getDate() - 30);
      break;
    case '90d':
      from.setDate(now.getDate() - 90);
      break;
    default:
      return null;
  }
  return from.toISOString();
}

export default function BoardPage() {
  const { getToken } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  const api = useMemo(() => createApiClient(getToken), [getToken]);

  const [streamState, setStreamState] = useState<StreamingState>(createInitialStreamState);
  const controllerRef = useRef<AbortController | null>(null);

  const [history, setHistory] = useState<BoardMeetingListItem[]>([]);
  const [historyMeta, setHistoryMeta] = useState<BoardMeetingListResponse['meta'] | null>(
    null
  );
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyFilters, setHistoryFilters] = useState<{
    persona: HistoryPersonaFilter;
    timeframe: HistoryTimeframeFilter;
  }>({ persona: 'all', timeframe: '30d' });

  const [detailMeetingId, setDetailMeetingId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<BoardMeetingDetail | null>(null);

  const [userRating, setUserRating] = useState<number | null>(null);
  const [ratingSubmitted, setRatingSubmitted] = useState(false);
  const [ratingHover, setRatingHover] = useState<number | null>(null);

  const refreshHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);

    try {
      const params: {
        page?: number;
        pageSize?: number;
        persona?: 'ceo' | 'cfo' | 'cmo';
        from?: string;
        to?: string;
      } = {
        page: 1,
        pageSize: 5,
      };

      if (historyFilters.persona !== 'all') {
        params.persona = historyFilters.persona;
      }

      const from = computeFromDate(historyFilters.timeframe);
      if (from) {
        params.from = from;
        params.to = new Date().toISOString();
      }

      const response = await api.listBoardMeetings(params);
      setHistory(response.data);
      setHistoryMeta(response.meta);
    } catch (error) {
      setHistoryError(
        error instanceof Error ? error.message : 'Failed to load board meeting history'
      );
    } finally {
      setHistoryLoading(false);
    }
  }, [api, historyFilters]);

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  useEffect(() => {
    return () => {
      if (controllerRef.current) {
        controllerRef.current.abort();
        controllerRef.current = null;
      }
    };
  }, []);

  const applyActionItemUpdate = useCallback(
    (item: BoardActionItemWithAssignee) => {
      setStreamState((prev) => {
        if (prev.meetingId !== item.meetingId) {
          return prev;
        }
        const exists = prev.actionItems.some((action) => action.id === item.id);
        const actionItems = exists
          ? prev.actionItems.map((action) => (action.id === item.id ? item : action))
          : [...prev.actionItems, item];
        return {
          ...prev,
          actionItems,
        };
      });

      setDetail((prev) => {
        if (!prev || prev.id !== item.meetingId) {
          return prev;
        }
        return {
          ...prev,
          actionItems: prev.actionItems.map((action) =>
            action.id === item.id ? item : action
          ),
        };
      });
    },
    []
  );

  const handleStreamEvent = useCallback(
    (event: BoardMeetingStreamEnvelope) => {
      setStreamState((prev) => {
        const data =
          typeof event.data === 'object' && event.data !== null
            ? (event.data as unknown as Record<string, unknown>)
            : {};
        const baseMeetingId =
          prev.meetingId ?? (typeof data.meetingId === 'string' ? data.meetingId : null);

        switch (event.type) {
          case 'agenda': {
            const agenda = {
              ...prev.agenda,
              [event.data.sectionId]: {
                title: event.data.title,
                personaId: event.data.personaId,
                status: event.data.status,
              },
            };
            const agendaOrder = prev.agendaOrder.includes(event.data.sectionId)
              ? prev.agendaOrder
              : [...prev.agendaOrder, event.data.sectionId];
            return {
              ...prev,
              meetingId: baseMeetingId,
              agenda,
              agendaOrder,
              status: prev.status === 'connecting' ? 'running' : prev.status,
            };
          }
          case 'persona-response': {
            const personaTurns = [
              ...prev.personaTurns.filter((turn) => turn.sequence !== event.data.sequence),
              event.data,
            ].sort((a, b) => a.sequence - b.sequence);
            return {
              ...prev,
              meetingId: baseMeetingId,
              personaTurns,
            };
          }
          case 'action-item': {
            const updatedItems = prev.actionItems.some((item) => item.id === event.data.item.id)
              ? prev.actionItems.map((item) =>
                  item.id === event.data.item.id ? event.data.item : item
                )
              : [...prev.actionItems, event.data.item];
            return {
              ...prev,
              meetingId: baseMeetingId,
              actionItems: updatedItems,
            };
          }
          case 'summary': {
            return {
              ...prev,
              meetingId: baseMeetingId,
              summary: event.data.summary,
            };
          }
          case 'metrics': {
            const tokenUsage =
              'tokenUsage' in event.data
                ? ((event.data as Record<string, unknown>).tokenUsage as Record<string, unknown> | null)
                : prev.tokenUsage;
            return {
              ...prev,
              meetingId: baseMeetingId,
              metrics: event.data.metrics,
              tokenUsage,
            };
          }
          case 'completed': {
            return {
              ...prev,
              meetingId: baseMeetingId,
              status: 'completed',
              endedAt: event.data.endedAt,
            };
          }
          case 'error': {
            return {
              ...prev,
              meetingId: baseMeetingId,
              status: 'error',
              error: event.data.message,
            };
          }
          default:
            return prev;
        }
      });
    },
    []
  );

  const startMeeting = useCallback(
    async (payload?: StartBoardMeetingPayload) => {
      if (controllerRef.current) {
        controllerRef.current.abort();
        controllerRef.current = null;
      }

      const controller = new AbortController();
      controllerRef.current = controller;

      // Reset rating state for new meeting
      setUserRating(null);
      setRatingSubmitted(false);

      setStreamState({
        ...createInitialStreamState(),
        status: 'connecting',
        startedAt: new Date().toISOString(),
      });

      let aborted = false;

      try {
        const response = await api.startBoardMeetingStream(payload ?? {}, {
          signal: controller.signal,
        });

        if (!response.body) {
          throw new Error('No response stream available');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let shouldTerminate = false;

        while (!shouldTerminate) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });

          let boundary = buffer.indexOf('\n\n');
          while (boundary !== -1) {
            const raw = buffer.slice(0, boundary).trim();
            buffer = buffer.slice(boundary + 2);

            if (!raw || raw.startsWith(':')) {
              boundary = buffer.indexOf('\n\n');
              continue;
            }

            const dataLine = raw.startsWith('data:') ? raw.slice(5).trim() : raw;

            if (!dataLine) {
              boundary = buffer.indexOf('\n\n');
              continue;
            }

            try {
              const event = JSON.parse(dataLine) as BoardMeetingStreamEnvelope;
              handleStreamEvent(event);
              if (event.type === 'completed' || event.type === 'error') {
                shouldTerminate = true;
                break;
              }
            } catch (error) {
              console.error('Failed to parse board meeting stream chunk', error);
            }

            boundary = buffer.indexOf('\n\n');
          }
        }

        await reader.cancel().catch(() => undefined);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          aborted = true;
        } else {
          const message =
            error instanceof Error ? error.message : 'Failed to start board meeting';
          setStreamState((prev) => ({
            ...prev,
            status: 'error',
            error: message,
          }));
          toast({
            title: 'Board meeting failed',
            description: message,
            variant: 'destructive',
          });
        }
      } finally {
        controllerRef.current = null;
        if (!aborted) {
          void refreshHistory();
        }
      }
    },
    [api, handleStreamEvent, refreshHistory, toast]
  );

  const stopMeeting = useCallback(() => {
    if (controllerRef.current) {
      controllerRef.current.abort();
      controllerRef.current = null;
    }
    setStreamState(createInitialStreamState());
    toast({
      title: 'Board meeting cancelled',
      description: 'The board meeting stream was halted.',
    });
  }, [toast]);

  const handleActionItemStatusChange = useCallback(
    async (item: BoardActionItemWithAssignee, status: 'open' | 'in_progress' | 'completed') => {
      try {
        const updated = await api.updateBoardActionItem(item.id, { status });
        applyActionItemUpdate(updated);
        toast({
          title: 'Action item updated',
          description: `Marked as ${status.replace('_', ' ')}`,
        });
      } catch (error) {
        toast({
          title: 'Update failed',
          description: error instanceof Error ? error.message : 'Could not update action item',
          variant: 'destructive',
        });
      }
    },
    [api, applyActionItemUpdate, toast]
  );

  const handleActionItemDueDateChange = useCallback(
    async (item: BoardActionItemWithAssignee, dateValue: string) => {
      const isoValue = dateValue ? new Date(`${dateValue}T00:00:00Z`).toISOString() : null;
      try {
        const updated = await api.updateBoardActionItem(item.id, { dueDate: isoValue });
        applyActionItemUpdate(updated);
        toast({
          title: 'Due date updated',
          description: isoValue ? `Due on ${new Date(isoValue).toLocaleDateString()}` : 'Due date cleared',
        });
      } catch (error) {
        toast({
          title: 'Update failed',
          description: error instanceof Error ? error.message : 'Could not update due date',
          variant: 'destructive',
        });
      }
    },
    [api, applyActionItemUpdate, toast]
  );

  const submitRating = useCallback(
    async (rating: number) => {
      if (!streamState.meetingId) {
        toast({
          title: 'Cannot submit rating',
          description: 'No active meeting to rate',
          variant: 'destructive',
        });
        return;
      }

      try {
        await api.submitBoardMeetingRating(streamState.meetingId, rating);
        setUserRating(rating);
        setRatingSubmitted(true);
        toast({
          title: 'Rating submitted',
          description: `Thank you for rating this meeting ${rating} star${rating !== 1 ? 's' : ''}!`,
        });
      } catch (error) {
        toast({
          title: 'Rating failed',
          description: error instanceof Error ? error.message : 'Could not submit rating',
          variant: 'destructive',
        });
      }
    },
    [api, streamState.meetingId, toast]
  );

  const openMeetingDetail = useCallback((meetingId: string) => {
    setDetailMeetingId(meetingId);
    setDetailOpen(true);
  }, []);

  useEffect(() => {
    if (!detailOpen || !detailMeetingId) {
      return;
    }

    setDetailLoading(true);
    setDetail(null);

    api
      .getBoardMeetingDetail(detailMeetingId)
      .then((data) => {
        setDetail(data);
      })
      .catch((error) => {
        toast({
          title: 'Failed to load meeting',
          description: error instanceof Error ? error.message : 'Unable to fetch meeting details',
          variant: 'destructive',
        });
      })
      .finally(() => {
        setDetailLoading(false);
      });
  }, [api, detailMeetingId, detailOpen, toast]);

  const status = streamState.status;
  const StatusIcon = statusIcon[status];
  const hasActiveMeeting = status === 'running' || status === 'connecting';

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1">
              <CardTitle>Board Meeting Control</CardTitle>
              <CardDescription>
                Orchestrate a live executive session with persona insights, agenda tracking, and action item capture.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Badge
                variant={statusVariant[status]}
                className="flex items-center gap-1.5 px-3 py-1 capitalize"
              >
                <StatusIcon
                  className={cn('h-4 w-4', status === 'running' || status === 'connecting' ? 'animate-spin' : '')}
                />
                {statusLabel[status]}
              </Badge>
              {hasActiveMeeting ? (
                <Button variant="destructive" className="gap-2" onClick={stopMeeting} type="button">
                  <StopCircle className="h-4 w-4" />
                  Stop meeting
                </Button>
              ) : (
                <Button className="gap-2" onClick={() => void startMeeting()} type="button">
                  <Play className="h-4 w-4" />
                  Prep board meeting
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              <span>Started {formatDateTime(streamState.startedAt)}</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />
              <span>Completed {formatDateTime(streamState.endedAt)}</span>
            </div>
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              <span>{streamState.personaTurns.length} persona turns</span>
            </div>
          </CardContent>
        </Card>

        {streamState.error && (
          <div className="flex items-start gap-3 rounded-md border border-destructive/20 bg-destructive/10 p-4 text-destructive">
            <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0" />
            <div className="space-y-1">
              <p className="font-medium">Meeting encountered an error</p>
              <p className="text-sm">{streamState.error}</p>
            </div>
          </div>
        )}

        {streamState.status === 'completed' && streamState.meetingId && !ratingSubmitted && (
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="pt-6">
              <div className="flex flex-col items-center gap-4 text-center">
                <div className="space-y-2">
                  <p className="font-medium">How was this board meeting?</p>
                  <p className="text-sm text-muted-foreground">
                    Your feedback helps us improve the experience
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {[1, 2, 3, 4, 5].map((rating) => (
                    <button
                      key={rating}
                      type="button"
                      onClick={() => void submitRating(rating)}
                      onMouseEnter={() => setRatingHover(rating)}
                      onMouseLeave={() => setRatingHover(null)}
                      className="group transition-transform hover:scale-110"
                      aria-label={`Rate ${rating} star${rating !== 1 ? 's' : ''}`}
                    >
                      <Star
                        className={cn(
                          'h-8 w-8 transition-colors',
                          (ratingHover !== null && rating <= ratingHover) ||
                            (ratingHover === null && userRating !== null && rating <= userRating)
                            ? 'fill-yellow-400 text-yellow-400'
                            : 'text-muted-foreground group-hover:text-yellow-400'
                        )}
                      />
                    </button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {ratingSubmitted && streamState.status === 'completed' && (
          <div className="flex items-center justify-center gap-3 rounded-md border border-primary/20 bg-primary/5 p-4">
            <CheckCircle2 className="h-5 w-5 text-primary" />
            <p className="text-sm font-medium">
              Thank you for your feedback! You rated this meeting {userRating} star
              {userRating !== 1 ? 's' : ''}.
            </p>
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <History className="h-5 w-5" /> Agenda Timeline
              </CardTitle>
              <CardDescription>Track agenda progress as each persona shares their insights.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {streamState.agendaOrder.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Kick off a board meeting to populate the agenda timeline.
                </p>
              ) : (
                <div className="space-y-3">
                  {streamState.agendaOrder.map((sectionId) => {
                    const section = streamState.agenda[sectionId];
                    return (
                      <div
                        key={sectionId}
                        className="flex items-start justify-between rounded-lg border p-3"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <Badge variant="outline" className="uppercase">
                              {section.personaId}
                            </Badge>
                            <span>{section.title}</span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {section.status === 'pending'
                              ? 'Awaiting persona response'
                              : section.status === 'in_progress'
                              ? 'Gathering insights'
                              : 'Completed'}
                          </p>
                        </div>
                        <Badge variant={agendaVariant[section.status]} className="capitalize">
                          {section.status.replace('_', ' ')}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Users className="h-5 w-5" /> Persona Intelligence Feed
              </CardTitle>
              <CardDescription>
                Live persona analysis, recommendations, and risk assessments streamed from the orchestrator.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {streamState.personaTurns.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Persona responses will appear here as the meeting progresses.
                </p>
              ) : (
                <div className="space-y-6">
                  {streamState.personaTurns.map((turn) => (
                    <div key={`${turn.personaId}-${turn.sequence}`} className="space-y-3 rounded-lg border p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="uppercase">
                            {turn.personaId}
                          </Badge>
                          <span className="font-semibold">
                            {personaLabel(turn.personaId, turn.personaName)}
                          </span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {formatDateTime(turn.createdAt)}
                        </span>
                      </div>
                      <p className="text-sm leading-relaxed">{turn.summary}</p>

                      {turn.risks.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase text-destructive">Risks</p>
                          <ul className="space-y-1 text-sm text-muted-foreground">
                            {turn.risks.map((risk, idx) => (
                              <li key={idx} className="flex gap-2">
                                <span className="mt-1 text-xs">•</span>
                                <span>{risk}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {turn.opportunities.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase text-emerald-600 dark:text-emerald-400">
                            Opportunities
                          </p>
                          <ul className="space-y-1 text-sm text-muted-foreground">
                            {turn.opportunities.map((opportunity, idx) => (
                              <li key={idx} className="flex gap-2">
                                <span className="mt-1 text-xs">•</span>
                                <span>{opportunity}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {turn.recommendations.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase text-primary">
                            Recommended Actions
                          </p>
                          <ul className="space-y-2 text-sm text-muted-foreground">
                            {turn.recommendations.map((recommendation, idx) => (
                              <li key={idx} className="rounded-md border border-primary/10 p-2">
                                <p className="font-medium text-foreground">{recommendation.title}</p>
                                {recommendation.rationale && (
                                  <p className="text-xs text-muted-foreground">
                                    {recommendation.rationale}
                                  </p>
                                )}
                                <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                                  {recommendation.ownerHint && <span>Owner hint: {recommendation.ownerHint}</span>}
                                  {recommendation.dueDateHint && (
                                    <span>Due: {recommendation.dueDateHint}</span>
                                  )}
                                  {recommendation.priority && (
                                    <span className="uppercase">Priority: {recommendation.priority}</span>
                                  )}
                                </div>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Target className="h-5 w-5" /> Highlights & Risks
                </CardTitle>
                <CardDescription>Executive-ready narrative summarizing the latest meeting.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                {streamState.summary ? (
                  <div className="space-y-4">
                    <p className="text-foreground">{streamState.summary.narrative}</p>
                    <div className="space-y-3">
                      {streamState.summary.highlights.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold uppercase text-emerald-600 dark:text-emerald-400">
                            Key wins
                          </p>
                          <ul className="space-y-1 text-muted-foreground">
                            {streamState.summary.highlights.map((highlight, idx) => (
                              <li key={idx} className="flex gap-2">
                                <span className="mt-1 text-xs">•</span>
                                <span>{highlight}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {streamState.summary.risks.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold uppercase text-destructive">Risks</p>
                          <ul className="space-y-1 text-muted-foreground">
                            {streamState.summary.risks.map((risk, idx) => (
                              <li key={idx} className="flex gap-2">
                                <span className="mt-1 text-xs">•</span>
                                <span>{risk}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {streamState.summary.blockers.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold uppercase text-warning">Blockers</p>
                          <ul className="space-y-1 text-muted-foreground">
                            {streamState.summary.blockers.map((blocker, idx) => (
                              <li key={idx} className="flex gap-2">
                                <span className="mt-1 text-xs">•</span>
                                <span>{blocker}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {streamState.summary.nextSteps.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold uppercase text-primary">Next steps</p>
                          <ul className="space-y-1 text-muted-foreground">
                            {streamState.summary.nextSteps.map((step, idx) => (
                              <li key={idx} className="flex gap-2">
                                <span className="mt-1 text-xs">•</span>
                                <span>{step}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-muted-foreground">
                    Summary insights will appear here once the meeting synthesis completes.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <BarChart3 className="h-5 w-5" /> Meeting Metrics
                </CardTitle>
                <CardDescription>Latency, token usage, and action item impact.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                {streamState.metrics ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-muted-foreground">Duration</p>
                        <p className="text-base font-semibold">
                          {formatDurationMs(streamState.metrics.durationMs)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Action items</p>
                        <p className="text-base font-semibold">
                          {Object.entries(streamState.metrics.actionItems || {})
                            .map(([statusKey, count]) => `${statusKey.replace('_', ' ')}: ${count}`)
                            .join(' • ')}
                        </p>
                      </div>
                    </div>

                    {streamState.metrics.personaTokens && (
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase text-muted-foreground">Persona token usage</p>
                        <div className="space-y-2">
                          {Object.entries(streamState.metrics.personaTokens).map(([personaId, usage]) => (
                            <div key={personaId} className="flex items-center justify-between rounded-md border p-2 text-xs">
                              <span className="font-medium uppercase">{personaId}</span>
                              <span className="text-muted-foreground">
                                {usage.total} tokens (in: {usage.input} / out: {usage.output})
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {streamState.metrics.personaLatencyMs && (
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase text-muted-foreground">Persona latency</p>
                        <div className="grid gap-2">
                          {Object.entries(streamState.metrics.personaLatencyMs).map(([personaId, latency]) => (
                            <div key={personaId} className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-xs">
                              <span className="font-medium uppercase">{personaId}</span>
                              <span>{formatDurationMs(latency)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {streamState.tokenUsage && (
                      <div className="space-y-2 text-xs text-muted-foreground">
                        <p className="text-xs font-semibold uppercase text-muted-foreground">Raw token usage</p>
                        <pre className="max-h-40 overflow-auto rounded-md bg-muted/40 p-2 text-[11px]">
                          {JSON.stringify(streamState.tokenUsage, null, 2)}
                        </pre>
                      </div>
                    )}

                    {streamState.metrics.userFeedback && (
                      <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-xs">
                        <p className="font-semibold text-primary">User feedback</p>
                        <p className="text-muted-foreground">
                          Rating: {streamState.metrics.userFeedback.rating ?? '—'}
                          {streamState.metrics.userFeedback.comment
                            ? ` · ${streamState.metrics.userFeedback.comment}`
                            : ''}
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-muted-foreground">
                    Meeting metrics will populate as soon as the orchestration completes.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Action Items</CardTitle>
              <CardDescription>
                Assign owners, update status, and move work to execution.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {streamState.actionItems.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Action items generated during the board meeting will appear here.
                </p>
              ) : (
                <div className="space-y-4">
                  {streamState.actionItems.map((item) => (
                    <div key={item.id} className="space-y-3 rounded-lg border p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-1">
                          <p className="text-sm font-semibold text-foreground">{item.title}</p>
                          {item.description && (
                            <p className="text-xs text-muted-foreground">{item.description}</p>
                          )}
                        </div>
                        <Badge variant={priorityVariant[item.priority]} className="capitalize">
                          {item.priority}
                        </Badge>
                      </div>

                      <div className="grid gap-3">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span className="font-medium uppercase">Status</span>
                          <Select
                            value={item.status}
                            onValueChange={(value) =>
                              void handleActionItemStatusChange(
                                item,
                                value as 'open' | 'in_progress' | 'completed'
                              )
                            }
                          >
                            <SelectTrigger className="h-8 w-36 text-xs">
                              <SelectValue placeholder="Select status" />
                            </SelectTrigger>
                            <SelectContent>
                              {statusOptions.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                          <div className="flex flex-col">
                            <span className="font-medium uppercase">Due date</span>
                            <Input
                              type="date"
                              className="mt-1 h-8 w-40 text-xs"
                              value={toDateInputValue(item.dueDate)}
                              onChange={(event) =>
                                void handleActionItemDueDateChange(item, event.target.value)
                              }
                            />
                          </div>
                          <div className="flex flex-col">
                            <span className="font-medium uppercase">Owner</span>
                            <span className="mt-1 text-xs text-foreground">
                              {item.assignee?.name || item.assignee?.email || 'Unassigned'}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-1 text-xs text-muted-foreground">
                        <span>Created {formatDateTime(item.createdAt)}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1 text-xs"
                          onClick={() => router.push('/tasks')}
                          type="button"
                        >
                          Hand off to tasks
                          <ArrowRight className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="space-y-3">
              <div>
                <CardTitle className="text-lg">Meeting History</CardTitle>
                <CardDescription>Replay past sessions and benchmark outcomes.</CardDescription>
              </div>
              <div className="grid gap-3">
                <div className="flex flex-col gap-1">
                  <Label className="text-xs uppercase text-muted-foreground">Persona filter</Label>
                  <Select
                    value={historyFilters.persona}
                    onValueChange={(value) =>
                      setHistoryFilters((prev) => ({
                        ...prev,
                        persona: value as HistoryPersonaFilter,
                      }))
                    }
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="All personas" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All personas</SelectItem>
                      <SelectItem value="ceo">CEO</SelectItem>
                      <SelectItem value="cfo">CFO</SelectItem>
                      <SelectItem value="cmo">CMO</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs uppercase text-muted-foreground">Timeframe</Label>
                  <Select
                    value={historyFilters.timeframe}
                    onValueChange={(value) =>
                      setHistoryFilters((prev) => ({
                        ...prev,
                        timeframe: value as HistoryTimeframeFilter,
                      }))
                    }
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Last 30 days" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All time</SelectItem>
                      <SelectItem value="7d">Last 7 days</SelectItem>
                      <SelectItem value="30d">Last 30 days</SelectItem>
                      <SelectItem value="90d">Last 90 days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={() => void refreshHistory()}
                    type="button"
                  >
                    <History className="h-3.5 w-3.5" /> Refresh
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {historyLoading ? (
                <div className="flex justify-center py-6">
                  <LoadingSpinner size="md" />
                </div>
              ) : historyError ? (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  {historyError}
                </div>
              ) : history.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No board meetings found for the selected filters.
                </p>
              ) : (
                <div className="space-y-3">
                  {history.map((meeting) => (
                    <div key={meeting.id} className="space-y-3 rounded-lg border p-4 text-sm">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-1">
                          <p className="font-semibold text-foreground">
                            {formatDateTime(meeting.startedAt)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Agenda v{meeting.agendaVersion}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Duration {calculateDuration(meeting.startedAt, meeting.endedAt)}
                          </p>
                        </div>
                        <Badge
                          variant={meeting.endedAt ? 'success' : 'warning'}
                          className="capitalize"
                        >
                          {meeting.endedAt ? 'Completed' : 'In progress'}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                        <span>{meeting.personaCount} persona turns</span>
                        <span>
                          Open: {meeting.actionItemCounts.open} · In progress: {meeting.actionItemCounts.in_progress} · Closed: {meeting.actionItemCounts.completed}
                        </span>
                        {typeof meeting.rating === 'number' && (
                          <span>Rating: {meeting.rating}</span>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-2 text-xs"
                        onClick={() => openMeetingDetail(meeting.id)}
                        type="button"
                      >
                        View transcript
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              {historyMeta && (
                <p className="text-xs text-muted-foreground">
                  Showing page {historyMeta.page} of {historyMeta.pageCount} · {historyMeta.total}{' '}
                  meetings total
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog
        open={detailOpen}
        onOpenChange={(open) => {
          setDetailOpen(open);
          if (!open) {
            setDetail(null);
            setDetailMeetingId(null);
          }
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Board Meeting Replay</DialogTitle>
          </DialogHeader>

          {detailLoading ? (
            <div className="flex justify-center py-10">
              <LoadingSpinner size="md" />
            </div>
          ) : detail ? (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
                <span>Started {formatDateTime(detail.startedAt)}</span>
                <span>Duration {calculateDuration(detail.startedAt, detail.endedAt)}</span>
                {typeof detail.rating === 'number' && <span>Rating {detail.rating}</span>}
              </div>

              <div className="space-y-4">
                <h3 className="text-sm font-semibold uppercase text-muted-foreground">Summary</h3>
                {detail.summary ? (
                  <div className="space-y-3 text-sm text-muted-foreground">
                    <p className="text-foreground">{detail.summary.narrative}</p>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div>
                        <p className="text-xs font-semibold uppercase text-emerald-600 dark:text-emerald-400">
                          Highlights
                        </p>
                        <ul className="space-y-1">
                          {detail.summary.highlights.map((item, idx) => (
                            <li key={idx}>• {item}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase text-destructive">Risks</p>
                        <ul className="space-y-1">
                          {detail.summary.risks.map((item, idx) => (
                            <li key={idx}>• {item}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No summary captured.</p>
                )}
              </div>

              <div className="space-y-4">
                <h3 className="text-sm font-semibold uppercase text-muted-foreground">Persona transcripts</h3>
                <div className="space-y-4">
                  {detail.personaTurns.map((turn) => (
                    <div key={`${turn.personaId}-${turn.sequence}`} className="space-y-2 rounded-lg border p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-foreground">
                          {personaLabel(turn.personaId, turn.personaName)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatDateTime(turn.createdAt)}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground leading-relaxed">{turn.summary}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-sm font-semibold uppercase text-muted-foreground">Action items</h3>
                {detail.actionItems.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No action items captured.</p>
                ) : (
                  <div className="space-y-3">
                    {detail.actionItems.map((item) => (
                      <div key={item.id} className="rounded-lg border p-3 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium text-foreground">{item.title}</span>
                          <Badge variant={priorityVariant[item.priority]} className="capitalize">
                            {item.priority}
                          </Badge>
                        </div>
                        {item.description && (
                          <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
                        )}
                        <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                          <span>Status: {item.status.replace('_', ' ')}</span>
                          <span>
                            Owner: {item.assignee?.name || item.assignee?.email || 'Unassigned'}
                          </span>
                          <span>
                            Due: {item.dueDate ? new Date(item.dueDate).toLocaleDateString() : '—'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <p className="py-6 text-sm text-muted-foreground">
              Meeting data unavailable. Try refreshing the history panel.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
