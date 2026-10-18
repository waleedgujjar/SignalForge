import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, DEFAULT_HEADERS, TEST_USER, THRESHOLDS } from '../config.js';
import { login } from '../helpers/auth.js';

export const options = {
  vus: 1,
  iterations: 10,
  thresholds: THRESHOLDS.smoke,
};

export function setup() {
  const sessionCookie = login();
  if (!sessionCookie) {
    throw new Error('Smoke test setup failed: could not log in');
  }
  return { sessionCookie };
}

export default function (data) {
  // 1. Health check (unauthenticated)
  const health = http.get(`${BASE_URL}/health`, {
    tags: { name: 'GET /health' },
  });
  check(health, {
    'health 200': (r) => r.status === 200,
  });

  // 2. Login
  const loginRes = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ email: TEST_USER.email, password: TEST_USER.password }),
    { headers: DEFAULT_HEADERS, tags: { name: 'POST /auth/login' } },
  );
  check(loginRes, {
    'login 200': (r) => r.status === 200,
  });

  sleep(0.5);

  // 3. List leads (authenticated via cookie jar from login)
  const leads = http.get(`${BASE_URL}/leads?page=1&limit=20`, {
    tags: { name: 'GET /leads' },
  });
  check(leads, {
    'leads 200': (r) => r.status === 200,
  });

  // 4. List campaigns
  const campaigns = http.get(`${BASE_URL}/campaigns`, {
    tags: { name: 'GET /campaigns' },
  });
  check(campaigns, {
    'campaigns 200': (r) => r.status === 200,
  });

  // 5. Analytics overview
  const analytics = http.get(`${BASE_URL}/analytics/overview?period=7d`, {
    tags: { name: 'GET /analytics/overview' },
  });
  check(analytics, {
    'analytics 200 or 404': (r) => r.status === 200 || r.status === 404,
  });

  sleep(1);
}
