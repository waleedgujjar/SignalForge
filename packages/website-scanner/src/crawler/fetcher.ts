import { isAllowedRedirect, SSRFError, validateUrl } from './url-validator.js';
import type { AnalysisConfig, CrawledPage } from '../types.js';

export async function fetchPage(
  url: string,
  config: AnalysisConfig,
): Promise<CrawledPage> {
  await validateUrl(url);

  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'manual',
      headers: {
        'User-Agent': 'SignalForge-Scanner/1.0 (+https://signalforge.io/bot)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Encoding': 'gzip, deflate',
      },
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new Error(`Redirect without Location header from ${url}`);

      if (!isAllowedRedirect(location, url)) {
        throw new SSRFError(`Blocked redirect to: ${location}`);
      }

      let redirectCount = 0;
      let currentUrl = new URL(location, url).href;
      let currentRes = res;

      while (redirectCount < config.maxRedirects) {
        await validateUrl(currentUrl);
        currentRes = await fetch(currentUrl, {
          signal: controller.signal,
          redirect: 'manual',
          headers: {
            'User-Agent': 'SignalForge-Scanner/1.0 (+https://signalforge.io/bot)',
            'Accept': 'text/html,application/xhtml+xml',
          },
        });

        if (currentRes.status >= 300 && currentRes.status < 400) {
          const nextLocation = currentRes.headers.get('location');
          if (!nextLocation) break;
          if (!isAllowedRedirect(nextLocation, currentUrl)) {
            throw new SSRFError(`Blocked redirect to: ${nextLocation}`);
          }
          currentUrl = new URL(nextLocation, currentUrl).href;
          redirectCount++;
        } else {
          break;
        }
      }

      if (redirectCount >= config.maxRedirects) {
        throw new Error(`Too many redirects (${config.maxRedirects}) for ${url}`);
      }

      return await buildCrawledPage(currentUrl, currentRes, start, config);
    }

    return await buildCrawledPage(url, res, start, config);
  } finally {
    clearTimeout(timer);
  }
}

async function buildCrawledPage(
  url: string,
  res: Response,
  startTime: number,
  config: AnalysisConfig,
): Promise<CrawledPage> {
  const contentLength = parseInt(res.headers.get('content-length') ?? '0', 10);
  if (contentLength > config.maxResponseBytes) {
    throw new Error(`Response too large: ${contentLength} bytes`);
  }

  const buffer = await res.arrayBuffer();
  if (buffer.byteLength > config.maxResponseBytes) {
    throw new Error(`Response too large: ${buffer.byteLength} bytes`);
  }

  const html = new TextDecoder().decode(buffer);
  const headers: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  return {
    url,
    statusCode: res.status,
    headers,
    html,
    contentLength: buffer.byteLength,
    loadTimeMs: Date.now() - startTime,
  };
}

export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
