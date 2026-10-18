const EMAIL_REGEX =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

const MAX_LOCAL_LENGTH = 64;
const MAX_DOMAIN_LENGTH = 255;
const MAX_EMAIL_LENGTH = 254;

export interface SyntaxValidationResult {
  valid: boolean;
  reasonCode: string;
  reasonMessage: string;
}

export function validateSyntax(email: string, localPart: string, domain: string): SyntaxValidationResult {
  if (!email || email.includes(' ')) {
    return invalid('INVALID_SYNTAX', 'Email contains whitespace or is empty');
  }
  if ((email.match(/@/g) ?? []).length !== 1) {
    return invalid('INVALID_SYNTAX', 'Email must contain exactly one @ symbol');
  }
  if (!localPart || !domain) {
    return invalid('INVALID_SYNTAX', 'Missing local part or domain');
  }
  if (localPart.startsWith('.') || localPart.endsWith('.') || localPart.includes('..')) {
    return invalid('INVALID_SYNTAX', 'Invalid dot placement in local part');
  }
  if (domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) {
    return invalid('INVALID_SYNTAX', 'Invalid dot placement in domain');
  }
  if (localPart.length > MAX_LOCAL_LENGTH) {
    return invalid('INVALID_SYNTAX', 'Local part exceeds maximum length');
  }
  if (domain.length > MAX_DOMAIN_LENGTH) {
    return invalid('INVALID_SYNTAX', 'Domain exceeds maximum length');
  }
  if (email.length > MAX_EMAIL_LENGTH) {
    return invalid('INVALID_SYNTAX', 'Email exceeds maximum length');
  }
  if (!EMAIL_REGEX.test(email)) {
    return invalid('INVALID_SYNTAX', 'Invalid email syntax');
  }
  return { valid: true, reasonCode: 'VALID_SYNTAX', reasonMessage: 'Syntax is valid' };
}

function invalid(reasonCode: string, reasonMessage: string): SyntaxValidationResult {
  return { valid: false, reasonCode, reasonMessage };
}
