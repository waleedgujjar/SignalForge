import { describe, expect, it } from 'vitest';
import type { CrawledPage } from '@signalforge/website-scanner';

import {
  extractCompanyName,
  extractDescription,
  extractServices,
  extractLocation,
  extractCertifications,
  extractServiceArea,
  extractYearEstablished,
  detectPagePresence,
  getAllText,
} from '../extract.js';

function page(url: string, html: string): CrawledPage {
  return { url, html, status: 200, contentType: 'text/html', headers: {} } as unknown as CrawledPage;
}

describe('extractCompanyName', () => {
  it('extracts from og:site_name', () => {
    const pages = [page('https://acme.com', '<html><head><meta property="og:site_name" content="Acme HVAC" /></head><body></body></html>')];
    expect(extractCompanyName(pages)).toBe('Acme HVAC');
  });

  it('extracts from title tag (split on separator)', () => {
    const pages = [page('https://acme.com', '<html><head><title>Acme HVAC | Houston TX</title></head><body></body></html>')];
    expect(extractCompanyName(pages)).toBe('Acme HVAC');
  });

  it('falls back to h1', () => {
    const pages = [page('https://acme.com', '<html><head><title></title></head><body><h1>Acme Heating & Cooling</h1></body></html>')];
    expect(extractCompanyName(pages)).toBe('Acme Heating & Cooling');
  });

  it('returns undefined for empty pages', () => {
    expect(extractCompanyName([])).toBeUndefined();
  });
});

describe('extractDescription', () => {
  it('extracts from og:description on home page', () => {
    const html = '<html><head><meta property="og:description" content="Acme HVAC provides expert heating and cooling services to the greater Houston area since 1985." /></head><body></body></html>';
    expect(extractDescription([page('https://acme.com', html)])).toContain('Acme HVAC provides');
  });

  it('extracts from about page paragraphs', () => {
    const home = page('https://acme.com', '<html><body></body></html>');
    const about = page('https://acme.com/about', '<html><body><main><p>Acme HVAC has been proudly serving the Houston community for over 35 years with top-quality heating and cooling solutions.</p></main></body></html>');
    expect(extractDescription([home, about])).toContain('Acme HVAC has been proudly serving');
  });
});

describe('extractServices', () => {
  it('extracts h2/h3 headings from services page', () => {
    const svc = page('https://acme.com/services', `
      <html><body>
        <h2>AC Installation</h2>
        <h2>Heating Repair</h2>
        <h3>Duct Cleaning</h3>
      </body></html>
    `);
    const result = extractServices([page('https://acme.com', '<html><body></body></html>'), svc]);
    expect(result).toContain('AC Installation');
    expect(result).toContain('Heating Repair');
    expect(result).toContain('Duct Cleaning');
  });

  it('extracts list items from services page', () => {
    const svc = page('https://acme.com/services', `
      <html><body>
        <ul>
          <li>Furnace Installation</li>
          <li>Air Conditioning Maintenance</li>
        </ul>
      </body></html>
    `);
    const result = extractServices([page('https://acme.com', '<html><body></body></html>'), svc]);
    expect(result).toContain('Furnace Installation');
    expect(result).toContain('Air Conditioning Maintenance');
  });

  it('caps at 20 services', () => {
    const items = Array.from({ length: 25 }, (_, i) => `<li>Service ${i + 1}</li>`).join('');
    const svc = page('https://acme.com/services', `<html><body><ul>${items}</ul></body></html>`);
    expect(extractServices([page('https://acme.com', '<html><body></body></html>'), svc])).toHaveLength(20);
  });
});

describe('extractLocation', () => {
  it('extracts from JSON-LD structured data', () => {
    const html = `<html><body>
      <script type="application/ld+json">{"@type":"LocalBusiness","address":{"addressLocality":"Houston","addressRegion":"TX","postalCode":"77001"}}</script>
    </body></html>`;
    expect(extractLocation([page('https://acme.com', html)])).toBe('Houston, TX, 77001');
  });

  it('extracts from address element', () => {
    const html = '<html><body><address>1234 Main St, Houston, TX 77001</address></body></html>';
    expect(extractLocation([page('https://acme.com/contact', html)])).toBe('1234 Main St, Houston, TX 77001');
  });
});

describe('extractCertifications', () => {
  it('finds HVAC certifications in text', () => {
    const text = 'We are NATE certified and BBB accredited. All technicians are EPA certified.';
    const certs = extractCertifications(text);
    expect(certs).toContain('NATE certified');
    expect(certs).toContain('BBB accredited');
    expect(certs).toContain('EPA certified');
  });

  it('returns empty for no matches', () => {
    expect(extractCertifications('Just a regular company.')).toEqual([]);
  });
});

describe('extractServiceArea', () => {
  it('extracts "serving the X area" pattern', () => {
    expect(extractServiceArea('We are proudly serving the greater Houston area.')).toBe('greater Houston');
  });

  it('returns undefined when not mentioned', () => {
    expect(extractServiceArea('We fix air conditioners.')).toBeUndefined();
  });
});

describe('extractYearEstablished', () => {
  it('extracts "established in YYYY"', () => {
    expect(extractYearEstablished('Established in 1985, we have been serving ...')).toBe('1985');
  });

  it('extracts "YYYY–present" pattern', () => {
    expect(extractYearEstablished('1990–present')).toBe('1990');
  });

  it('converts "over N years" to a year', () => {
    const result = extractYearEstablished('Over 30 years of experience');
    expect(Number(result)).toBeLessThanOrEqual(new Date().getFullYear());
    expect(Number(result)).toBeGreaterThan(1900);
  });
});

describe('detectPagePresence', () => {
  it('detects team page, testimonials, blog, and contact form', () => {
    const pages = [
      page('https://acme.com', '<html><body></body></html>'),
      page('https://acme.com/team', '<html><body>Our Team</body></html>'),
      page('https://acme.com/testimonials', '<html><body>What our clients say</body></html>'),
      page('https://acme.com/blog', '<html><body>Latest news</body></html>'),
      page('https://acme.com/contact', '<html><body><form><input type="text" /><button>Send</button></form></body></html>'),
    ];
    const result = detectPagePresence(pages);
    expect(result.hasTeamPage).toBe(true);
    expect(result.hasTestimonials).toBe(true);
    expect(result.hasBlog).toBe(true);
    expect(result.hasContactForm).toBe(true);
  });

  it('returns false when none present', () => {
    const pages = [page('https://acme.com', '<html><body>Home</body></html>')];
    const result = detectPagePresence(pages);
    expect(result.hasTeamPage).toBe(false);
    expect(result.hasTestimonials).toBe(false);
    expect(result.hasBlog).toBe(false);
    expect(result.hasContactForm).toBe(false);
  });
});

describe('getAllText', () => {
  it('strips script/style/nav and returns body text', () => {
    const html = '<html><body><nav>Menu</nav><script>var x=1;</script><main><p>Hello world</p></main></body></html>';
    const text = getAllText([page('https://acme.com', html)]);
    expect(text).toContain('Hello world');
    expect(text).not.toContain('var x=1');
    expect(text).not.toContain('Menu');
  });
});
