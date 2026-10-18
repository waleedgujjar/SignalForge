export interface RobotsRules {
  disallowed: string[];
  sitemapUrls: string[];
}

export function parseRobotsTxt(content: string): RobotsRules {
  const disallowed: string[] = [];
  const sitemapUrls: string[] = [];
  let inWildcardAgent = false;

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const lower = line.toLowerCase();

    if (lower.startsWith('user-agent:')) {
      const agent = line.slice('user-agent:'.length).trim();
      inWildcardAgent = agent === '*';
      continue;
    }

    if (lower.startsWith('sitemap:')) {
      sitemapUrls.push(line.slice('sitemap:'.length).trim());
      continue;
    }

    if (inWildcardAgent && lower.startsWith('disallow:')) {
      const path = line.slice('disallow:'.length).trim();
      if (path) disallowed.push(path);
    }
  }

  return { disallowed, sitemapUrls };
}

export function isPathAllowed(path: string, rules: RobotsRules): boolean {
  for (const disallowed of rules.disallowed) {
    if (path.startsWith(disallowed)) return false;
  }
  return true;
}

export async function fetchRobotsTxt(baseUrl: string, timeoutMs: number): Promise<RobotsRules | null> {
  try {
    const url = new URL('/robots.txt', baseUrl).href;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'SignalForge-Scanner/1.0' },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const text = await res.text();
    return parseRobotsTxt(text);
  } catch {
    return null;
  }
}
