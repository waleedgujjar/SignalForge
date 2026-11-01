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

/**
 * Bounce risk of sending to the address. Only evidence raises the score: an
 * SMTP check that could not run (port blocked, timeout, greylisting) adds a
 * small uncertainty penalty but never makes a clean address look dangerous.
 */
export function scoreRisk(input: RiskInput): RiskOutput {
  const factors: string[] = [];
  let score = 0;
  const add = (points: number, factor: string) => {
    score += points;
    factors.push(factor);
  };

  if (input.isDisposable) add(100, 'DISPOSABLE_DOMAIN');
  if (!input.syntaxValid) add(100, 'INVALID_SYNTAX');
  if (input.syntaxValid && !input.mxFound && input.status === 'INVALID') add(100, 'NO_MX');
  if (input.smtpStatus === 'REJECTED') add(100, 'SMTP_REJECTED');
  if (input.smtpStatus === 'MAILBOX_FULL') add(55, 'MAILBOX_FULL');
  if (input.isCatchAll) add(35, 'CATCH_ALL');
  if (input.isRole) add(25, 'ROLE_EMAIL');
  if (input.smtpStatus === 'BLOCKED') add(10, 'SMTP_BLOCKED');
  if (input.smtpStatus === 'TEMPORARY_FAILURE') add(10, 'SMTP_TEMPORARY');
  if (input.smtpStatus === 'TIMEOUT' || input.smtpStatus === 'UNKNOWN' || input.smtpStatus === 'UNAVAILABLE') {
    add(10, 'SMTP_UNCONFIRMED');
  }
  if (input.status === 'UNKNOWN' && !input.mxFound) add(20, 'DNS_UNCONFIRMED');

  score = Math.min(100, score);
  return { riskScore: score, riskLevel: toRiskLevel(score), riskFactors: factors };
}

function toRiskLevel(score: number): RiskLevel {
  if (score <= 20) return 'LOW';
  if (score <= 50) return 'MEDIUM';
  if (score <= 75) return 'HIGH';
  return 'VERY_HIGH';
}
