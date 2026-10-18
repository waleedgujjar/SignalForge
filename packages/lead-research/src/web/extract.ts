/// Deterministic HTML extraction — pure functions, no side effects.
///
/// Each function receives crawled pages and returns structured data extracted
/// via cheerio. No AI calls, no network access, fully testable.

import * as cheerio from 'cheerio';
import type { CrawledPage } from '@signalforge/website-scanner';

function loadPage(page: CrawledPage): cheerio.CheerioAPI {
  return cheerio.load(page.html);
}

function isAboutPage(url: string): boolean {
  return /\/(about|who-we-are|our-story|company)/i.test(url);
}

function isServicesPage(url: string): boolean {
  return /\/(services|solutions|products|what-we-do|offerings)/i.test(url);
}

function isTeamPage(url: string): boolean {
  return /\/(team|staff|people|our-team|about-us)/i.test(url);
}

function isContactPage(url: string): boolean {
  return /\/(contact|get-in-touch|reach-us|locations?)/i.test(url);
}

export function extractCompanyName(pages: CrawledPage[]): string | undefined {
  for (const page of pages) {
    const $ = loadPage(page);

    const ogSiteName = $('meta[property="og:site_name"]').attr('content')?.trim();
    if (ogSiteName && ogSiteName.length > 1 && ogSiteName.length < 100) return ogSiteName;

    const appName = $('meta[name="application-name"]').attr('content')?.trim();
    if (appName && appName.length > 1 && appName.length < 100) return appName;
  }

  if (pages.length > 0) {
    const $ = loadPage(pages[0]!);
    const title = $('title').text().trim();
    if (title) {
      const cleaned = title.split(/[|\-–—]/)[0]?.trim();
      if (cleaned && cleaned.length > 1 && cleaned.length < 80) return cleaned;
    }

    const h1 = $('h1').first().text().trim();
    if (h1 && h1.length > 1 && h1.length < 80) return h1;
  }

  return undefined;
}

export function extractDescription(pages: CrawledPage[]): string | undefined {
  for (const page of pages) {
    if (isAboutPage(page.url) || page.url === pages[0]?.url) {
      const $ = loadPage(page);

      const ogDesc = $('meta[property="og:description"]').attr('content')?.trim();
      if (ogDesc && ogDesc.length > 20) return ogDesc.slice(0, 500);

      const metaDesc = $('meta[name="description"]').attr('content')?.trim();
      if (metaDesc && metaDesc.length > 20) return metaDesc.slice(0, 500);
    }
  }

  const aboutPage = pages.find((p) => isAboutPage(p.url));
  if (aboutPage) {
    const $ = loadPage(aboutPage);
    const paragraphs = $('main p, article p, .content p, #content p, .about p')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((t) => t.length > 50);
    if (paragraphs.length > 0) return paragraphs[0]!.slice(0, 500);
  }

  return undefined;
}

export function extractServices(pages: CrawledPage[]): string[] {
  const services: string[] = [];
  const seen = new Set<string>();

  for (const page of pages) {
    if (!isServicesPage(page.url) && page.url !== pages[0]?.url) continue;
    const $ = loadPage(page);

    $('h2, h3').each((_, el) => {
      const text = $(el).text().trim();
      if (text.length > 3 && text.length < 100 && !seen.has(text.toLowerCase())) {
        seen.add(text.toLowerCase());
        services.push(text);
      }
    });

    $('ul li, ol li').each((_, el) => {
      const text = $(el).text().trim();
      if (text.length > 3 && text.length < 100 && !seen.has(text.toLowerCase())) {
        seen.add(text.toLowerCase());
        services.push(text);
      }
    });
  }

  return services.slice(0, 20);
}

export function extractLocation(pages: CrawledPage[]): string | undefined {
  for (const page of pages) {
    const $ = loadPage(page);

    const jsonLd = $('script[type="application/ld+json"]')
      .map((_, el) => $(el).html())
      .get();
    for (const raw of jsonLd) {
      if (!raw) continue;
      try {
        const data = JSON.parse(raw) as Record<string, unknown>;
        const address = (data.address ?? (data as Record<string, unknown>)['@graph']) as Record<string, unknown> | undefined;
        if (address && typeof address === 'object' && 'addressLocality' in address) {
          const parts = [address.addressLocality, address.addressRegion, address.postalCode]
            .filter(Boolean)
            .map(String);
          if (parts.length > 0) return parts.join(', ');
        }
      } catch {
        // ignore malformed JSON-LD
      }
    }

    const addrEl = $('address').first().text().trim();
    if (addrEl && addrEl.length > 5 && addrEl.length < 200) return addrEl;
  }

  return undefined;
}

export function extractCertifications(allText: string): string[] {
  const patterns = [
    /\b(EPA\s+certified|NATE\s+certified|BBB\s+accredited|ISO\s+\d+|LEED|Energy\s+Star|bonded\s+and\s+insured|licensed\s+and\s+insured)\b/gi,
  ];
  const certs = new Set<string>();
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(allText)) !== null) {
      certs.add(match[1]!.trim());
    }
  }
  return [...certs].slice(0, 10);
}

export function extractServiceArea(allText: string): string | undefined {
  const patterns = [
    /serving\s+(?:the\s+)?(.{5,60}?)(?:\s+area|\s+region|\s+community|\.)/i,
    /proudly\s+serv(?:ing|e)\s+(.{5,60}?)(?:\s+and\s+surrounding|\s+area|\.)/i,
    /service\s+area[:\s]+(.{5,60}?)(?:\.|\n)/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(allText);
    if (match?.[1]) return match[1].trim();
  }
  return undefined;
}

export function extractYearEstablished(allText: string): string | undefined {
  const patterns = [
    /(?:established|founded|since|est\.?)\s+(?:in\s+)?(\d{4})/i,
    /(\d{4})\s*[-–]\s*present/i,
    /over\s+(\d+)\s+years?\s+(?:of\s+)?(?:experience|service)/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(allText);
    if (match?.[1]) {
      const num = parseInt(match[1], 10);
      if (num >= 1900 && num <= new Date().getFullYear()) return String(num);
      if (num > 0 && num < 200) {
        return String(new Date().getFullYear() - num);
      }
    }
  }
  return undefined;
}

export interface PagePresence {
  hasTeamPage: boolean;
  hasTestimonials: boolean;
  hasBlog: boolean;
  hasContactForm: boolean;
}

export function detectPagePresence(pages: CrawledPage[]): PagePresence {
  let hasTeamPage = false;
  let hasTestimonials = false;
  let hasBlog = false;
  let hasContactForm = false;

  for (const page of pages) {
    const url = page.url.toLowerCase();
    const $ = loadPage(page);

    if (isTeamPage(url)) hasTeamPage = true;
    if (/\/(testimonials?|reviews?|clients?|case-stud)/i.test(url)) hasTestimonials = true;
    if (/\/(blog|news|articles?|resources?)/i.test(url)) hasBlog = true;
    if (isContactPage(url) && $('form').length > 0) hasContactForm = true;

    const text = $('body').text().toLowerCase();
    if (!hasTestimonials && /testimonial|client review|customer feedback/i.test(text)) {
      hasTestimonials = true;
    }
  }

  return { hasTeamPage, hasTestimonials, hasBlog, hasContactForm };
}

export function getAllText(pages: CrawledPage[]): string {
  return pages
    .map((page) => {
      const $ = loadPage(page);
      $('script, style, noscript, nav, header, footer').remove();
      return $('body').text().replace(/\s+/g, ' ').trim();
    })
    .join('\n')
    .slice(0, 50_000);
}
