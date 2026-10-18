import * as cheerio from 'cheerio';
import type { CrawledPage, PerformanceData, Finding } from '../types.js';

export function analyzePerformance(pages: CrawledPage[]): PerformanceData {
  const findings: Finding[] = [];

  if (pages.length === 0) {
    return {
      findings: [{ category: 'performance', severity: 'CRITICAL', title: 'No pages to analyze', description: 'No pages available for performance analysis.', confidence: 'HIGH', source: 'DETERMINISTIC' }],
      avgLoadTimeMs: 0, totalPageSizeBytes: 0, resourceCounts: { scripts: 0, stylesheets: 0, images: 0, total: 0 }, hasRenderBlockingResources: false, largeResources: [],
    };
  }

  const avgLoadTimeMs = Math.round(pages.reduce((sum, p) => sum + p.loadTimeMs, 0) / pages.length);
  const totalPageSizeBytes = pages.reduce((sum, p) => sum + p.contentLength, 0);

  if (avgLoadTimeMs > 3000) {
    findings.push({ category: 'performance', severity: 'HIGH', title: 'Slow page load', description: `Average load time is ${avgLoadTimeMs}ms (target: <3000ms).`, confidence: 'MEDIUM', source: 'DETERMINISTIC' });
  } else if (avgLoadTimeMs > 1500) {
    findings.push({ category: 'performance', severity: 'MEDIUM', title: 'Moderate page load', description: `Average load time is ${avgLoadTimeMs}ms.`, confidence: 'MEDIUM', source: 'DETERMINISTIC' });
  }

  let totalScripts = 0;
  let totalStylesheets = 0;
  let totalImages = 0;
  let hasRenderBlockingResources = false;
  const largeResources: { url: string; sizeEstimate: string; type: string }[] = [];

  for (const page of pages) {
    const $ = cheerio.load(page.html);
    const scripts = $('script[src]');
    const stylesheets = $('link[rel="stylesheet"]');
    const images = $('img[src]');

    totalScripts += scripts.length;
    totalStylesheets += stylesheets.length;
    totalImages += images.length;

    scripts.each((_, el) => {
      const async = $(el).attr('async');
      const defer = $(el).attr('defer');
      if (async === undefined && defer === undefined) {
        hasRenderBlockingResources = true;
      }
    });

    $('link[rel="stylesheet"]').each((_, el) => {
      const media = $(el).attr('media');
      if (!media || media === 'all') {
        hasRenderBlockingResources = true;
      }
    });
  }

  if (totalScripts > 15) {
    findings.push({ category: 'performance', severity: 'MEDIUM', title: 'Many external scripts', description: `${totalScripts} external scripts detected across ${pages.length} page(s).`, confidence: 'HIGH', source: 'DETERMINISTIC' });
  }

  if (hasRenderBlockingResources) {
    findings.push({ category: 'performance', severity: 'MEDIUM', title: 'Render-blocking resources', description: 'Scripts without async/defer or stylesheets without media queries block rendering.', confidence: 'HIGH', source: 'DETERMINISTIC' });
  }

  const avgPageSize = Math.round(totalPageSizeBytes / pages.length);
  if (avgPageSize > 2 * 1024 * 1024) {
    findings.push({ category: 'performance', severity: 'HIGH', title: 'Large page size', description: `Average page size is ${Math.round(avgPageSize / 1024)}KB.`, confidence: 'HIGH', source: 'DETERMINISTIC' });
  } else if (avgPageSize > 500 * 1024) {
    findings.push({ category: 'performance', severity: 'MEDIUM', title: 'Moderate page size', description: `Average page size is ${Math.round(avgPageSize / 1024)}KB.`, confidence: 'HIGH', source: 'DETERMINISTIC' });
  }

  return {
    findings,
    avgLoadTimeMs,
    totalPageSizeBytes,
    resourceCounts: { scripts: totalScripts, stylesheets: totalStylesheets, images: totalImages, total: totalScripts + totalStylesheets + totalImages },
    hasRenderBlockingResources,
    largeResources,
  };
}
