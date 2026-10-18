import * as cheerio from 'cheerio';
import { fetchPage, delay } from './fetcher.js';
import { fetchRobotsTxt, isPathAllowed } from './robots-parser.js';
import type { AnalysisConfig, CrawledPage, CrawlResult } from '../types.js';

export async function crawlWebsite(
  startUrl: string,
  config: AnalysisConfig,
): Promise<CrawlResult> {
  const start = Date.now();
  const pages: CrawledPage[] = [];
  const visited = new Set<string>();
  const errors: string[] = [];

  let parsedStart: URL;
  try {
    parsedStart = new URL(startUrl);
  } catch {
    return { pages: [], domain: '', startUrl, durationMs: 0, errors: [`Invalid URL: ${startUrl}`] };
  }

  const domain = parsedStart.hostname;
  const origin = parsedStart.origin;

  const robots = await fetchRobotsTxt(origin, config.requestTimeoutMs);

  const queue: string[] = [];
  const priorityUrls = config.priorityPaths.map(p => new URL(p, origin).href);
  queue.push(startUrl);
  for (const pUrl of priorityUrls) {
    if (pUrl !== startUrl) queue.push(pUrl);
  }

  while (queue.length > 0 && pages.length < config.maxPages) {
    const url = queue.shift()!;
    const normalized = normalizeUrl(url);

    if (visited.has(normalized)) continue;
    visited.add(normalized);

    const path = new URL(url).pathname;

    if (config.blockedPaths.some(blocked => path.startsWith(blocked))) continue;
    if (robots && !isPathAllowed(path, robots)) continue;

    try {
      if (pages.length > 0) await delay(config.interRequestDelayMs);

      const page = await fetchPage(url, config);
      if (page.statusCode >= 200 && page.statusCode < 300) {
        pages.push(page);
        const links = extractInternalLinks(page.html, origin, domain);
        for (const link of links) {
          const normLink = normalizeUrl(link);
          if (!visited.has(normLink) && !config.blockedPaths.some(b => new URL(link).pathname.startsWith(b))) {
            if (!robots || isPathAllowed(new URL(link).pathname, robots)) {
              queue.push(link);
            }
          }
        }
      }
    } catch (err) {
      errors.push(`Failed to fetch ${url}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    pages,
    domain,
    startUrl,
    durationMs: Date.now() - start,
    errors,
  };
}

function extractInternalLinks(html: string, origin: string, domain: string): string[] {
  const $ = cheerio.load(html);
  const links: string[] = [];

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    try {
      const resolved = new URL(href, origin);
      if (resolved.hostname === domain && (resolved.protocol === 'http:' || resolved.protocol === 'https:')) {
        resolved.hash = '';
        links.push(resolved.href);
      }
    } catch { /* ignore invalid hrefs */ }
  });

  return [...new Set(links)];
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    let pathname = parsed.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    parsed.pathname = pathname;
    return parsed.href;
  } catch {
    return url;
  }
}
