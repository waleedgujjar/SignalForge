import { normalizeEmail } from './normalizer.js';
import { validateSyntax } from './syntax-validator.js';
import { validateDomain } from './domain-validator.js';
import { verifyMx } from './mx-verifier.js';
import { getDefaultDisposableProvider } from './disposable-provider.js';
import { detectRoleEmail } from './role-detector.js';
import { detectProviderType } from './provider-detector.js';
import { verifySmtpRecipient, detectCatchAll } from './smtp-verifier.js';
import { scoreRisk } from './risk-scorer.js';
import { scoreConfidence } from './confidence-scorer.js';
import { reasonMessage } from './reason-codes.js';
import {
  loadVerificationConfig,
  type VerificationResult,
  type VerifyEmailOptions,
  type VerificationStatus,
  type SmtpInternalStatus,
  type VerificationMethod,
} from './types.js';

const catchAllCache = new Map<string, { isCatchAll: boolean; expiresAt: number }>();
const CATCH_ALL_TTL_MS = 24 * 60 * 60 * 1000;

export class EmailVerificationEngine {
  async verify(rawEmail: string, options: VerifyEmailOptions = {}): Promise<VerificationResult> {
    const config = loadVerificationConfig();
    const normalized = normalizeEmail(rawEmail);

    if (!normalized.valid) {
      return buildResult({
        normalized,
        status: 'INVALID',
        reasonCode: 'INVALID_SYNTAX',
        syntaxValid: false,
        domainValid: false,
        dnsResolved: false,
        mxFound: false,
        mxRecords: [],
        mxStatus: 'NONE',
        smtpStatus: 'SKIPPED',
        isDisposable: false,
        isRole: false,
        roleType: null,
        isCatchAll: false,
        providerType: 'UNKNOWN',
        verificationMethod: 'LOCAL',
      });
    }

    const syntax = validateSyntax(normalized.normalizedEmail, normalized.localPart, normalized.domain);
    if (!syntax.valid) {
      return buildResult({
        normalized,
        status: 'INVALID',
        reasonCode: syntax.reasonCode,
        syntaxValid: false,
        domainValid: false,
        dnsResolved: false,
        mxFound: false,
        mxRecords: [],
        mxStatus: 'NONE',
        smtpStatus: 'SKIPPED',
        isDisposable: false,
        isRole: false,
        roleType: null,
        isCatchAll: false,
        providerType: detectProviderType(normalized.domain),
        verificationMethod: 'LOCAL',
      });
    }

    const disposableProvider = getDefaultDisposableProvider();
    const isDisposable = disposableProvider.isDisposable(normalized.domain);
    if (isDisposable) {
      return buildResult({
        normalized,
        status: 'DISPOSABLE',
        reasonCode: 'DISPOSABLE_DOMAIN',
        syntaxValid: true,
        domainValid: true,
        dnsResolved: false,
        mxFound: false,
        mxRecords: [],
        mxStatus: 'UNKNOWN',
        smtpStatus: 'SKIPPED',
        isDisposable: true,
        isRole: false,
        roleType: null,
        isCatchAll: false,
        providerType: detectProviderType(normalized.domain),
        verificationMethod: 'LOCAL',
      });
    }

    const role = detectRoleEmail(normalized.localPart);
    const providerType = detectProviderType(normalized.domain);

    const domainResult = await validateDomain(normalized.domain);
    if (domainResult.result === 'DOMAIN_NOT_FOUND' || domainResult.result === 'DOMAIN_INVALID') {
      return buildResult({
        normalized,
        status: 'INVALID',
        reasonCode: 'INVALID_DOMAIN',
        syntaxValid: true,
        domainValid: false,
        dnsResolved: false,
        mxFound: false,
        mxRecords: [],
        mxStatus: 'NONE',
        smtpStatus: 'SKIPPED',
        isDisposable: false,
        isRole: role.isRole,
        roleType: role.roleType,
        isCatchAll: false,
        providerType,
        verificationMethod: 'DNS',
      });
    }

    if (domainResult.result === 'DNS_TIMEOUT' || domainResult.result === 'DNS_ERROR') {
      return buildResult({
        normalized,
        status: 'UNKNOWN',
        reasonCode: domainResult.result === 'DNS_TIMEOUT' ? 'DNS_TIMEOUT' : 'DNS_FAILURE',
        syntaxValid: true,
        domainValid: false,
        dnsResolved: false,
        mxFound: false,
        mxRecords: [],
        mxStatus: 'ERROR',
        smtpStatus: 'SKIPPED',
        isDisposable: false,
        isRole: role.isRole,
        roleType: role.roleType,
        isCatchAll: false,
        providerType,
        verificationMethod: 'DNS',
      });
    }

    const mx = await verifyMx(normalized.domain);
    if (!mx.mxFound) {
      return buildResult({
        normalized,
        status: 'INVALID',
        reasonCode: 'NO_MX',
        syntaxValid: true,
        domainValid: true,
        dnsResolved: domainResult.dnsResolved,
        mxFound: false,
        mxRecords: [],
        mxStatus: mx.mxStatus,
        smtpStatus: 'SKIPPED',
        isDisposable: false,
        isRole: role.isRole,
        roleType: role.roleType,
        isCatchAll: false,
        providerType,
        verificationMethod: 'MX',
      });
    }

    if (mx.mxStatus === 'TIMEOUT' || mx.mxStatus === 'ERROR') {
      return buildResult({
        normalized,
        status: 'UNKNOWN',
        reasonCode: mx.mxStatus === 'TIMEOUT' ? 'DNS_TIMEOUT' : 'DNS_FAILURE',
        syntaxValid: true,
        domainValid: true,
        dnsResolved: domainResult.dnsResolved,
        mxFound: false,
        mxRecords: mx.mxRecords,
        mxStatus: mx.mxStatus,
        smtpStatus: 'SKIPPED',
        isDisposable: false,
        isRole: role.isRole,
        roleType: role.roleType,
        isCatchAll: false,
        providerType,
        verificationMethod: 'MX',
      });
    }

    let smtpStatus: SmtpInternalStatus = 'SKIPPED';
    let isCatchAll = false;
    const smtpEnabled = options.smtpEnabled ?? config.smtpEnabled;

    if (smtpEnabled && mx.mailServer) {
      const smtpResult = await verifySmtpRecipient(normalized.normalizedEmail, mx.mailServer, {
        timeoutMs: config.smtpTimeoutMs,
      });
      smtpStatus = smtpResult.status;

      if (options.catchAllEnabled !== false) {
        isCatchAll = await getCatchAllCached(normalized.domain, mx.mailServer, config.smtpTimeoutMs);
      }
    }

    let status: VerificationStatus;
    let reasonCode: string;

    if (role.isRole) {
      status = 'ROLE_BASED';
      reasonCode = 'ROLE_EMAIL';
    } else if (isCatchAll) {
      status = 'RISKY';
      reasonCode = 'CATCH_ALL_DOMAIN';
    } else if (smtpStatus === 'REJECTED') {
      status = 'INVALID';
      reasonCode = 'SMTP_REJECTED';
    } else if (smtpStatus === 'TIMEOUT') {
      status = 'UNKNOWN';
      reasonCode = 'SMTP_TIMEOUT';
    } else if (smtpStatus === 'BLOCKED') {
      status = 'UNKNOWN';
      reasonCode = 'SMTP_BLOCKED';
    } else if (smtpStatus === 'TEMPORARY_FAILURE') {
      status = 'UNKNOWN';
      reasonCode = 'SMTP_TEMPORARY_FAILURE';
    } else if (smtpStatus === 'ACCEPTED') {
      status = 'VERIFIED';
      reasonCode = 'VALID_SMTP_ACCEPTED';
    } else if (mx.mxFound) {
      status = 'VERIFIED';
      reasonCode = 'VALID_DOMAIN_AND_MX';
    } else {
      status = 'UNKNOWN';
      reasonCode = 'UNKNOWN_MAILBOX';
    }

    const verificationMethod: VerificationMethod =
      smtpStatus !== 'SKIPPED' ? 'COMBINED' : mx.mxFound ? 'MX' : 'DNS';

    return buildResult({
      normalized,
      status,
      reasonCode,
      syntaxValid: true,
      domainValid: true,
      dnsResolved: domainResult.dnsResolved,
      mxFound: mx.mxFound,
      mxRecords: mx.mxRecords,
      mxStatus: mx.mxStatus,
      smtpStatus,
      isDisposable: false,
      isRole: role.isRole,
      roleType: role.roleType,
      isCatchAll,
      providerType,
      verificationMethod,
    });
  }
}

async function getCatchAllCached(domain: string, mailServer: string, timeoutMs: number): Promise<boolean> {
  const cached = catchAllCache.get(domain);
  if (cached && cached.expiresAt > Date.now()) return cached.isCatchAll;
  const isCatchAll = await detectCatchAll(domain, mailServer, { timeoutMs });
  catchAllCache.set(domain, { isCatchAll, expiresAt: Date.now() + CATCH_ALL_TTL_MS });
  return isCatchAll;
}

function buildResult(input: {
  normalized: ReturnType<typeof normalizeEmail>;
  status: VerificationStatus;
  reasonCode: string;
  syntaxValid: boolean;
  domainValid: boolean;
  dnsResolved: boolean;
  mxFound: boolean;
  mxRecords: VerificationResult['mxRecords'];
  mxStatus: string;
  smtpStatus: SmtpInternalStatus;
  isDisposable: boolean;
  isRole: boolean;
  roleType: string | null;
  isCatchAll: boolean;
  providerType: VerificationResult['providerType'];
  verificationMethod: VerificationMethod;
}): VerificationResult {
  const risk = scoreRisk({
    status: input.status,
    syntaxValid: input.syntaxValid,
    mxFound: input.mxFound,
    isDisposable: input.isDisposable,
    isRole: input.isRole,
    isCatchAll: input.isCatchAll,
    smtpStatus: input.smtpStatus,
  });

  const confidenceScore = scoreConfidence({
    syntaxValid: input.syntaxValid,
    domainValid: input.domainValid,
    dnsResolved: input.dnsResolved,
    mxFound: input.mxFound,
    smtpStatus: input.smtpStatus,
    isDisposable: input.isDisposable,
    isCatchAll: input.isCatchAll,
    isRole: input.isRole,
  });

  const legacyScore = Math.max(0, Math.min(100, confidenceScore));

  return {
    email: input.normalized.normalizedEmail,
    originalEmail: input.normalized.originalEmail,
    normalizedEmail: input.normalized.normalizedEmail,
    status: input.status,
    score: legacyScore,
    riskScore: risk.riskScore,
    riskLevel: risk.riskLevel,
    confidenceScore,
    reason: reasonMessage(input.reasonCode),
    reasonCode: input.reasonCode,
    domain: input.normalized.domain,
    mxStatus: input.mxStatus,
    syntaxValid: input.syntaxValid,
    domainValid: input.domainValid,
    dnsResolved: input.dnsResolved,
    mxFound: input.mxFound,
    mxRecords: input.mxRecords,
    smtpStatus: input.smtpStatus,
    isDisposable: input.isDisposable,
    isRole: input.isRole,
    roleType: input.roleType,
    isCatchAll: input.isCatchAll,
    providerType: input.providerType,
    verificationMethod: input.verificationMethod,
    riskFactors: risk.riskFactors,
    verificationVersion: 'v1',
  };
}

export const emailVerificationEngine = new EmailVerificationEngine();
