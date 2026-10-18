const MESSAGES: Record<string, string> = {
  VALID_SYNTAX: 'Email syntax is valid',
  VALID_SMTP_ACCEPTED: 'Mail server accepted the recipient address',
  VALID_DOMAIN_AND_MX: 'Domain exists with valid MX records',
  INVALID_SYNTAX: 'Email syntax is invalid',
  INVALID_DOMAIN: 'Domain is invalid or does not exist',
  NO_MX: 'Domain has no usable mail route',
  DNS_FAILURE: 'DNS lookup failed',
  DNS_TIMEOUT: 'DNS lookup timed out',
  DISPOSABLE_DOMAIN: 'Disposable email domain detected',
  ROLE_EMAIL: 'Role-based email address',
  CATCH_ALL_DOMAIN: 'Domain accepts all recipients (catch-all)',
  SMTP_REJECTED: 'Mail server rejected the recipient address',
  SMTP_TEMPORARY_FAILURE: 'Temporary SMTP failure during verification',
  SMTP_BLOCKED: 'SMTP verification was blocked by the mail server',
  SMTP_TIMEOUT: 'SMTP verification timed out',
  UNKNOWN_MAILBOX: 'Mailbox existence could not be confirmed',
  SMTP_SKIPPED: 'SMTP verification was skipped',
};

export function reasonMessage(code: string): string {
  return MESSAGES[code] ?? code;
}
