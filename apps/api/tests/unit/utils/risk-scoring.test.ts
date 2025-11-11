import { describe, expect, it } from 'vitest';
import { calculateActionRisk } from '../../../src/utils/risk-scoring.js';

const basePayload = {
  moduleSlug: 'growth-pulse',
  capability: 'send-email',
  impact: 'targeted cohort',
  scope: 'selected contacts',
};

describe('calculateActionRisk', () => {
  it('returns low risk for lightweight actions', () => {
    const result = calculateActionRisk({
      source: 'module:light-touch',
      payload: basePayload,
    });

    expect(result.level).toBe('low');
    expect(result.score).toBeGreaterThanOrEqual(20);
    expect(result.score).toBeLessThan(34);
    expect(result.reasons).toHaveLength(0);
  });

  it('elevates risk for finance modules touching sensitive data', () => {
    const result = calculateActionRisk({
      source: 'module:finance-ops',
      payload: {
        ...basePayload,
        moduleSlug: 'finance-audit',
        flags: ['contains PII records'],
        connectors: ['stripe', 'netsuite'],
      },
    });

    expect(result.level).toBe('high');
    expect(result.score).toBeGreaterThanOrEqual(67);
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        'module finance-heavy',
        'touches sensitive data',
        'multiple connectors affected',
      ])
    );
  });

  it('considers declared risk tags and impact keywords', () => {
    const result = calculateActionRisk({
      source: 'automated-orchestrator',
      payload: {
        ...basePayload,
        risk: 'high',
        impact: 'Mass outreach to all tenants',
        scope: 'GLOBAL sync',
      },
    });

    expect(result.level).toBe('high');
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        'module flagged high risk',
        'high described impact',
        'broad scope',
        'automated source',
      ])
    );
  });
});
