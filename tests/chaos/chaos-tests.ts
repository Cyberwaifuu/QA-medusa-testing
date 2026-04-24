import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const BACKEND_URL = 'http://localhost:9000';
const STOREFRONT_URL = 'http://localhost:8000';
const REQUEST_TIMEOUT_MS = 10_000;
const PUBLISHABLE_KEY = 'pk_6f761f01b46e94b499d74ba0f5be134537728da217dc73690ab584d7e43b454c';
const RESULTS_PATH = resolve(process.cwd(), 'reports', 'chaos-results.json');

interface ChaosTestResult {
  scenario: string;
  fault_type: string;
  affected_module: string;
  duration_seconds: number;
  system_behavior: string;
  error_messages: string[];
  recovery_time_ms: number | null;
  availability_during_fault: number;
  data_consistency: boolean;
}

interface RequestProbe {
  label: string;
  method: string;
  url: string;
  status: number | null;
  ok: boolean;
  duration_ms: number;
  error: string | null;
  response_body_snippet: string | null;
}

const results: ChaosTestResult[] = [];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function truncate(value: unknown, max = 300): string {
  if (value === undefined || value === null) return '';
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  return str.length > max ? str.slice(0, max) + '…' : str;
}

async function probe(
  label: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  config: AxiosRequestConfig = {},
  data?: unknown
): Promise<RequestProbe> {
  const start = Date.now();
  const needsKey = url.includes('/store/');
  const finalConfig: AxiosRequestConfig = {
    timeout: REQUEST_TIMEOUT_MS,
    validateStatus: () => true,
    ...config,
    headers: {
      ...(needsKey ? { 'x-publishable-api-key': PUBLISHABLE_KEY } : {}),
      ...config.headers,
    },
  };
  try {
    const res =
      method === 'GET' || method === 'DELETE'
        ? await axios.request({ url, method, ...finalConfig })
        : await axios.request({ url, method, data, ...finalConfig });
    const duration_ms = Date.now() - start;
    return {
      label,
      method,
      url,
      status: res.status,
      ok: res.status >= 200 && res.status < 300,
      duration_ms,
      error: null,
      response_body_snippet: truncate(res.data),
    };
  } catch (err) {
    const duration_ms = Date.now() - start;
    const axiosErr = err as AxiosError;
    return {
      label,
      method,
      url,
      status: axiosErr.response?.status ?? null,
      ok: false,
      duration_ms,
      error: axiosErr.code
        ? `${axiosErr.code}: ${axiosErr.message}`
        : axiosErr.message,
      response_body_snippet: axiosErr.response
        ? truncate(axiosErr.response.data)
        : null,
    };
  }
}

function logHeader(title: string): void {
  console.log('\n' + '='.repeat(72));
  console.log(title);
  console.log('='.repeat(72));
}

function logProbe(p: RequestProbe): void {
  const status = p.status ?? 'NO_RESPONSE';
  const err = p.error ? `  err=${p.error}` : '';
  console.log(
    `  [${p.method}] ${p.url}  →  status=${status}  time=${p.duration_ms}ms${err}`
  );
}

async function scenario1_Baseline(): Promise<void> {
  logHeader('Scenario 1: API Health Check Baseline');
  const t0 = Date.now();
  const probes: RequestProbe[] = [];
  const errors: string[] = [];

  for (let i = 0; i < 5; i++) {
    const r = await probe(
      `baseline-products-${i + 1}`,
      'GET',
      `${BACKEND_URL}/store/products`
    );
    probes.push(r);
    logProbe(r);
    if (!r.ok && r.error) errors.push(r.error);
  }

  for (let i = 0; i < 5; i++) {
    const r = await probe(
      `baseline-carts-${i + 1}`,
      'POST',
      `${BACKEND_URL}/store/carts`,
      { headers: { 'Content-Type': 'application/json' } },
      {}
    );
    probes.push(r);
    logProbe(r);
    if (!r.ok && r.error) errors.push(r.error);
  }

  const successCount = probes.filter((p) => p.ok).length;
  const durationsOk = probes.filter((p) => p.ok).map((p) => p.duration_ms);
  const avgMs = durationsOk.length
    ? Math.round(durationsOk.reduce((a, b) => a + b, 0) / durationsOk.length)
    : 0;
  const maxMs = durationsOk.length ? Math.max(...durationsOk) : 0;
  const availability = (successCount / probes.length) * 100;

  results.push({
    scenario: 'Scenario 1: Baseline Health Check',
    fault_type: 'none (baseline)',
    affected_module: 'Medusa Store API',
    duration_seconds: (Date.now() - t0) / 1000,
    system_behavior: `${successCount}/${probes.length} OK, avg=${avgMs}ms, max=${maxMs}ms`,
    error_messages: errors.slice(0, 10),
    recovery_time_ms: null,
    availability_during_fault: availability,
    data_consistency: true,
  });
}

async function scenario2_EndpointFailures(): Promise<void> {
  logHeader('Scenario 2: API Endpoint Failure Simulation');
  const t0 = Date.now();
  const probes: RequestProbe[] = [];
  const errors: string[] = [];

  const p1 = await probe(
    'nonexistent-endpoint',
    'GET',
    `${BACKEND_URL}/store/nonexistent`
  );
  probes.push(p1);
  logProbe(p1);

  const p2 = await probe(
    'malformed-json',
    'POST',
    `${BACKEND_URL}/store/carts`,
    {
      headers: { 'Content-Type': 'application/json' },
      transformRequest: [(data) => data],
    },
    '{not-valid-json,,'
  );
  probes.push(p2);
  logProbe(p2);

  const p3 = await probe(
    'invalid-cart-id-line-items',
    'POST',
    `${BACKEND_URL}/store/carts/invalid-id/line-items`,
    { headers: { 'Content-Type': 'application/json' } },
    { variant_id: 'some-variant', quantity: 1 }
  );
  probes.push(p3);
  logProbe(p3);

  const badCodes = [500, 502, 503, 504];
  const unhandledCrash = probes.find(
    (p) => p.status !== null && badCodes.includes(p.status)
  );
  const noResponseCount = probes.filter((p) => p.status === null).length;
  const handledGracefully =
    unhandledCrash === undefined && noResponseCount === 0;

  for (const p of probes) {
    if (p.status !== null && badCodes.includes(p.status)) {
      errors.push(`${p.label} returned ${p.status}: ${p.response_body_snippet}`);
    }
    if (p.error) errors.push(`${p.label}: ${p.error}`);
  }

  const successOrExpected4xxCount = probes.filter(
    (p) => p.status !== null && p.status < 500
  ).length;
  const availability = (successOrExpected4xxCount / probes.length) * 100;

  results.push({
    scenario: 'Scenario 2: Endpoint Failure Simulation',
    fault_type: 'invalid endpoint / malformed payload / invalid resource id',
    affected_module: 'Medusa Store API router + validation',
    duration_seconds: (Date.now() - t0) / 1000,
    system_behavior: handledGracefully
      ? `All faults handled with 4xx (no 5xx, no connection drops). p1=${p1.status} p2=${p2.status} p3=${p3.status}`
      : `Unhandled fault detected. p1=${p1.status} p2=${p2.status} p3=${p3.status}`,
    error_messages: errors.slice(0, 10),
    recovery_time_ms: null,
    availability_during_fault: availability,
    data_consistency: handledGracefully,
  });
}

async function scenario3_InvalidDataInjection(): Promise<void> {
  logHeader('Scenario 3: Invalid Data Injection');
  const t0 = Date.now();
  const probes: RequestProbe[] = [];
  const errors: string[] = [];

  const cartResp = await probe(
    'helper-create-cart',
    'POST',
    `${BACKEND_URL}/store/carts`,
    { headers: { 'Content-Type': 'application/json' } },
    {}
  );
  logProbe(cartResp);
  let cartId: string | null = null;
  try {
    const parsed =
      typeof cartResp.response_body_snippet === 'string' &&
      cartResp.response_body_snippet.startsWith('{')
        ? JSON.parse(cartResp.response_body_snippet)
        : null;
    cartId = parsed?.cart?.id ?? parsed?.id ?? null;
  } catch {
    cartId = null;
  }

  const p1 = await probe(
    'auth-empty-email',
    'POST',
    `${BACKEND_URL}/auth/customer/emailpass`,
    { headers: { 'Content-Type': 'application/json' } },
    { email: '', password: 'password123' }
  );
  probes.push(p1);
  logProbe(p1);

  const longEmail = 'a'.repeat(10_000) + '@test.com';
  const p2 = await probe(
    'auth-oversized-email',
    'POST',
    `${BACKEND_URL}/auth/customer/emailpass`,
    { headers: { 'Content-Type': 'application/json' } },
    { email: longEmail, password: 'password123' }
  );
  probes.push(p2);
  logProbe(p2);

  const p3 = await probe(
    'xss-region-id',
    'POST',
    `${BACKEND_URL}/store/carts`,
    { headers: { 'Content-Type': 'application/json' } },
    { region_id: '<script>alert(1)</script>' }
  );
  probes.push(p3);
  logProbe(p3);

  const lineItemsUrl = cartId
    ? `${BACKEND_URL}/store/carts/${cartId}/line-items`
    : `${BACKEND_URL}/store/carts/unknown-cart-id/line-items`;

  const p4 = await probe(
    'negative-quantity',
    'POST',
    lineItemsUrl,
    { headers: { 'Content-Type': 'application/json' } },
    { variant_id: 'some-variant-id', quantity: -999_999 }
  );
  probes.push(p4);
  logProbe(p4);

  const p5 = await probe(
    'zero-quantity',
    'POST',
    lineItemsUrl,
    { headers: { 'Content-Type': 'application/json' } },
    { variant_id: 'some-variant-id', quantity: 0 }
  );
  probes.push(p5);
  logProbe(p5);

  for (const p of probes) {
    if (p.status !== null && p.status >= 500) {
      errors.push(`${p.label} -> ${p.status}: ${p.response_body_snippet}`);
    }
    if (p.error) errors.push(`${p.label} network: ${p.error}`);
    if (
      p.response_body_snippet &&
      p.response_body_snippet.includes('<script>alert(1)</script>')
    ) {
      errors.push(
        `${p.label}: XSS payload reflected verbatim in response — review escaping`
      );
    }
  }

  const clean = probes.filter(
    (p) => p.status !== null && p.status >= 400 && p.status < 500
  ).length;
  const availability = (clean / probes.length) * 100;
  const noServerCrash = probes.every(
    (p) => p.status === null || p.status < 500
  );

  results.push({
    scenario: 'Scenario 3: Invalid Data Injection',
    fault_type: 'malicious / malformed input',
    affected_module: 'Auth + Cart APIs',
    duration_seconds: (Date.now() - t0) / 1000,
    system_behavior: probes
      .map((p) => `${p.label}=${p.status ?? 'ERR'}(${p.duration_ms}ms)`)
      .join(', '),
    error_messages: errors.slice(0, 10),
    recovery_time_ms: null,
    availability_during_fault: availability,
    data_consistency: noServerCrash,
  });
}

async function scenario4_RapidBurst(): Promise<void> {
  logHeader('Scenario 4: Rapid Request Burst (Resource Exhaustion)');
  const t0 = Date.now();
  const BURST = 100;
  const tasks: Promise<RequestProbe>[] = [];
  for (let i = 0; i < BURST; i++) {
    tasks.push(
      probe(`burst-${i + 1}`, 'GET', `${BACKEND_URL}/store/products`)
    );
  }
  const settled = await Promise.all(tasks);

  const ok = settled.filter((p) => p.ok).length;
  const failed = settled.length - ok;
  const statuses = settled.reduce<Record<string, number>>((acc, p) => {
    const key = p.status !== null ? String(p.status) : 'NO_RESPONSE';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const durations = settled.map((p) => p.duration_ms);
  const maxMs = Math.max(...durations);
  const minMs = Math.min(...durations);
  const avgMs = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
  const errorRate = (failed / settled.length) * 100;
  const availability = (ok / settled.length) * 100;

  console.log(
    `  total=${settled.length} ok=${ok} failed=${failed} errorRate=${errorRate.toFixed(
      1
    )}%`
  );
  console.log(`  latency min=${minMs}ms avg=${avgMs}ms max=${maxMs}ms`);
  console.log(`  status distribution: ${JSON.stringify(statuses)}`);

  const recoveryStart = Date.now();
  let recoveryMs: number | null = null;
  for (let i = 0; i < 10; i++) {
    const p = await probe(
      `post-burst-check-${i + 1}`,
      'GET',
      `${BACKEND_URL}/store/products`
    );
    if (p.ok) {
      recoveryMs = Date.now() - recoveryStart;
      console.log(`  service responsive again after ${recoveryMs}ms`);
      break;
    }
    await sleep(500);
  }

  const errors = settled
    .filter((p) => !p.ok)
    .slice(0, 10)
    .map((p) => `${p.label}: status=${p.status ?? 'NO_RESPONSE'} ${p.error ?? ''}`);

  results.push({
    scenario: 'Scenario 4: Rapid Request Burst',
    fault_type: 'resource exhaustion / DDoS simulation (100 concurrent)',
    affected_module: 'Medusa Store API / underlying HTTP + DB pool',
    duration_seconds: (Date.now() - t0) / 1000,
    system_behavior: `ok=${ok}/${settled.length} errorRate=${errorRate.toFixed(
      1
    )}% latency min/avg/max=${minMs}/${avgMs}/${maxMs}ms statuses=${JSON.stringify(
      statuses
    )}`,
    error_messages: errors,
    recovery_time_ms: recoveryMs,
    availability_during_fault: availability,
    data_consistency: failed === 0,
  });
}

async function scenario5_ServiceRecovery(): Promise<void> {
  logHeader('Scenario 5: Service Recovery Test (MTTR)');
  console.log('INSTRUCTIONS:');
  console.log('  1. Medusa must be running on :9000 right now.');
  console.log('  2. After the first OK probe, this test will poll every 2s.');
  console.log(
    '  3. STOP the Medusa backend (Ctrl+C in its terminal) when prompted.'
  );
  console.log('  4. Wait ~10 seconds, then START Medusa again.');
  console.log('  5. The test will detect downtime and measure MTTR.');
  console.log('');

  const t0 = Date.now();
  const errors: string[] = [];

  const initial = await probe(
    'recovery-initial',
    'GET',
    `${BACKEND_URL}/store/products`
  );
  logProbe(initial);
  if (!initial.ok) {
    results.push({
      scenario: 'Scenario 5: Service Recovery Test',
      fault_type: 'manual service stop + restart',
      affected_module: 'Medusa backend process',
      duration_seconds: (Date.now() - t0) / 1000,
      system_behavior:
        'SKIPPED — initial probe failed, service must be up before the test starts',
      error_messages: [initial.error ?? `status=${initial.status}`],
      recovery_time_ms: null,
      availability_during_fault: 0,
      data_consistency: false,
    });
    return;
  }

  console.log('');
  console.log('>>> NOW STOP MEDUSA (Ctrl+C in the backend terminal) <<<');
  console.log('');

  const MAX_DOWNTIME_MS = 5 * 60 * 1000;
  const POLL_MS = 2000;
  let downAt: number | null = null;
  let recoveredAt: number | null = null;
  let checks = 0;
  let successChecks = 1;
  const downStart = Date.now();

  while (Date.now() - downStart < MAX_DOWNTIME_MS) {
    checks++;
    const p = await probe(
      `recovery-check-${checks}`,
      'GET',
      `${BACKEND_URL}/store/products`
    );
    const timeLabel = `${Math.round((Date.now() - downStart) / 1000)}s`;
    if (p.ok) {
      successChecks++;
      if (downAt !== null) {
        recoveredAt = Date.now();
        console.log(
          `  [${timeLabel}] ✅ service recovered (status=${p.status} in ${p.duration_ms}ms)`
        );
        break;
      } else {
        console.log(`  [${timeLabel}] still up (status=${p.status})`);
      }
    } else {
      if (downAt === null) {
        downAt = Date.now();
        console.log(
          `  [${timeLabel}] ⚠️  service DOWN (status=${p.status ?? 'NO_RESPONSE'} err=${p.error}) — now polling for recovery…`
        );
      } else {
        console.log(
          `  [${timeLabel}] still down (status=${p.status ?? 'NO_RESPONSE'})`
        );
      }
      if (p.error) errors.push(`check-${checks}: ${p.error}`);
    }
    await sleep(POLL_MS);
  }

  const mttr =
    downAt !== null && recoveredAt !== null ? recoveredAt - downAt : null;
  const totalWindow = Date.now() - downStart;
  const availability =
    checks > 0 ? (successChecks / (checks + 1)) * 100 : 100;

  let behavior: string;
  if (mttr !== null) {
    behavior = `Service was detected down and recovered. MTTR=${mttr}ms (${(
      mttr / 1000
    ).toFixed(1)}s), checks=${checks}, window=${Math.round(totalWindow / 1000)}s`;
  } else if (downAt === null) {
    behavior = `No downtime observed during the ${Math.round(
      totalWindow / 1000
    )}s window — either the service was never stopped or recovery was faster than one poll interval`;
  } else {
    behavior = `Service went down at ${new Date(
      downAt
    ).toISOString()} and did NOT recover within the ${Math.round(
      totalWindow / 1000
    )}s window`;
  }

  results.push({
    scenario: 'Scenario 5: Service Recovery Test',
    fault_type: 'manual service stop + restart',
    affected_module: 'Medusa backend process',
    duration_seconds: (Date.now() - t0) / 1000,
    system_behavior: behavior,
    error_messages: errors.slice(0, 10),
    recovery_time_ms: mttr,
    availability_during_fault: availability,
    data_consistency: mttr !== null,
  });
}

function printSummary(): void {
  logHeader('CHAOS TEST SUMMARY');
  console.table(
    results.map((r) => ({
      scenario: r.scenario,
      fault_type: r.fault_type,
      duration_s: r.duration_seconds.toFixed(2),
      availability_pct: r.availability_during_fault.toFixed(1),
      mttr_ms: r.recovery_time_ms ?? '—',
      data_consistency: r.data_consistency,
      errors: r.error_messages.length,
    }))
  );
}

function saveResults(): void {
  const dir = dirname(RESULTS_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const payload = {
    generated_at: new Date().toISOString(),
    backend_url: BACKEND_URL,
    storefront_url: STOREFRONT_URL,
    total_scenarios: results.length,
    results,
  };
  writeFileSync(RESULTS_PATH, JSON.stringify(payload, null, 2), 'utf-8');
  console.log(`\nResults written to: ${RESULTS_PATH}`);
}

async function main(): Promise<void> {
  console.log('Starting chaos / fault injection tests');
  console.log(`Backend:    ${BACKEND_URL}`);
  console.log(`Storefront: ${STOREFRONT_URL}`);
  console.log(`Timeout:    ${REQUEST_TIMEOUT_MS}ms per request`);

  const runners: Array<{ name: string; fn: () => Promise<void> }> = [
    { name: 'Scenario 1', fn: scenario1_Baseline },
    { name: 'Scenario 2', fn: scenario2_EndpointFailures },
    { name: 'Scenario 3', fn: scenario3_InvalidDataInjection },
    { name: 'Scenario 4', fn: scenario4_RapidBurst },
    { name: 'Scenario 5', fn: scenario5_ServiceRecovery },
  ];

  for (const r of runners) {
    try {
      await r.fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[${r.name}] unexpected error: ${message}`);
      results.push({
        scenario: r.name,
        fault_type: 'test-harness error',
        affected_module: 'chaos-tests.ts',
        duration_seconds: 0,
        system_behavior: `Runner threw unhandled error: ${message}`,
        error_messages: [message],
        recovery_time_ms: null,
        availability_during_fault: 0,
        data_consistency: false,
      });
    }
  }

  printSummary();
  saveResults();
}

main().catch((err) => {
  console.error('Fatal top-level error:', err);
  try {
    saveResults();
  } catch {}
  process.exit(0);
});
