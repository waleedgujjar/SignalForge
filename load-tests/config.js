import { SharedArray } from 'k6/data';

export const BASE_URL = __ENV.API_URL || 'http://localhost:4000';

export const DEFAULT_HEADERS = {
  'Content-Type': 'application/json',
};

export const THRESHOLDS = {
  smoke: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<3000'],
  },
  baseline: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<2000'],
  },
  stress: {
    http_req_failed: ['rate<0.10'],
    http_req_duration: ['p(95)<5000'],
  },
  soak: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<3000'],
  },
};

export const KNOWN_IDS = {
  workspaceId: 'perf-ws-001',
  userId: 'perf-user-001',
  leadIds: Array.from({ length: 20 }, (_, i) => `perf-lead-${String(i + 1).padStart(4, '0')}`),
  campaignIds: ['perf-camp-001', 'perf-camp-002', 'perf-camp-003'],
  mailboxIds: Array.from({ length: 5 }, (_, i) => `perf-mailbox-${String(i + 1).padStart(3, '0')}`),
};

export const TEST_USER = {
  email: 'perftest@signalforge.test',
  password: 'PerfTest123!@#Secure',
};
