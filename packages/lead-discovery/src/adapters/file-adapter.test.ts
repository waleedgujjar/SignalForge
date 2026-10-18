import { describe, expect, it } from 'vitest';

import { mapRow } from './file-adapter.js';

describe('mapRow', () => {
  it('maps CSV columns using header → field mappings', () => {
    const lead = mapRow(
      {
        'Business Name': 'Acme Dental',
        Email: 'hello@acme.com',
        Phone: '512-555-0100',
      },
      {
        'Business Name': 'company',
        Email: 'email',
        Phone: 'phone',
      },
    );

    expect(lead.company).toBe('Acme Dental');
    expect(lead.email).toBe('hello@acme.com');
    expect(lead.phone).toBe('512-555-0100');
  });

  it('uses website or companyDomain column', () => {
    const lead = mapRow(
      { Domain: 'acme.com' },
      { Domain: 'companyDomain' },
    );

    expect(lead.website).toBe('acme.com');
  });
});
