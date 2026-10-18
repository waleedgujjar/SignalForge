/// Canonicalization of raw source values.
///
/// Every source is normalized through here BEFORE deduplication, so that
/// "ABC DENTAL LLC" from Google and "ABC Dental" from a CSV compare equal.
/// Raw values are always preserved alongside the canonical ones — normalization
/// is for matching, never a replacement for what the source actually said.

import { randomUUID } from 'node:crypto';
import { normalizeDomain as stripToHost } from '@signalforge/deliverability';

import type { RawDiscoveredLead } from './types.js';

/// Legal-form suffixes stripped for comparison only. Deliberately conservative:
/// removing too much merges genuinely different businesses.
const COMPANY_SUFFIXES = [
  'llc', 'l.l.c', 'inc', 'inc.', 'incorporated', 'corp', 'corp.', 'corporation',
  'ltd', 'ltd.', 'limited', 'llp', 'lp', 'plc', 'gmbh', 'bv', 'nv', 'ag', 'sa',
  'srl', 'pty', 'pte', 'co', 'co.', 'company', 'holdings', 'group',
];

/// Query parameters that never identify a distinct page.
const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|msclkid$|mc_cid$|mc_eid$|ref$|source$)/i;

export function normalizeCompany(value?: string | null): string | null {
  if (!value) return null;
  let out = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Strip trailing legal suffixes repeatedly ("ABC Dental Group LLC").
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of COMPANY_SUFFIXES) {
      const bare = suffix.replace(/\./g, '');
      if (out.endsWith(` ${bare}`)) {
        out = out.slice(0, -(bare.length + 1)).trim();
        changed = true;
      }
    }
  }
  return out || null;
}

export function normalizeEmail(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase().replace(/^mailto:/, '');
  // Sources routinely emit "Name <a@b.com>" or several addresses in one cell.
  const match = trimmed.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/);
  if (!match) return null;
  const email = match[0];
  const [local, domain] = email.split('@');
  if (!local || !domain) return null;
  return `${local}@${domain}`;
}

export function isValidEmail(value?: string | null): boolean {
  return normalizeEmail(value) !== null;
}

/// Reduce a URL or bare hostname to its registrable host.
///
/// `https://www.example.com/`, `http://example.com` and
/// `https://example.com/?utm_source=x` all collapse to `example.com`.
/// Subdomains other than `www` are preserved — `careers.example.com` is often a
/// genuinely different business unit, and merging them loses real leads.
export function normalizeDomain(value?: string | null): string | null {
  if (!value) return null;

  // Scheme/path/user@ stripping is shared with the deliverability DNS checker so
  // there is exactly one implementation of it. Everything below is the extra
  // canonicalization deduplication needs and DNS checking does not: dropping
  // `www.`, validating the shape, and rejecting values that cannot identify a
  // company. Without the `www.` rule, `www.example.com` and `example.com` from
  // two sources would become two separate leads.
  const host = stripToHost(value.replace(/^mailto:/i, ''))
    .split('?')[0]
    ?.split('#')[0]
    ?.replace(/:\d+$/, '')
    .replace(/^www\./, '')
    .replace(/\.$/, '');

  if (!host || !host.includes('.')) return null;
  if (!/^[a-z0-9.-]+$/.test(host)) return null;
  // A bare IP is never a useful company identity.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;
  return host;
}

/// Canonical absolute URL with tracking parameters removed. Keeps the path,
/// because `/practice-a` and `/practice-b` on a shared host are different.
export function normalizeWebsite(value?: string | null): string | null {
  if (!value) return null;
  let raw = value.trim();
  if (!raw) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  }
  url.hash = '';
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  url.protocol = 'https:';
  const query = url.searchParams.toString();
  // URL always reports at least "/" for the path; drop that bare root so
  // "example.com" and "example.com/" produce one canonical string.
  const path = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '');
  return `${url.protocol}//${url.host}${path}${query ? `?${query}` : ''}`;
}

/// E.164-ish canonical form: digits only, with a leading `+` when a country
/// code is present. Extensions are dropped for comparison.
export function normalizePhone(value?: string | null, defaultCountryCode?: string | null): string | null {
  if (!value) return null;
  const withoutExt = value.replace(/(?:ext|x|extension)\.?\s*\d+$/i, '');
  const hadPlus = withoutExt.trim().startsWith('+');
  const digits = withoutExt.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;

  if (hadPlus) return `+${digits}`;
  // A 10-digit number in a NANP country is unambiguous; prefix it so US numbers
  // from different sources compare equal whether or not they carried a +1.
  if (digits.length === 10 && isNanpCountry(defaultCountryCode)) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1') && isNanpCountry(defaultCountryCode)) return `+${digits}`;
  return digits;
}

function isNanpCountry(code?: string | null): boolean {
  if (!code) return false;
  return ['US', 'USA', 'CA', 'CAN'].includes(code.trim().toUpperCase());
}

export function normalizeCountryCode(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim().toUpperCase();
  if (!trimmed) return null;
  const ALIASES: Record<string, string> = {
    USA: 'US', 'UNITED STATES': 'US', 'UNITED STATES OF AMERICA': 'US',
    UK: 'GB', 'UNITED KINGDOM': 'GB', 'GREAT BRITAIN': 'GB',
    CAN: 'CA', CANADA: 'CA', AUS: 'AU', AUSTRALIA: 'AU',
    UAE: 'AE', 'UNITED ARAB EMIRATES': 'AE',
  };
  if (ALIASES[trimmed]) return ALIASES[trimmed];
  return /^[A-Z]{2}$/.test(trimmed) ? trimmed : null;
}

export function titleCase(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed || null;
}

export interface NormalizedLead extends RawDiscoveredLead {
  normalizedCompany: string | null;
  normalizedEmail: string | null;
  normalizedPhone: string | null;
  normalizedDomain: string | null;
  website: string | null;
}

/// Produce the canonical shape used by dedup, qualification and promotion.
export function normalizeLead(raw: RawDiscoveredLead): NormalizedLead {
  const countryCode = normalizeCountryCode(raw.countryCode ?? raw.country);
  const website = normalizeWebsite(raw.website);
  // A source with no website field often still reveals the domain via email.
  const domain = normalizeDomain(raw.website) ?? normalizeDomain(raw.email);

  const firstName = titleCase(raw.firstName);
  const lastName = titleCase(raw.lastName);
  const fullName =
    titleCase(raw.fullName) ?? ([firstName, lastName].filter(Boolean).join(' ') || null);

  return {
    ...raw,
    company: titleCase(raw.company),
    firstName,
    lastName,
    fullName,
    jobTitle: titleCase(raw.jobTitle),
    industry: titleCase(raw.industry),
    country: titleCase(raw.country),
    countryCode,
    state: titleCase(raw.state),
    city: titleCase(raw.city),
    postalCode: titleCase(raw.postalCode),
    website,
    normalizedCompany: normalizeCompany(raw.company),
    normalizedEmail: normalizeEmail(raw.email),
    normalizedPhone: normalizePhone(raw.phone, countryCode),
    normalizedDomain: domain,
  };
}

/// Whether a normalized record carries enough identity to be worth keeping.
/// A row with no company, no email and no domain cannot be deduped or contacted.
export function hasUsableIdentity(lead: NormalizedLead): boolean {
  return Boolean(lead.normalizedCompany || lead.normalizedEmail || lead.normalizedDomain);
}

/// File imports keep any row that carries mapped data — not just contactable identity.
export function hasImportableRowData(lead: NormalizedLead): boolean {
  return Boolean(
    lead.normalizedCompany ||
      lead.normalizedEmail ||
      lead.normalizedDomain ||
      lead.normalizedPhone ||
      lead.fullName ||
      lead.firstName ||
      lead.lastName ||
      lead.jobTitle ||
      lead.industry ||
      lead.city ||
      lead.state ||
      lead.country,
  );
}

// ─── Placeholder Email ─────────────────────────────────────────────────────────

const PLACEHOLDER_EMAIL_DOMAIN = 'import.signalforge.local';

export function generatePlaceholderEmail(): string {
  return `noemail+${randomUUID().replace(/-/g, '').slice(0, 16)}@${PLACEHOLDER_EMAIL_DOMAIN}`;
}

export function isPlaceholderEmail(email: string): boolean {
  return email.endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`);
}

// ─── Invalid Owner Name Detection ───────────────────────────────────────────────

const INVALID_OWNER_NAMES = new Set([
  'not found', 'not available', 'n/a', 'na', 'none', 'null', 'unknown',
  'unavailable', 'no owner', 'no data', 'not_found', 'undefined', 'tbd',
  'pending', 'vacant', 'empty', 'test', 'xxx', 'no name', '-', '--', '---',
  '.', '..', '...', '*',
]);

export function isInvalidOwnerName(value: string): boolean {
  if (!value) return true;
  const trimmed = value.trim();
  if (!trimmed) return true;
  const lower = trimmed.toLowerCase();
  if (INVALID_OWNER_NAMES.has(lower)) return true;
  const collapsed = lower.replace(/[-_\s]+/g, ' ').trim();
  return INVALID_OWNER_NAMES.has(collapsed);
}

// ─── Name Resolution ────────────────────────────────────────────────────────────

export interface ResolvedName {
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
}

export function resolveLeadName(
  ownerName: string | null | undefined,
  companyName: string | null | undefined,
  parts?: { firstName?: string | null; lastName?: string | null },
): ResolvedName {
  const empty: ResolvedName = { fullName: null, firstName: null, lastName: null };

  const owner = ownerName?.trim() || null;
  if (owner && !isInvalidOwnerName(owner)) {
    return splitFullName(owner);
  }

  const first = parts?.firstName?.trim() || null;
  const last = parts?.lastName?.trim() || null;
  const combined = [first, last].filter(Boolean).join(' ');
  if (combined && !isInvalidOwnerName(combined)) {
    return splitFullName(combined);
  }

  const company = companyName?.trim() || null;
  if (company) {
    return { fullName: company, firstName: null, lastName: null };
  }

  return empty;
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
    || lead.email?.trim()
    || null;
}

function splitFullName(name: string): ResolvedName {
  const parts = name.split(/\s+/);
  if (parts.length >= 2) {
    return {
      fullName: name,
      firstName: parts[0]!,
      lastName: parts.slice(1).join(' '),
    };
  }
  return { fullName: name, firstName: name, lastName: null };
}

// ─── State Normalization ────────────────────────────────────────────────────────

const US_STATES: Record<string, string> = {
  alabama: 'Alabama', al: 'Alabama',
  alaska: 'Alaska', ak: 'Alaska',
  arizona: 'Arizona', az: 'Arizona',
  arkansas: 'Arkansas', ar: 'Arkansas',
  california: 'California', ca: 'California',
  colorado: 'Colorado', co: 'Colorado',
  connecticut: 'Connecticut', ct: 'Connecticut',
  delaware: 'Delaware', de: 'Delaware',
  florida: 'Florida', fl: 'Florida',
  georgia: 'Georgia', ga: 'Georgia',
  hawaii: 'Hawaii', hi: 'Hawaii',
  idaho: 'Idaho', id: 'Idaho',
  illinois: 'Illinois', il: 'Illinois',
  indiana: 'Indiana', in: 'Indiana',
  iowa: 'Iowa', ia: 'Iowa',
  kansas: 'Kansas', ks: 'Kansas',
  kentucky: 'Kentucky', ky: 'Kentucky',
  louisiana: 'Louisiana', la: 'Louisiana',
  maine: 'Maine', me: 'Maine',
  maryland: 'Maryland', md: 'Maryland',
  massachusetts: 'Massachusetts', ma: 'Massachusetts',
  michigan: 'Michigan', mi: 'Michigan',
  minnesota: 'Minnesota', mn: 'Minnesota',
  mississippi: 'Mississippi', ms: 'Mississippi',
  missouri: 'Missouri', mo: 'Missouri',
  montana: 'Montana', mt: 'Montana',
  nebraska: 'Nebraska', ne: 'Nebraska',
  nevada: 'Nevada', nv: 'Nevada',
  'new hampshire': 'New Hampshire', nh: 'New Hampshire',
  'new jersey': 'New Jersey', nj: 'New Jersey',
  'new mexico': 'New Mexico', nm: 'New Mexico',
  'new york': 'New York', ny: 'New York',
  'north carolina': 'North Carolina', nc: 'North Carolina',
  'north dakota': 'North Dakota', nd: 'North Dakota',
  ohio: 'Ohio', oh: 'Ohio',
  oklahoma: 'Oklahoma', ok: 'Oklahoma',
  oregon: 'Oregon', or: 'Oregon',
  pennsylvania: 'Pennsylvania', pa: 'Pennsylvania',
  'rhode island': 'Rhode Island', ri: 'Rhode Island',
  'south carolina': 'South Carolina', sc: 'South Carolina',
  'south dakota': 'South Dakota', sd: 'South Dakota',
  tennessee: 'Tennessee', tn: 'Tennessee',
  texas: 'Texas', tx: 'Texas',
  utah: 'Utah', ut: 'Utah',
  vermont: 'Vermont', vt: 'Vermont',
  virginia: 'Virginia', va: 'Virginia',
  washington: 'Washington', wa: 'Washington',
  'west virginia': 'West Virginia', wv: 'West Virginia',
  wisconsin: 'Wisconsin', wi: 'Wisconsin',
  wyoming: 'Wyoming', wy: 'Wyoming',
  'district of columbia': 'District of Columbia', dc: 'District of Columbia',
};

const US_STATE_TYPOS: Record<string, string> = {
  taxes: 'Texas',
  tex: 'Texas',
  calif: 'California',
  cali: 'California',
  penn: 'Pennsylvania',
  mich: 'Michigan',
  tenn: 'Tennessee',
  mass: 'Massachusetts',
  minn: 'Minnesota',
  wash: 'Washington',
  wisc: 'Wisconsin',
  conn: 'Connecticut',
  ore: 'Oregon',
  okla: 'Oklahoma',
  ariz: 'Arizona',
  nebr: 'Nebraska',
  mont: 'Montana',
  virg: 'Virginia',
};

export function normalizeStateName(
  value: string | null | undefined,
  countryCode: string | null | undefined,
): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const isUs = !countryCode || countryCode === 'US';
  if (!isUs) return titleCase(trimmed);

  const lower = trimmed.toLowerCase();
  const fromState = US_STATES[lower];
  if (fromState) return fromState;

  const fromTypo = US_STATE_TYPOS[lower];
  if (fromTypo) return fromTypo;

  return titleCase(trimmed);
}
