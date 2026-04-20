import axios, { AxiosInstance } from 'axios';
import { afterEach, beforeEach } from 'vitest';

export const baseURL = process.env.MEDUSA_BASE_URL ?? 'http://localhost:9000';

export const publishableApiKey =
  process.env.MEDUSA_PUBLISHABLE_KEY ??
  'pk_6f761f01b46e94b499d74ba0f5be134537728da217dc73690ab584d7e43b454c';

export function createApiClient(extraHeaders: Record<string, string> = {}): AxiosInstance {
  return axios.create({
    baseURL,
    timeout: 15_000,
    validateStatus: () => true,
    headers: {
      'Content-Type': 'application/json',
      'x-publishable-api-key': publishableApiKey,
      ...extraHeaders,
    },
  });
}

export function logTestResult(name: string, passed: boolean, durationMs: number): void {
  const status = passed ? 'PASS' : 'FAIL';
  console.log(`[${status}] ${name} — ${durationMs.toFixed(2)}ms`);
}

export function registerTestLogging(): void {
  let startedAt = 0;

  beforeEach(() => {
    startedAt = performance.now();
  });

  afterEach((ctx) => {
    const duration = performance.now() - startedAt;
    const passed = ctx.task.result?.state === 'pass';
    logTestResult(ctx.task.name, passed, duration);
  });
}
