import type { Env } from '@signalforge/config';
import { getEnv } from '@signalforge/config';

export class ScraperError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'ScraperError';
  }
}

export interface ScraperClientOptions {
  fetchImpl?: typeof fetch;
  env?: Env | (() => Env);
}

export interface ScraperJobRequest {
  keywords: string[];
  lat: string;
  lon: string;
  max_time: number;
  name?: string;
  lang?: string;
  zoom?: number;
  fast_mode?: boolean;
  radius?: number;
  depth?: number;
  email?: boolean;
}

export interface ScraperJobStatus {
  id: string;
  Status: string;
}

export interface ScraperResultRow {
  input_id: string;
  link: string;
  title: string;
  category: string;
  address: string;
  open_hours: string;
  popular_times: string;
  website: string;
  phone: string;
  plus_code: string;
  review_count: string;
  review_rating: string;
  reviews_per_rating: string;
  latitude: string;
  longitude: string;
  cid: string;
  status: string;
  descriptions: string;
  reviews_link: string;
  thumbnail: string;
  timezone: string;
  price_range: string;
  data_id: string;
  place_id: string;
  images: string;
  reservations: string;
  order_online: string;
  menu: string;
  owner: string;
  complete_address: string;
  about: string;
  user_reviews: string;
  user_reviews_extended: string;
  emails: string;
}

export class GoogleMapsScraperClient {
  private readonly fetchImpl: typeof fetch;
  private readonly envSource: Env | (() => Env);

  constructor(options: ScraperClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.envSource = options.env ?? getEnv;
  }

  private readEnv(): Env {
    return typeof this.envSource === 'function' ? this.envSource() : this.envSource;
  }

  private get baseUrl(): string {
    return this.readEnv().GOOGLE_MAPS_SCRAPER_URL;
  }

  async healthCheck(): Promise<{ status: 'READY' | 'UNAVAILABLE'; details: string[] }> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/api/v1/jobs`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      if (response.ok) {
        return { status: 'READY', details: [] };
      }
      return { status: 'UNAVAILABLE', details: [`HTTP ${response.status}`] };
    } catch (err) {
      return {
        status: 'UNAVAILABLE',
        details: [err instanceof Error ? err.message : String(err)],
      };
    }
  }

  async createJob(request: ScraperJobRequest, signal?: AbortSignal): Promise<string> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/v1/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(request),
        signal,
      });
    } catch (err) {
      if (signal?.aborted) throw new ScraperError('Job creation cancelled', 'CANCELLED');
      throw new ScraperError(
        `Failed to reach scraper: ${err instanceof Error ? err.message : String(err)}`,
        'PROVIDER_UNAVAILABLE',
      );
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new ScraperError(
        `Scraper returned HTTP ${response.status}: ${body.slice(0, 200)}`,
        response.status >= 500 ? 'PROVIDER_UNAVAILABLE' : 'SCRAPER_JOB_FAILED',
      );
    }

    const data = (await response.json()) as { id: string };
    return data.id;
  }

  async waitForCompletion(jobId: string, signal?: AbortSignal): Promise<ScraperJobStatus> {
    const env = this.readEnv();
    const pollInterval = env.GOOGLE_MAPS_SCRAPER_POLL_INTERVAL_MS;
    const maxAttempts = env.GOOGLE_MAPS_SCRAPER_MAX_POLL_ATTEMPTS;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (signal?.aborted) throw new ScraperError('Job cancelled', 'CANCELLED');

      const status = await this.getJobStatus(jobId, signal);

      if (status.Status === 'ok') return status;
      if (status.Status === 'failed') {
        throw new ScraperError(`Scraper job ${jobId} failed`, 'SCRAPER_JOB_FAILED');
      }

      await this.sleep(pollInterval, signal);
    }

    throw new ScraperError(
      `Scraper job ${jobId} did not complete within ${maxAttempts} poll attempts`,
      'TIMEOUT',
    );
  }

  async downloadResults(jobId: string, signal?: AbortSignal): Promise<ScraperResultRow[]> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/v1/jobs/${jobId}/download`, {
        method: 'GET',
        signal,
      });
    } catch (err) {
      if (signal?.aborted) throw new ScraperError('Download cancelled', 'CANCELLED');
      throw new ScraperError(
        `Failed to download results: ${err instanceof Error ? err.message : String(err)}`,
        'PROVIDER_UNAVAILABLE',
      );
    }

    if (!response.ok) {
      throw new ScraperError(
        `Scraper returned HTTP ${response.status} on download`,
        'SCRAPER_JOB_FAILED',
      );
    }

    const csvText = await response.text();
    return GoogleMapsScraperClient.parseCsv(csvText);
  }

  async deleteJob(jobId: string): Promise<void> {
    try {
      await this.fetchImpl(`${this.baseUrl}/api/v1/jobs/${jobId}`, { method: 'DELETE' });
    } catch {
      // Cleanup failure is non-fatal
    }
  }

  private async getJobStatus(jobId: string, signal?: AbortSignal): Promise<ScraperJobStatus> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/v1/jobs/${jobId}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal,
      });
    } catch (err) {
      if (signal?.aborted) throw new ScraperError('Status check cancelled', 'CANCELLED');
      throw new ScraperError(
        `Failed to check job status: ${err instanceof Error ? err.message : String(err)}`,
        'PROVIDER_UNAVAILABLE',
      );
    }

    if (!response.ok) {
      throw new ScraperError(
        `Scraper returned HTTP ${response.status} on status check`,
        'PROVIDER_UNAVAILABLE',
      );
    }

    return (await response.json()) as ScraperJobStatus;
  }

  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new ScraperError('Cancelled', 'CANCELLED'));
        return;
      }
      const timer = setTimeout(resolve, ms);
      if (signal) {
        const onAbort = () => {
          clearTimeout(timer);
          reject(new ScraperError('Cancelled', 'CANCELLED'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  static parseCsv(csvText: string): ScraperResultRow[] {
    const lines = splitCsvLines(csvText);
    if (lines.length < 2) return [];

    const headers = parseCsvLine(lines[0]!);
    const rows: ScraperResultRow[] = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]!;
      if (!line.trim()) continue;

      const values = parseCsvLine(line);
      const row: Record<string, string> = {};
      for (let j = 0; j < headers.length; j++) {
        row[headers[j]!] = values[j] ?? '';
      }
      rows.push(row as unknown as ScraperResultRow);
    }

    return rows;
  }
}

function splitCsvLines(text: string): string[] {
  const lines: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      lines.push(current);
      current = '';
    } else {
      current += ch;
    }
  }

  if (current) lines.push(current);
  return lines;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }

  fields.push(current);
  return fields;
}
