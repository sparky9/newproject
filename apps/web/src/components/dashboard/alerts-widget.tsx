'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { createApiClient } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import type { Alert, TriggerSeverity } from '@ocsuite/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sparkline } from '@/components/ui/sparkline';
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  Loader2,
  ShieldAlert,
} from 'lucide-react';

const severityOrder: TriggerSeverity[] = ['critical', 'warning', 'info'];

const severityLabels: Record<TriggerSeverity, string> = {
  critical: 'Critical',
  warning: 'Warning',
  info: 'Info',
};

const severityBadgeVariant: Record<TriggerSeverity, 'error' | 'warning' | 'outline'> = {
  critical: 'error',
  warning: 'warning',
  info: 'outline',
};

type SeverityFilter = 'all' | TriggerSeverity;

interface AlertStatsSummary {
  pending: number;
  criticalPending: number;
}

function formatRelativeTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.round(diffMs / 60000);

  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

function getSeverityIcon(severity: TriggerSeverity) {
  switch (severity) {
    case 'critical':
      return ShieldAlert;
    case 'warning':
      return AlertTriangle;
    default:
      return BellRing;
  }
}

export function AlertsWidget() {
  const { getToken } = useAuth();
  const { toast } = useToast();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [stats, setStats] = useState<AlertStatsSummary>({ pending: 0, criticalPending: 0 });
  const [loading, setLoading] = useState(true);
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [acknowledging, setAcknowledging] = useState<string | null>(null);

  const api = useMemo(() => createApiClient(getToken), [getToken]);

  const loadAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.listAlerts({
        status: 'pending',
        severity: severityFilter === 'all' ? undefined : severityFilter,
        limit: 10,
      });

      setAlerts(response.alerts ?? []);
      setStats(response.stats ?? { pending: 0, criticalPending: 0 });
    } catch (error) {
      console.error('Failed to load alerts', error);
      toast({
        title: 'Unable to load alerts',
        description: 'Please try again shortly.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [api, severityFilter, toast]);

  useEffect(() => {
    loadAlerts();
  }, [loadAlerts]);

  const acknowledgeAlert = useCallback(
    async (alertId: string) => {
      setAcknowledging(alertId);
      try {
        await api.acknowledgeAlert(alertId);
        setAlerts((current) => current.filter((alert) => alert.id !== alertId));
        setStats((current) => ({
          pending: Math.max(0, current.pending - 1),
          criticalPending: Math.max(
            0,
            current.criticalPending - (alerts.find((alert) => alert.id === alertId)?.severity === 'critical' ? 1 : 0)
          ),
        }));
        toast({
          title: 'Alert acknowledged',
          description: 'The alert has been marked as acknowledged.',
        });
      } catch (error) {
        console.error('Failed to acknowledge alert', error);
        toast({
          title: 'Failed to acknowledge alert',
          description: 'Please try again.',
          variant: 'destructive',
        });
      } finally {
        setAcknowledging(null);
      }
    },
    [api, alerts, toast]
  );

  const severityDistribution = useMemo(() => {
    const counts: Record<TriggerSeverity, number> = {
      critical: 0,
      warning: 0,
      info: 0,
    };

    for (const alert of alerts) {
      const severity = alert.severity ?? 'warning';
      if (severity in counts) {
        counts[severity as TriggerSeverity] += 1;
      }
    }

    return severityOrder.map((severity) => counts[severity]);
  }, [alerts]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-lg font-semibold">Today's Alerts</CardTitle>
          <CardDescription>
            {stats.pending > 0
              ? `${stats.pending} pending${stats.criticalPending ? ` • ${stats.criticalPending} critical` : ''}`
              : 'All caught up'}
          </CardDescription>
        </div>
        <Sparkline
          values={severityDistribution}
          width={120}
          height={32}
          stroke="hsl(var(--destructive))"
          fill="hsl(var(--destructive) / 0.2)"
          className="hidden sm:block"
        />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {(['all', ...severityOrder] as SeverityFilter[]).map((option) => (
            <Button
              key={option}
              size="sm"
              variant={severityFilter === option ? 'default' : 'outline'}
              onClick={() => setSeverityFilter(option)}
            >
              {option === 'all' ? 'All severities' : severityLabels[option]}
            </Button>
          ))}
          <Button
            size="sm"
            variant="ghost"
            onClick={loadAlerts}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshIcon className="mr-2 h-4 w-4" />
            )}
            Refresh
          </Button>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, idx) => (
              <div key={idx} className="animate-pulse rounded-lg border p-3">
                <div className="flex items-center space-x-3">
                  <div className="h-6 w-6 rounded-full bg-muted" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-1/3 rounded bg-muted" />
                    <div className="h-3 w-1/2 rounded bg-muted" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : alerts.length === 0 ? (
          <div className="rounded-lg border border-dashed py-10 text-center">
            <CheckCircle2 className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No pending alerts right now.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {alerts.map((alert) => {
              const Icon = getSeverityIcon((alert.severity as TriggerSeverity) ?? 'warning');

              return (
                <div
                  key={alert.id}
                  className="flex flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="flex flex-1 items-start space-x-3">
                    <div className="mt-1 rounded-full border p-2">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold leading-none">
                          {alert.title || 'Alert'}
                        </h3>
                        <Badge variant={severityBadgeVariant[(alert.severity as TriggerSeverity) ?? 'warning']}>
                          {severityLabels[(alert.severity as TriggerSeverity) ?? 'warning']}
                        </Badge>
                      </div>
                      {alert.summary && (
                        <p className="text-sm text-muted-foreground">
                          {alert.summary}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {formatRelativeTime(alert.createdAt)}
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => acknowledgeAlert(alert.id)}
                    disabled={acknowledging === alert.id}
                  >
                    {acknowledging === alert.id ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                    )}
                    Acknowledge
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RefreshIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M21 12a9 9 0 1 1-9-9"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.4"
      />
      <path
        d="M21 3v6h-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
