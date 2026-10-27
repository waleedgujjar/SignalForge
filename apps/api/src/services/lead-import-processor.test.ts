import { describe, expect, it, vi } from 'vitest';

// processImportRows is pure, but the module also imports prisma / workflow events
// at load time. Stub those so importing the module has no side effects.
vi.mock('@signalforge/database', () => ({ prisma: {} }));
vi.mock('@signalforge/automations', () => ({ publishWorkflowEvent: vi.fn(async () => {}) }));

import { processImportRows } from './lead-import-processor.js';

const MAPPINGS = { Email: 'email', Company: 'company', Name: 'fullName' };

describe('processImportRows email-required rule', () => {
  it('imports rows with a valid email and skips every emailless or invalid row', () => {
    const rows = [
      { Email: 'alice@example.com', Company: 'Acme', Name: 'Alice' },
      { Email: '', Company: 'NoEmail Co', Name: 'Bob' },
      { Email: '   ', Company: 'Whitespace Co', Name: 'Carol' },
      { Email: 'not-an-email', Company: 'Bad Co', Name: 'Dan' },
      { Email: '  dave@example.com  ', Company: 'Dave Co', Name: 'Dave' },
    ];

    const result = processImportRows(rows, MAPPINGS);

    // Only the two rows with a resolvable email are persisted.
    expect(result.processedRows).toHaveLength(2);
    expect(result.processedRows.every((r) => r.hadEmail)).toBe(true);
    const emails = result.processedRows.map((r) => r.normalized.normalizedEmail);
    expect(emails).toContain('alice@example.com');
    expect(emails).toContain('dave@example.com'); // surrounding whitespace trimmed

    // Missing (empty + whitespace) vs invalid-syntax are counted distinctly.
    expect(result.noEmail).toBe(2);
    expect(result.invalidEmail).toBe(1);
  });

  it('never fabricates a placeholder email for a company/phone-only row', () => {
    const rows = [{ Email: '', Company: 'Phone Only LLC', Name: 'No Email Person' }];

    const result = processImportRows(rows, MAPPINGS);

    expect(result.processedRows).toHaveLength(0);
    expect(result.noEmail).toBe(1);
    expect(result.invalidEmail).toBe(0);
  });
});
