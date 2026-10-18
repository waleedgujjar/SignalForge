/// CSV / XLSX discovery source.
///
/// This is the adapter that guarantees the engine costs nothing: it needs no
/// provider, no API key and no network. Parsing and header detection are
/// delegated wholesale to @signalforge/integrations, which already backs the
/// Google Drive importer — there is no second parser here.

import { Readable } from 'node:stream';

import {
  buildLeadImportMappingsRecord,
  detectLeadImportMappings,
  parseFileStream,
  resolveImportMimeType,
} from '@signalforge/integrations';
import type { DiscoverySourceType } from '@signalforge/database';

import { InvalidDiscoveryRequestError } from '../types.js';
import type { AdapterContext, LeadSearchParams, LeadSearchResult, LeadSourceAdapter, RawDiscoveredLead } from '../types.js';

const CSV_MIME = 'text/csv';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function mimeTypeForSource(source: DiscoverySourceType): string {
  return source === 'XLSX' ? XLSX_MIME : CSV_MIME;
}

/// Turn one parsed spreadsheet row into a raw lead using the column mapping.
export function mapRow(row: Record<string, string>, mappings: Record<string, string>): RawDiscoveredLead {
  const value = (field: string): string | null => {
    for (const [column, mapped] of Object.entries(mappings)) {
      if (mapped !== field) continue;
      const raw = row[column];
      if (raw !== undefined && raw !== null && typeof raw === 'string' && raw.trim() !== '') return raw.trim();
    }
    return null;
  };

  return {
    company: value('company'),
    firstName: value('firstName'),
    lastName: value('lastName'),
    fullName: value('fullName'),
    jobTitle: value('jobTitle'),
    email: value('email'),
    phone: value('phone'),
    website: value('website') ?? value('companyDomain'),
    industry: value('industry'),
    country: value('country'),
    countryCode: value('countryCode'),
    state: value('state'),
    city: value('city'),
    postalCode: value('postalCode'),
    emailSource: value('email') ? 'SOURCE_PROVIDED' : null,
    metadata: {},
  };
}

export class FileAdapter implements LeadSourceAdapter {
  readonly billable = false;

  constructor(readonly source: DiscoverySourceType = 'CSV') {}

  get displayName(): string {
    return this.source === 'XLSX' ? 'XLSX import' : 'CSV import';
  }

  /// Always available — this is the zero-cost path and must never be gated.
  isConfigured(): boolean {
    return true;
  }

  async search(params: LeadSearchParams, context: AdapterContext): Promise<LeadSearchResult> {
    if (!context.file) {
      throw new InvalidDiscoveryRequestError('A file is required for CSV/XLSX discovery');
    }

    const resolvedMime = resolveImportMimeType(
      context.file.mimeType || mimeTypeForSource(this.source),
      context.file.filename,
    );

    const parsed = await parseFileStream(Readable.from(context.file.buffer), resolvedMime, {
      maxRows: params.maxResults,
      filename: context.file.filename,
    });

    // An explicit mapping from the UI always wins; auto-detection is the
    // fallback so a well-formed file imports without a mapping step.
    const mappings =
      context.file.columnMappings && Object.keys(context.file.columnMappings).length > 0
        ? context.file.columnMappings
        : buildLeadImportMappingsRecord(detectLeadImportMappings(parsed.headers, parsed.rows));

    if (Object.keys(mappings).length === 0) {
      throw new InvalidDiscoveryRequestError(
        'No usable columns were detected. Map at least one of company, email or website.',
      );
    }

    const leads = parsed.rows.slice(0, params.maxResults).map((row, index) => ({
      ...mapRow(row, mappings),
      // Stable per-row id so upserts never collapse distinct CSV rows.
      sourceId: `file-row-${index + 1}`,
      metadata: { importRow: index + 1, fileImport: true },
    }));

    return {
      leads,
      // Row-level requirements are enforced by the pipeline filter, not here,
      // so the job counters can report exactly how many rows each rule dropped.
      appliedFilters: ['maxResults'],
      requestsUsed: 0,
      warnings:
        parsed.totalRowCount > params.maxResults
          ? [`File contains ${parsed.totalRowCount} rows; only the first ${params.maxResults} were imported.`]
          : undefined,
    };
  }
}

export const csvAdapter = new FileAdapter('CSV');
export const xlsxAdapter = new FileAdapter('XLSX');
