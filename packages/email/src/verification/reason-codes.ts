const MESSAGES: Record<string, string> = {
  VALID_SYNTAX: 'Email syntax is valid',
  VALID_SMTP_ACCEPTED: 'Mail server confirmed the mailbox exists',
  VALID_DOMAIN_AND_MX: 'Domain exists with valid MX records',
  INVALID_SYNTAX: 'Email syntax is invalid',
  INVALID_DOMAIN: 'Domain is invalid or does not exist',
  NO_MX: 'Domain has no usable mail route',
  NULL_MX: 'Domain declares that it accepts no email (null MX)',
  DNS_FAILURE: 'DNS lookup failed on every resolver',
  DNS_TIMEOUT: 'DNS lookup timed out',
  DISPOSABLE_DOMAIN: 'Disposable email domain detected',
  ROLE_EMAIL: 'Role-based (shared) mailbox, not a person',
  CATCH_ALL_DOMAIN: 'Domain accepts all addresses (catch-all), so this mailbox cannot be confirmed',
  MAILBOX_FULL: 'Mailbox exists but is full or over quota',
  SMTP_REJECTED: 'Mail server says this mailbox does not exist',
  SMTP_TEMPORARY_FAILURE: 'Mail server deferred the check (greylisting or rate limit); domain is valid',
  SMTP_BLOCKED: 'Mail server refused to answer verification probes; domain is valid',
  SMTP_TIMEOUT: 'Mail server did not answer in time; domain is valid',
  SMTP_UNAVAILABLE: 'Mailbox probing is unavailable from this server (outbound port 25 blocked); domain is valid',
  SMTP_SKIPPED: 'Mailbox check is disabled; domain and mail route are valid',
  UNKNOWN_MAILBOX: 'Mailbox existence could not be confirmed; domain is valid',
};

export function reasonMessage(code: string): string {
  return MESSAGES[code] ?? code;
}
