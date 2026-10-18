import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';
import { BASE_URL, TEST_USER } from '../config.js';
import { login } from '../helpers/auth.js';

const analyticsLatency = new Trend('pool_stress_analytics_duration', true);
const timeoutErrors = new Counter('pool_stress_timeouts');

export const options = {
  stages: [
    { duration: '15s', target: 5 },
    { duration: '30s', target: 10 },
    { duration: '30s', target: 15 },
    { duration: '30s', target: 20 },
    { duration: '15s', target: 0 },
  ],
  thresholds: {
    pool_stress_analytics_duration: ['p(95)<10000'],
    http_req_failed: ['rate<0.20'],
  },
};

export function setup() {
  const sessionCookie = login();
  if (!sessionCookie) {
    throw new Error('Pool stress setup failed: could not log in');
  }
  return { sessionCookie };
}

export default function (data) {
  // Hammer the analytics overview endpoint exclusively
  // This fires 10+ parallel Prisma queries internally,
  // which should saturate a pool of 10 connections with 20 VUs.
  const res = http.get(`${BASE_URL}/analytics/overview?period=7d`, {
    tags: { name: 'GET /analytics/overview (pool stress)' },
    timeout: '30s',
  });

  analyticsLatency.add(res.timings.duration);

  const ok = check(res, {
    'analytics not timeout': (r) => r.status !== 0,
    'analytics not 5xx': (r) => r.status < 500,
  });

  if (!ok || res.timings.duration > 10000) {
    timeoutErrors.add(1);
  }

  sleep(0.2);
}

export function handleSummary(data) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return {
    [`results/pool-stress-${timestamp}.json`]: JSON.stringify(data, null, 2),
  };
}
