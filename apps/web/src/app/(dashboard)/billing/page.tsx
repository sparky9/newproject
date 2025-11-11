'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import type { BillingUsageSummary } from '@ocsuite/types';
import { createApiClient } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MetricCard } from '@/components/dashboard/metric-card';
import { Sparkline } from '@/components/ui/sparkline';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Coins,
  Loader2,
  Puzzle,
} from 'lucide-react';

interface Trend {
  value: number;
  isPositive: boolean;
}

const RANGE_OPTIONS = [7, 30, 90] as const;

function formatNumber(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function calculateTrend(values: number[]): Trend | undefined {
  if (values.length < 2) {
    return undefined;
  }

  const latest = values.at(-1)!;
  const previous = values.slice(0, -1).findLast((value) => value !== 0) ?? values[values.length - 2];

  if (typeof previous !== 'number' || previous === 0) {
    return undefined;
  }

  const delta = ((latest - previous) / previous) * 100;
  return {
    value: Math.round(delta * 10) / 10,
    isPositive: delta >= 0,
  };
}

export default function BillingPage() {
  const { getToken } = useAuth();
  const { toast } = useToast();
  const [summary, setSummary] = useState<BillingUsageSummary | null>(null);
  const [range, setRange] = useState<(typeof RANGE_OPTIONS)[number]>(30);
  const [loading, setLoading] = useState(true);

  const api = useMemo(() => createApiClient(getToken), [getToken]);

  const loadUsage = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getBillingUsage({ days: range });
      setSummary(data);
    } catch (error) {
      console.error('Failed to load billing usage', error);
      toast({
        title: 'Unable to load usage data',
        description: 'Check your connection and try again.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [api, range, toast]);

  useEffect(() => {
    loadUsage();
  }, [loadUsage]);

  const usage = summary?.usage ?? ([] as BillingUsageSummary['usage']);
  const totals = summary?.totals ?? {
    tokensUsed: 0,
    tasksExecuted: 0,
    alertsTriggered: 0,
    activeWidgets: 0,
  };

  const metricDefinitions = useMemo(
    () => [
      {
        key: 'tokensUsed',
        title: 'Tokens consumed',
        value: formatNumber(totals.tokensUsed),
        icon: Coins,
        description: `${summary?.range.days ?? range}-day total`,
        values: usage.map((point) => point.tokensUsed),
      },
      {
        key: 'tasksExecuted',
        title: 'Tasks executed',
        value: formatNumber(totals.tasksExecuted),
        icon: Activity,
        description: 'Automated actions completed',
        values: usage.map((point) => point.tasksExecuted),
      },
      {
        key: 'alertsTriggered',
        title: 'Alerts triggered',
        value: formatNumber(totals.alertsTriggered),
        icon: AlertTriangle,
        description: 'Signals raised for review',
        values: usage.map((point) => point.alertsTriggered),
      },
      {
        key: 'activeWidgets',
        title: 'Active widgets',
        value: formatNumber(totals.activeWidgets),
        icon: Puzzle,
        description: 'Peak widgets enabled',
        values: usage.map((point) => point.activeWidgets),
      },
    ],
    [totals, usage, summary?.range?.days, range]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Billing & Usage</h1>
        <p className="text-muted-foreground">
          Monitor consumption trends, active widgets, and alert activity across your tenant.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-2 rounded-lg border bg-card p-1">
          {RANGE_OPTIONS.map((option) => (
            <Button
              key={option}
              size="sm"
              variant={range === option ? 'default' : 'ghost'}
              onClick={() => setRange(option)}
              disabled={loading}
            >
              {option} days
            </Button>
          ))}
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={loadUsage}
          disabled={loading}
        >
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BarChart3 className="mr-2 h-4 w-4" />}
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metricDefinitions.map((metric) => (
          <MetricCard
            key={metric.key}
            title={metric.title}
            value={metric.value}
            icon={metric.icon}
            description={metric.description}
            trend={calculateTrend(metric.values)}
          />
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-lg font-semibold">Usage overview</CardTitle>
            <CardDescription>
              {summary
                ? `${summary.range.start} — ${summary.range.end}`
                : 'No usage data available for the selected range'}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-6 lg:grid-cols-2">
          <div>
            <h3 className="mb-3 text-sm font-medium text-muted-foreground">Token usage</h3>
            <Sparkline
              values={usage.map((point) => point.tokensUsed)}
              width={420}
              height={120}
              stroke="hsl(var(--primary))"
              fill="hsl(var(--primary))"
              className="w-full"
            />
          </div>
          <div>
            <h3 className="mb-3 text-sm font-medium text-muted-foreground">Tasks executed</h3>
            <Sparkline
              values={usage.map((point) => point.tasksExecuted)}
              width={420}
              height={120}
              stroke="hsl(var(--secondary-foreground))"
              fill="transparent"
              className="w-full"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold">Daily breakdown</CardTitle>
          <CardDescription>
            Totals aggregated per day. Active widget count reflects the maximum concurrently enabled widgets.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {usage.length === 0 ? (
            <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
              No usage captured for the selected timeframe.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full table-fixed text-sm">
                <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">Tokens</th>
                    <th className="px-3 py-2 font-medium">Tasks</th>
                    <th className="px-3 py-2 font-medium">Alerts</th>
                    <th className="px-3 py-2 font-medium">Active widgets</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.map((point) => (
                    <tr key={point.date} className="border-b last:border-0">
                      <td className="px-3 py-2 text-foreground">
                        {new Date(point.date).toLocaleDateString()}
                      </td>
                      <td className="px-3 py-2">{formatNumber(point.tokensUsed)}</td>
                      <td className="px-3 py-2">{formatNumber(point.tasksExecuted)}</td>
                      <td className="px-3 py-2">{formatNumber(point.alertsTriggered)}</td>
                      <td className="px-3 py-2">{formatNumber(point.activeWidgets)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
