export type VerificationStatus =
  | 'VERIFIED'
  | 'RISKY'
  | 'INVALID'
  | 'UNKNOWN'
  | 'DISPOSABLE'
  | 'ROLE_BASED';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
export type ProviderType = 'FREE' | 'BUSINESS' | 'UNKNOWN';
export type SmtpInternalStatus =
  | 'ACCEPTED'
  | 'REJECTED'
  | 'TEMPORARY_FAILURE'
  | 'BLOCKED'
  | 'TIMEOUT'
  | 'UNKNOWN'
  | 'SKIPPED';

export type DomainCheckResult =
  | 'DOMAIN_VALID'
  | 'DOMAIN_INVALID'
  | 'DNS_ERROR'
  | 'DNS_TIMEOUT'
  | 'DOMAIN_NOT_FOUND'
  | 'UNKNOWN';

export type VerificationMethod = 'LOCAL' | 'DNS' | 'MX' | 'SMTP' | 'COMBINED' | 'EXTERNAL_PROVIDER';

export interface MxRecord {
  exchange: string;
  priority: number;
}

export interface VerificationResult {
  email: string;
  originalEmail: string;
  normalizedEmail: string;
  status: VerificationStatus;
  score: number;
  riskScore: number;
  riskLevel: RiskLevel;
  confidenceScore: number;
  reason: string;
  reasonCode: string;
  domain: string;
  mxStatus: string;
  syntaxValid: boolean;
  domainValid: boolean;
  dnsResolved: boolean;
  mxFound: boolean;
  mxRecords: MxRecord[];
  smtpStatus: SmtpInternalStatus;
  isDisposable: boolean;
  isRole: boolean;
  roleType: string | null;
  isCatchAll: boolean;
  providerType: ProviderType;
  verificationMethod: VerificationMethod;
  riskFactors: string[];
  verificationVersion: string;
}

export interface VerifyEmailOptions {
  forceRecheck?: boolean;
  smtpEnabled?: boolean;
  catchAllEnabled?: boolean;
  workspaceId?: string;
}

export interface VerificationConfig {
  enabled: boolean;
  cacheTtlDays: number;
  smtpEnabled: boolean;
  smtpTimeoutMs: number;
  smtpMaxRetries: number;
  maxConcurrency: number;
  perDomainLimit: number;
  maxBulkSize: number;
}

export function loadVerificationConfig(): VerificationConfig {
  return {
    enabled: process.env.EMAIL_VERIFICATION_ENABLED !== 'false',
    cacheTtlDays: Number(process.env.EMAIL_VERIFICATION_CACHE_TTL_DAYS ?? 7),
    smtpEnabled: process.env.EMAIL_VERIFICATION_SMTP_ENABLED !== 'false',
    smtpTimeoutMs: Number(process.env.EMAIL_VERIFICATION_SMTP_TIMEOUT_MS ?? 10000),
    smtpMaxRetries: Number(process.env.EMAIL_VERIFICATION_SMTP_MAX_RETRIES ?? 2),
    maxConcurrency: Number(process.env.EMAIL_VERIFICATION_MAX_CONCURRENCY ?? 10),
    perDomainLimit: Number(process.env.EMAIL_VERIFICATION_PER_DOMAIN_LIMIT ?? 5),
    maxBulkSize: Number(process.env.EMAIL_VERIFICATION_MAX_BULK_SIZE ?? 10000),
  };
}
