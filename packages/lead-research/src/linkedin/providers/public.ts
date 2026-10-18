/// Public-page provider: ONE read of the URL the researcher pasted.
///
/// The page is fetched through Jina Reader (`${JINA_READER_BASE_URL}/${url}`),
/// which renders the public HTML to markdown. There is exactly one request per
/// research action: no crawling, no follow-ups, no retry around a refusal, no
/// name-based search (a missing URL is an error, never a query). The host is
/// fixed by env (https only) and the path is a validated linkedin.com URL, so
/// the provider can never be pointed at an arbitrary server. A refusal from
/// LinkedIn (authwall, 429/999, 404) is reported as such and ends the job;
/// the record goes to MANUAL_REVIEW with the reason. Parsing is deterministic
/// regex over visibly present text — no model, and never emails, phones,
/// follower counts or revenue.

import { getEnv, type Env } from '@signalforge/config';

import { sanitizeSecrets } from '../../sanitize.js';
import type { ResearchContext, ResearchOutcome, ResearchProvenanceEntry } from '../../types.js';
import { normalizeOutcome, isEvidenceField } from '../normalize.js';
import type { CompanyResearchInput, LinkedInResearchProvider, PersonResearchInput } from '../provider.js';
import { failureOutcome } from '../provider.js';
import type { LinkedInCompanyData, LinkedInPersonData, LinkedInResearchData, ProviderHealth } from '../types.js';
import { parseLinkedInUrl } from '../url.js';
import type { LinkedInUrlKind } from '../url.js';

export const PUBLIC_PROVIDER_DISPLAY_NAME = 'Public page (single fetch)';
export const PUBLIC_USER_AGENT = 'SignalForge-LeadResearch/1.0';
const CONTENT_PREVIEW_LIMIT = 20_000;
const MIN_CONTENT_LENGTH = 200;
const CORE_CONFIDENCE = 0.6;
const SECONDARY_CONFIDENCE = 0.4;

type FetchImpl = typeof fetch;
type EnvSource = Env | (() => Env);

export interface PublicProviderOptions {
  fetchImpl?: FetchImpl;
  env?: EnvSource;
  now?: () => Date;
}

/// What Jina Reader returns. JSON bodies are `{ code, status, data: { title,
/// description, url, content } }`; a flat body and a text/plain body
/// ("Title: …\n\nURL Source: …\n\nMarkdown Content:\n…") are tolerated too.
interface ReaderPayload {
  code?: number;
  message?: string;
  title?: string;
  description?: string;
  url?: string;
  content: string;
}

interface ParsedFields {
  data: LinkedInResearchData;
  provenance: ResearchProvenanceEntry[];
}

export class PublicLinkedInProvider implements LinkedInResearchProvider {
  readonly name = 'public' as const;
  readonly displayName = PUBLIC_PROVIDER_DISPLAY_NAME;

  private readonly fetchImpl: FetchImpl;
  private readonly envSource: EnvSource;
  private readonly now: () => Date;

  constructor(options: PublicProviderOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.envSource = options.env ?? getEnv;
    this.now = options.now ?? (() => new Date());
  }

  private readEnv(): Env | null {
    try {
      return typeof this.envSource === 'function' ? this.envSource() : this.envSource;
    } catch {
      return null;
    }
  }

  isConfigured(): boolean {
    const env = this.readEnv();
    return Boolean(env && env.LINKEDIN_RESEARCH_ENABLED && env.LINKEDIN_RESEARCH_PUBLIC_FETCH_ENABLED);
  }

  /// Config-only: no network call, so the settings page never triggers a read.
  async healthCheck(): Promise<ProviderHealth> {
    const env = this.readEnv();
    const checkedAt = this.now().toISOString();
    if (!env) {
      return this.health('UNAVAILABLE', 'NOT_REQUIRED', checkedAt, ['Environment configuration could not be loaded']);
    }
    const details: string[] = [];
    let readerHost = env.JINA_READER_BASE_URL;
    let readerOk = true;
    try {
      const base = new URL(env.JINA_READER_BASE_URL);
      readerHost = base.host;
      readerOk = base.protocol === 'https:';
    } catch {
      readerOk = false;
    }
    details.push(`Reader host: ${readerHost}`);
    details.push(env.JINA_API_KEY ? 'JINA_API_KEY: set (optional)' : 'JINA_API_KEY: not set (optional)');
    details.push('One fetch per researcher action; refusals stop the job.');
    if (!readerOk) {
      details.push('JINA_READER_BASE_URL must be an https URL');
      return this.health('UNAVAILABLE', env.JINA_API_KEY ? 'CONFIGURED' : 'NOT_REQUIRED', checkedAt, details);
    }
    if (!this.isConfigured()) {
      details.push(
        env.LINKEDIN_RESEARCH_ENABLED
          ? 'Disabled by LINKEDIN_RESEARCH_PUBLIC_FETCH_ENABLED=false'
          : 'Disabled by LINKEDIN_RESEARCH_ENABLED=false',
      );
      return this.health('DISABLED', env.JINA_API_KEY ? 'CONFIGURED' : 'NOT_REQUIRED', checkedAt, details);
    }
    return this.health('READY', env.JINA_API_KEY ? 'CONFIGURED' : 'NOT_REQUIRED', checkedAt, details);
  }

  private health(
    status: ProviderHealth['status'],
    authentication: ProviderHealth['authentication'],
    checkedAt: string,
    details: string[],
  ): ProviderHealth {
    return { provider: this.name, displayName: this.displayName, status, authentication, checkedAt, details };
  }

  async researchCompany(input: CompanyResearchInput, ctx: ResearchContext): Promise<ResearchOutcome> {
    return this.fetchOnce(input.url, 'COMPANY', ctx);
  }

  async researchPerson(input: PersonResearchInput, ctx: ResearchContext): Promise<ResearchOutcome> {
    return this.fetchOnce(input.url, 'PERSON', ctx);
  }

  private async fetchOnce(url: string | undefined, kind: LinkedInUrlKind, ctx: ResearchContext): Promise<ResearchOutcome> {
    if (!url) {
      return failureOutcome(
        this.name,
        'UNAVAILABLE',
        'UNSUPPORTED_URL',
        'No LinkedIn URL was provided; the public provider never searches by name',
      );
    }
    const parsed = parseLinkedInUrl(url);
    if (!parsed.ok) return failureOutcome(this.name, 'UNAVAILABLE', parsed.code, parsed.message);
    if (parsed.value.kind !== kind) {
      return failureOutcome(
        this.name,
        'UNAVAILABLE',
        'UNSUPPORTED_URL',
        `Expected a LinkedIn ${kind.toLowerCase()} URL but received a ${parsed.value.kind.toLowerCase()} URL`,
      );
    }

    const env = this.readEnv();
    if (!env || !this.isConfigured()) {
      ctx.chainNotes.push('Public page fetch is disabled');
      return failureOutcome(
        this.name,
        'UNAVAILABLE',
        'PROVIDER_NOT_CONFIGURED',
        'Public page fetch is disabled (LINKEDIN_RESEARCH_PUBLIC_FETCH_ENABLED=false)',
      );
    }

    let base: URL;
    try {
      base = new URL(env.JINA_READER_BASE_URL);
    } catch {
      ctx.chainNotes.push('Reader base URL is invalid');
      return failureOutcome(this.name, 'UNAVAILABLE', 'PROVIDER_UNAVAILABLE', 'JINA_READER_BASE_URL is not a valid URL');
    }
    if (base.protocol !== 'https:') {
      ctx.chainNotes.push('Reader base URL must use https');
      return failureOutcome(this.name, 'UNAVAILABLE', 'PROVIDER_UNAVAILABLE', 'JINA_READER_BASE_URL must use https');
    }

    const normalizedUrl = parsed.value.normalizedUrl;
    const target = `${env.JINA_READER_BASE_URL.replace(/\/+$/, '')}/${normalizedUrl}`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-Return-Format': 'markdown',
      'User-Agent': PUBLIC_USER_AGENT,
    };
    if (env.JINA_API_KEY) headers.Authorization = `Bearer ${env.JINA_API_KEY}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, ctx.timeoutMs));
    const onOuterAbort = () => controller.abort();
    ctx.signal?.addEventListener('abort', onOuterAbort, { once: true });

    let response: Response;
    try {
      response = await this.fetchImpl(target, {
        method: 'GET',
        headers,
        signal: controller.signal,
        redirect: 'manual',
      });
    } catch (error) {
      if (isAbortError(error)) {
        return failureOutcome(this.name, 'FAILED', 'TIMEOUT', `Reader did not respond within ${ctx.timeoutMs} ms`, true);
      }
      const message = error instanceof Error ? error.message : String(error);
      return failureOutcome(this.name, 'FAILED', 'PROVIDER_UNAVAILABLE', `Reader request failed: ${sanitizeSecrets(message)}`, true);
    } finally {
      clearTimeout(timer);
      ctx.signal?.removeEventListener('abort', onOuterAbort);
    }

    const httpRefusal = this.classifyHttpStatus(response.status);
    if (httpRefusal) return httpRefusal;

    let bodyText: string;
    try {
      bodyText = await response.text();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return failureOutcome(this.name, 'FAILED', 'PROVIDER_UNAVAILABLE', `Reader body could not be read: ${sanitizeSecrets(message)}`, true);
    }

    const payload = parseReaderBody(bodyText, response.headers.get('content-type'));
    if (payload.code !== undefined && payload.code !== 200) {
      const bodyRefusal = this.classifyHttpStatus(payload.code, payload.message);
      if (bodyRefusal) return bodyRefusal;
    }
    if (payload.message && /\b999\b/.test(payload.message)) {
      return failureOutcome(this.name, 'MANUAL_REVIEW', 'RATE_LIMITED', 'LinkedIn refused the request (999); manual verification required');
    }

    if (isAuthwall(payload)) {
      return failureOutcome(
        this.name,
        'MANUAL_REVIEW',
        'LOGIN_REQUIRED',
        'LinkedIn returned a sign-in wall instead of the public page; manual verification required',
        false,
        this.raw(payload, normalizedUrl),
      );
    }

    const retrievedAt = this.now().toISOString();
    const fields =
      kind === 'COMPANY' ? parseCompany(payload, normalizedUrl, retrievedAt) : parsePerson(payload, normalizedUrl, retrievedAt);

    const evidence = fields.provenance.filter((entry) => isEvidenceField(entry.field));
    if (evidence.length === 0) {
      return failureOutcome(
        this.name,
        'MANUAL_REVIEW',
        'PARSE_FAILED',
        'The public page did not expose any recognizable profile fields; manual verification required',
        false,
        this.raw(payload, normalizedUrl),
      );
    }

    fields.data.source = { platform: 'linkedin', url: normalizedUrl, retrievedAt };
    return normalizeOutcome(fields.data, fields.provenance, { provider: this.name, raw: this.raw(payload, normalizedUrl) });
  }

  /// Detection ladder for HTTP (and Jina body) status codes. Refusals go to
  /// MANUAL_REVIEW and are never retried; only server-side failures are.
  private classifyHttpStatus(status: number, message?: string): ResearchOutcome | null {
    const suffix = message ? `: ${sanitizeSecrets(message).slice(0, 200)}` : '';
    if (status === 429 || status === 999) {
      return failureOutcome(this.name, 'MANUAL_REVIEW', 'RATE_LIMITED', `LinkedIn rate-limited the request (HTTP ${status})${suffix}; manual verification required`);
    }
    if (status === 401 || status === 403) {
      return failureOutcome(this.name, 'MANUAL_REVIEW', 'LOGIN_REQUIRED', `LinkedIn requires a signed-in session for this page (HTTP ${status})${suffix}; manual verification required`);
    }
    if (status === 404 || status === 410) {
      return failureOutcome(this.name, 'UNAVAILABLE', 'PAGE_UNAVAILABLE', `The LinkedIn page was not found (HTTP ${status})${suffix}`);
    }
    if (status >= 500) {
      return failureOutcome(this.name, 'FAILED', 'PROVIDER_UNAVAILABLE', `Reader returned HTTP ${status}${suffix}`, true);
    }
    if (status >= 300) {
      // Redirects are not followed and other 4xx codes are reader-side; both
      // step aside so the chain falls through to manual with the reason.
      return failureOutcome(this.name, 'UNAVAILABLE', 'PROVIDER_UNAVAILABLE', `Reader returned HTTP ${status}${suffix}`, false);
    }
    return null;
  }

  private raw(payload: ReaderPayload, normalizedUrl: string): Record<string, unknown> {
    return {
      title: payload.title ? sanitizeSecrets(payload.title).slice(0, 300) : null,
      url: payload.url ?? normalizedUrl,
      contentPreview: sanitizeSecrets(payload.content.slice(0, CONTENT_PREVIEW_LIMIT)),
      fetchedVia: 'jina-reader',
    };
  }
}

// ─── Body parsing ─────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function parseReaderBody(text: string, contentType: string | null): ReaderPayload {
  const looksJson = (contentType ?? '').includes('json') || /^\s*[{[]/.test(text);
  if (looksJson) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (isRecord(parsed)) {
        const data = isRecord(parsed.data) ? parsed.data : parsed;
        return {
          code: asNumber(parsed.code),
          message: asString(parsed.message),
          title: asString(data.title),
          description: asString(data.description),
          url: asString(data.url),
          content: asString(data.content) ?? asString(data.text) ?? '',
        };
      }
    } catch {
      // Not JSON after all; fall through to the text format.
    }
  }
  const title = /^Title:\s*(.+)$/m.exec(text)?.[1]?.trim();
  const url = /^URL Source:\s*(\S+)$/m.exec(text)?.[1];
  const marker = 'Markdown Content:';
  const index = text.indexOf(marker);
  const content = index >= 0 ? text.slice(index + marker.length).trim() : text;
  return { title, url, content };
}

// ─── Authwall detection ───────────────────────────────────────────────────────

const AUTHWALL_URL = /authwall|\/login\b|checkpoint|uas\/login|\/signup\b|\/uas\//i;
const AUTHWALL_TITLE = /^\s*(sign in|sign up|log in|join linkedin|linkedin login|linkedin: log in|security verification)\b|^\s*linkedin\s*$/i;
const AUTHWALL_CONTENT =
  /sign in to (view|see|continue|access)|join linkedin|join now to (see|view)|security verification|please verify|you must (sign|log) in|log in to linkedin|sign in to linkedin|authwall/i;

export function isAuthwall(payload: ReaderPayload): boolean {
  if (payload.url && AUTHWALL_URL.test(payload.url)) return true;
  if (payload.title && AUTHWALL_TITLE.test(payload.title)) return true;
  const head = payload.content.slice(0, 800);
  if (AUTHWALL_CONTENT.test(head)) return true;
  if (payload.content.trim().length < MIN_CONTENT_LENGTH) return true;
  return false;
}

// ─── Field extraction ─────────────────────────────────────────────────────────

/// Anything that looks like an email or phone number is never stored, even
/// when it sits inside an otherwise useful line (a tagline with a hotline).
const CONTACT_DATA = /[\w.+-]+@[\w-]+\.[\w.-]+|\+?\d[\d\s().-]{7,}\d/;
const GENERIC_TITLES = /^(linkedin|sign in|sign up|join now|log in|home|overview)$/i;
const SECTION_LABELS = /^(industry|industries|company size|headquarters|website|type|founded|specialties|locations|employees|about|overview|location|experience|education|posts|jobs|people|followers)$/i;
const COMPANY_SUFFIXES = /^(inc|llc|ltd|corp|co|gmbh|limited|incorporated|plc|sa|ag|bv|srl|pty|llp)\.?$/i;
const EMPLOYEE_RANGE = /(\d[\d,]*)\s*[-–]\s*(\d[\d,]*)\+?\s+employees/i;
const EMPLOYEE_PLUS = /(\d[\d,]*)\+\s+employees/i;

function cleanText(value: string | undefined, max = 200): string | undefined {
  if (!value) return undefined;
  const cleaned = value
    .replace(/[*_`#>]+/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length === 0) return undefined;
  if (CONTACT_DATA.test(cleaned)) return undefined;
  return cleaned.slice(0, max);
}

function stripLinkedInSuffix(title: string): string {
  return title
    .replace(/\s*[|\-–—]\s*LinkedIn\s*$/i, '')
    .replace(/:\s*(Overview|About|Posts|Jobs|People)\s*$/i, '')
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/// "Industry\n\nSoftware Development" or "Industry: Software Development".
function labelledValue(content: string, label: string): string | undefined {
  const pattern = new RegExp(`(?:^|\\n)[ \\t#*_]*${escapeRegExp(label)}[ \\t*_]*:?[ \\t]*(?:\\n[ \\t]*)*([^\\n]{1,200})`, 'i');
  const match = pattern.exec(content);
  const value = match?.[1]?.trim();
  if (!value || SECTION_LABELS.test(value.replace(/[*_#:]/g, '').trim())) return undefined;
  return cleanText(value);
}

function employeeRange(text: string): string | undefined {
  const range = EMPLOYEE_RANGE.exec(text);
  if (range?.[1] && range[2]) return `${range[1]}-${range[2]} employees`;
  const plus = EMPLOYEE_PLUS.exec(text);
  if (plus?.[1]) return `${plus[1]}+ employees`;
  return undefined;
}

/// A line that is exactly "City, Region" — the weakest signal we accept, so
/// it is 0.4 and skipped when a labelled headquarters exists.
function cityRegionLine(content: string): string | undefined {
  const pattern = /^[ \t]*([A-Z][A-Za-z.' -]{1,40}?),[ \t]+([A-Z][A-Za-z.' -]{1,40}?)[ \t]*$/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const city = match[1]?.trim();
    const region = match[2]?.trim();
    if (!city || !region) continue;
    if (COMPANY_SUFFIXES.test(region) || SECTION_LABELS.test(city) || SECTION_LABELS.test(region)) continue;
    return `${city}, ${region}`;
  }
  return undefined;
}

function externalWebsite(content: string): string | undefined {
  const candidates: string[] = [];
  const labelled = labelledValue(content, 'Website');
  if (labelled) candidates.push(labelled);
  const link = /\[\s*Website\s*\]\((https?:\/\/[^)\s]+)\)/i.exec(content)?.[1];
  if (link) candidates.push(link);
  for (const candidate of candidates) {
    const urlText = /https?:\/\/\S+/i.exec(candidate)?.[0] ?? candidate;
    try {
      const url = new URL(urlText.startsWith('http') ? urlText : `https://${urlText}`);
      const host = url.hostname.toLowerCase();
      if (host === 'linkedin.com' || host.endsWith('.linkedin.com') || host === 'lnkd.in') continue;
      if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
      return `${url.protocol}//${url.host}${url.pathname === '/' ? '' : url.pathname}`;
    } catch {
      continue;
    }
  }
  return undefined;
}

function entry(
  field: string,
  value: unknown,
  confidence: number,
  sourceUrl: string,
  retrievedAt: string,
): ResearchProvenanceEntry {
  return {
    field,
    value,
    source: 'LINKEDIN_PUBLIC',
    sourceUrl,
    provider: 'public',
    retrievedAt,
    confidence,
    verification: 'INFERRED',
  };
}

export function parseCompany(payload: ReaderPayload, normalizedUrl: string, retrievedAt: string): ParsedFields {
  const company: LinkedInCompanyData = { url: normalizedUrl };
  const provenance: ResearchProvenanceEntry[] = [entry('company.url', normalizedUrl, CORE_CONFIDENCE, normalizedUrl, retrievedAt)];
  const content = payload.content;
  const description = payload.description ?? '';

  const name = cleanText(stripLinkedInSuffix(payload.title ?? ''), 200);
  if (name && !GENERIC_TITLES.test(name)) {
    company.name = name;
    provenance.push(entry('company.name', name, CORE_CONFIDENCE, normalizedUrl, retrievedAt));
  }

  const range = employeeRange(content) ?? employeeRange(description);
  if (range) {
    company.employeeRange = range;
    provenance.push(entry('company.employeeRange', range, CORE_CONFIDENCE, normalizedUrl, retrievedAt));
  }

  const industry = labelledValue(content, 'Industry') ?? labelledValue(content, 'Industries');
  if (industry) {
    company.industry = industry;
    provenance.push(entry('company.industry', industry, CORE_CONFIDENCE, normalizedUrl, retrievedAt));
  }

  const location = labelledValue(content, 'Headquarters') ?? cityRegionLine(content);
  if (location) {
    company.location = location;
    provenance.push(entry('company.location', location, SECONDARY_CONFIDENCE, normalizedUrl, retrievedAt));
  }

  const website = externalWebsite(content);
  if (website) {
    company.website = website;
    provenance.push(entry('company.website', website, SECONDARY_CONFIDENCE, normalizedUrl, retrievedAt));
  }

  // Jina's description for a company page reads
  // "Acme | 1,234 followers on LinkedIn. Tagline here | About text". The
  // follower count is deliberately not captured.
  const tagline = cleanText(/followers on LinkedIn\.?\s*([^|]+?)(?:\s*\||$)/i.exec(description)?.[1], 200);
  if (tagline) {
    company.tagline = tagline;
    provenance.push(entry('company.tagline', tagline, SECONDARY_CONFIDENCE, normalizedUrl, retrievedAt));
  }

  return { data: { company }, provenance };
}

export function parsePerson(payload: ReaderPayload, normalizedUrl: string, retrievedAt: string): ParsedFields {
  const person: LinkedInPersonData = { profileUrl: normalizedUrl };
  const provenance: ResearchProvenanceEntry[] = [entry('person.profileUrl', normalizedUrl, CORE_CONFIDENCE, normalizedUrl, retrievedAt)];
  const content = payload.content;
  const description = payload.description ?? '';

  // "Jane Doe - CTO - Acme | LinkedIn", "Jane Doe – CTO | LinkedIn", "Jane Doe | LinkedIn".
  const parts = stripLinkedInSuffix(payload.title ?? '')
    .split(/\s+[-–—]\s+/)
    .map((part) => cleanText(part, 200))
    .filter((part): part is string => Boolean(part));
  const [namePart, titlePart, companyPart] = parts;

  if (namePart && !GENERIC_TITLES.test(namePart)) {
    person.fullName = namePart;
    provenance.push(entry('person.fullName', namePart, CORE_CONFIDENCE, normalizedUrl, retrievedAt));
    const tokens = namePart.split(/\s+/);
    if (tokens.length === 2 && tokens[0] && tokens[1]) {
      person.firstName = tokens[0];
      person.lastName = tokens[1];
      provenance.push(entry('person.firstName', tokens[0], SECONDARY_CONFIDENCE, normalizedUrl, retrievedAt));
      provenance.push(entry('person.lastName', tokens[1], SECONDARY_CONFIDENCE, normalizedUrl, retrievedAt));
    }
  }
  if (titlePart) {
    person.title = titlePart;
    provenance.push(entry('person.title', titlePart, CORE_CONFIDENCE, normalizedUrl, retrievedAt));
  }

  const company = companyPart ?? cleanText(/Experience:\s*([^·|\n]+)/i.exec(description)?.[1], 200);
  if (company) {
    person.company = company;
    provenance.push(entry('person.company', company, SECONDARY_CONFIDENCE, normalizedUrl, retrievedAt));
  }

  const location = cleanText(/Location:\s*([^·|\n]+)/i.exec(description)?.[1], 200) ?? labelledValue(content, 'Location');
  if (location) {
    person.location = location;
    provenance.push(entry('person.location', location, SECONDARY_CONFIDENCE, normalizedUrl, retrievedAt));
  }

  return { data: { person }, provenance };
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === 'AbortError') ||
    (typeof error === 'object' && error !== null && (error as { name?: string }).name === 'AbortError')
  );
}

export const publicProvider = new PublicLinkedInProvider();
