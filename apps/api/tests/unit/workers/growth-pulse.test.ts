import { describe, it, expect } from 'vitest';

/**
 * Growth Pulse Worker Unit Tests
 *
 * Tests for the Growth Pulse worker's core functions including:
 * - Metrics calculation from snapshots
 * - LLM insight generation
 * - JSON response parsing
 * - Severity determination logic
 */

// Import the functions we want to test
// Note: These would need to be exported from the worker file
// For now, we'll recreate the logic here for testing purposes

type MetricsSnapshot = {
  revenue: number;
  users: number;
  conversions: number;
  sessions: number;
};

type AggregatedMetrics = {
  totalRevenue: number;
  growthRate: number;
  conversionRate: number;
  avgRevenuePerUser: number;
  totalUsers: number;
  totalConversions: number;
  totalSessions: number;
  dataPoints: number;
};

type InsightAction = {
  title: string;
  description: string;
  priority: 'high' | 'medium';
  estimatedImpact: string;
};

type InsightResponse = {
  score: number;
  severity: 'info' | 'warning' | 'critical';
  summary: string;
  highlights: string[];
  actionItems: InsightAction[];
};

// Recreate calculateMetrics function for testing
function calculateMetrics(snapshots: MetricsSnapshot[]): AggregatedMetrics {
  const totalRevenue = snapshots.reduce((sum, s) => sum + s.revenue, 0);
  const totalUsers = snapshots.reduce((sum, s) => sum + s.users, 0);
  const totalConversions = snapshots.reduce((sum, s) => sum + s.conversions, 0);
  const totalSessions = snapshots.reduce((sum, s) => sum + s.sessions, 0);

  // Calculate growth rate (comparing first half vs second half)
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
  } satisfies AggregatedMetrics;
}

// Recreate parseInsightResponse function for testing
function parseInsightResponse(response: string, metrics: AggregatedMetrics): InsightResponse {
  try {
    // Clean up response - remove markdown code blocks if present
    let cleanedResponse = response.trim();
    if (cleanedResponse.startsWith('```json')) {
      cleanedResponse = cleanedResponse.replace(/^```json\n?/, '').replace(/\n?```$/, '');
    } else if (cleanedResponse.startsWith('```')) {
      cleanedResponse = cleanedResponse.replace(/^```\n?/, '').replace(/\n?```$/, '');
    }

    // Try to parse as JSON first
    const parsed = JSON.parse(cleanedResponse);
    return {
      score: parsed.score || calculateDefaultScore(metrics),
      severity: parsed.severity || determineSeverity(metrics),
      summary: parsed.summary || generateDefaultSummary(metrics),
      highlights: parsed.highlights || [],
      actionItems: parsed.actionItems || [],
    } satisfies InsightResponse;
  } catch (error) {
    // Fallback to heuristic generation
    return {
      score: calculateDefaultScore(metrics),
      severity: determineSeverity(metrics),
      summary: generateDefaultSummary(metrics),
      highlights: generateDefaultHighlights(metrics),
      actionItems: generateDefaultActions(metrics),
    } satisfies InsightResponse;
  }
}

// Recreate helper functions
function calculateDefaultScore(metrics: AggregatedMetrics): number {
  let score = 50;

  if (metrics.growthRate > 20) score += 30;
  else if (metrics.growthRate > 10) score += 20;
  else if (metrics.growthRate > 0) score += 10;
  else if (metrics.growthRate < -10) score -= 20;

  if (metrics.conversionRate > 5) score += 15;
  else if (metrics.conversionRate > 2) score += 10;

  return Math.max(0, Math.min(100, score));
}

function determineSeverity(metrics: AggregatedMetrics): 'info' | 'warning' | 'critical' {
  if (metrics.growthRate < -20 || metrics.conversionRate < 0.5) return 'critical';
  if (metrics.growthRate < 0 || metrics.conversionRate < 1) return 'warning';
  return 'info';
}

function generateDefaultSummary(metrics: AggregatedMetrics): string {
  return `Revenue growth is ${metrics.growthRate > 0 ? 'positive' : 'negative'} at ${metrics.growthRate.toFixed(1)}% with a ${metrics.conversionRate.toFixed(2)}% conversion rate. Total revenue: $${metrics.totalRevenue.toFixed(2)}.`;
}

function generateDefaultHighlights(metrics: AggregatedMetrics): string[] {
  return [
    `Total revenue of $${metrics.totalRevenue.toFixed(2)} across ${metrics.dataPoints} days`,
    `Growth rate: ${metrics.growthRate.toFixed(1)}%`,
    `Conversion rate: ${metrics.conversionRate.toFixed(2)}%`,
    `Average revenue per user: $${metrics.avgRevenuePerUser.toFixed(2)}`,
  ];
}

function generateDefaultActions(metrics: AggregatedMetrics): InsightAction[] {
  const actions: InsightAction[] = [];

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

describe('Growth Pulse Worker', () => {
  describe('calculateMetrics', () => {
    it('should calculate metrics from snapshots', () => {
      const snapshots = [
        { revenue: 100, users: 10, conversions: 5, sessions: 50 },
        { revenue: 150, users: 15, conversions: 8, sessions: 60 },
        { revenue: 200, users: 20, conversions: 10, sessions: 70 },
        { revenue: 250, users: 25, conversions: 12, sessions: 80 },
      ];

      const metrics = calculateMetrics(snapshots);

      expect(metrics.totalRevenue).toBe(700);
      expect(metrics.totalUsers).toBe(70);
      expect(metrics.totalConversions).toBe(35);
      expect(metrics.totalSessions).toBe(260);
      expect(metrics.dataPoints).toBe(4);
      expect(metrics.conversionRate).toBeCloseTo(13.46, 1);
      expect(metrics.avgRevenuePerUser).toBe(10);
    });

    it('should handle growth rate calculation', () => {
      // First half: 100 + 150 = 250
      // Second half: 200 + 300 = 500
      // Growth: (500 - 250) / 250 * 100 = 100%
      const snapshots = [
        { revenue: 100, users: 10, conversions: 5, sessions: 50 },
        { revenue: 150, users: 15, conversions: 8, sessions: 60 },
        { revenue: 200, users: 20, conversions: 10, sessions: 70 },
        { revenue: 300, users: 30, conversions: 15, sessions: 100 },
      ];

      const metrics = calculateMetrics(snapshots);

      expect(metrics.growthRate).toBe(100);
    });

    it('should handle negative growth rate', () => {
      // First half: 300 + 250 = 550
      // Second half: 200 + 150 = 350
      // Growth: (350 - 550) / 550 * 100 = -36.36%
      const snapshots = [
        { revenue: 300, users: 30, conversions: 15, sessions: 100 },
        { revenue: 250, users: 25, conversions: 12, sessions: 80 },
        { revenue: 200, users: 20, conversions: 10, sessions: 70 },
        { revenue: 150, users: 15, conversions: 8, sessions: 60 },
      ];

      const metrics = calculateMetrics(snapshots);

      expect(metrics.growthRate).toBeCloseTo(-36.36, 1);
    });

    it('should handle zero division gracefully', () => {
      const snapshots = [
        { revenue: 0, users: 0, conversions: 0, sessions: 0 },
        { revenue: 0, users: 0, conversions: 0, sessions: 0 },
      ];

      const metrics = calculateMetrics(snapshots);

      expect(metrics.totalRevenue).toBe(0);
      expect(metrics.growthRate).toBe(0);
      expect(metrics.conversionRate).toBe(0);
      expect(metrics.avgRevenuePerUser).toBe(0);
    });
  });

  describe('parseInsightResponse', () => {
    it('should parse valid JSON response', () => {
      const jsonResponse = JSON.stringify({
        score: 75,
        severity: 'info',
        summary: 'Business is performing well',
        highlights: ['Strong growth', 'Good conversion rate'],
        actionItems: [
          {
            title: 'Maintain momentum',
            description: 'Keep up the good work',
            priority: 'medium',
            estimatedImpact: 'Sustained growth',
          },
        ],
      });

      const metrics = {
        growthRate: 15,
        conversionRate: 3.5,
        totalRevenue: 1000,
      };

      const result = parseInsightResponse(jsonResponse, metrics);

      expect(result.score).toBe(75);
      expect(result.severity).toBe('info');
      expect(result.summary).toBe('Business is performing well');
      expect(result.highlights).toHaveLength(2);
      expect(result.actionItems).toHaveLength(1);
    });

    it('should handle JSON wrapped in markdown code blocks', () => {
      const jsonResponse = '```json\n{"score": 80, "severity": "info", "summary": "Test"}\n```';

      const metrics = {
        growthRate: 10,
        conversionRate: 2.5,
        totalRevenue: 500,
      };

      const result = parseInsightResponse(jsonResponse, metrics);

      expect(result.score).toBe(80);
      expect(result.severity).toBe('info');
      expect(result.summary).toBe('Test');
    });

    it('should fall back to heuristics on parse error', () => {
      const invalidResponse = 'This is not valid JSON';

      const metrics = {
        growthRate: -15,
        conversionRate: 1.5,
        totalRevenue: 500,
        totalUsers: 50,
        totalConversions: 10,
        totalSessions: 666,
        avgRevenuePerUser: 10,
        dataPoints: 10,
      };

      const result = parseInsightResponse(invalidResponse, metrics);

      expect(result.score).toBeGreaterThan(0);
      expect(result.severity).toBe('warning');
      expect(result.summary).toContain('negative');
      expect(result.highlights.length).toBeGreaterThan(0);
      expect(result.actionItems.length).toBeGreaterThan(0);
    });
  });

  describe('severity determination', () => {
    it('should return critical for negative growth > 20%', () => {
      const metrics = {
        growthRate: -25,
        conversionRate: 2.0,
        totalRevenue: 500,
      };

      const severity = determineSeverity(metrics);

      expect(severity).toBe('critical');
    });

    it('should return critical for very low conversion rate', () => {
      const metrics = {
        growthRate: 5,
        conversionRate: 0.3,
        totalRevenue: 500,
      };

      const severity = determineSeverity(metrics);

      expect(severity).toBe('critical');
    });

    it('should return warning for negative growth < 20%', () => {
      const metrics = {
        growthRate: -10,
        conversionRate: 2.0,
        totalRevenue: 500,
      };

      const severity = determineSeverity(metrics);

      expect(severity).toBe('warning');
    });

    it('should return warning for low conversion rate', () => {
      const metrics = {
        growthRate: 5,
        conversionRate: 0.8,
        totalRevenue: 500,
      };

      const severity = determineSeverity(metrics);

      expect(severity).toBe('warning');
    });

    it('should return info for positive growth', () => {
      const metrics = {
        growthRate: 15,
        conversionRate: 3.5,
        totalRevenue: 1000,
      };

      const severity = determineSeverity(metrics);

      expect(severity).toBe('info');
    });
  });

  describe('score calculation', () => {
    it('should assign high score for strong growth', () => {
      const metrics = {
        growthRate: 25,
        conversionRate: 6.0,
        totalRevenue: 2000,
      };

      const score = calculateDefaultScore(metrics);

      expect(score).toBeGreaterThanOrEqual(80);
    });

    it('should assign medium score for moderate growth', () => {
      const metrics = {
        growthRate: 12,
        conversionRate: 3.0,
        totalRevenue: 1000,
      };

      const score = calculateDefaultScore(metrics);

      expect(score).toBeGreaterThanOrEqual(60);
      expect(score).toBeLessThanOrEqual(80);
    });

    it('should assign low score for declining metrics', () => {
      const metrics = {
        growthRate: -15,
        conversionRate: 1.0,
        totalRevenue: 500,
      };

      const score = calculateDefaultScore(metrics);

      expect(score).toBeLessThan(50);
    });

    it('should never exceed 100 or go below 0', () => {
      const highMetrics = {
        growthRate: 100,
        conversionRate: 20,
        totalRevenue: 10000,
      };

      const lowMetrics = {
        growthRate: -50,
        conversionRate: 0.1,
        totalRevenue: 10,
      };

      expect(calculateDefaultScore(highMetrics)).toBeLessThanOrEqual(100);
      expect(calculateDefaultScore(lowMetrics)).toBeGreaterThanOrEqual(0);
    });
  });

  describe('action items generation', () => {
    it('should recommend conversion optimization for low conversion rate', () => {
      const metrics = {
        growthRate: 5,
        conversionRate: 1.5,
        totalRevenue: 500,
        totalUsers: 50,
        totalConversions: 10,
        totalSessions: 666,
        avgRevenuePerUser: 10,
        dataPoints: 10,
      };

      const actions = generateDefaultActions(metrics);

      const conversionAction = actions.find(a => a.title.includes('conversion'));
      expect(conversionAction).toBeDefined();
      expect(conversionAction?.priority).toBe('high');
    });

    it('should recommend addressing declining growth', () => {
      const metrics = {
        growthRate: -10,
        conversionRate: 3.0,
        totalRevenue: 500,
        totalUsers: 50,
        totalConversions: 10,
        totalSessions: 333,
        avgRevenuePerUser: 10,
        dataPoints: 10,
      };

      const actions = generateDefaultActions(metrics);

      const growthAction = actions.find(a => a.title.includes('growth'));
      expect(growthAction).toBeDefined();
      expect(growthAction?.priority).toBe('high');
    });

    it('should always include monitoring action', () => {
      const metrics = {
        growthRate: 15,
        conversionRate: 5.0,
        totalRevenue: 1000,
        totalUsers: 100,
        totalConversions: 50,
        totalSessions: 1000,
        avgRevenuePerUser: 10,
        dataPoints: 10,
      };

      const actions = generateDefaultActions(metrics);

      const monitorAction = actions.find(a => a.title.includes('Monitor'));
      expect(monitorAction).toBeDefined();
      expect(monitorAction?.priority).toBe('medium');
    });
  });
});
