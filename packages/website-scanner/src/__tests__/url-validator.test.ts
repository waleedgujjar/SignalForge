import { describe, it, expect } from 'vitest';
import { validateUrl, isAllowedRedirect, SSRFError } from '../crawler/url-validator.js';

describe('validateUrl', () => {
  it('accepts valid HTTPS URLs', async () => {
    const url = await validateUrl('https://example.com');
    expect(url.hostname).toBe('example.com');
  });

  it('accepts valid HTTP URLs', async () => {
    const url = await validateUrl('http://example.com');
    expect(url.hostname).toBe('example.com');
  });

  it('rejects localhost', async () => {
    await expect(validateUrl('http://localhost')).rejects.toThrow(SSRFError);
    await expect(validateUrl('http://localhost:8080')).rejects.toThrow(SSRFError);
  });

  it('rejects 0.0.0.0', async () => {
    await expect(validateUrl('http://0.0.0.0')).rejects.toThrow(SSRFError);
  });

  it('rejects private IP 127.0.0.1', async () => {
    await expect(validateUrl('http://127.0.0.1')).rejects.toThrow(SSRFError);
  });

  it('rejects private IP 10.x.x.x', async () => {
    await expect(validateUrl('http://10.0.0.1')).rejects.toThrow(SSRFError);
  });

  it('rejects private IP 192.168.x.x', async () => {
    await expect(validateUrl('http://192.168.1.1')).rejects.toThrow(SSRFError);
  });

  it('rejects private IP 172.16-31.x.x', async () => {
    await expect(validateUrl('http://172.16.0.1')).rejects.toThrow(SSRFError);
    await expect(validateUrl('http://172.31.255.255')).rejects.toThrow(SSRFError);
  });

  it('rejects cloud metadata IP', async () => {
    await expect(validateUrl('http://169.254.169.254')).rejects.toThrow(SSRFError);
  });

  it('rejects non-http schemes', async () => {
    await expect(validateUrl('ftp://example.com')).rejects.toThrow(SSRFError);
    await expect(validateUrl('file:///etc/passwd')).rejects.toThrow(SSRFError);
    await expect(validateUrl('javascript:alert(1)')).rejects.toThrow(SSRFError);
  });

  it('rejects URLs with credentials', async () => {
    await expect(validateUrl('http://user:pass@example.com')).rejects.toThrow(SSRFError);
  });

  it('rejects invalid URLs', async () => {
    await expect(validateUrl('not-a-url')).rejects.toThrow(SSRFError);
  });

  it('rejects metadata.google.internal', async () => {
    await expect(validateUrl('http://metadata.google.internal')).rejects.toThrow(SSRFError);
  });
});

describe('isAllowedRedirect', () => {
  it('allows valid HTTPS redirects', () => {
    expect(isAllowedRedirect('https://www.example.com/page', 'https://example.com')).toBe(true);
  });

  it('blocks redirect to localhost', () => {
    expect(isAllowedRedirect('http://localhost/admin', 'https://example.com')).toBe(false);
  });

  it('blocks redirect to 0.0.0.0', () => {
    expect(isAllowedRedirect('http://0.0.0.0:8080', 'https://example.com')).toBe(false);
  });

  it('blocks redirect to private IPs', () => {
    expect(isAllowedRedirect('http://192.168.1.1', 'https://example.com')).toBe(false);
    expect(isAllowedRedirect('http://10.0.0.1', 'https://example.com')).toBe(false);
    expect(isAllowedRedirect('http://127.0.0.1', 'https://example.com')).toBe(false);
  });

  it('blocks redirect to non-http schemes', () => {
    expect(isAllowedRedirect('ftp://example.com', 'https://example.com')).toBe(false);
  });

  it('blocks redirect with credentials', () => {
    expect(isAllowedRedirect('http://user:pass@example.com', 'https://example.com')).toBe(false);
  });

  it('handles relative redirects', () => {
    expect(isAllowedRedirect('/new-page', 'https://example.com')).toBe(true);
  });
});
