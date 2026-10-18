import type { Readable } from 'node:stream';

export interface IntegrationTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface CloudFolder {
  id: string;
  name: string;
  parentId: string | null;
  modifiedAt: string;
}

export interface CloudFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  modifiedAt: string;
  parentId: string | null;
}

export interface ParsedFileResult {
  headers: string[];
  rows: Record<string, string>[];
  totalRowCount: number;
}

export interface ColumnMapping {
  csvColumn: string;
  leadField: string;
  confidence: number;
  reason?: string;
}

export interface LeadImportMappingResult {
  mappings: ColumnMapping[];
  unmappedColumns: string[];
}

export interface IntegrationProviderAdapter {
  getAuthUrl(state: string, redirectUri: string): string;
  exchangeCode(
    code: string,
    redirectUri: string,
  ): Promise<{ tokens: IntegrationTokens; email: string }>;
  refreshTokens(tokens: IntegrationTokens): Promise<IntegrationTokens>;
  revokeAccess(tokens: IntegrationTokens): Promise<void>;
  listFolders(
    tokens: IntegrationTokens,
    parentId?: string,
  ): Promise<CloudFolder[]>;
  listFiles(
    tokens: IntegrationTokens,
    folderId: string,
  ): Promise<CloudFile[]>;
  downloadFile(
    tokens: IntegrationTokens,
    fileId: string,
  ): Promise<Readable>;
}

export const SUPPORTED_MIME_TYPES = [
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.google-apps.spreadsheet',
] as const;

export const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
export const MAX_ROWS_PER_FILE = 50_000;
export const MAX_PREVIEW_ROWS = 100;
