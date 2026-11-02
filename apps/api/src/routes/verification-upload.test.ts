import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';

const state = vi.hoisted(() => ({
  jobs: [] as Array<{ emails: string[]; metadata: Record<string, unknown> }>,
  maxBulk: 10_000,
}));

vi.mock('@signalforge/config', () => ({
  loadEnv: () => ({ EMAIL_VERIFICATION_MAX_BULK_SIZE: state.maxBulk }),
}));
vi.mock('@signalforge/verification', () => ({
  verificationJobService: {
    createJob: vi.fn(async (input: { emails: string[]; metadata: Record<string, unknown> }) => {
      state.jobs.push(input);
      return { id: `job-${state.jobs.length}`, status: 'RUNNING', total: input.emails.length };
    }),
  },
}));
vi.mock('../plugins/auth.js', () => ({
  requireWorkspaceOrUploadToken: () => ({
    preHandler: async (request: { user?: unknown }) => {
      request.user = { userId: 'u1', workspaceId: 'ws1', role: 'OWNER' };
    },
  }),
  getWorkspaceId: () => 'ws1',
}));

let app: FastifyInstance;

beforeAll(async () => {
  process.env.IMPORT_DATA_DIR = await mkdtemp(join(tmpdir(), 'sf-verify-upload-'));
  const { verificationUploadRoutes, extractEmail } = await import('./verification-upload.js');
  expect(extractEmail('Jane <JANE@Acme.com>')).toBe('jane@acme.com');
  app = Fastify();
  await app.register(multipart);
  await app.register(verificationUploadRoutes, { prefix: '/verification' });
  await app.ready();
}, 120_000);

beforeEach(() => {
  state.jobs = [];
  state.maxBulk = 10_000;
});

function multipartBody(file: { name: string; type: string; content: string | Buffer }, options?: unknown) {
  const boundary = '----sfboundary';
  const parts: Buffer[] = [];
  if (options) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="options"\r\n\r\n${JSON.stringify(options)}\r\n`));
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`,
    ),
    Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

async function upload(file: { name: string; type: string; content: string | Buffer }, options?: unknown) {
  const { payload, headers } = multipartBody(file, options);
  return app.inject({ method: 'POST', url: '/verification/excel', payload, headers });
}

describe('POST /verification/excel', () => {
  it('queues the unique, cleaned emails from a CSV and reports what it skipped', async () => {
    const csv = [
      'Name,Contact',
      'Ann,ann@acme.com',
      'Bob,"Bob Smith <BOB@acme.com>"',
      'Cat,mailto:cat@acme.com',
      'Ann again,ann@acme.com',
      'No email,',
      'Not an email,"Sales: dee@acme.com"',
    ].join('\n');
    const res = await upload({ name: 'leads.csv', type: 'text/csv', content: csv });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      total: 3,
      emailColumn: 'Contact',
      rowCount: 6,
      duplicateEmails: 1,
      emptyRows: 1,
      invalidRows: 1,
      rowsWithoutEmail: 1,
    });
    // Only cells that are an address count; free text containing one does not.
    expect(state.jobs[0]!.emails).toEqual(['ann@acme.com', 'bob@acme.com', 'cat@acme.com']);
    // The file is kept on disk for the export; rows are not stuffed into the job JSON.
    expect(state.jobs[0]!.metadata).toMatchObject({ filePath: expect.any(String), originalFilename: 'leads.csv' });
    expect(state.jobs[0]!.metadata.rows).toBeUndefined();
  });

  it('verifies the Gmail column, never the Google Maps or Website URLs', async () => {
    const maps = 'https://www.google.com/maps/place/blackbelt+company+-+hvac+services+in+san+antonio+tx/@29.66927';
    const csv = [
      'Company,Website,Google Maps,Gmail',
      `Blackbelt,https://blackbelt.com,${maps},contact@blackbelt.com`,
      `Company B,https://company-b.com,${maps}2,info@company-b.com`,
    ].join('\n');
    const res = await upload({ name: 'leads.csv', type: 'text/csv', content: csv });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ emailColumn: 'Gmail', ambiguous: false, uniqueEmails: 2 });
    expect(state.jobs[0]!.emails).toEqual(['contact@blackbelt.com', 'info@company-b.com']);
  });

  it('never sends URLs even when the user picks the URL column by mistake', async () => {
    const csv = 'Company,Google Maps,Gmail\nA,https://www.google.com/maps/place/a/@29.6,-98.4,a@x.com\n';
    const res = await upload({ name: 'leads.csv', type: 'text/csv', content: csv }, { emailColumn: 'Google Maps' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/No valid email addresses were found in the "Google Maps" column/);
    expect(state.jobs).toHaveLength(0);
  });

  it('parses a CSV that Windows labels application/vnd.ms-excel', async () => {
    const res = await upload({ name: 'export.csv', type: 'application/vnd.ms-excel', content: 'Email\na@acme.com\n' });
    expect(res.statusCode).toBe(200);
    expect(state.jobs[0]!.emails).toEqual(['a@acme.com']);
  });

  it('honours an explicit email column from the upload options', async () => {
    const csv = 'Work Email,Personal Email\nw@acme.com,p@gmail.com\n';
    const res = await upload({ name: 'two.csv', type: 'text/csv', content: csv }, { emailColumn: 'Personal Email' });
    expect(res.statusCode).toBe(200);
    expect(state.jobs[0]!.emails).toEqual(['p@gmail.com']);
  });

  it.each([
    ['an empty file', { name: 'empty.csv', type: 'text/csv', content: '' }, /empty/i],
    ['a header-only file', { name: 'h.csv', type: 'text/csv', content: 'Email\n' }, /no data rows/i],
    ['a corrupt spreadsheet', { name: 'bad.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', content: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 1, 2, 3, 4, 5]) }, /could not be read|re-save/i],
    ['a file with no email column', { name: 'n.csv', type: 'text/csv', content: 'Name,Phone\nAnn,123\nBob,456\n' }, /email column/i],
    ['an email column with no addresses', { name: 'n.csv', type: 'text/csv', content: 'Email\nn/a\nunknown\n' }, /no valid email/i],
  ])('returns 400 with a clear message (not 500) for %s', async (_label, file, message) => {
    const res = await upload(file);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(message);
    expect(state.jobs).toHaveLength(0);
  });

  it('rejects a file over the bulk limit with guidance to split it', async () => {
    state.maxBulk = 2;
    const res = await upload({ name: 'big.csv', type: 'text/csv', content: 'Email\na@x.com\nb@x.com\nc@x.com\n' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/split the file/i);
  });

  it('still accepts the legacy JSON base64 body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/verification/excel',
      payload: { file: { data: Buffer.from('Email\nz@acme.com\n').toString('base64'), mimeType: 'text/csv', filename: 'z.csv' } },
    });
    expect(res.statusCode).toBe(200);
    expect(state.jobs[0]!.emails).toEqual(['z@acme.com']);
  });
});

describe('POST /verification/excel/preview', () => {
  async function preview(file: { name: string; type: string; content: string }, options?: unknown) {
    const { payload, headers } = multipartBody(file, options);
    return app.inject({ method: 'POST', url: '/verification/excel/preview', payload, headers });
  }

  it('shows the detected column, counts and a preview without queuing anything', async () => {
    const csv = [
      'Company,Google Maps,Gmail,Business Email',
      'A,"https://google.com/maps/place/a/@1,2",a@gmail.com,ceo@a.com',
      'B,"https://google.com/maps/place/b/@3,4",b@gmail.com,',
      'C,"https://google.com/maps/place/c/@5,6",not-an-email,',
      'D,"https://google.com/maps/place/d/@7,8",,',
    ].join('\n');
    const res = await preview({ name: 'leads.csv', type: 'text/csv', content: csv });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Business Email ranks above Gmail; its empty cells fall back to Gmail.
    expect(body).toMatchObject({
      emailColumn: 'Business Email',
      rowCount: 4,
      validRows: 2,
      uniqueEmails: 2,
      fallbackRows: 1,
      // Row C: Business Email empty and the Gmail fallback is not an address.
      emptyRows: 2,
      preview: ['ceo@a.com', 'b@gmail.com'],
    });
    expect(body.candidates.map((c: { header: string }) => c.header)).toEqual(['Business Email', 'Gmail']);
    expect(state.jobs).toHaveLength(0);
  });

  it('re-previews with the column the user chose', async () => {
    const csv = 'Gmail,Business Email\npersonal@gmail.com,work@acme.com\n';
    const res = await preview({ name: 'x.csv', type: 'text/csv', content: csv }, { emailColumn: 'Gmail' });
    expect(res.json()).toMatchObject({ emailColumn: 'Gmail', preview: ['personal@gmail.com'], ambiguous: false });
  });

  it('reports a file with no email column', async () => {
    const res = await preview({ name: 'x.csv', type: 'text/csv', content: 'Company,Website\nA,https://a.com\n' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ headers: ['Company', 'Website'] });
  });
});
