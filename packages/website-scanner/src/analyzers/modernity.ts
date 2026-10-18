import * as cheerio from 'cheerio';
import type { CrawledPage, ModernityAssessment, Finding } from '../types.js';

const OUTDATED_SIGNALS = [
  { pattern: /<table[^>]*(?:cellpadding|cellspacing|bgcolor)/i, label: 'Table-based layout' },
  { pattern: /<font[\s>]/i, label: 'Deprecated <font> tag' },
  { pattern: /<center[\s>]/i, label: 'Deprecated <center> tag' },
  { pattern: /<marquee[\s>]/i, label: 'Deprecated <marquee> tag' },
  { pattern: /<blink[\s>]/i, label: 'Deprecated <blink> tag' },
  { pattern: /<frameset[\s>]/i, label: 'Frameset usage' },
  { pattern: /<iframe[^>]*src="[^"]*flash/i, label: 'Flash content' },
  { pattern: /\.swf/i, label: 'SWF Flash file' },
  { pattern: /<!--\[if\s+(?:lt\s+)?IE/i, label: 'IE conditional comments' },
  { pattern: /document\.write\(/i, label: 'document.write usage' },
];

const MODERN_SIGNALS = [
  { pattern: /data-reactroot|__react|_reactRootContainer/i, label: 'React SPA' },
  { pattern: /__next|_next\/static/i, label: 'Next.js' },
  { pattern: /data-v-[a-f0-9]|__nuxt/i, label: 'Vue/Nuxt' },
  { pattern: /loading="lazy"/i, label: 'Lazy loading images' },
  { pattern: /srcset=/i, label: 'Responsive images' },
  { pattern: /<picture[\s>]/i, label: 'Picture element' },
  { pattern: /service-?worker/i, label: 'Service worker' },
  { pattern: /preconnect|prefetch|preload/i, label: 'Resource hints' },
  { pattern: /<svg[\s>]/i, label: 'SVG graphics' },
  { pattern: /display:\s*(?:flex|grid)/i, label: 'Modern CSS layout' },
  { pattern: /@media\s*\(/i, label: 'Media queries' },
  { pattern: /--[a-zA-Z-]+\s*:/i, label: 'CSS custom properties' },
];

export function analyzeModernity(pages: CrawledPage[]): ModernityAssessment {
  const findings: Finding[] = [];

  if (pages.length === 0) {
    return {
      findings: [{ category: 'modernity', severity: 'INFO', title: 'No pages to analyze', description: 'No pages available.', confidence: 'HIGH', source: 'DETERMINISTIC' }],
      modernityScore: 0, outdatedSignals: [], modernSignals: [],
    };
  }

  const outdatedFound: string[] = [];
  const modernFound: string[] = [];

  const allHtml = pages.map(p => p.html).join('\n');

  for (const sig of OUTDATED_SIGNALS) {
    if (sig.pattern.test(allHtml)) {
      outdatedFound.push(sig.label);
    }
  }

  for (const sig of MODERN_SIGNALS) {
    if (sig.pattern.test(allHtml)) {
      modernFound.push(sig.label);
    }
  }

  const homepage = pages[0]!;
  const $ = cheerio.load(homepage.html);

  const hasDoctype = homepage.html.trimStart().toLowerCase().startsWith('<!doctype html');
  if (!hasDoctype) outdatedFound.push('Missing HTML5 doctype');

  const hasHtml5Semantic = $('header, nav, main, footer, section, article, aside').length > 0;
  if (hasHtml5Semantic) modernFound.push('HTML5 semantic elements');

  let modernityScore = 50;
  modernityScore += modernFound.length * 5;
  modernityScore -= outdatedFound.length * 10;
  modernityScore = Math.max(0, Math.min(100, modernityScore));

  if (outdatedFound.length > 0) {
    findings.push({
      category: 'modernity',
      severity: outdatedFound.length > 3 ? 'HIGH' : 'MEDIUM',
      title: 'Outdated web patterns',
      description: `Found ${outdatedFound.length} outdated pattern(s): ${outdatedFound.slice(0, 3).join(', ')}${outdatedFound.length > 3 ? '...' : ''}.`,
      confidence: 'HIGH',
      source: 'DETERMINISTIC',
    });
  }

  if (modernityScore < 30) {
    findings.push({ category: 'modernity', severity: 'HIGH', title: 'Very outdated website', description: `Modernity score: ${modernityScore}/100.`, confidence: 'MEDIUM', source: 'HEURISTIC' });
  } else if (modernityScore < 50) {
    findings.push({ category: 'modernity', severity: 'MEDIUM', title: 'Dated website', description: `Modernity score: ${modernityScore}/100.`, confidence: 'MEDIUM', source: 'HEURISTIC' });
  }

  return { findings, modernityScore, outdatedSignals: outdatedFound, modernSignals: modernFound };
}
