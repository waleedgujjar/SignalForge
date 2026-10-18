import { checkSuppression, type SuppressionEntry } from './suppression-engine.js';
import type { VerificationResult } from './verification-service.js';
import { shouldExcludeByVerification } from './verification/eligibility.js';
import { selectMailbox, type MailboxCandidate, type RotationStrategy } from './rotation-engine.js';
import { resolveVariables, type LeadVariableContext } from './variable-resolver.js';
import { parseSpintax } from './spintax-parser.js';

export type PolicyDecision = 'ALLOW_SEND' | 'BLOCK_SEND' | 'DEFER';

export interface SendingWindowConfig {
  startTime?: string;
  endTime?: string;
  timezone?: string;
  days?: number[];
  startHour?: number;
  endHour?: number;
}

export interface PolicyCheckInput {
  campaignStatus: string;
  campaignLeadStatus: string;
  mailboxStatus?: string;
  leadEmail: string;
  subjectTemplate: string;
  bodyTemplate: string;
  variableContext: LeadVariableContext;
  suppressions: SuppressionEntry[];
  verification?: VerificationResult | null;
  verificationPolicy?: {
    excludeInvalid?: boolean;
    excludeDisposable?: boolean;
    excludeHighRisk?: boolean;
    minScore?: number;
    blockUnverified?: boolean;
    allowRoleEmails?: boolean;
    blockRisky?: boolean;
    blockUnknown?: boolean;
  };
  mailboxes: MailboxCandidate[];
  rotationStrategy: RotationStrategy;
  sendingWindow?: SendingWindowConfig;
  isWithinWindow?: boolean;
  skipRotation?: boolean;
  preselectedMailboxId?: string;
  spintaxOptions?: { deterministic?: boolean; seed?: number };
}

export interface PolicyCheckResult {
  decision: PolicyDecision;
  reason?: string;
  mailboxId?: string;
  renderedSubject?: string;
  renderedBody?: string;
  rotationStrategy?: RotationStrategy;
}

export function evaluateSendingPolicy(input: PolicyCheckInput): PolicyCheckResult {
  if (input.campaignStatus === 'PAUSED') {
    return { decision: 'BLOCK_SEND', reason: 'SEND_BLOCKED_CAMPAIGN_PAUSED' };
  }

  if (input.campaignLeadStatus === 'PAUSED') {
    return { decision: 'BLOCK_SEND', reason: 'SEND_BLOCKED_LEAD_PAUSED' };
  }

  if (input.mailboxStatus === 'PAUSED') {
    return { decision: 'BLOCK_SEND', reason: 'SEND_BLOCKED_MAILBOX_PAUSED' };
  }

  const suppression = checkSuppression(input.leadEmail, input.suppressions);
  if (suppression.suppressed) {
    return {
      decision: 'BLOCK_SEND',
      reason: `SEND_BLOCKED_SUPPRESSION_${suppression.reason ?? 'MANUAL'}`,
    };
  }

  if (input.verificationPolicy) {
    const fullVerification = input.verification
      ? ({
          ...input.verification,
          originalEmail: input.verification.email,
          normalizedEmail: input.verification.email.toLowerCase(),
          riskScore: (input.verification as VerificationResult).riskScore ?? 0,
          riskLevel: (input.verification as VerificationResult).riskLevel ?? 'LOW',
          confidenceScore: (input.verification as VerificationResult).confidenceScore ?? 0,
          reasonCode: (input.verification as VerificationResult).reasonCode ?? '',
          syntaxValid: true,
          domainValid: true,
          dnsResolved: true,
          mxFound: true,
          mxRecords: [],
          smtpStatus: 'SKIPPED',
          isDisposable: input.verification.status === 'DISPOSABLE',
          isRole: input.verification.status === 'ROLE_BASED',
          roleType: null,
          isCatchAll: false,
          providerType: 'UNKNOWN',
          verificationMethod: 'LOCAL',
          riskFactors: [],
          verificationVersion: 'v1',
        } as VerificationResult)
      : null;

    const exclusion = shouldExcludeByVerification(fullVerification, input.verificationPolicy);
    if (exclusion.excluded) {
      return {
        decision: 'BLOCK_SEND',
        reason: `SEND_BLOCKED_VERIFICATION_${exclusion.reason ?? input.verification?.status ?? 'UNVERIFIED'}`,
      };
    }
  }

  const subjectVars = resolveVariables(input.subjectTemplate, input.variableContext);
  const bodyVars = resolveVariables(input.bodyTemplate, input.variableContext);

  if (subjectVars.hasUnresolved || bodyVars.hasUnresolved) {
    const missing = [...subjectVars.missingVariables, ...bodyVars.missingVariables];
    return {
      decision: 'BLOCK_SEND',
      reason: `SEND_BLOCKED_UNRESOLVED_VARIABLES: ${missing.join(', ')}`,
    };
  }

  const subjectSpintax = parseSpintax(subjectVars.text, input.spintaxOptions);
  const bodySpintax = parseSpintax(bodyVars.text, input.spintaxOptions);

  if (!subjectSpintax.valid || !bodySpintax.valid) {
    return {
      decision: 'BLOCK_SEND',
      reason: `SEND_BLOCKED_MALFORMED_SPINTAX: ${subjectSpintax.error ?? bodySpintax.error}`,
    };
  }

  if (input.isWithinWindow === false) {
    return { decision: 'DEFER', reason: 'SEND_DEFERRED_OUTSIDE_WINDOW' };
  }

  if (
    input.isWithinWindow === undefined &&
    input.sendingWindow &&
    !isWithinLegacyWindow(input.sendingWindow)
  ) {
    return { decision: 'DEFER', reason: 'SEND_DEFERRED_OUTSIDE_WINDOW' };
  }

  if (input.skipRotation) {
    if (input.preselectedMailboxId) {
      return {
        decision: 'ALLOW_SEND',
        mailboxId: input.preselectedMailboxId,
        renderedSubject: subjectSpintax.text,
        renderedBody: bodySpintax.text,
        rotationStrategy: input.rotationStrategy,
      };
    }
    return { decision: 'BLOCK_SEND', reason: 'SEND_BLOCKED_NO_MAILBOX' };
  }

  const rotation = selectMailbox(input.mailboxes, input.rotationStrategy);
  if (!rotation.mailboxId) {
    return {
      decision: 'BLOCK_SEND',
      reason: rotation.reason ?? 'SEND_BLOCKED_NO_MAILBOX',
    };
  }

  return {
    decision: 'ALLOW_SEND',
    mailboxId: rotation.mailboxId,
    renderedSubject: subjectSpintax.text,
    renderedBody: bodySpintax.text,
    rotationStrategy: input.rotationStrategy,
  };
}

function isWithinLegacyWindow(window: SendingWindowConfig): boolean {
  if (window.startHour === undefined || window.endHour === undefined) return true;
  const now = new Date();
  const hour = now.getUTCHours();
  if (window.startHour <= window.endHour) {
    return hour >= window.startHour && hour < window.endHour;
  }
  return hour >= window.startHour || hour < window.endHour;
}
