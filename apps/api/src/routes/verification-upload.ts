import { Readable } from 'node:stream';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { loadEnv } from '@signalforge/config';
import {
  detectColumnMappings,
  parseFileStream,
  resolveImportMimeType,
  FileParseError,
} from '@signalforge/integrations';
import { verificationJobService } from '@signalforge/verification';
import { verificationExcelSchema } from '@signalforge/validation';
import { getWorkspaceId, requireWorkspaceOrUploadToken } from '../plugins/auth.js';

// Uploaded verification files are kept so the results export can be rebuilt
// with the original columns, instead of storing every row in the job's JSON.
const UPLOAD_DIR = join(process.env.IMPORT_DATA_DIR ?? join(tmpdir(), 'signalforge-imports'), 'verification');

const EMAIL_IN_TEXT = /[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+/;

/** Pulls the address out of cells like "Jane <jane@acme.com>" or "mailto:jane@acme.com". */
export function extractEmail(cell: string | undefined): string | null {
  if (!cell) return null;
  const match = EMAIL_IN_TEXT.exec(cell);
  return match ? match[0].toLowerCase() : null;
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

export const verificationUploadRoutes: FastifyPluginAsync = async (app) => {
  // Session cookie (through the web proxy) or a short-lived upload token, so
  // large files can go straight to this origin instead of through Vercel.
  app.addHook('preHandler', requireWorkspaceOrUploadToken().preHandler);

  app.post('/excel', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const env = loadEnv();

    let input: UploadInput;
    try {
      input = await readUpload(request);
    } catch (err) {
      if (err instanceof UploadError) return badRequest(reply, err.message);
      throw err;
    }
    if (input.buffer.length === 0) return badRequest(reply, 'The uploaded file is empty.');

    const mimeType = resolveImportMimeType(input.mimeType, input.filename);
    let parsed: Awaited<ReturnType<typeof parseFileStream>>;
    try {
      parsed = await parseFileStream(Readable.from(input.buffer), mimeType, { filename: input.filename });
    } catch (err) {
      if (err instanceof FileParseError) return badRequest(reply, err.message);
      throw err;
    }
    if (parsed.rows.length === 0) return badRequest(reply, 'The file has a header row but no data rows.');

    const mappings = detectColumnMappings(parsed.headers);
    const emailColumn =
      (input.emailColumn && parsed.headers.includes(input.emailColumn) ? input.emailColumn : undefined) ??
      mappings.find((mapping) => mapping.leadField === 'email')?.csvColumn ??
      parsed.headers.find((header) => header.toLowerCase().includes('email')) ??
      // Last resort: the column where most cells hold an address.
      bestEmailColumn(parsed.headers, parsed.rows);

    if (!emailColumn) {
      return badRequest(reply, 'Could not find an email column. Rename the column to "Email" and upload again.', {
        headers: parsed.headers,
      });
    }

    const emails: string[] = [];
    let rowsWithoutEmail = 0;
    for (const row of parsed.rows) {
      const email = extractEmail(row[emailColumn]);
      if (email) emails.push(email);
      else rowsWithoutEmail++;
    }
    const uniqueEmails = [...new Set(emails)];
    if (uniqueEmails.length === 0) {
      return badRequest(reply, `No valid email addresses were found in the "${emailColumn}" column.`, {
        emailColumn,
        headers: parsed.headers,
      });
    }
    if (uniqueEmails.length > env.EMAIL_VERIFICATION_MAX_BULK_SIZE) {
      return badRequest(
        reply,
        `This file has ${uniqueEmails.length.toLocaleString()} unique emails; the limit per verification job is ${env.EMAIL_VERIFICATION_MAX_BULK_SIZE.toLocaleString()}. Split the file and upload the parts.`,
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
      emails: uniqueEmails,
      metadata: {
        emailColumn,
        headers: parsed.headers,
        filePath,
        mimeType,
        originalFilename: input.filename ?? null,
        rowCount: parsed.rows.length,
        duplicateEmails: emails.length - uniqueEmails.length,
        rowsWithoutEmail,
      },
    });

    return {
      jobId: job.id,
      status: job.status,
      total: job.total,
      emailColumn,
      rowCount: parsed.rows.length,
      duplicateEmails: emails.length - uniqueEmails.length,
      rowsWithoutEmail,
    };
  });
};

function bestEmailColumn(headers: string[], rows: Record<string, string>[]): string | undefined {
  const sample = rows.slice(0, 200);
  let best: { header: string; hits: number } | undefined;
  for (const header of headers) {
    const hits = sample.filter((row) => extractEmail(row[header])).length;
    if (hits > 0 && (!best || hits > best.hits)) best = { header, hits };
  }
  return best && best.hits >= Math.max(1, sample.length * 0.3) ? best.header : undefined;
}
