import * as cheerio from 'cheerio';
import type { CrawledPage, MobileFindings, Finding } from '../types.js';

export function analyzeMobile(pages: CrawledPage[]): MobileFindings {
  const findings: Finding[] = [];
  const homepage = pages[0];

  if (!homepage) {
    return {
      findings: [{ category: 'mobile', severity: 'CRITICAL', title: 'No pages to analyze', description: 'No pages available for mobile analysis.', confidence: 'HIGH', source: 'DETERMINISTIC' }],
      hasViewportMeta: false, hasResponsiveSignals: false, hasFixedWidthElements: false, touchTargetConcerns: 0,
    };
  }

  const $ = cheerio.load(homepage.html);

  const viewportMeta = $('meta[name="viewport"]').attr('content') ?? '';
  const hasViewportMeta = viewportMeta.length > 0;
  if (!hasViewportMeta) {
    findings.push({ category: 'mobile', severity: 'HIGH', title: 'No viewport meta tag', description: 'Missing viewport meta tag — page will not scale properly on mobile.', confidence: 'HIGH', source: 'DETERMINISTIC' });
  } else if (!viewportMeta.includes('width=device-width')) {
    findings.push({ category: 'mobile', severity: 'MEDIUM', title: 'Viewport not responsive', description: 'Viewport meta tag does not include width=device-width.', confidence: 'HIGH', source: 'DETERMINISTIC' });
  }

  const htmlContent = homepage.html;
  const hasResponsiveSignals =
    htmlContent.includes('@media') ||
    htmlContent.includes('max-width') ||
    htmlContent.includes('min-width') ||
    htmlContent.includes('flex') ||
    htmlContent.includes('grid') ||
    $('link[media]').length > 0;

  if (!hasResponsiveSignals) {
    findings.push({ category: 'mobile', severity: 'MEDIUM', title: 'No responsive CSS signals', description: 'No media queries, flexbox, or grid patterns detected.', confidence: 'MEDIUM', source: 'HEURISTIC' });
  }

  const fixedWidthPattern = /width\s*:\s*\d{4,}px/i;
  const hasFixedWidthElements = fixedWidthPattern.test(htmlContent);
  if (hasFixedWidthElements) {
    findings.push({ category: 'mobile', severity: 'MEDIUM', title: 'Fixed-width elements', description: 'Elements with large fixed pixel widths detected.', confidence: 'MEDIUM', source: 'HEURISTIC' });
  }

  let touchTargetConcerns = 0;
  $('a, button, input[type="submit"], input[type="button"]').each((_, el) => {
    const style = $(el).attr('style') ?? '';
    const smallPattern = /(?:font-size|height|padding)\s*:\s*(\d+)px/g;
    let match;
    while ((match = smallPattern.exec(style)) !== null) {
      if (parseInt(match[1]!, 10) < 10) touchTargetConcerns++;
    }
  });

  if (touchTargetConcerns > 0) {
    findings.push({ category: 'mobile', severity: 'LOW', title: 'Small touch targets', description: `${touchTargetConcerns} element(s) may have insufficient touch target size.`, confidence: 'LOW', source: 'HEURISTIC' });
  }

  return { findings, hasViewportMeta, hasResponsiveSignals, hasFixedWidthElements, touchTargetConcerns };
}
