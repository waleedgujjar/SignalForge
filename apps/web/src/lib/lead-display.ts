export function isPlaceholderEmail(email: string): boolean {
  return email.endsWith('@import.signalforge.local');
}

export function getLeadDisplayName(lead: {
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  email?: string | null;
}): string | null {
  const fromParts = [lead.firstName, lead.lastName].filter(Boolean).join(' ');
  return lead.fullName?.trim()
    || fromParts
    || lead.company?.trim()
    || (lead.email && !isPlaceholderEmail(lead.email) ? lead.email : null)
    || null;
}

export function getLeadWebsite(lead: {
  website?: string | null;
  companyDomain?: string | null;
}): string | null {
  if (lead.website?.trim()) return lead.website.trim();
  if (lead.companyDomain?.trim()) {
    const domain = lead.companyDomain.trim();
    return domain.startsWith('http') ? domain : `https://${domain}`;
  }
  return null;
}

export function formatWebsiteHref(url: string): string {
  return url.startsWith('http') ? url : `https://${url}`;
}

export function formatWebsiteLabel(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

export function formatPhoneTel(phone: string): string | null {
  const digits = phone.replace(/[^\d+]/g, '');
  if (digits.replace(/\D/g, '').length < 7) return null;
  return digits.startsWith('+') ? digits : `+${digits.replace(/^\+/, '')}`;
}

export function formatEmailMailto(email: string): string | null {
  if (!email || isPlaceholderEmail(email)) return null;
  const trimmed = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  return trimmed;
}
