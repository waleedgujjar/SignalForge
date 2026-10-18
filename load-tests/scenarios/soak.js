import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';
import { BASE_URL, DEFAULT_HEADERS, TEST_USER, KNOWN_IDS } from '../config.js';
import { login } from '../helpers/auth.js';
import { generateSearchTerms } from '../helpers/data-generators.js';

const requestDuration = new Trend('soak_request_duration', true);
const errorCounter = new Counter('soak_errors');

export const options = {
  vus: 10,
  duration: '10m',
  thresholds: {
    http_req_failed: ['rate<0.05'],
    soak_request_duration: ['p(95)<3000', 'p(99)<5000'],
    soak_errors: ['count<50'],
  },
};

export function setup() {
  const sessionCookie = login();
  if (!sessionCookie) {
    throw new Error('Soak test setup failed: could not log in');
  }
  return { sessionCookie };
}

export default function (data) {
  const actions = [
    // Lead listing
    () => http.get(`${BASE_URL}/leads?page=${Math.floor(Math.random() * 10) + 1}&limit=20`, {
      tags: { name: 'GET /leads' },
    }),
    // Lead search
    () => {
      const terms = generateSearchTerms();
      return http.get(`${BASE_URL}/leads?search=${encodeURIComponent(terms.medium)}&page=1&limit=20`, {
        tags: { name: 'GET /leads?search' },
      });
    },
    // Campaigns list
    () => http.get(`${BASE_URL}/campaigns`, { tags: { name: 'GET /campaigns' } }),
    // Campaign detail
    () => {
      const id = KNOWN_IDS.campaignIds[Math.floor(Math.random() * KNOWN_IDS.campaignIds.length)];
      return http.get(`${BASE_URL}/campaigns/${id}`, { tags: { name: 'GET /campaigns/:id' } });
    },
    // Analytics overview
    () => http.get(`${BASE_URL}/analytics/overview?period=7d`, { tags: { name: 'GET /analytics/overview' } }),
    // Analytics timeline
    () => http.get(`${BASE_URL}/analytics/timeline?period=30d`, { tags: { name: 'GET /analytics/timeline' } }),
  ];

  const action = actions[Math.floor(Math.random() * actions.length)];
  const res = action();

  requestDuration.add(res.timings.duration);

  const ok = check(res, {
    'status ok': (r) => r.status >= 200 && r.status < 500,
  });

  if (!ok) {
    errorCounter.add(1);
  }

  sleep(1 + Math.random() * 2);
}

export function handleSummary(data) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return {
    [`results/soak-${timestamp}.json`]: JSON.stringify(data, null, 2),
  };
}
