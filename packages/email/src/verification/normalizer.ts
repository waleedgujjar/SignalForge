export interface NormalizedEmail {
  originalEmail: string;
  normalizedEmail: string;
  localPart: string;
  domain: string;
  valid: boolean;
}

export function normalizeEmail(input: string): NormalizedEmail {
  const originalEmail = input;
  const trimmed = input.trim();
  const atIndex = trimmed.lastIndexOf('@');

  if (atIndex <= 0 || atIndex === trimmed.length - 1) {
    return {
      originalEmail,
      normalizedEmail: trimmed.toLowerCase(),
      localPart: '',
      domain: '',
      valid: false,
    };
  }

  const localPart = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1).toLowerCase();
  const normalizedEmail = `${localPart}@${domain}`;

  return {
    originalEmail,
    normalizedEmail,
    localPart,
    domain,
    valid: localPart.length > 0 && domain.length > 0,
  };
}
