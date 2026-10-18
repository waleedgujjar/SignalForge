import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { BASE_URL, DEFAULT_HEADERS, TEST_USER, THRESHOLDS, KNOWN_IDS } from '../config.js';
import { login } from '../helpers/auth.js';
import { generateLead, generateSearchTerms } from '../helpers/data-generators.js';

const leadLatency = new Trend('lead_list_duration', true);
const searchLatency = new Trend('lead_search_duration', true);
const campaignDetailLatency = new Trend('campaign_detail_duration', true);
const analyticsLatency = new Trend('analytics_overview_duration', true);
const exportLatency = new Trend('lead_export_duration', true);
const errorCount = new Counter('business_errors');

export const options = {
  vus: 5,
  duration: '60s',
  thresholds: {
    ...THRESHOLDS.baseline,
    lead_list_duration: ['p(95)<1000'],
    lead_search_duration: ['p(95)<2000'],
    campaign_detail_duration: ['p(95)<2000'],
    analytics_overview_duration: ['p(95)<3000'],
  },
};

export function setup() {
  const sessionCookie = login();
  if (!sessionCookie) {
    throw new Error('Baseline setup failed: could not log in');
  }
  return { sessionCookie };
}

export default function (data) {
  // Leads CRUD (80% read, 20% write)
  group('leads', () => {
    if (Math.random() < 0.8) {
      const page = Math.floor(Math.random() * 10) + 1;
      const res = http.get(`${BASE_URL}/leads?page=${page}&limit=20`, {
        tags: { name: 'GET /leads' },
      });
      leadLatency.add(res.timings.duration);
      check(res, { 'leads list 200': (r) => r.status === 200 });
    } else {
      const lead = generateLead(__VU * 1000 + __ITER);
      const res = http.post(`${BASE_URL}/leads`, JSON.stringify(lead), {
        headers: DEFAULT_HEADERS,
        tags: { name: 'POST /leads' },
      });
      check(res, { 'lead create 201': (r) => r.status === 201 });
    }
  });

  sleep(0.3);

  // Lead search (ILIKE-heavy)
  group('lead_search', () => {
    const terms = generateSearchTerms();
    const termKey = Math.random() < 0.5 ? 'short' : 'long';
    const term = terms[termKey];
    const res = http.get(`${BASE_URL}/leads?search=${encodeURIComponent(term)}&page=1&limit=20`, {
      tags: { name: `GET /leads?search (${termKey})` },
    });
    searchLatency.add(res.timings.duration);
    check(res, { 'search 200': (r) => r.status === 200 });
  });

  sleep(0.3);

  // Campaign list + detail
  group('campaigns', () => {
    const listRes = http.get(`${BASE_URL}/campaigns`, {
      tags: { name: 'GET /campaigns' },
    });
    check(listRes, { 'campaigns list 200': (r) => r.status === 200 });

    const campaignId = KNOWN_IDS.campaignIds[Math.floor(Math.random() * KNOWN_IDS.campaignIds.length)];
    const detailRes = http.get(`${BASE_URL}/campaigns/${campaignId}`, {
      tags: { name: 'GET /campaigns/:id' },
    });
    campaignDetailLatency.add(detailRes.timings.duration);
    check(detailRes, {
      'campaign detail 200 or 404': (r) => r.status === 200 || r.status === 404,
    });
  });

  sleep(0.3);

  // Analytics
  group('analytics', () => {
    const overview = http.get(`${BASE_URL}/analytics/overview?period=7d`, {
      tags: { name: 'GET /analytics/overview' },
    });
    analyticsLatency.add(overview.timings.duration);
    check(overview, {
      'analytics overview 200 or 404': (r) => r.status === 200 || r.status === 404,
    });

    const timeline = http.get(`${BASE_URL}/analytics/timeline?period=30d`, {
      tags: { name: 'GET /analytics/timeline' },
    });
    check(timeline, {
      'analytics timeline 200 or 404': (r) => r.status === 200 || r.status === 404,
    });

    const sources = http.get(`${BASE_URL}/analytics/sources`, {
      tags: { name: 'GET /analytics/sources' },
    });
    check(sources, {
      'analytics sources 200 or 404': (r) => r.status === 200 || r.status === 404,
    });
  });

  sleep(0.3);

  // Lead export (every ~5th iteration to avoid overload)
  if (__ITER % 5 === 0) {
    group('export', () => {
      const res = http.get(`${BASE_URL}/leads/export`, {
        tags: { name: 'GET /leads/export' },
      });
      exportLatency.add(res.timings.duration);
      check(res, {
        'export 200 or 404': (r) => r.status === 200 || r.status === 404,
      });
    });
  }

  sleep(0.5);
}

export function handleSummary(data) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return {
    [`results/baseline-${timestamp}.json`]: JSON.stringify(data, null, 2),
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
  };
}

function textSummary(data, opts) {
  // k6 provides a built-in text summary; this is a fallback
  return JSON.stringify(
    {
      metrics: Object.fromEntries(
        Object.entries(data.metrics || {}).map(([k, v]) => [
          k,
          v.values ? { avg: v.values.avg, p95: v.values['p(95)'], max: v.values.max } : v,
        ]),
      ),
    },
    null,
    2,
  );
}
