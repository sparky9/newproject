import type { AnalyticsSnapshot } from '@ocsuite/types';

export interface GrowthMetrics {
  totalRevenue: number;
  growthRate: number;
  conversionRate: number;
  avgRevenuePerUser: number;
  totalUsers: number;
  totalConversions: number;
  totalSessions: number;
  dataPoints: number;
}

export interface InsightActionItem {
  title: string;
  description?: string;
  priority?: string;
  estimatedImpact?: string;
}

export interface GrowthPulseInsight {
  score: number;
  severity: 'info' | 'warning' | 'critical';
  summary: string;
  highlights: string[];
  actionItems: InsightActionItem[];
}

export function calculateMetrics(snapshots: AnalyticsSnapshot[]): GrowthMetrics {
  const totalRevenue = snapshots.reduce((sum, snapshot) => sum + snapshot.revenue, 0);
  const totalUsers = snapshots.reduce((sum, snapshot) => sum + snapshot.users, 0);
  const totalConversions = snapshots.reduce((sum, snapshot) => sum + snapshot.conversions, 0);
  const totalSessions = snapshots.reduce((sum, snapshot) => sum + snapshot.sessions, 0);

  const midPoint = Math.floor(snapshots.length / 2);
  const firstHalfRevenue = snapshots.slice(0, midPoint).reduce((sum, s) => sum + s.revenue, 0);
  const secondHalfRevenue = snapshots.slice(midPoint).reduce((sum, s) => sum + s.revenue, 0);
  const growthRate = firstHalfRevenue > 0
    ? ((secondHalfRevenue - firstHalfRevenue) / firstHalfRevenue) * 100
    : 0;

  const conversionRate = totalSessions > 0 ? (totalConversions / totalSessions) * 100 : 0;
  const avgRevenuePerUser = totalUsers > 0 ? totalRevenue / totalUsers : 0;

  return {
    totalRevenue,
    growthRate,
    conversionRate,
    avgRevenuePerUser,
    totalUsers,
    totalConversions,
    totalSessions,
    dataPoints: snapshots.length,
  };
}

export function calculateDefaultScore(metrics: GrowthMetrics): number {
  let score = 50;

  if (metrics.growthRate > 20) score += 30;
  else if (metrics.growthRate > 10) score += 20;
  else if (metrics.growthRate > 0) score += 10;
  else if (metrics.growthRate < -10) score -= 20;

  if (metrics.conversionRate > 5) score += 15;
  else if (metrics.conversionRate > 2) score += 10;

  return Math.max(0, Math.min(100, score));
}

export function determineSeverity(metrics: GrowthMetrics): 'info' | 'warning' | 'critical' {
  if (metrics.growthRate < -20 || metrics.conversionRate < 0.5) return 'critical';
  if (metrics.growthRate < 0 || metrics.conversionRate < 1) return 'warning';
  return 'info';
}

export function generateDefaultSummary(metrics: GrowthMetrics): string {
  return `Revenue growth is ${metrics.growthRate > 0 ? 'positive' : 'negative'} at ${metrics.growthRate.toFixed(1)}% with a ${metrics.conversionRate.toFixed(2)}% conversion rate. Total revenue: $${metrics.totalRevenue.toFixed(2)}.`;
}

export function generateDefaultHighlights(metrics: GrowthMetrics): string[] {
  return [
    `Total revenue of $${metrics.totalRevenue.toFixed(2)} across ${metrics.dataPoints} days`,
    `Growth rate: ${metrics.growthRate.toFixed(1)}%`,
    `Conversion rate: ${metrics.conversionRate.toFixed(2)}%`,
    `Average revenue per user: $${metrics.avgRevenuePerUser.toFixed(2)}`,
  ];
}

export function generateDefaultActions(metrics: GrowthMetrics): InsightActionItem[] {
  const actions: InsightActionItem[] = [];

  if (metrics.conversionRate < 2) {
    actions.push({
      title: 'Optimize conversion funnel',
      description: 'Focus on improving conversion rate through A/B testing and user experience improvements',
      priority: 'high',
      estimatedImpact: 'Increase revenue by 10-20%',
    });
  }

  if (metrics.growthRate < 0) {
    actions.push({
      title: 'Address declining growth',
      description: 'Investigate causes of negative growth and implement retention strategies',
      priority: 'high',
      estimatedImpact: 'Stabilize and reverse growth trend',
    });
  }

  actions.push({
    title: 'Monitor key metrics',
    description: 'Continue tracking revenue, conversions, and user engagement',
    priority: 'medium',
    estimatedImpact: 'Maintain visibility into business performance',
  });

  return actions;
}
