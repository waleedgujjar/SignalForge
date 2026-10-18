/// LinkedIn URL classification and normalization.
///
/// Every URL is validated here before anything is persisted or fetched. The
/// rules are strict on purpose: only `linkedin.com` hosts, only the handful of
/// path classes we can research (profile, company, school, job), no userinfo,
/// no odd ports, no scheme other than http(s). Shorteners (`lnkd.in`) and
/// look-alike hosts (`linkedin.com.evil.com`) are rejected so the public
/// provider can never be pointed at an arbitrary server.

import type { LeadResearchType } from '@signalforge/database';

import { LinkedInUrlError } from '../types.js';

export type LinkedInUrlKind = 'PERSON' | 'COMPANY' | 'SCHOOL' | 'JOB';

export interface ParsedLinkedInUrl {
  kind: LinkedInUrlKind;
  researchType: LeadResearchType;
  slug: string;
  host: string;
  /// Canonical form used for dedupe and fetching:
  /// `https://www.linkedin.com/{in|company|school|showcase|jobs/view}/{slug}`.
  normalizedUrl: string;
  /// What the researcher actually pasted (trimmed), kept for display.
  sourceUrl: string;
}

export type ParseLinkedInUrlResult =
  | { ok: true; value: ParsedLinkedInUrl }
  | { ok: false; code: 'INVALID_URL' | 'UNSUPPORTED_URL'; message: string };

const MAX_URL_LENGTH = 500;
const SLUG_PATTERN = /^[A-Za-z0-9\-_%.~]{1,200}$/;
const SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const HTTP_SCHEME_PATTERN = /^https?:\/\//i;

const KIND_TO_RESEARCH_TYPE: Record<LinkedInUrlKind, LeadResearchType> = {
  PERSON: 'PERSON',
  COMPANY: 'COMPANY',
  SCHOOL: 'OTHER',
  JOB: 'JOB',
};

function invalid(message: string): ParseLinkedInUrlResult {
  return { ok: false, code: 'INVALID_URL', message };
}

function unsupported(message: string): ParseLinkedInUrlResult {
  return { ok: false, code: 'UNSUPPORTED_URL', message };
}

function isLinkedInHost(host: string): boolean {
  return host === 'linkedin.com' || host.endsWith('.linkedin.com');
}

export function parseLinkedInUrl(input: string | null | undefined): ParseLinkedInUrlResult {
  const trimmed = (input ?? '').trim();
  if (trimmed.length === 0) return invalid('LinkedIn URL is required');
  if (trimmed.length > MAX_URL_LENGTH) return invalid(`LinkedIn URL must be at most ${MAX_URL_LENGTH} characters`);
  if (/\s/.test(trimmed)) return invalid('LinkedIn URL must not contain whitespace');

  // A bare `linkedin.com/in/x` is accepted; anything with a non-http scheme
  // (`javascript:`, `ftp:`, `mailto:`) is rejected before `new URL` can be
  // creative about it.
  let candidate = trimmed;
  if (!HTTP_SCHEME_PATTERN.test(candidate)) {
    if (SCHEME_PATTERN.test(candidate)) return invalid('LinkedIn URL must use http or https');
    candidate = `https://${candidate}`;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return invalid('LinkedIn URL is not a valid URL');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return invalid('LinkedIn URL must use http or https');
  if (url.username || url.password) return invalid('LinkedIn URL must not contain credentials');
  if (url.port) return invalid('LinkedIn URL must not specify a port');

  const host = url.hostname.toLowerCase();
  if (!isLinkedInHost(host)) return unsupported('Only linkedin.com URLs are supported');

  const segments = url.pathname.split('/').filter((segment) => segment.length > 0);
  const [first, second, third] = segments;
  if (!first) return unsupported('LinkedIn URL must point to a profile, company, school or job page');

  let kind: LinkedInUrlKind;
  let slug: string | undefined;
  let pathPrefix: string;

  switch (first.toLowerCase()) {
    case 'in':
      kind = 'PERSON';
      slug = second;
      pathPrefix = 'in';
      break;
    case 'pub':
      // Legacy public profile URLs (`/pub/name/1/2/3`) resolve to `/in/name`.
      kind = 'PERSON';
      slug = second;
      pathPrefix = 'in';
      break;
    case 'company':
      kind = 'COMPANY';
      slug = second;
      pathPrefix = 'company';
      break;
    case 'showcase':
      kind = 'COMPANY';
      slug = second;
      pathPrefix = 'showcase';
      break;
    case 'school':
      kind = 'SCHOOL';
      slug = second;
      pathPrefix = 'school';
      break;
    case 'jobs':
      if (second?.toLowerCase() !== 'view') {
        return unsupported('Only LinkedIn job pages under /jobs/view/ are supported');
      }
      kind = 'JOB';
      slug = third;
      pathPrefix = 'jobs/view';
      break;
    default:
      return unsupported('LinkedIn URL must point to a profile, company, school or job page');
  }

  if (!slug) return invalid('LinkedIn URL is missing its identifier');
  let decodedSlug: string;
  try {
    decodedSlug = decodeURIComponent(slug);
  } catch {
    return invalid('LinkedIn URL identifier is malformed');
  }
  if (!SLUG_PATTERN.test(slug) || decodedSlug.includes('/')) return invalid('LinkedIn URL identifier is malformed');

  const normalizedSlug = slug.toLowerCase();
  return {
    ok: true,
    value: {
      kind,
      researchType: KIND_TO_RESEARCH_TYPE[kind],
      slug: normalizedSlug,
      host,
      normalizedUrl: `https://www.linkedin.com/${pathPrefix}/${normalizedSlug}`,
      sourceUrl: trimmed,
    },
  };
}

/// Canonical URL or null when the input is not a supported LinkedIn URL.
export function normalizeLinkedInUrl(input: string | null | undefined): string | null {
  const parsed = parseLinkedInUrl(input);
  return parsed.ok ? parsed.value.normalizedUrl : null;
}

/// Parse or throw. `expectedKind` enforces that a "company URL" field really
/// holds a company page (and vice versa) — a mismatch is an UNSUPPORTED_URL
/// because the URL is valid, just not for this slot.
export function assertLinkedInUrl(input: string | null | undefined, expectedKind?: LinkedInUrlKind): ParsedLinkedInUrl {
  const parsed = parseLinkedInUrl(input);
  if (!parsed.ok) throw new LinkedInUrlError(parsed.code, parsed.message);
  if (expectedKind && parsed.value.kind !== expectedKind) {
    throw new LinkedInUrlError(
      'UNSUPPORTED_URL',
      `Expected a LinkedIn ${expectedKind.toLowerCase()} URL but received a ${parsed.value.kind.toLowerCase()} URL`,
    );
  }
  return parsed.value;
}
