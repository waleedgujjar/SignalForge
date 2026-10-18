import * as cheerio from 'cheerio';
import type { CrawledPage, ContentFindings, Finding } from '../types.js';

const TRUST_KEYWORDS = ['certified', 'trusted', 'award', 'partner', 'client', 'customer', 'guarantee', 'secure', 'years of experience', 'since '];
const VALUE_PROP_PATTERNS = [/we help/i, /our mission/i, /why choose/i, /what we do/i, /how we/i, /transform/i, /solution/i, /empower/i];

export function analyzeContent(pages: CrawledPage[]): ContentFindings {
  const findings: Finding[] = [];
  const homepage = pages[0];

  if (!homepage) {
    return {
      findings: [{ category: 'content', severity: 'CRITICAL', title: 'No pages to analyze', description: 'No pages available for content analysis.', confidence: 'HIGH', source: 'DETERMINISTIC' }],
      hasValueProposition: false, hasServiceDescriptions: false, hasTrustSignals: false, hasBlog: false, headingStructureScore: 0,
    };
  }

  const $ = cheerio.load(homepage.html);
  const bodyText = $('body').text().toLowerCase();
  const allText = pages.map(p => cheerio.load(p.html)('body').text().toLowerCase()).join(' ');

  const hasValueProposition = VALUE_PROP_PATTERNS.some(p => p.test(bodyText));
  if (!hasValueProposition) {
    findings.push({ category: 'content', severity: 'MEDIUM', title: 'Weak value proposition', description: 'No clear value proposition patterns found on homepage.', confidence: 'MEDIUM', source: 'HEURISTIC' });
  }

  const servicePages = pages.filter(p => {
    const url = p.url.toLowerCase();
    return url.includes('/service') || url.includes('/product') || url.includes('/solution') || url.includes('/feature');
  });
  const hasServiceDescriptions = servicePages.length > 0 || bodyText.includes('service') || bodyText.includes('product');
  if (!hasServiceDescriptions) {
    findings.push({ category: 'content', severity: 'MEDIUM', title: 'No service descriptions', description: 'No dedicated service/product pages or descriptions found.', confidence: 'MEDIUM', source: 'HEURISTIC' });
  }

  const hasTrustSignals = TRUST_KEYWORDS.some(k => allText.includes(k));
  if (!hasTrustSignals) {
    findings.push({ category: 'content', severity: 'LOW', title: 'No trust signals', description: 'No client logos, certifications, or trust badges detected.', confidence: 'MEDIUM', source: 'HEURISTIC' });
  }

  const blogPages = pages.filter(p => p.url.toLowerCase().includes('/blog'));
  const hasBlog = blogPages.length > 0 || allText.includes('blog');

  const h1Count = $('h1').length;
  const h2Count = $('h2').length;
  const h3Count = $('h3').length;
  let headingStructureScore = 0;
  if (h1Count === 1) headingStructureScore += 40;
  else if (h1Count > 0) headingStructureScore += 20;
  if (h2Count >= 2) headingStructureScore += 30;
  else if (h2Count === 1) headingStructureScore += 15;
  if (h3Count >= 1) headingStructureScore += 30;
  else headingStructureScore += 10;

  if (headingStructureScore < 50) {
    findings.push({ category: 'content', severity: 'LOW', title: 'Poor heading structure', description: `Heading structure score: ${headingStructureScore}/100.`, confidence: 'HIGH', source: 'DETERMINISTIC' });
  }

  return { findings, hasValueProposition, hasServiceDescriptions, hasTrustSignals, hasBlog, headingStructureScore };
}
