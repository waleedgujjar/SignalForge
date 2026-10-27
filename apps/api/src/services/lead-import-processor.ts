import { prisma, type Prisma } from '@signalforge/database';
import { isCustomField } from '@signalforge/integrations';
import type { ColumnMapping } from '@signalforge/integrations';
import {
  normalizeLead,
  normalizeStateName,
  normalizeCountryCode,
  hasImportableRowData,
  isPlaceholderEmail,
  resolveLeadName,
  getLeadDisplayName,
  loadDedupCandidates,
  createDedupIndex,
  findDuplicate,
  toDedupEntry,
  addToIndex,
  mapRow,
  type NormalizedLead,
} from '@signalforge/lead-discovery';
import { publishWorkflowEvent } from '@signalforge/automations';
import type { LeadSource } from '@signalforge/database';

export interface ProcessedImportRow {
  normalized: NormalizedLead;
  customFields: Record<string, string>;
  rowIndex: number;
  hadEmail: boolean;
  nameSource: 'owner' | 'company' | null;
  linkedinUrl?: string;
  linkedinCompanyUrl?: string;
  region?: string;
  rawRow?: Record<string, string>;
  unmappedData?: Record<string, string>;
}

export interface ImportFieldStats {
  totalRows: number;
  validRows: number;
  email: number;
  phone: number;
  website: number;
  owner: number;
  company: number;
}

export interface PreviewImportRow {
  name: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
}

export interface ProcessRowsResult {
  processedRows: ProcessedImportRow[];
  skipped: number;
  errors: Array<{ row: number; message: string }>;
  errorCount: number;
  /** Rows skipped because they had no email value at all. */
  noEmail: number;
  /** Rows skipped because the email value was present but not a valid address. */
  invalidEmail: number;
  nameFromOwner: number;
  nameFromCompany: number;
}

export interface ImportExecutionSummary {
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  noEmail: number;
  nameFromOwner: number;
  nameFromCompany: number;
}

const MAX_REPORTED_ERRORS = 50;

export function processImportRows(
  rows: Record<string, string>[],
  mappings: Record<string, string>,
  unmappedColumns: string[] = [],
  options?: { includeRaw?: boolean },
): ProcessRowsResult {
  const processedRows: ProcessedImportRow[] = [];
  const errors: Array<{ row: number; message: string }> = [];
  let errorCount = 0;
  let skipped = 0;
  let noEmail = 0;
  let invalidEmail = 0;
  let nameFromOwner = 0;
  let nameFromCompany = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    try {
      const raw = mapRow(row, mappings);

      const customFields: Record<string, string> = {};
      for (const [csvCol, field] of Object.entries(mappings)) {
        if (isCustomField(field)) {
          const val = row[csvCol];
          if (val !== undefined && val !== null && String(val).trim() !== '') {
            customFields[field] = String(val).trim();
          }
        }
      }

      const unmappedData: Record<string, string> = {};
      for (const col of unmappedColumns) {
        const val = row[col]?.trim();
        if (val) unmappedData[col] = val;
      }

      let linkedinUrl: string | undefined;
      let linkedinCompanyUrl: string | undefined;
      let region: string | undefined;
      for (const [csvCol, field] of Object.entries(mappings)) {
        const val = row[csvCol]?.trim();
        if (!val) continue;
        if (field === 'linkedinUrl') linkedinUrl = val;
        if (field === 'linkedinCompanyUrl') linkedinCompanyUrl = val;
        if (field === 'region') region = val;
      }

      const ownerValue = raw.fullName;
      const companyValue = raw.company;
      const resolved = resolveLeadName(ownerValue, companyValue, {
        firstName: raw.firstName,
        lastName: raw.lastName,
      });
      let nameSource: 'owner' | 'company' | null = null;

      if (resolved.fullName) {
        raw.fullName = resolved.fullName;
        raw.firstName = raw.firstName ?? resolved.firstName;
        raw.lastName = raw.lastName ?? resolved.lastName;

        const ownerCandidate = ownerValue?.trim()
          || [raw.firstName, raw.lastName].filter(Boolean).join(' ');
        if (ownerCandidate && resolved.fullName === ownerCandidate) {
          nameSource = 'owner';
        } else {
          nameSource = 'company';
        }
      }

      const normalized = normalizeLead(raw);
      const countryCode = normalizeCountryCode(raw.country) ?? normalized.countryCode;
      normalized.state = normalizeStateName(normalized.state, countryCode);
      if (countryCode) normalized.countryCode = countryCode;

      if (!hasImportableRowData(normalized)) {
        skipped++;
        continue;
      }

      // A valid, non-empty email is mandatory. Never fabricate a placeholder or
      // persist a partial lead (company/phone/name only) for an emailless row.
      if (!normalized.normalizedEmail) {
        const rawEmail = (raw.email ?? '').trim();
        if (rawEmail) {
          invalidEmail++;
          if (errors.length < MAX_REPORTED_ERRORS) {
            errors.push({ row: i + 1, message: `Skipped: invalid email address "${rawEmail}"` });
          }
        } else {
          noEmail++;
        }
        continue;
      }
      const hadEmail = true;

      if (nameSource === 'owner') nameFromOwner++;
      else if (nameSource === 'company') nameFromCompany++;

      processedRows.push({
        normalized,
        customFields,
        rowIndex: i,
        hadEmail,
        nameSource,
        linkedinUrl,
        linkedinCompanyUrl,
        region,
        rawRow: options?.includeRaw ? row : undefined,
        unmappedData: Object.keys(unmappedData).length > 0 ? unmappedData : undefined,
      });
    } catch (err: unknown) {
      errorCount++;
      if (errors.length < MAX_REPORTED_ERRORS) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        errors.push({ row: i + 1, message: msg });
      }
    }
  }

  return { processedRows, skipped, errors, errorCount, noEmail, invalidEmail, nameFromOwner, nameFromCompany };
}

export function computeFieldStats(processedRows: ProcessedImportRow[], totalRows: number): ImportFieldStats {
  return {
    totalRows,
    validRows: processedRows.length,
    email: processedRows.filter((r) => r.hadEmail).length,
    phone: processedRows.filter((r) => r.normalized.normalizedPhone ?? r.normalized.phone).length,
    website: processedRows.filter((r) => r.normalized.website ?? r.normalized.normalizedDomain).length,
    owner: processedRows.filter((r) => r.nameSource === 'owner').length,
    company: processedRows.filter((r) => r.normalized.company).length,
  };
}

export function toPreviewRows(processedRows: ProcessedImportRow[], limit = 20): PreviewImportRow[] {
  return processedRows.slice(0, limit).map((row) => ({
    name: getLeadDisplayName(row.normalized),
    company: row.normalized.company ?? null,
    email: row.hadEmail ? row.normalized.normalizedEmail : null,
    phone: row.normalized.normalizedPhone ?? row.normalized.phone ?? null,
    website: row.normalized.website ?? (row.normalized.normalizedDomain ? `https://${row.normalized.normalizedDomain}` : null),
  }));
}

export async function mergeLeadFields(
  existingLeadId: string,
  newData: NormalizedLead,
  newCustomFields: Record<string, string | Record<string, unknown>>,
  extras?: { linkedinUrl?: string; region?: string },
): Promise<boolean> {
  const existing = await prisma.lead.findUnique({
    where: { id: existingLeadId },
    select: {
      id: true, firstName: true, lastName: true, fullName: true, company: true,
      companyDomain: true, jobTitle: true, industry: true, phone: true,
      linkedinUrl: true, countryCode: true, country: true, region: true,
      state: true, city: true, website: true, email: true, customFields: true,
    },
  });

  if (!existing) return false;

  const updates: Record<string, unknown> = {};

  if (!existing.firstName && newData.firstName) updates.firstName = newData.firstName;
  if (!existing.lastName && newData.lastName) updates.lastName = newData.lastName;
  if (!existing.fullName && newData.fullName) updates.fullName = newData.fullName;
  if (!existing.company && newData.company) updates.company = newData.company;
  if (!existing.companyDomain && newData.normalizedDomain) updates.companyDomain = newData.normalizedDomain;
  if (!existing.jobTitle && newData.jobTitle) updates.jobTitle = newData.jobTitle;
  if (!existing.industry && newData.industry) updates.industry = newData.industry;
  if (!existing.phone && (newData.normalizedPhone ?? newData.phone)) {
    updates.phone = newData.normalizedPhone ?? newData.phone;
  }
  if (!existing.linkedinUrl && extras?.linkedinUrl) updates.linkedinUrl = extras.linkedinUrl;
  if (!existing.countryCode && newData.countryCode) updates.countryCode = newData.countryCode;
  if (!existing.country && newData.country) updates.country = newData.country;
  if (!existing.region && extras?.region) updates.region = extras.region;
  if (!existing.state && newData.state) updates.state = newData.state;
  if (!existing.city && newData.city) updates.city = newData.city;
  if (!existing.website && newData.website) updates.website = newData.website;

  if (isPlaceholderEmail(existing.email) && newData.normalizedEmail && !isPlaceholderEmail(newData.normalizedEmail)) {
    updates.email = newData.normalizedEmail;
  }

  if (Object.keys(newCustomFields).length > 0) {
    const existingCustom = (existing.customFields && typeof existing.customFields === 'object' && !Array.isArray(existing.customFields))
      ? existing.customFields as Record<string, unknown>
      : {};
    const merged = { ...existingCustom };
    let customChanged = false;
    for (const [key, val] of Object.entries(newCustomFields)) {
      if (!merged[key]) {
        merged[key] = val;
        customChanged = true;
      }
    }
    if (customChanged) updates.customFields = merged;
  }

  if (Object.keys(updates).length === 0) return false;

  await prisma.lead.update({ where: { id: existingLeadId }, data: updates });
  return true;
}

export interface ExecuteImportOptions {
  workspaceId: string;
  processedRows: ProcessedImportRow[];
  mergeStrategy: 'skip' | 'fill_missing';
  source: LeadSource;
  sourceFile?: string;
  importBatchId?: string;
  researchEnabled?: boolean;
  onResearch?: (inputs: { leadId: string; companyUrl?: string; personUrl?: string }[]) => Promise<number>;
}

export async function executeImportRows(
  options: ExecuteImportOptions,
): Promise<{ summary: ImportExecutionSummary; createdLeadIds: string[]; researchInputs: { leadId: string; companyUrl?: string; personUrl?: string }[] }> {
  const { workspaceId, processedRows, mergeStrategy, source, sourceFile, importBatchId, researchEnabled } = options;

  const summary: ImportExecutionSummary = {
    created: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    noEmail: processedRows.filter((r) => !r.hadEmail).length,
    nameFromOwner: processedRows.filter((r) => r.nameSource === 'owner').length,
    nameFromCompany: processedRows.filter((r) => r.nameSource === 'company').length,
  };

  const allNormalized = processedRows.map((r) => r.normalized);
  const existingCandidates = await loadDedupCandidates(workspaceId, allNormalized);
  const dedupIndex = createDedupIndex(existingCandidates);
  const createdLeadIds: string[] = [];
  const researchInputs: { leadId: string; companyUrl?: string; personUrl?: string }[] = [];

  for (const processedRow of processedRows) {
    const { normalized, customFields, rowIndex, linkedinUrl, linkedinCompanyUrl, region, unmappedData } = processedRow;
    try {
      const entry = toDedupEntry(normalized, `batch:${rowIndex}`, source);
      const match = findDuplicate(entry, dedupIndex);

      const importMeta = {
        importSource: source,
        ...(sourceFile ? { sourceFile } : {}),
        ...(importBatchId ? { importBatchId } : {}),
        sourceRow: rowIndex + 1,
        ...(unmappedData ? { rawColumns: unmappedData } : {}),
      };

      const mergedCustomFields: Record<string, string | Record<string, unknown>> = {
        ...customFields,
        ...(Object.keys(importMeta).length > 0 ? { _import: importMeta } : {}),
      };

      if (match) {
        if (mergeStrategy === 'skip') {
          summary.skipped++;
          if (researchEnabled && (linkedinCompanyUrl || linkedinUrl)) {
            researchInputs.push({ leadId: match.id, companyUrl: linkedinCompanyUrl, personUrl: linkedinUrl });
          }
        } else {
          const updated = await mergeLeadFields(match.id, normalized, mergedCustomFields, { linkedinUrl, region });
          if (updated) summary.updated++;
          else summary.skipped++;
          if (researchEnabled && (linkedinCompanyUrl || linkedinUrl)) {
            researchInputs.push({ leadId: match.id, companyUrl: linkedinCompanyUrl, personUrl: linkedinUrl });
          }
        }
      } else {
        const fullName =
          normalized.fullName ??
          ([normalized.firstName, normalized.lastName].filter(Boolean).join(' ') || undefined);

        const created = await prisma.lead.create({
          data: {
            workspaceId,
            email: normalized.normalizedEmail!,
            firstName: normalized.firstName,
            lastName: normalized.lastName,
            fullName,
            company: normalized.company,
            companyDomain: normalized.normalizedDomain,
            jobTitle: normalized.jobTitle,
            industry: normalized.industry,
            phone: normalized.normalizedPhone ?? normalized.phone,
            linkedinUrl: linkedinUrl ?? undefined,
            countryCode: normalized.countryCode,
            country: normalized.country,
            region: region ?? undefined,
            state: normalized.state,
            city: normalized.city,
            website: normalized.website,
            source,
            customFields: Object.keys(mergedCustomFields).length > 0
              ? (mergedCustomFields as Prisma.InputJsonValue)
              : undefined,
          },
        });

        createdLeadIds.push(created.id);
        summary.created++;

        const newEntry = toDedupEntry(normalized, created.id, source);
        addToIndex(dedupIndex, newEntry);

        if (researchEnabled && (linkedinCompanyUrl || linkedinUrl)) {
          researchInputs.push({ leadId: created.id, companyUrl: linkedinCompanyUrl, personUrl: linkedinUrl });
        }

        void publishWorkflowEvent({
          eventType: 'LEAD_IMPORTED',
          workspaceId,
          leadId: created.id,
          idempotencyKey: `lead-imported:${created.id}`,
          metadata: { source, country: created.country },
        }).catch(() => {});
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      if (msg.includes('Unique constraint')) {
        summary.skipped++;
      } else {
        summary.errors++;
      }
    }
  }

  return { summary, createdLeadIds, researchInputs };
}

export function formatMappingsResponse(mappings: ColumnMapping[]) {
  return mappings.map((m) => ({
    csvColumn: m.csvColumn,
    leadField: m.leadField,
    confidence: m.confidence,
    reason: m.reason,
  }));
}
