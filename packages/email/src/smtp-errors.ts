export type SmtpErrorCategory =
  | 'AUTH_FAILED'
  | 'CONNECTION_REFUSED'
  | 'CONNECTION_TIMEOUT'
  | 'INVALID_HOST'
  | 'INVALID_PORT'
  | 'TLS_FAILED'
  | 'PROVIDER_REJECTED'
  | 'UNKNOWN';

export interface NormalizedSmtpError {
  category: SmtpErrorCategory;
  message: string;
}

const CATEGORY_MESSAGES: Record<SmtpErrorCategory, string> = {
  AUTH_FAILED: 'Authentication failed. Check the username and password.',
  CONNECTION_REFUSED: 'The SMTP server refused the connection. Verify host and port.',
  CONNECTION_TIMEOUT: 'The connection timed out. Verify network access and host reachability.',
  INVALID_HOST: 'The SMTP hostname could not be resolved.',
  INVALID_PORT: 'The SMTP port is invalid or blocked.',
  TLS_FAILED: 'The TLS handshake failed. Check the encryption mode.',
  PROVIDER_REJECTED: 'The provider rejected the connection.',
  UNKNOWN: 'The connection failed for an unknown reason.',
};

interface NodemailerErrorShape {
  code?: string;
  responseCode?: number;
  command?: string;
  message?: string;
}

export function normalizeSmtpError(err: unknown): NormalizedSmtpError {
  const e = (err ?? {}) as NodemailerErrorShape;
  const code = e.code;
  const responseCode = e.responseCode;
  const rawMessage = typeof e.message === 'string' ? e.message : '';
  const msg = rawMessage.toLowerCase();

  const category = classify(code, responseCode, msg);
  return { category, message: CATEGORY_MESSAGES[category] };
}

function classify(
  code: string | undefined,
  responseCode: number | undefined,
  msg: string,
): SmtpErrorCategory {
  if (code === 'EAUTH' || (typeof responseCode === 'number' && (responseCode === 535 || responseCode === 534 || responseCode === 530))) {
    return 'AUTH_FAILED';
  }
  if (code === 'ETIMEDOUT' || code === 'ETIME' || msg.includes('timed out')) {
    return 'CONNECTION_TIMEOUT';
  }
  if (code === 'ECONNREFUSED' || msg.includes('connection refused')) {
    return 'CONNECTION_REFUSED';
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'EDNS' || msg.includes('getaddrinfo')) {
    return 'INVALID_HOST';
  }
  if (code === 'ECONNRESET' && msg.includes('port')) {
    return 'INVALID_PORT';
  }
  if (msg.includes('tls') || msg.includes('ssl') || msg.includes('certificate') || code === 'ESOCKET') {
    return 'TLS_FAILED';
  }
  if (typeof responseCode === 'number' && responseCode >= 500 && responseCode < 600) {
    return 'PROVIDER_REJECTED';
  }
  return 'UNKNOWN';
}

export function smtpCategoryMessage(category: SmtpErrorCategory): string {
  return CATEGORY_MESSAGES[category];
}
