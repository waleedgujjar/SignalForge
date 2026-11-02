import { Readable } from 'node:stream';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { loadEnv } from '@signalforge/config';
import {
  detectEmailColumns,
  extractEmailsFromRows,
  parseEmailCell,
  parseFileStream,
  resolveImportMimeType,
  FileParseError,
  type EmailColumnCandidate,
  type EmailExtraction,
} from '@signalforge/integrations';
import { verificationJobService } from '@signalforge/verification';
import { verificationExcelSchema } from '@signalforge/validation';
import { getWorkspaceId, requireWorkspaceOrUploadToken } from '../plugins/auth.js';

// Uploaded verification files are kept so the results export can be rebuilt
// with the original columns, instead of storing every row in the job's JSON.
const UPLOAD_DIR = join(process.env.IMPORT_DATA_DIR ?? join(tmpdir(), 'signalforge-imports'), 'verification');

/**
 * The email in a cell, or null. Only a cell that is an address qualifies
 * (see parseEmailCell): URLs such as Google Maps links never do.
 */
export function extractEmail(cell: string | undefined): string | null {
  const parsed = parseEmailCell(cell);
  return parsed.status === 'valid' ? parsed.email : null;
}

interface UploadInput {
  buffer: Buffer;
  filename?: string;
  mimeType: string;
  emailColumn?: string;
  name?: string;
}

class UploadError extends Error {
  constructor(message: string, readonly details?: Record<string, unknown>) {
    super(message);
  }
}

async function readUpload(request: FastifyRequest): Promise<UploadInput> {
  if (request.isMultipart()) {
    const data = await request.file();
    if (!data) throw new UploadError('No file uploaded');
    const optionsRaw = (data.fields as Record<string, { value?: string }>)?.options?.value;
    let options: { emailColumn?: unknown; name?: unknown } = {};
    if (optionsRaw) {
      try {
        options = JSON.parse(optionsRaw) as typeof options;
      } catch {
        throw new UploadError('Invalid upload options');
      }
    }
    return {
      buffer: await data.toBuffer(),
      filename: data.filename,
      mimeType: data.mimetype,
      emailColumn: typeof options.emailColumn === 'string' ? options.emailColumn : undefined,
      name: typeof options.name === 'string' ? options.name : undefined,
    };
  }

  const body = verificationExcelSchema.parse(request.body);
  return {
    buffer: Buffer.from(body.file.data, 'base64'),
    filename: body.file.filename,
    mimeType: body.file.mimeType,
    emailColumn: body.emailColumn,
    name: body.name,
  };
}

function badRequest(reply: FastifyReply, error: string, details?: Record<string, unknown>) {
  return reply.status(400).send({ error, ...(details ?? {}) });
}

interface AnalyzedUpload {
  input: UploadInput;
  mimeType: string;
  headers: string[];
  rows: Record<string, string>[];
  candidates: EmailColumnCandidate[];
  ambiguous: boolean;
  extraction: EmailExtraction;
  /** Other recognized email columns, tried when the chosen one is empty. */
  fallbackColumns: string[];
}

/**
 * Parses the upload, picks the email column (the user's choice, else the
 * strongest detected one) and extracts the valid addresses. Used by both the
 * preview and the start endpoints, so what the user previews is what runs.
 */
async function analyzeUpload(request: FastifyRequest): Promise<AnalyzedUpload | { error: string; details?: Record<string, unknown> }> {
  let input: UploadInput;
  try {
    input = await readUpload(request);
  } catch (err) {
    if (err instanceof UploadError) return { error: err.message };
    throw err;
  }
  if (input.buffer.length === 0) return { error: 'The uploaded file is empty.' };

  const mimeType = resolveImportMimeType(input.mimeType, input.filename);
  let parsed: Awaited<ReturnType<typeof parseFileStream>>;
  try {
    parsed = await parseFileStream(Readable.from(input.buffer), mimeType, { filename: input.filename });
  } catch (err) {
    if (err instanceof FileParseError) return { error: err.message };
    throw err;
  }
  if (parsed.rows.length === 0) return { error: 'The file has a header row but no data rows.' };

  const detection = detectEmailColumns(parsed.headers, parsed.rows);
  let column: string | null = detection.selected;
  if (input.emailColumn) {
    if (!parsed.headers.includes(input.emailColumn)) {
      return { error: `Column "${input.emailColumn}" is not in this file.`, details: { headers: parsed.headers } };
    }
    column = input.emailColumn;
  }
  if (!column) {
    return {
      error: 'Could not find an email column. Name the column "Email" (or "Gmail", "Business Email", ...) and upload again.',
      details: { headers: parsed.headers },
    };
  }

  const fallbackColumns = detection.candidates
    .filter((c) => c.header !== column && c.reason !== 'content')
    .map((c) => c.header);
  const extraction = extractEmailsFromRows(parsed.rows, column, fallbackColumns);
  return {
    input,
    mimeType,
    headers: parsed.headers,
    rows: parsed.rows,
    candidates: detection.candidates,
    ambiguous: detection.ambiguous && !input.emailColumn,
    extraction,
    fallbackColumns,
  };
}

function summarize(a: AnalyzedUpload) {
  const { extraction } = a;
  return {
    filename: a.input.filename ?? null,
    emailColumn: extraction.column,
    ambiguous: a.ambiguous,
    candidates: a.candidates.map((c) => ({
      header: c.header,
      reason: c.reason,
      valid: c.valid,
      invalid: c.invalid,
      empty: c.empty,
    })),
    headers: a.headers,
    rowCount: extraction.rowCount,
    validRows: extraction.validRows,
    uniqueEmails: extraction.emails.length,
    duplicateEmails: extraction.duplicateEmails,
    invalidRows: extraction.invalidRows,
    emptyRows: extraction.emptyRows,
    fallbackRows: extraction.fallbackRows,
    preview: extraction.preview,
    invalidSamples: extraction.invalidSamples,
  };
}

export const verificationUploadRoutes: FastifyPluginAsync = async (app) => {
  // Session cookie (through the web proxy) or a short-lived upload token, so
  // large files can go straight to this origin instead of through Vercel.
  app.addHook('preHandler', requireWorkspaceOrUploadToken().preHandler);

  // Shows which column will be used and what it contains. Queues nothing.
  app.post('/excel/preview', async (request, reply) => {
    const analyzed = await analyzeUpload(request);
    if ('error' in analyzed) return badRequest(reply, analyzed.error, analyzed.details);
    return summarize(analyzed);
  });

  app.post('/excel', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const env = loadEnv();

    const analyzed = await analyzeUpload(request);
    if ('error' in analyzed) return badRequest(reply, analyzed.error, analyzed.details);
    const { extraction, input } = analyzed;

    if (extraction.emails.length === 0) {
      return badRequest(reply, `No valid email addresses were found in the "${extraction.column}" column.`, summarize(analyzed));
    }
    if (extraction.emails.length > env.EMAIL_VERIFICATION_MAX_BULK_SIZE) {
      return badRequest(
        reply,
        `This file has ${extraction.emails.length.toLocaleString()} unique emails; the limit per verification job is ${env.EMAIL_VERIFICATION_MAX_BULK_SIZE.toLocaleString()}. Split the file and upload the parts.`,
      );
    }

    await mkdir(UPLOAD_DIR, { recursive: true });
    const ext = extname(input.filename ?? '').toLowerCase().replace(/[^.a-z0-9]/g, '') || '.dat';
    const filePath = join(UPLOAD_DIR, `${randomUUID()}${ext}`);
    await writeFile(filePath, input.buffer);

    const job = await verificationJobService.createJob({
      workspaceId,
      initiatedByUserId: request.user?.userId,
      source: 'EXCEL',
      name: input.name ?? input.filename ?? 'Excel verification',
      emails: extraction.emails,
      metadata: {
        emailColumn: extraction.column,
        fallbackColumns: analyzed.fallbackColumns,
        headers: analyzed.headers,
        filePath,
        mimeType: analyzed.mimeType,
        originalFilename: input.filename ?? null,
        rowCount: extraction.rowCount,
        duplicateEmails: extraction.duplicateEmails,
        rowsWithoutEmail: extraction.emptyRows,
        invalidRows: extraction.invalidRows,
      },
    });

    return {
      jobId: job.id,
      status: job.status,
      total: job.total,
      ...summarize(analyzed),
      // Kept for existing clients.
      rowsWithoutEmail: extraction.emptyRows,
    };
  });
};
