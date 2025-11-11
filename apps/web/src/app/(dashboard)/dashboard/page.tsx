'use client';

import { useEffect, useState } from 'react';
import { useAuth, useUser } from '@clerk/nextjs';
import { MetricCard } from '@/components/dashboard/metric-card';
import { ModuleInsightCard } from '@/components/dashboard/module-insight-card';
import { OnboardingChecklist } from '@/components/dashboard/onboarding-checklist';
import { AlertsWidget } from '@/components/dashboard/alerts-widget';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { createApiClient } from '@/lib/api';
import type { ModuleInsight } from '@ocsuite/types';
import {
  DollarSign,
  Users,
  CheckCircle2,
  TrendingDown,
  MessageSquare,
  Cable,
  Video,
  RefreshCw,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface DashboardMetrics {
  revenue: number;
  leads: number;
  tasks: number;
  activeConnectors: number;
}

interface Activity {
  id: string;
  type: string;
  description: string;
  timestamp: Date;
}

export default function DashboardPage() {
  const { getToken } = useAuth();
  const { user } = useUser();
  const router = useRouter();
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [insights, setInsights] = useState<ModuleInsight[]>([]);
  const [loading, setLoading] = useState(true);
  const [insightsLoading, setInsightsLoading] = useState(false);

  useEffect(() => {
    async function loadDashboard() {
      try {
        const api = createApiClient(getToken);
        const [metricsData, activityData, insightsData] = await Promise.all([
          api.getDashboardMetrics(),
          api.getRecentActivity(),
          api.getModuleInsights().catch(() => [] as ModuleInsight[]),
        ]);
        setMetrics(metricsData);
        setActivities(activityData);
        setInsights(insightsData);
      } catch (error) {
        console.error('Failed to load dashboard:', error);
      } finally {
        setLoading(false);
      }
    }

    loadDashboard();
  }, [getToken]);

  async function refreshInsights() {
    setInsightsLoading(true);
    try {
      const api = createApiClient(getToken);
      const insightsData = await api.getModuleInsights();
      setInsights(insightsData);
    } catch (error) {
      console.error('Failed to refresh insights:', error);
    } finally {
      setInsightsLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader className="space-y-0 pb-2">
                <div className="h-4 bg-muted rounded w-24" />
              </CardHeader>
              <CardContent>
                <div className="h-8 bg-muted rounded w-32" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Welcome back, {user?.firstName || 'there'}! Here's what's happening
          today.
        </p>
      </div>

  {/* Onboarding Checklist */}
  <OnboardingChecklist />

  {/* Metrics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Revenue"
          value={`$${(metrics?.revenue || 0).toLocaleString()}`}
          icon={DollarSign}
          description="Total revenue tracked"
          trend={{ value: 12.5, isPositive: true }}
        />
        <MetricCard
          title="Active Leads"
          value={metrics?.leads || 0}
          icon={Users}
          description="Leads in pipeline"
          trend={{ value: 8.2, isPositive: true }}
        />
        <MetricCard
          title="Tasks Completed"
          value={metrics?.tasks || 0}
          icon={CheckCircle2}
          description="This month"
          trend={{ value: 4.1, isPositive: true }}
        />
        <MetricCard
          title="Burn Rate"
          value="$12,500/mo"
          icon={TrendingDown}
          description="Monthly expenses"
          trend={{ value: -2.3, isPositive: false }}
        />
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <Button
              variant="outline"
              className="h-auto flex flex-col items-start p-4 space-y-2"
              onClick={() => router.push('/chat')}
            >
              <MessageSquare className="h-6 w-6" />
              <div className="text-left">
                <div className="font-semibold">Chat with CEO</div>
                <div className="text-xs text-muted-foreground">
                  Get strategic insights
                </div>
              </div>
            </Button>

            <Button
              variant="outline"
              className="h-auto flex flex-col items-start p-4 space-y-2"
              onClick={() => router.push('/chat?type=board')}
            >
              <Video className="h-6 w-6" />
              <div className="text-left">
                <div className="font-semibold">Run Board Meeting</div>
                <div className="text-xs text-muted-foreground">
                  Consult your AI board
                </div>
              </div>
            </Button>

            <Button
              variant="outline"
              className="h-auto flex flex-col items-start p-4 space-y-2"
              onClick={() => router.push('/connectors')}
            >
              <Cable className="h-6 w-6" />
              <div className="text-left">
                <div className="font-semibold">Connect Integration</div>
                <div className="text-xs text-muted-foreground">
                  Link your tools
                </div>
              </div>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Alerts */}
      <AlertsWidget />

      {/* Module Insights */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold">Module Insights</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={refreshInsights}
            disabled={insightsLoading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${insightsLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {insights.length === 0 ? (
          <Card>
            <CardContent className="py-8">
              <div className="text-center">
                <p className="text-muted-foreground mb-4">
                  No module insights available yet.
                </p>
                <p className="text-sm text-muted-foreground">
                  Insights will appear here as your modules analyze your business data.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            {insights.map((insight) => (
              <ModuleInsightCard
                key={insight.id}
                insight={insight}
                onViewDetails={() => {
                  // Could navigate to a detailed view
                  console.log('View details for insight:', insight.id);
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Recent Activity */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {activities.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No recent activity
              </p>
            ) : (
              activities.map((activity) => (
                <div
                  key={activity.id}
                  className="flex items-start space-x-3 text-sm"
                >
                  <div className="w-2 h-2 rounded-full bg-primary mt-2" />
                  <div className="flex-1">
                    <p>{activity.description}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {new Date(activity.timestamp).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
