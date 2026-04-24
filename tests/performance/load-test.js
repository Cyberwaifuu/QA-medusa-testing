import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.1.0/index.js';

const BASE_URL = 'http://localhost:9000';
const PUBLISHABLE_KEY = 'pk_6f761f01b46e94b499d74ba0f5be134537728da217dc73690ab584d7e43b454c';

const storeHeaders = {
  'Content-Type': 'application/json',
  'x-publishable-api-key': PUBLISHABLE_KEY,
};

export function setup() {
  const res = http.get(`${BASE_URL}/store/regions`, {
    headers: { 'x-publishable-api-key': PUBLISHABLE_KEY },
  });
  let regionId = '';
  if (res.status === 200) {
    const regions = res.json('regions');
    if (regions && regions.length > 0) {
      regionId = regions[0].id;
    }
  }
  console.log(`Setup: regionId = ${regionId}, status = ${res.status}`);
  return { regionId };
}

export const options = {
  scenarios: {
    normal_load: {
      executor: 'constant-vus',
      vus: 5,
      duration: '30s',
      exec: 'normalScenario',
    },
    peak_load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 20 },
        { duration: '20s', target: 20 },
        { duration: '10s', target: 0 },
      ],
      exec: 'peakScenario',
      startTime: '35s',
    },
    spike_load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '5s', target: 50 },
        { duration: '10s', target: 50 },
        { duration: '5s', target: 0 },
      ],
      exec: 'spikeScenario',
      startTime: '70s',
    },
    endurance: {
      executor: 'constant-vus',
      vus: 3,
      duration: '60s',
      exec: 'enduranceScenario',
      startTime: '90s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<2000'],
    http_req_failed: ['rate<0.1'],
    http_reqs: ['rate>5'],
  },
};

function runCoreFlow(data) {
  group('Products API [MEDIUM risk]', () => {
    const res = http.get(`${BASE_URL}/store/products`, {
      headers: { 'x-publishable-api-key': PUBLISHABLE_KEY },
    });
    check(res, { 'products status 200': (r) => r.status === 200 });
  });

  group('Cart API [HIGH risk]', () => {
    const body = data.regionId
      ? JSON.stringify({ region_id: data.regionId })
      : JSON.stringify({});
    const cartRes = http.post(`${BASE_URL}/store/carts`, body, {
      headers: storeHeaders,
    });
    check(cartRes, { 'cart created': (r) => r.status === 200 });

    if (cartRes.status === 200) {
      const cartId = cartRes.json('cart.id');
      const getRes = http.get(`${BASE_URL}/store/carts/${cartId}`, {
        headers: { 'x-publishable-api-key': PUBLISHABLE_KEY },
      });
      check(getRes, { 'cart retrieved': (r) => r.status === 200 });
    }
  });

  group('Auth API [HIGH risk]', () => {
    const authRes = http.post(
      `${BASE_URL}/auth/customer/emailpass`,
      JSON.stringify({ email: 'loadtest@example.com', password: 'wrong' }),
      { headers: { 'Content-Type': 'application/json' } },
    );
    check(authRes, { 'auth returns 401': (r) => r.status === 401 });
  });
}

export function normalScenario(data) {
  runCoreFlow(data);
  sleep(1);
}

export function peakScenario(data) {
  runCoreFlow(data);
  sleep(0.5);
}

export function spikeScenario() {
  group('Products API [MEDIUM risk]', () => {
    const res = http.get(`${BASE_URL}/store/products`, {
      headers: { 'x-publishable-api-key': PUBLISHABLE_KEY },
    });
    check(res, { 'products status 200': (r) => r.status === 200 });
  });
}

export function enduranceScenario(data) {
  runCoreFlow(data);
  sleep(2);
}

export function handleSummary(data) {
  return {
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
    'reports/k6-summary.json': JSON.stringify(data, null, 2),
  };
}
