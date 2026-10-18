import * as cheerio from 'cheerio';
import type { CrawledPage, SeoFindings, Finding } from '../types.js';

export function analyzeSeo(pages: CrawledPage[]): SeoFindings {
  const findings: Finding[] = [];
  const homepage = pages[0];

  if (!homepage) {
    return {
      findings: [{ category: 'seo', severity: 'CRITICAL', title: 'No pages to analyze', description: 'No pages available for SEO analysis.', confidence: 'HIGH', source: 'DETERMINISTIC' }],
      hasTitle: false, hasMetaDescription: false, hasCanonical: false, hasH1: false, h1Count: 0, h2Count: 0, hasOpenGraph: false, hasTwitterCard: false, hasStructuredData: false, hasSitemap: false, hasRobotsTxt: false, imgsMissingAlt: 0,
    };
  }

  const $ = cheerio.load(homepage.html);
  const title = $('title').text().trim();
  const hasTitle = title.length > 0;
  if (!hasTitle) {
    findings.push({ category: 'seo', severity: 'HIGH', title: 'Missing title tag', description: 'No <title> tag found on the homepage.', confidence: 'HIGH', source: 'DETERMINISTIC' });
  } else if (title.length < 20 || title.length > 70) {
    findings.push({ category: 'seo', severity: 'LOW', title: 'Title length issue', description: `Title is ${title.length} chars (recommended: 20-70).`, confidence: 'HIGH', source: 'DETERMINISTIC' });
  }

  const metaDesc = $('meta[name="description"]').attr('content')?.trim() ?? '';
  const hasMetaDescription = metaDesc.length > 0;
  if (!hasMetaDescription) {
    findings.push({ category: 'seo', severity: 'HIGH', title: 'Missing meta description', description: 'No meta description found on the homepage.', confidence: 'HIGH', source: 'DETERMINISTIC' });
  } else if (metaDesc.length < 50 || metaDesc.length > 160) {
    findings.push({ category: 'seo', severity: 'LOW', title: 'Meta description length', description: `Meta description is ${metaDesc.length} chars (recommended: 50-160).`, confidence: 'HIGH', source: 'DETERMINISTIC' });
  }

  const hasCanonical = $('link[rel="canonical"]').length > 0;
  if (!hasCanonical) {
    findings.push({ category: 'seo', severity: 'MEDIUM', title: 'No canonical URL', description: 'No canonical link tag found.', confidence: 'HIGH', source: 'DETERMINISTIC' });
  }

  const h1Count = $('h1').length;
  const hasH1 = h1Count > 0;
  if (!hasH1) {
    findings.push({ category: 'seo', severity: 'HIGH', title: 'Missing H1 heading', description: 'No H1 heading found on the homepage.', confidence: 'HIGH', source: 'DETERMINISTIC' });
  } else if (h1Count > 1) {
    findings.push({ category: 'seo', severity: 'LOW', title: 'Multiple H1 headings', description: `${h1Count} H1 headings found (recommended: 1).`, confidence: 'HIGH', source: 'DETERMINISTIC' });
  }

  const h2Count = $('h2').length;

  const hasOpenGraph = $('meta[property^="og:"]').length > 0;
  const hasTwitterCard = $('meta[name^="twitter:"]').length > 0;
  if (!hasOpenGraph) {
    findings.push({ category: 'seo', severity: 'MEDIUM', title: 'No Open Graph tags', description: 'No OG meta tags for social sharing.', confidence: 'HIGH', source: 'DETERMINISTIC' });
  }
  if (!hasTwitterCard) {
    findings.push({ category: 'seo', severity: 'LOW', title: 'No Twitter Card tags', description: 'No Twitter Card meta tags found.', confidence: 'HIGH', source: 'DETERMINISTIC' });
  }

  const hasStructuredData = homepage.html.includes('application/ld+json') || homepage.html.includes('itemtype=');

  let imgsMissingAlt = 0;
  for (const page of pages) {
    const p$ = cheerio.load(page.html);
    p$('img').each((_, el) => {
      const alt = p$(el).attr('alt');
      if (alt === undefined || alt.trim() === '') imgsMissingAlt++;
    });
  }

  if (imgsMissingAlt > 0) {
    findings.push({ category: 'seo', severity: 'MEDIUM', title: 'Images missing alt text', description: `${imgsMissingAlt} image(s) without alt attributes.`, confidence: 'HIGH', source: 'DETERMINISTIC' });
  }

  const hasSitemap = pages.some(p => p.html.toLowerCase().includes('sitemap'));
  const hasRobotsTxt = true;

  return { findings, hasTitle, hasMetaDescription, hasCanonical, hasH1, h1Count, h2Count, hasOpenGraph, hasTwitterCard, hasStructuredData, hasSitemap, hasRobotsTxt, imgsMissingAlt };
}
