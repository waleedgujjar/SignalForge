import { normalizeEmail } from './normalizer.js';
import { validateSyntax } from './syntax-validator.js';
import { validateDomain } from './domain-validator.js';
import { verifyMx } from './mx-verifier.js';
import { getDefaultDisposableProvider } from './disposable-provider.js';
import { detectRoleEmail } from './role-detector.js';
import { detectProviderType } from './provider-detector.js';
import { verifySmtpRecipient, isSmtpUnavailable, type SmtpVerifyResult } from './smtp-verifier.js';
import { scoreRisk } from './risk-scorer.js';
import { scoreConfidence } from './confidence-scorer.js';
import { reasonMessage } from './reason-codes.js';
import {
  loadVerificationConfig,
  type VerificationCheck,
  type VerificationResult,
  type VerifyEmailOptions,
  type VerificationStatus,
  type SmtpInternalStatus,
  type VerificationMethod,
} from './types.js';

export const VERIFICATION_VERSION = 'v2';

const catchAllCache = new Map<string, { isCatchAll: boolean; expiresAt: number }>();
const CATCH_ALL_TTL_MS = 24 * 60 * 60 * 1000;

export function resetCatchAllCacheForTests(): void {
  catchAllCache.clear();
}

type Normalized = ReturnType<typeof normalizeEmail>;

interface Evidence {
  normalized: Normalized;
  checks: VerificationCheck[];
  syntaxValid: boolean;
  domainValid: boolean;
  dnsResolved: boolean;
  mxFound: boolean;
  mxRecords: VerificationResult['mxRecords'];
  mxStatus: string;
  smtpStatus: SmtpInternalStatus;
  smtpResponse: string | null;
  isDisposable: boolean;
  isRole: boolean;
  roleType: string | null;
  isCatchAll: boolean;
  providerType: VerificationResult['providerType'];
  verificationMethod: VerificationMethod;
}

export class EmailVerificationEngine {
  async verify(rawEmail: string, options: VerifyEmailOptions = {}): Promise<VerificationResult> {
    const config = loadVerificationConfig();
    const normalized = normalizeEmail(rawEmail);
    const ev: Evidence = {
      normalized,
      checks: [],
      syntaxValid: false,
      domainValid: false,
      dnsResolved: false,
      mxFound: false,
      mxRecords: [],
      mxStatus: 'NONE',
      smtpStatus: 'SKIPPED',
      smtpResponse: null,
      isDisposable: false,
      isRole: false,
      roleType: null,
      isCatchAll: false,
      providerType: normalized.valid ? detectProviderType(normalized.domain) : 'UNKNOWN',
      verificationMethod: 'LOCAL',
    };

    // 1. Syntax
    const syntax = normalized.valid
      ? validateSyntax(normalized.normalizedEmail, normalized.localPart, normalized.domain)
      : { valid: false, reasonCode: 'INVALID_SYNTAX' };
    if (!syntax.valid) {
      ev.checks.push({ check: 'syntax', outcome: 'fail', detail: 'Address is not a well-formed email' });
      return finish(ev, 'INVALID', syntax.reasonCode ?? 'INVALID_SYNTAX');
    }
    ev.syntaxValid = true;
    ev.checks.push({ check: 'syntax', outcome: 'pass', detail: 'Address is well-formed' });

    // 2. Disposable provider
    if (getDefaultDisposableProvider().isDisposable(normalized.domain)) {
      ev.isDisposable = true;
      ev.domainValid = true;
      ev.checks.push({ check: 'disposable', outcome: 'fail', detail: `${normalized.domain} is a disposable/temporary inbox provider` });
      return finish(ev, 'DISPOSABLE', 'DISPOSABLE_DOMAIN');
    }
    ev.checks.push({ check: 'disposable', outcome: 'pass', detail: 'Not a known disposable provider' });

    const role = detectRoleEmail(normalized.localPart);
    ev.isRole = role.isRole;
    ev.roleType = role.roleType;
    ev.checks.push(
      role.isRole
        ? { check: 'role', outcome: 'warn', detail: `"${role.roleType}@" is a shared/role mailbox, not a person` }
        : { check: 'role', outcome: 'pass', detail: 'Personal (non-role) address' },
    );

    // 3. Domain
    ev.verificationMethod = 'DNS';
    const domain = await validateDomain(normalized.domain);
    ev.dnsResolved = domain.dnsResolved;
    if (domain.result === 'DOMAIN_NOT_FOUND' || domain.result === 'DOMAIN_INVALID') {
      ev.checks.push({ check: 'domain', outcome: 'fail', detail: `${normalized.domain} does not exist in DNS` });
      return finish(ev, 'INVALID', 'INVALID_DOMAIN');
    }
    if (domain.result === 'DNS_TIMEOUT' || domain.result === 'DNS_ERROR') {
      ev.checks.push({ check: 'domain', outcome: 'warn', detail: 'DNS lookups failed on every resolver; try again later' });
      return finish(ev, 'UNKNOWN', domain.result === 'DNS_TIMEOUT' ? 'DNS_TIMEOUT' : 'DNS_FAILURE');
    }
    ev.domainValid = true;
    ev.checks.push({ check: 'domain', outcome: 'pass', detail: `${normalized.domain} exists` });

    // 4. Mail route
    ev.verificationMethod = 'MX';
    const mx = await verifyMx(normalized.domain);
    ev.mxRecords = mx.mxRecords;
    ev.mxStatus = mx.mxStatus;
    if (mx.mxStatus === 'TIMEOUT' || mx.mxStatus === 'ERROR') {
      ev.checks.push({ check: 'mx', outcome: 'warn', detail: 'MX lookup failed on every resolver; try again later' });
      return finish(ev, 'UNKNOWN', mx.mxStatus === 'TIMEOUT' ? 'DNS_TIMEOUT' : 'DNS_FAILURE');
    }
    if (!mx.mxFound) {
      ev.checks.push({
        check: 'mx',
        outcome: 'fail',
        detail: mx.mxStatus === 'NULL_MX' ? 'Domain publishes a null MX: it accepts no email' : 'Domain has no MX or address records to deliver to',
      });
      return finish(ev, 'INVALID', mx.mxStatus === 'NULL_MX' ? 'NULL_MX' : 'NO_MX');
    }
    ev.mxFound = true;
    ev.checks.push({ check: 'mx', outcome: 'pass', detail: `Mail handled by ${mx.mailServers.slice(0, 2).join(', ')}` });

    // 5. Mailbox (SMTP RCPT probe)
    const smtpEnabled = options.smtpEnabled ?? config.smtpEnabled;
    if (!smtpEnabled) {
      ev.checks.push({ check: 'smtp', outcome: 'skip', detail: 'Mailbox check is disabled in configuration' });
      return finish(ev, role.isRole ? 'ROLE_BASED' : 'UNKNOWN', role.isRole ? 'ROLE_EMAIL' : 'SMTP_SKIPPED');
    }
    if (isSmtpUnavailable()) {
      ev.smtpStatus = 'UNAVAILABLE';
      ev.checks.push({ check: 'smtp', outcome: 'skip', detail: 'Outbound port 25 is unreachable from this server, so mailboxes cannot be probed' });
      return finish(ev, role.isRole ? 'ROLE_BASED' : 'UNKNOWN', role.isRole ? 'ROLE_EMAIL' : 'SMTP_UNAVAILABLE');
    }

    const cachedCatchAll = catchAllCache.get(normalized.domain);
    const knownCatchAll = cachedCatchAll && cachedCatchAll.expiresAt > Date.now() ? cachedCatchAll.isCatchAll : undefined;
    const smtp: SmtpVerifyResult = await verifySmtpRecipient(normalized.normalizedEmail, mx.mailServers, {
      timeoutMs: config.smtpTimeoutMs,
      probeCatchAll: options.catchAllEnabled !== false && knownCatchAll === undefined,
    });
    ev.verificationMethod = 'COMBINED';
    ev.smtpStatus = smtp.status;
    ev.smtpResponse = smtp.response ?? null;

    if (smtp.catchAll !== undefined) {
      catchAllCache.set(normalized.domain, { isCatchAll: smtp.catchAll, expiresAt: Date.now() + CATCH_ALL_TTL_MS });
    }
    const isCatchAll = smtp.status === 'ACCEPTED' && (smtp.catchAll ?? knownCatchAll ?? false);
    ev.isCatchAll = isCatchAll;

    switch (smtp.status) {
      case 'REJECTED':
        ev.checks.push({ check: 'smtp', outcome: 'fail', detail: `Mail server says the mailbox does not exist (${smtp.response ?? 'rejected'})` });
        return finish(ev, 'INVALID', 'SMTP_REJECTED');
      case 'MAILBOX_FULL':
        ev.checks.push({ check: 'smtp', outcome: 'warn', detail: `Mailbox exists but is full or over quota (${smtp.response ?? ''})` });
        return finish(ev, 'RISKY', 'MAILBOX_FULL');
      case 'ACCEPTED':
        ev.checks.push({ check: 'smtp', outcome: 'pass', detail: `Mail server accepted the recipient (${smtp.response ?? '250'})` });
        if (isCatchAll) {
          ev.checks.push({ check: 'catch_all', outcome: 'warn', detail: 'Server also accepts made-up addresses, so acceptance does not prove this mailbox exists' });
          return finish(ev, role.isRole ? 'ROLE_BASED' : 'CATCH_ALL', role.isRole ? 'ROLE_EMAIL' : 'CATCH_ALL_DOMAIN');
        }
        ev.checks.push({ check: 'catch_all', outcome: 'pass', detail: 'Server rejects made-up addresses, so acceptance is meaningful' });
        return finish(ev, role.isRole ? 'ROLE_BASED' : 'VERIFIED', role.isRole ? 'ROLE_EMAIL' : 'VALID_SMTP_ACCEPTED');
      default: {
        // The mailbox could not be confirmed either way. This is not a negative
        // signal about the address; it says nothing about it.
        const reasonCode = SMTP_REASON[smtp.status] ?? 'UNKNOWN_MAILBOX';
        ev.checks.push({ check: 'smtp', outcome: 'skip', detail: `${reasonMessage(reasonCode)}${smtp.response ? ` (${smtp.response})` : ''}` });
        return finish(ev, role.isRole ? 'ROLE_BASED' : 'UNKNOWN', role.isRole ? 'ROLE_EMAIL' : reasonCode);
      }
    }
  }
}

const SMTP_REASON: Partial<Record<SmtpInternalStatus, string>> = {
  BLOCKED: 'SMTP_BLOCKED',
  TIMEOUT: 'SMTP_TIMEOUT',
  UNAVAILABLE: 'SMTP_UNAVAILABLE',
  TEMPORARY_FAILURE: 'SMTP_TEMPORARY_FAILURE',
  UNKNOWN: 'UNKNOWN_MAILBOX',
};

function finish(ev: Evidence, status: VerificationStatus, reasonCode: string): VerificationResult {
  const risk = scoreRisk({
    status,
    syntaxValid: ev.syntaxValid,
    mxFound: ev.mxFound,
    isDisposable: ev.isDisposable,
    isRole: ev.isRole,
    isCatchAll: ev.isCatchAll,
    smtpStatus: ev.smtpStatus,
  });

  const confidenceScore = scoreConfidence({
    syntaxValid: ev.syntaxValid,
    domainValid: ev.domainValid,
    dnsResolved: ev.dnsResolved,
    mxFound: ev.mxFound,
    smtpStatus: ev.smtpStatus,
    isDisposable: ev.isDisposable,
    isCatchAll: ev.isCatchAll,
    isRole: ev.isRole,
  });

  return {
    email: ev.normalized.normalizedEmail,
    originalEmail: ev.normalized.originalEmail,
    normalizedEmail: ev.normalized.normalizedEmail,
    status,
    score: confidenceScore,
    riskScore: risk.riskScore,
    riskLevel: risk.riskLevel,
    confidenceScore,
    reason: reasonMessage(reasonCode),
    reasonCode,
    domain: ev.normalized.domain,
    mxStatus: ev.mxStatus,
    syntaxValid: ev.syntaxValid,
    domainValid: ev.domainValid,
    dnsResolved: ev.dnsResolved,
    mxFound: ev.mxFound,
    mxRecords: ev.mxRecords,
    smtpStatus: ev.smtpStatus,
    isDisposable: ev.isDisposable,
    isRole: ev.isRole,
    roleType: ev.roleType,
    isCatchAll: ev.isCatchAll,
    providerType: ev.providerType,
    verificationMethod: ev.verificationMethod,
    riskFactors: risk.riskFactors,
    checks: ev.checks,
    smtpResponse: ev.smtpResponse,
    verificationVersion: VERIFICATION_VERSION,
  };
}

export const emailVerificationEngine = new EmailVerificationEngine();
