import { describe, expect, it } from 'vitest';

import { detectLeadImportMappings, buildLeadImportMappingsRecord } from './lead-import-field-mapper.js';

describe('detectLeadImportMappings', () => {
  it('maps File A standard headers', () => {
    const headers = ['Name', 'Company Name', 'Email', 'Phone', 'Website'];
    const rows = [
      { Name: 'John Smith', 'Company Name': 'ABC HVAC', Email: 'john@abc.com', Phone: '+1 713-555-1234', Website: 'https://abc.com' },
    ];
    const result = detectLeadImportMappings(headers, rows);
    const record = buildLeadImportMappingsRecord(result);

    expect(record['Email']).toBe('email');
    expect(record['Phone']).toBe('phone');
    expect(record['Website']).toBe('website');
    expect(record['Company Name']).toBe('company');
    expect(record['Name']).toBe('fullName');
  });

  it('maps File B alternate headers', () => {
    const headers = ['Owner Name', 'Business', 'Business Email', 'Mobile', 'Website URL'];
    const rows = [
      { 'Owner Name': 'Jane Doe', Business: 'XYZ Corp', 'Business Email': 'jane@xyz.com', Mobile: '7135551234', 'Website URL': 'www.xyz.com' },
    ];
    const result = detectLeadImportMappings(headers, rows);
    const record = buildLeadImportMappingsRecord(result);

    expect(record['Owner Name']).toBe('fullName');
    expect(record['Business']).toBe('company');
    expect(record['Business Email']).toBe('email');
    expect(record['Mobile']).toBe('phone');
    expect(record['Website URL']).toBe('website');
  });

  it('maps File C contact-style headers', () => {
    const headers = ['Contact Name', 'Company', 'Contact Email', 'Telephone', 'URL'];
    const rows = [
      { 'Contact Name': 'Bob Lee', Company: 'Lee Inc', 'Contact Email': 'bob@lee.com', Telephone: '(713) 555-9999', URL: 'https://lee.com' },
    ];
    const result = detectLeadImportMappings(headers, rows);
    const record = buildLeadImportMappingsRecord(result);

    expect(record['Contact Name']).toBe('fullName');
    expect(record['Contact Email']).toBe('email');
    expect(record['Telephone']).toBe('phone');
    expect(record['URL']).toBe('website');
  });

  it('infers email/phone/website from unknown headers (File D)', () => {
    const headers = ['Column A', 'Column B', 'Column C', 'Column D', 'Column E'];
    const rows = [
      { 'Column A': 'John', 'Column B': 'ACME', 'Column C': 'john@abc.com', 'Column D': '+1 7135551234', 'Column E': 'https://abc.com' },
      { 'Column A': 'Jane', 'Column B': 'XYZ', 'Column C': 'jane@xyz.com', 'Column D': '+1 7135555678', 'Column E': 'https://xyz.com' },
    ];
    const result = detectLeadImportMappings(headers, rows);
    const record = buildLeadImportMappingsRecord(result);

    expect(record['Column C']).toBe('email');
    expect(record['Column D']).toBe('phone');
    expect(record['Column E']).toBe('website');
  });

  it('does not classify pure integers as phone numbers', () => {
    const headers = ['ID', 'Email'];
    const rows = [
      { ID: '100000', Email: 'test@example.com' },
      { ID: '100001', Email: 'other@example.com' },
    ];
    const result = detectLeadImportMappings(headers, rows);
    const record = buildLeadImportMappingsRecord(result);

    expect(record['ID']).toBeUndefined();
    expect(record['Email']).toBe('email');
  });

  it('applies manual overrides', () => {
    const headers = ['Contact', 'URL'];
    const rows = [{ Contact: 'John Smith', URL: 'https://example.com' }];
    const result = detectLeadImportMappings(headers, rows, {
      Contact: 'fullName',
      URL: 'website',
    });
    const record = buildLeadImportMappingsRecord(result);

    expect(record['Contact']).toBe('fullName');
    expect(record['URL']).toBe('website');
    expect(result.mappings.find((m) => m.csvColumn === 'Contact')?.reason).toBe('manual-override');
  });

  it('returns unmapped columns', () => {
    const headers = ['Email', 'Notes'];
    const rows = [{ Email: 'a@b.com', Notes: 'VIP lead' }];
    const result = detectLeadImportMappings(headers, rows);

    expect(result.unmappedColumns).toContain('Notes');
  });
});
