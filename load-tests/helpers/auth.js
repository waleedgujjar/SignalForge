import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL, DEFAULT_HEADERS, TEST_USER } from '../config.js';

export function login(email, password) {
  const res = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ email: email || TEST_USER.email, password: password || TEST_USER.password }),
    { headers: DEFAULT_HEADERS, tags: { name: 'auth_login' } },
  );

  const success = check(res, {
    'login status 200': (r) => r.status === 200,
    'login has session cookie': (r) => r.cookies['sf_session'] !== undefined,
  });

  if (!success) {
    console.error(`Login failed: ${res.status} ${res.body}`);
    return null;
  }

  return res.cookies['sf_session'][0].value;
}

export function authenticatedHeaders(jar) {
  return {
    ...DEFAULT_HEADERS,
  };
}

export function authGet(url, params = {}) {
  return http.get(`${BASE_URL}${url}`, {
    ...params,
    tags: { name: params.name || url, ...params.tags },
  });
}

export function authPost(url, body, params = {}) {
  return http.post(`${BASE_URL}${url}`, JSON.stringify(body), {
    headers: DEFAULT_HEADERS,
    ...params,
    tags: { name: params.name || url, ...params.tags },
  });
}

export function authPatch(url, body, params = {}) {
  return http.patch(`${BASE_URL}${url}`, JSON.stringify(body), {
    headers: DEFAULT_HEADERS,
    ...params,
    tags: { name: params.name || url, ...params.tags },
  });
}
