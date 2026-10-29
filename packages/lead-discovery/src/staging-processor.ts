import { prisma, Prisma, type StagedLeadStatus } from '@signalforge/database';
import {
  normalizeEmail,
  normalizePhone,
  normalizeDomain,
  normalizeWebsite,
  normalizeLead,
} from './normalization.js';
import { persistLeadBatch, type ProcessedImportRow } from './import-processor.js';

// ─── Large Lead Data staging: mapping, cleaning, dedup, categorization ────────

export const STAGING_FIELDS = [
  'username',
  'name',
  'bio',
  'category',
  'website',
  'email',
  'phone',
] as const;
export type StagingField = (typeof STAGING_FIELDS)[number];

const STAGING_ALIASES: Record<string, StagingField> = {
  // username
  username: 'username',
  'user name': 'username',
  handle: 'username',
  account: 'username',
  'account name': 'username',
  'instagram username': 'username',
  'ig username': 'username',
  'profile username': 'username',
  'social handle': 'username',
  'screen name': 'username',
  // name
  name: 'name',
  'full name': 'name',
  'business name': 'name',
  'company name': 'name',
  company: 'name',
  'profile name': 'name',
  'display name': 'name',
  'page name': 'name',
  // bio
  bio: 'bio',
  biography: 'bio',
  description: 'bio',
  about: 'bio',
  'about us': 'bio',
  'profile description': 'bio',
  'business description': 'bio',
  summary: 'bio',
  // category
  category: 'category',
  'business category': 'category',
  industry: 'category',
  niche: 'category',
  'business type': 'category',
  'company category': 'category',
  // website
  website: 'website',
  'web site': 'website',
  url: 'website',
  'website url': 'website',
  link: 'website',
  'external url': 'website',
  site: 'website',
  homepage: 'website',
  domain: 'website',
  'company website': 'website',
  // email
  email: 'email',
  'email address': 'email',
  'e mail': 'email',
  'e mail address': 'email',
  'contact email': 'email',
  'business email': 'email',
  'professional email': 'email',
  mail: 'email',
  // phone
  phone: 'phone',
  'phone number': 'phone',
  'contact number': 'phone',
  'phone no': 'phone',
  mobile: 'phone',
  'mobile number': 'phone',
  telephone: 'phone',
  tel: 'phone',
  whatsapp: 'phone',
  'whatsapp number': 'phone',
};

function normalizeHeader(header: string): string {
  return header
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const URL_RE = /^(https?:\/\/|www\.)|\.[a-z]{2,}(\/|$)/i;
const PHONE_RE = /^\+?[\d\s().-]{7,20}$/;

/**
 * Map file headers to the 7 staging fields: exact/alias header matches first,
 * then value inference (email/website/phone) for still-unmapped columns.
 * One source column per target field (first match wins).
 */
export function detectStagingMappings(
  headers: string[],
  sampleRows: Record<string, string>[] = [],
  overrides?: Record<string, string>,
): Record<string, StagingField> {
  const mappings: Record<string, StagingField> = {};
  const used = new Set<StagingField>();

  if (overrides) {
    for (const [header, field] of Object.entries(overrides)) {
      if ((STAGING_FIELDS as readonly string[]).includes(field) && !used.has(field as StagingField)) {
        mappings[header] = field as StagingField;
        used.add(field as StagingField);
      }
    }
  }

  for (const header of headers) {
    if (mappings[header]) continue;
    const field = STAGING_ALIASES[normalizeHeader(header)];
    if (field && !used.has(field)) {
      mappings[header] = field;
      used.add(field);
    }
  }

  if (sampleRows.length > 0) {
    for (const header of headers) {
      if (mappings[header]) continue;
      const values = sampleRows
        .map((r) => (r[header] ?? '').trim())
        .filter((v) => v !== '')
        .slice(0, 25);
      if (values.length < 3) continue;
      const ratio = (re: RegExp) => values.filter((v) => re.test(v)).length / values.length;
      if (!used.has('email') && ratio(EMAIL_RE) > 0.6) {
        mappings[header] = 'email';
        used.add('email');
      } else if (!used.has('website') && ratio(URL_RE) > 0.6 && ratio(EMAIL_RE) < 0.2) {
        mappings[header] = 'website';
        used.add('website');
      } else if (!used.has('phone') && ratio(PHONE_RE) > 0.6) {
        mappings[header] = 'phone';
        used.add('phone');
      }
    }
  }

  return mappings;
}

export function normalizeUsername(value?: string | null): string | null {
  if (!value) return null;
  let v = value.trim().toLowerCase();
  if (!v) return null;
  // Accept profile URLs (instagram.com/handle, tiktok.com/@handle, …):
  // keep the last non-empty path segment.
  if (v.includes('/')) {
    const segments = v
      .replace(/^https?:\/\//, '')
      .split('/')
      .map((s) => s.trim())
      .filter(Boolean);
    v = segments.length > 1 ? segments[segments.length - 1]! : (segments[0] ?? '');
  }
  v = (v.split('?')[0] ?? '').replace(/^@+/, '').trim();
  if (!v || v.length > 100) return null;
  return v;
}

/** Domains that identify a platform, not a business — excluded from domain dedup. */
const PLATFORM_DOMAINS = new Set([
  'instagram.com',
  'facebook.com',
  'fb.com',
  'linkedin.com',
  'twitter.com',
  'x.com',
  'tiktok.com',
  'youtube.com',
  'linktr.ee',
  'beacons.ai',
  'wa.me',
  'bit.ly',
  'google.com',
  'goo.gl',
]);

export interface CategoryResult {
  category: string;
  confidence: number;
  reason: string;
}

const CATEGORY_RULES: Array<{ category: string; keywords: string[] }> = [
  { category: 'Photography', keywords: ['photograph', 'photo studio', 'fotograf', 'photoshoot'] },
  { category: 'Videography', keywords: ['videograph', 'video production', 'filmmaker', 'film maker'] },
  { category: 'Software & SaaS', keywords: ['software', 'saas', 'web develop', 'app develop', 'tech company', 'it services', 'developer'] },
  { category: 'Marketing & Advertising', keywords: ['marketing', 'seo ', ' seo', 'advertis', 'social media manag', 'growth agency', 'media agency', 'digital agency'] },
  { category: 'Design', keywords: ['graphic design', 'ui/ux', 'ux design', 'branding', 'web design', 'interior design', 'designer'] },
  { category: 'Consulting & Coaching', keywords: ['consult', 'coach', 'mentor', 'advisor'] },
  { category: 'Real Estate', keywords: ['real estate', 'realtor', 'realty', 'property manag', 'properties'] },
  { category: 'Food & Beverage', keywords: ['restaurant', 'cafe', 'coffee', 'bakery', 'catering', 'food truck', 'pizzeria', 'bar & grill'] },
  { category: 'Health & Fitness', keywords: ['fitness', ' gym', 'gym ', 'personal trainer', 'yoga', 'pilates', 'wellness', 'nutrition', 'physiotherap', 'chiropract'] },
  { category: 'Beauty & Salon', keywords: ['salon', 'beauty', 'makeup', 'hairstyl', 'hair studio', ' spa', 'spa ', 'nails', 'barber', 'lashes', 'esthetic'] },
  { category: 'Medical & Dental', keywords: ['dental', 'dentist', 'clinic', 'medical', 'dermatolog', 'pediatric', 'veterinar'] },
  { category: 'Legal', keywords: ['law firm', 'attorney', 'lawyer', 'legal services'] },
  { category: 'Finance & Accounting', keywords: ['accounting', 'accountant', 'bookkeep', 'financial', 'tax service', 'insurance', 'mortgage'] },
  { category: 'Construction & Home Services', keywords: ['construction', 'contractor', 'plumb', 'roofing', 'hvac', 'electrician', 'landscap', 'cleaning service', 'remodel', 'painting'] },
  { category: 'Automotive', keywords: ['automotive', 'car dealer', 'auto repair', 'auto detail', 'car wash', 'mechanic'] },
  { category: 'E-commerce & Retail', keywords: ['e-commerce', 'ecommerce', 'online store', 'boutique', 'shopify', 'retail', 'clothing brand', 'apparel'] },
  { category: 'Education', keywords: ['school', 'academy', 'tutor', 'education', 'university', 'learning center', 'courses'] },
  { category: 'Travel & Hospitality', keywords: ['travel', 'hotel', 'tour ', 'tours', 'hospitality', 'resort', 'airbnb'] },
  { category: 'Events & Entertainment', keywords: ['wedding', 'event plann', ' dj ', 'entertainment', 'music', 'band', 'artist'] },
  { category: 'Nonprofit', keywords: ['nonprofit', 'non-profit', 'charity', 'foundation', 'ngo'] },
];

export const UNCATEGORIZED = 'Uncategorized';

function cleanProvidedCategory(value: string): string {
  const cleaned = value.trim().replace(/\s+/g, ' ').slice(0, 60);
  return cleaned
    .toLowerCase()
    .split(' ')
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ');
}

export function categorizeStagedLead(input: {
  category?: string | null;
  bio?: string | null;
  name?: string | null;
  website?: string | null;
  username?: string | null;
}): CategoryResult {
  const provided = input.category?.trim();
  if (provided) {
    return { category: cleanProvidedCategory(provided), confidence: 1, reason: 'provided in file' };
  }

  const haystack = ` ${[input.bio, input.name, input.website, input.username]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()} `;
  if (haystack.trim()) {
    for (const rule of CATEGORY_RULES) {
      const hit = rule.keywords.find((kw) => haystack.includes(kw));
      if (hit) {
        return { category: rule.category, confidence: 0.7, reason: `matched "${hit.trim()}"` };
      }
    }
  }

  return { category: UNCATEGORIZED, confidence: 0, reason: 'insufficient evidence' };
}

export interface StagedLeadFilter {
  status?: StagedLeadStatus;
  category?: string;
  hasEmail?: boolean;
  hasWebsite?: boolean;
  search?: string;
  notImported?: boolean;
}

export function buildStagedLeadWhere(
  datasetId: string,
  filter: StagedLeadFilter = {},
): Prisma.StagedLeadWhereInput {
  const where: Prisma.StagedLeadWhereInput = { datasetId };
  if (filter.status) where.status = filter.status;
  if (filter.category === UNCATEGORIZED) {
    where.OR = [{ assignedCategory: UNCATEGORIZED }, { assignedCategory: null }];
  } else if (filter.category) {
    where.assignedCategory = filter.category;
  }
  if (filter.hasEmail === true) where.normalizedEmail = { not: null };
  else if (filter.hasEmail === false) where.normalizedEmail = null;
  if (filter.hasWebsite === true) where.website = { not: null };
  else if (filter.hasWebsite === false) where.website = null;
  if (filter.notImported) where.importedLeadId = null;
  if (filter.search) {
    const contains = { contains: filter.search, mode: 'insensitive' as const };
    const search: Prisma.StagedLeadWhereInput[] = [
      { username: contains },
      { name: contains },
      { email: contains },
      { website: contains },
    ];
    where.AND = [{ OR: search }];
  }
  return where;
}

/** Build one StagedLead row from a raw file row using the column mappings. */
export function buildStagedLeadData(
  row: Record<string, string>,
  mappings: Record<string, StagingField>,
  context: { datasetId: string; workspaceId: string; sourceRow: number },
): Prisma.StagedLeadCreateManyInput {
  const value = (field: StagingField): string | null => {
    for (const [header, mapped] of Object.entries(mappings)) {
      if (mapped !== field) continue;
      const raw = row[header];
      if (raw !== undefined && raw !== null && String(raw).trim() !== '') return String(raw).trim();
    }
    return null;
  };

  const username = value('username');
  const name = value('name');
  const bio = value('bio');
  const category = value('category');
  const websiteRaw = value('website');
  const email = value('email');
  const phone = value('phone');

  const normalizedEmail = normalizeEmail(email);
  const normalizedPhone = normalizePhone(phone);
  const website = normalizeWebsite(websiteRaw) ?? websiteRaw;
  const domain = normalizeDomain(websiteRaw);
  const websiteDomain = domain && !PLATFORM_DOMAINS.has(domain) ? domain : null;
  const normalizedUsername = normalizeUsername(username);

  const hasIdentity = Boolean(normalizedEmail || normalizedPhone || normalizedUsername || websiteDomain || name);
  const categorized = categorizeStagedLead({ category, bio, name, website, username });

  return {
    datasetId: context.datasetId,
    workspaceId: context.workspaceId,
    username,
    name,
    bio: bio ? bio.slice(0, 2000) : null,
    category,
    website,
    email,
    phone,
    normalizedEmail,
    normalizedPhone,
    websiteDomain,
    normalizedUsername,
    status: hasIdentity ? 'UNIQUE' : 'INVALID',
    dedupReason: hasIdentity ? null : 'No usable identifying information',
    assignedCategory: categorized.category,
    categoryConfidence: categorized.confidence,
    categoryReason: categorized.reason,
    rawData: row as unknown as Prisma.InputJsonValue,
    sourceRow: context.sourceRow,
  };
}

// ─── Dedup (SQL passes; deterministic keys, flags only — nothing is deleted) ──

interface DedupKeySpec {
  column: 'normalizedEmail' | 'normalizedPhone' | 'normalizedUsername' | 'websiteDomain';
  reason: string;
}

const DEDUP_KEYS: DedupKeySpec[] = [
  { column: 'normalizedEmail', reason: 'Same email as an earlier row' },
  { column: 'normalizedPhone', reason: 'Same phone number as an earlier row' },
  { column: 'normalizedUsername', reason: 'Same username as an earlier row' },
  { column: 'websiteDomain', reason: 'Same website domain as an earlier row' },
];

export interface DedupSummary {
  duplicates: number;
  review: number;
}

/**
 * Mark duplicates within a dataset. Priority: email > phone > username > domain.
 * The earliest row (lowest sourceRow) per key stays canonical; later rows become
 * DUPLICATE with a reason. Same-name-only matches are flagged REVIEW, never
 * removed. Idempotent: operates only on rows still marked UNIQUE.
 */
export async function dedupDataset(datasetId: string): Promise<DedupSummary> {
  // The dataset's rows were just bulk-inserted, so table statistics still
  // describe the table from before the insert; without this the planner picks
  // nested-loop joins over the fresh rows and the dedup UPDATEs take minutes.
  await prisma.$executeRaw`ANALYZE "StagedLead"`;

  let duplicates = 0;

  for (const key of DEDUP_KEYS) {
    const col = Prisma.raw(`"${key.column}"`);
    const changed = await prisma.$executeRaw`
      UPDATE "StagedLead" AS s
      SET "status" = 'DUPLICATE', "duplicateOfId" = k.keep_id, "dedupReason" = ${key.reason}
      FROM (
        SELECT ${col} AS key, (ARRAY_AGG("id" ORDER BY "sourceRow" ASC))[1] AS keep_id
        FROM "StagedLead"
        WHERE "datasetId" = ${datasetId} AND ${col} IS NOT NULL AND "status" <> 'INVALID'
        GROUP BY ${col}
        HAVING COUNT(*) > 1
      ) AS k
      WHERE s."datasetId" = ${datasetId}
        AND s."status" = 'UNIQUE'
        AND s.${col} = k.key
        AND s."id" <> k.keep_id
    `;
    duplicates += changed;
  }

  // Same display name only: ambiguous — flag for manual review, never auto-remove.
  const review = await prisma.$executeRaw`
    UPDATE "StagedLead" AS s
    SET "status" = 'REVIEW', "dedupReason" = 'Same name as another row - verify manually'
    FROM (
      SELECT LOWER(TRIM("name")) AS key, (ARRAY_AGG("id" ORDER BY "sourceRow" ASC))[1] AS keep_id
      FROM "StagedLead"
      WHERE "datasetId" = ${datasetId} AND "name" IS NOT NULL AND TRIM("name") <> '' AND "status" = 'UNIQUE'
      GROUP BY LOWER(TRIM("name"))
      HAVING COUNT(*) > 1
    ) AS k
    WHERE s."datasetId" = ${datasetId}
      AND s."status" = 'UNIQUE'
      AND LOWER(TRIM(s."name")) = k.key
      AND s."id" <> k.keep_id
  `;

  // Email already present in another dataset of this workspace: flag, don't drop.
  await prisma.$executeRaw`
    UPDATE "StagedLead" AS s
    SET "status" = 'REVIEW', "dedupReason" = 'Email also exists in another dataset'
    WHERE s."datasetId" = ${datasetId}
      AND s."status" = 'UNIQUE'
      AND s."normalizedEmail" IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM "StagedLead" o
        WHERE o."workspaceId" = s."workspaceId"
          AND o."normalizedEmail" = s."normalizedEmail"
          AND o."datasetId" <> ${datasetId}
      )
  `;

  return { duplicates, review };
}

const MERGEABLE_FIELDS = ['username', 'name', 'bio', 'category', 'website', 'email', 'phone'] as const;

/** Fill empty fields on canonical rows from their duplicates (non-destructive). */
export async function mergeDuplicateFieldsIntoCanonicals(datasetId: string): Promise<number> {
  let merged = 0;
  let cursor: string | undefined;

  for (;;) {
    const dupes = await prisma.stagedLead.findMany({
      where: { datasetId, status: 'DUPLICATE', duplicateOfId: { not: null } },
      orderBy: { id: 'asc' },
      take: 1000,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (dupes.length === 0) break;
    cursor = dupes[dupes.length - 1]!.id;

    const canonicalIds = [...new Set(dupes.map((d) => d.duplicateOfId!))];
    const canonicals = await prisma.stagedLead.findMany({ where: { id: { in: canonicalIds } } });
    const byId = new Map(canonicals.map((c) => [c.id, c]));

    const updates: Prisma.PrismaPromise<unknown>[] = [];
    for (const dupe of dupes) {
      const canonical = byId.get(dupe.duplicateOfId!);
      if (!canonical) continue;
      const data: Record<string, unknown> = {};
      for (const field of MERGEABLE_FIELDS) {
        if (!canonical[field] && dupe[field]) data[field] = dupe[field];
      }
      if (!canonical.normalizedEmail && dupe.normalizedEmail) data.normalizedEmail = dupe.normalizedEmail;
      if (!canonical.normalizedPhone && dupe.normalizedPhone) data.normalizedPhone = dupe.normalizedPhone;
      if (!canonical.websiteDomain && dupe.websiteDomain) data.websiteDomain = dupe.websiteDomain;
      if (!canonical.normalizedUsername && dupe.normalizedUsername) data.normalizedUsername = dupe.normalizedUsername;
      if (Object.keys(data).length > 0) {
        updates.push(prisma.stagedLead.update({ where: { id: canonical.id }, data }));
        // Keep the local copy current so later dupes of the same canonical don't re-write.
        Object.assign(canonical, data);
        merged++;
      }
    }
    if (updates.length > 0) await prisma.$transaction(updates);
    if (dupes.length < 1000) break;
  }

  return merged;
}

/** Recompute all dataset counters from the staged rows. */
export async function recomputeDatasetStats(datasetId: string): Promise<void> {
  const byStatus = await prisma.stagedLead.groupBy({
    by: ['status'],
    where: { datasetId },
    _count: { _all: true },
  });
  const count = (s: StagedLeadStatus) => byStatus.find((b) => b.status === s)?._count._all ?? 0;
  const staged = byStatus.reduce((acc, b) => acc + b._count._all, 0);
  const categorized = await prisma.stagedLead.count({
    where: { datasetId, assignedCategory: { not: UNCATEGORIZED }, NOT: { assignedCategory: null } },
  });
  const imported = await prisma.stagedLead.count({ where: { datasetId, importedLeadId: { not: null } } });

  await prisma.stagingDataset.update({
    where: { id: datasetId },
    data: {
      stagedCount: staged,
      uniqueCount: count('UNIQUE'),
      duplicateCount: count('DUPLICATE'),
      reviewCount: count('REVIEW'),
      invalidCount: count('INVALID'),
      categorizedCount: categorized,
      importedCount: imported,
    },
  });
}

// ─── Transfer into the regular Leads module ───────────────────────────────────

export interface StagedTransferRowResult {
  processedRows: ProcessedImportRow[];
  byEmail: Map<string, string[]>; // normalizedEmail -> staged lead ids
  noEmail: string[]; // staged lead ids with no valid email
}

/** Convert staged rows into ProcessedImportRow inputs for persistLeadBatch. */
export function buildTransferRows(
  staged: Array<{
    id: string;
    username: string | null;
    name: string | null;
    bio: string | null;
    category: string | null;
    website: string | null;
    email: string | null;
    phone: string | null;
    normalizedEmail: string | null;
    assignedCategory: string | null;
    sourceRow: number;
  }>,
): StagedTransferRowResult {
  const processedRows: ProcessedImportRow[] = [];
  const byEmail = new Map<string, string[]>();
  const noEmail: string[] = [];

  for (const lead of staged) {
    if (!lead.normalizedEmail) {
      noEmail.push(lead.id);
      continue;
    }
    const normalized = normalizeLead({
      fullName: lead.name,
      company: lead.name,
      email: lead.email,
      phone: lead.phone,
      website: lead.website,
      industry:
        lead.assignedCategory && lead.assignedCategory !== UNCATEGORIZED ? lead.assignedCategory : null,
    });

    const customFields: Record<string, string> = {};
    if (lead.username) customFields.socialAccount = lead.username;
    if (lead.bio) customFields.bio = lead.bio.slice(0, 1000);
    if (lead.category) customFields.sourceCategory = lead.category;

    processedRows.push({
      normalized,
      customFields,
      rowIndex: lead.sourceRow,
      hadEmail: true,
      nameSource: lead.name ? 'owner' : null,
    });
    const ids = byEmail.get(lead.normalizedEmail) ?? [];
    ids.push(lead.id);
    byEmail.set(lead.normalizedEmail, ids);
  }

  return { processedRows, byEmail, noEmail };
}

export { persistLeadBatch };
