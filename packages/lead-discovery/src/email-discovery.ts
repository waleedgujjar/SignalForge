import type { AnalysisConfig, CrawlResult } from '@signalforge/website-scanner';
import { crawlWebsite } from '@signalforge/website-scanner';

import { normalizeEmail } from './normalization.js';
import type { NormalizedLead } from './normalization.js';

// ─── Types ────────────────────────────────────────────────────────────────────

type ExtractedEmailSource = 'MAILTO' | 'PAGE_TEXT';

export interface EmailCandidate {
  email: string;
  source: ExtractedEmailSource;
  pageUrl: string;
  priority: number;
}

export interface EmailDiscoveryResult {
  email: string;
  source: ExtractedEmailSource;
  confidence: number;
  pageUrl: string;
  allCandidates: EmailCandidate[];
}

export interface EmailDiscoveryConfig {
  maxPages?: number;
  requestTimeoutMs?: number;
  maxConcurrency?: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const JUNK_LOCAL_PARTS = new Set([
  'noreply', 'no-reply', 'no_reply',
  'donotreply', 'do-not-reply', 'do_not_reply',
  'mailer-daemon', 'mailer_daemon', 'mailerdaemon',
  'postmaster',
  'bounce', 'bounces',
  'auto-reply', 'auto_reply', 'autoreply',
  'nobody',
  'devnull', 'dev-null',
]);

const ROLE_PRIORITY: Record<string, number> = {
  sales: 2,
  contact: 3,
  hello: 4,
  hi: 4,
  enquiries: 4,
  inquiries: 4,
  info: 5,
  information: 5,
  support: 6,
  help: 6,
  admin: 7,
  office: 7,
  team: 4,
  general: 7,
  reception: 7,
  billing: 7,
  accounts: 7,
  marketing: 3,
  service: 6,
};

const PRIORITY_PATHS = [
  '/',
  '/contact',
  '/contact-us',
  '/about',
  '/about-us',
  '/team',
  '/get-in-touch',
  '/reach-us',
  '/our-team',
  '/staff',
];

const BLOCKED_PATHS = [
  '/login',
  '/admin',
  '/cart',
  '/checkout',
  '/account',
  '/logout',
  '/register',
  '/signup',
  '/sign-up',
  '/privacy',
  '/terms',
  '/blog',
];

const UUID_HASH_PATTERN = /^[a-f0-9]{8,}$/;
const HEX_SEPARATED_PATTERN = /^[a-f0-9]+(-[a-f0-9]+){3,}$/;

// ─── Email Extraction ─────────────────────────────────────────────────────────

export function extractEmailsFromHtml(html: string, pageUrl: string): EmailCandidate[] {
  const candidates: EmailCandidate[] = [];
  const seen = new Set<string>();

  const mailtoPattern = /href\s*=\s*["']mailto:([^"'?]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = mailtoPattern.exec(html)) !== null) {
    const raw = match[1];
    if (!raw) continue;
    const normalized = normalizeEmail(raw);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      candidates.push({ email: normalized, source: 'MAILTO', pageUrl, priority: 0 });
    }
  }

  const textPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  while ((match = textPattern.exec(html)) !== null) {
    const raw = match[0];
    const normalized = normalizeEmail(raw);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      candidates.push({ email: normalized, source: 'PAGE_TEXT', pageUrl, priority: 0 });
    }
  }

  return candidates;
}

// ─── Junk Filtering ───────────────────────────────────────────────────────────

export function isJunkEmail(email: string): boolean {
  const atIndex = email.indexOf('@');
  if (atIndex === -1) return true;
  const localPart = email.slice(0, atIndex).toLowerCase();
  const domain = email.slice(atIndex + 1).toLowerCase();

  if (JUNK_LOCAL_PARTS.has(localPart)) return true;
  if (domain.includes('signalforge')) return true;
  if (UUID_HASH_PATTERN.test(localPart)) return true;
  if (HEX_SEPARATED_PATTERN.test(localPart)) return true;
  if (/^\d+$/.test(localPart)) return true;

  return false;
}

export function filterJunkEmails(candidates: EmailCandidate[]): EmailCandidate[] {
  return candidates.filter((c) => !isJunkEmail(c.email));
}

// ─── Ranking ──────────────────────────────────────────────────────────────────

export function getEmailPriority(email: string): number {
  const atIndex = email.indexOf('@');
  if (atIndex === -1) return 99;
  const localPart = email.slice(0, atIndex).toLowerCase();

  const rolePriority = ROLE_PRIORITY[localPart];
  if (rolePriority !== undefined) return rolePriority;

  // Not a known role → likely a personal name → highest priority
  return 1;
}

export function rankEmails(candidates: EmailCandidate[]): EmailCandidate[] {
  return candidates
    .map((c) => ({ ...c, priority: getEmailPriority(c.email) }))
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      if (a.source !== b.source) return a.source === 'MAILTO' ? -1 : 1;
      return 0;
    });
}

// ─── Single Domain Discovery ──────────────────────────────────────────────────

export async function discoverEmail(
  websiteUrl: string,
  config: EmailDiscoveryConfig = {},
): Promise<EmailDiscoveryResult | null> {
  const crawlConfig: AnalysisConfig = {
    maxPages: config.maxPages ?? 3,
    requestTimeoutMs: config.requestTimeoutMs ?? 10_000,
    maxResponseBytes: 5 * 1024 * 1024,
    maxRedirects: 5,
    interRequestDelayMs: 1000,
    priorityPaths: PRIORITY_PATHS,
    blockedPaths: BLOCKED_PATHS,
  };

  let crawlResult: CrawlResult;
  try {
    crawlResult = await crawlWebsite(websiteUrl, crawlConfig);
  } catch {
    return null;
  }

  if (crawlResult.pages.length === 0) return null;

  const allCandidates: EmailCandidate[] = [];
  const seenEmails = new Set<string>();

  for (const page of crawlResult.pages) {
    const pageCandidates = extractEmailsFromHtml(page.html, page.url);
    for (const candidate of pageCandidates) {
      if (!seenEmails.has(candidate.email)) {
        seenEmails.add(candidate.email);
        allCandidates.push(candidate);
      }
    }
  }

  if (allCandidates.length === 0) return null;

  const filtered = filterJunkEmails(allCandidates);
  if (filtered.length === 0) return null;

  const ranked = rankEmails(filtered);
  const best = ranked[0]!;

  let confidence = best.source === 'MAILTO' ? 80 : 60;
  if (best.priority === 1) confidence += 10;
  const contactPaths = ['/contact', '/contact-us', '/get-in-touch', '/reach-us'];
  if (contactPaths.some((p) => best.pageUrl.includes(p))) confidence += 5;
  confidence = Math.min(confidence, 100);

  return {
    email: best.email,
    source: best.source,
    confidence,
    pageUrl: best.pageUrl,
    allCandidates: ranked,
  };
}

// ─── Batch Discovery (domain dedup) ───────────────────────────────────────────

export async function discoverEmailForLeads(
  leads: NormalizedLead[],
  config: EmailDiscoveryConfig = {},
): Promise<Map<string, EmailDiscoveryResult | null>> {
  const domainToUrl = new Map<string, string>();
  for (const lead of leads) {
    const domain = lead.normalizedDomain;
    if (!domain || domainToUrl.has(domain)) continue;
    const url = lead.website ?? `https://${domain}`;
    domainToUrl.set(domain, url);
  }

  const results = new Map<string, EmailDiscoveryResult | null>();
  const domains = [...domainToUrl.entries()];
  const concurrency = config.maxConcurrency ?? 3;

  let cursor = 0;
  const size = Math.max(1, Math.min(concurrency, domains.length));

  await Promise.all(
    Array.from({ length: size }, async () => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= domains.length) return;
        const [domain, url] = domains[index]!;
        try {
          const result = await discoverEmail(url, config);
          results.set(domain, result);
        } catch {
          results.set(domain, null);
        }
      }
    }),
  );

  return results;
}
