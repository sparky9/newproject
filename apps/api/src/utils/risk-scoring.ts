import { z } from 'zod';

export const ActionPayloadSchema = z.record(z.unknown());

export type ActionPayload = z.infer<typeof ActionPayloadSchema>;

export interface RiskAssessmentInput {
  source: string;
  payload: ActionPayload;
}

export interface RiskAssessmentResult {
  score: number;
  level: 'low' | 'medium' | 'high';
  reasons: string[];
}

const HIGH_IMPACT_TERMS = ['mass', 'global', 'all tenants', 'all contacts'];
const SENSITIVE_DATA_TERMS = ['pii', 'phi', 'financial', 'sensitive'];

export function calculateActionRisk(input: RiskAssessmentInput): RiskAssessmentResult {
  const { source, payload } = input;

  let score = 20;
  const reasons: string[] = [];

  const impact = typeof payload.impact === 'string' ? payload.impact.toLowerCase() : null;
  const scope = typeof payload.scope === 'string' ? payload.scope.toLowerCase() : null;
  const moduleSlug = typeof payload.moduleSlug === 'string' ? payload.moduleSlug : undefined;
  const capability = typeof payload.capability === 'string' ? payload.capability : undefined;

  if (moduleSlug?.includes('finance') || moduleSlug?.includes('billing')) {
    score += 20;
    reasons.push('module finance-heavy');
  }

  if (capability?.includes('delete') || capability?.includes('sync')) {
    score += 15;
    reasons.push('capability modifies data');
  }

  if (impact && HIGH_IMPACT_TERMS.some(term => impact.includes(term))) {
    score += 25;
    reasons.push('high described impact');
  }

  if (scope && HIGH_IMPACT_TERMS.some(term => scope.includes(term))) {
    score += 15;
    reasons.push('broad scope');
  }

  const connectors = Array.isArray(payload.connectors) ? payload.connectors.length : 0;
  if (connectors > 0) {
    score += Math.min(connectors * 5, 20);
    reasons.push('multiple connectors affected');
  }

  const riskTag = typeof payload.risk === 'string' ? payload.risk.toLowerCase() : undefined;
  if (riskTag === 'high') {
    score += 25;
    reasons.push('module flagged high risk');
  } else if (riskTag === 'medium') {
    score += 10;
    reasons.push('module flagged medium risk');
  }

  const flags = Array.isArray(payload.flags) ? payload.flags : [];
  const includesSensitiveData = flags.some(flag => typeof flag === 'string' && SENSITIVE_DATA_TERMS.some(term => flag.toLowerCase().includes(term)));
  if (includesSensitiveData) {
    score += 20;
    reasons.push('touches sensitive data');
  }

  const sourceLower = source.toLowerCase();
  if (sourceLower.includes('automated')) {
    score += 10;
    reasons.push('automated source');
  }

  score = Math.max(0, Math.min(score, 100));

  let level: RiskAssessmentResult['level'] = 'medium';
  if (score <= 33) {
    level = 'low';
  } else if (score >= 67) {
    level = 'high';
  }

  return {
    score,
    level,
    reasons,
  };
}
