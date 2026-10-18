import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { BASE_URL, DEFAULT_HEADERS, TEST_USER, KNOWN_IDS } from '../config.js';
import { login } from '../helpers/auth.js';
import { generateSearchTerms } from '../helpers/data-generators.js';

const p95Trend = new Trend('all_requests_duration', true);

export const options = {
  stages: [
    { duration: '30s', target: 1 },
    { duration: '60s', target: 10 },
    { duration: '60s', target: 25 },
    { duration: '60s', target: 50 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.10'],
    http_req_duration: ['p(95)<5000'],
    all_requests_duration: ['p(95)<5000', 'p(99)<10000'],
  },
};

export function setup() {
  const sessionCookie = login();
  if (!sessionCookie) {
    throw new Error('Stress test setup failed: could not log in');
  }
  return { sessionCookie };
}

export default function (data) {
  // Mix of representative endpoints
  const endpoints = [
    () => {
      const r = http.get(`${BASE_URL}/leads?page=1&limit=20`, { tags: { name: 'GET /leads' } });
      p95Trend.add(r.timings.duration);
      check(r, { 'leads 200': (r) => r.status === 200 });
    },
    () => {
      const terms = generateSearchTerms();
      const r = http.get(`${BASE_URL}/leads?search=${encodeURIComponent(terms.short)}&page=1&limit=20`, {
        tags: { name: 'GET /leads?search' },
      });
      p95Trend.add(r.timings.duration);
      check(r, { 'search 200': (r) => r.status === 200 });
    },
    () => {
      const r = http.get(`${BASE_URL}/campaigns`, { tags: { name: 'GET /campaigns' } });
      p95Trend.add(r.timings.duration);
      check(r, { 'campaigns 200': (r) => r.status === 200 });
    },
    () => {
      const id = KNOWN_IDS.campaignIds[Math.floor(Math.random() * KNOWN_IDS.campaignIds.length)];
      const r = http.get(`${BASE_URL}/campaigns/${id}`, { tags: { name: 'GET /campaigns/:id' } });
      p95Trend.add(r.timings.duration);
      check(r, { 'campaign detail ok': (r) => r.status === 200 || r.status === 404 });
    },
    () => {
      const r = http.get(`${BASE_URL}/analytics/overview?period=7d`, {
        tags: { name: 'GET /analytics/overview' },
      });
      p95Trend.add(r.timings.duration);
      check(r, { 'analytics ok': (r) => r.status === 200 || r.status === 404 });
    },
  ];

  const fn = endpoints[Math.floor(Math.random() * endpoints.length)];
  fn();

  sleep(0.5 + Math.random() * 1.0);
}

export function handleSummary(data) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return {
    [`results/stress-${timestamp}.json`]: JSON.stringify(data, null, 2),
  };
}
