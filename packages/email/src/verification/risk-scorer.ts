import type { RiskLevel, SmtpInternalStatus, VerificationStatus } from './types.js';

export interface RiskInput {
  status: VerificationStatus;
  syntaxValid: boolean;
  mxFound: boolean;
  isDisposable: boolean;
  isRole: boolean;
  isCatchAll: boolean;
  smtpStatus: SmtpInternalStatus;
}

export interface RiskOutput {
  riskScore: number;
  riskLevel: RiskLevel;
  riskFactors: string[];
}

export function scoreRisk(input: RiskInput): RiskOutput {
  const factors: string[] = [];
  let score = 0;

  if (input.isDisposable) {
    score += 100;
    factors.push('DISPOSABLE_DOMAIN');
  }
  if (!input.syntaxValid) {
    score += 100;
    factors.push('INVALID_SYNTAX');
  }
  if (!input.mxFound && input.syntaxValid) {
    score += 100;
    factors.push('NO_MX');
  }
  if (input.smtpStatus === 'REJECTED') {
    score += 100;
    factors.push('SMTP_REJECTED');
  }
  if (input.isCatchAll) {
    score += 30;
    factors.push('CATCH_ALL');
  }
  if (input.isRole) {
    score += 20;
    factors.push('ROLE_EMAIL');
  }
  if (input.smtpStatus === 'BLOCKED') {
    score += 20;
    factors.push('SMTP_BLOCKED');
  }
  if (input.smtpStatus === 'TEMPORARY_FAILURE') {
    score += 15;
    factors.push('SMTP_TEMPORARY');
  }
  if (input.smtpStatus === 'TIMEOUT' || input.smtpStatus === 'UNKNOWN') {
    score += 20;
    factors.push('SMTP_UNCERTAIN');
  }
  if (input.status === 'UNKNOWN') {
    score += 15;
    factors.push('UNKNOWN_STATUS');
  }
  if (input.status === 'RISKY') {
    score += 25;
    factors.push('RISKY_STATUS');
  }

  score = Math.min(100, score);
  return {
    riskScore: score,
    riskLevel: toRiskLevel(score),
    riskFactors: factors,
  };
}

function toRiskLevel(score: number): RiskLevel {
  if (score <= 20) return 'LOW';
  if (score <= 50) return 'MEDIUM';
  if (score <= 75) return 'HIGH';
  return 'VERY_HIGH';
}
