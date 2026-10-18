import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { BASE_URL, TEST_USER } from '../config.js';
import { login } from '../helpers/auth.js';

const shortTermLatency = new Trend('search_short_term_duration', true);
const mediumTermLatency = new Trend('search_medium_term_duration', true);
const longTermLatency = new Trend('search_long_term_duration', true);

export const options = {
  vus: 10,
  duration: '60s',
  thresholds: {
    http_req_failed: ['rate<0.05'],
    search_short_term_duration: ['p(95)<5000'],
    search_medium_term_duration: ['p(95)<5000'],
    search_long_term_duration: ['p(95)<5000'],
  },
};

const SHORT_TERMS = ['ali', 'bob', 'ini', 'ace', 'glo', 'sta'];
const MEDIUM_TERMS = ['alice', 'carol', 'globe', 'stark', 'cyber'];
const LONG_TERMS = ['acme corp', 'globex inc', 'wayne enterprises', 'stark industries'];

export function setup() {
  const sessionCookie = login();
  if (!sessionCookie) {
    throw new Error('Search stress setup failed: could not log in');
  }
  return { sessionCookie };
}

export default function (data) {
  // Short term (2-3 chars) — broadest ILIKE scan
  const shortTerm = SHORT_TERMS[Math.floor(Math.random() * SHORT_TERMS.length)];
  const shortRes = http.get(
    `${BASE_URL}/leads?search=${encodeURIComponent(shortTerm)}&page=1&limit=20`,
    { tags: { name: 'search_short' } },
  );
  shortTermLatency.add(shortRes.timings.duration);
  check(shortRes, { 'short search 200': (r) => r.status === 200 });

  sleep(0.3);

  // Medium term (5 chars)
  const mediumTerm = MEDIUM_TERMS[Math.floor(Math.random() * MEDIUM_TERMS.length)];
  const medRes = http.get(
    `${BASE_URL}/leads?search=${encodeURIComponent(mediumTerm)}&page=1&limit=20`,
    { tags: { name: 'search_medium' } },
  );
  mediumTermLatency.add(medRes.timings.duration);
  check(medRes, { 'medium search 200': (r) => r.status === 200 });

  sleep(0.3);

  // Long term (full company name)
  const longTerm = LONG_TERMS[Math.floor(Math.random() * LONG_TERMS.length)];
  const longRes = http.get(
    `${BASE_URL}/leads?search=${encodeURIComponent(longTerm)}&page=1&limit=20`,
    { tags: { name: 'search_long' } },
  );
  longTermLatency.add(longRes.timings.duration);
  check(longRes, { 'long search 200': (r) => r.status === 200 });

  sleep(0.5);
}

export function handleSummary(data) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return {
    [`results/search-stress-${timestamp}.json`]: JSON.stringify(data, null, 2),
  };
}
