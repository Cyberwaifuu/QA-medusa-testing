import { describe, test, expect } from 'vitest';
import {
  createPaymentSession,
  transitionPaymentStatus,
  validatePaymentAmount,
  processRefund,
  getPaymentSummary,
  PaymentSession,
} from '../../src/modules/payment-processor';

function session(overrides: Partial<PaymentSession> = {}): PaymentSession {
  return {
    id: 'pay_test',
    provider_id: 'stripe',
    status: 'pending',
    amount: 11875,
    currency_code: 'eur',
    data: {},
    ...overrides,
  };
}

describe('[CRITICAL] PaymentProcessor - createPaymentSession', () => {
  test('creates a pending session with the correct amount and provider', () => {
    const s = createPaymentSession({
      provider_id: 'stripe',
      amount: 11875,
      currency_code: 'eur',
      data: { customer_id: 'cus_123' },
    });
    expect(s.id).toMatch(/^pay_/);
    expect(s.status).toBe('pending');
    expect(s.amount).toBe(11875);
    expect(s.currency_code).toBe('eur');
    expect(s.data).toEqual({ customer_id: 'cus_123' });
  });

  test('defaults data to empty object when not provided', () => {
    const s = createPaymentSession({
      provider_id: 'manual',
      amount: 500,
      currency_code: 'usd',
    });
    expect(s.data).toEqual({});
  });

  test('throws when provider_id is empty', () => {
    expect(() =>
      createPaymentSession({ provider_id: '', amount: 100, currency_code: 'usd' }),
    ).toThrow(/provider_id/);
  });

  test('throws when currency_code is empty', () => {
    expect(() =>
      createPaymentSession({ provider_id: 'stripe', amount: 100, currency_code: '' }),
    ).toThrow(/currency_code/);
  });

  test('throws when amount is 0 or negative', () => {
    expect(() =>
      createPaymentSession({ provider_id: 'stripe', amount: 0, currency_code: 'usd' }),
    ).toThrow(/amount/);
    expect(() =>
      createPaymentSession({ provider_id: 'stripe', amount: -10, currency_code: 'usd' }),
    ).toThrow(/amount/);
  });
});

describe('[CRITICAL] PaymentProcessor - transitionPaymentStatus', () => {
  test('pending → authorized sets authorized_at', () => {
    const s = transitionPaymentStatus(session({ status: 'pending' }), 'authorized');
    expect(s.status).toBe('authorized');
    expect(s.authorized_at).toBeInstanceOf(Date);
  });

  test('authorized → captured sets captured_at', () => {
    const s = transitionPaymentStatus(session({ status: 'authorized' }), 'captured');
    expect(s.status).toBe('captured');
    expect(s.captured_at).toBeInstanceOf(Date);
  });

  test('pending → requires_action → authorized is valid', () => {
    let s = transitionPaymentStatus(session({ status: 'pending' }), 'requires_action');
    expect(s.status).toBe('requires_action');
    s = transitionPaymentStatus(s, 'authorized');
    expect(s.status).toBe('authorized');
  });

  test('throws on pending → captured (must authorize first)', () => {
    expect(() =>
      transitionPaymentStatus(session({ status: 'pending' }), 'captured'),
    ).toThrow(/invalid/i);
  });

  test('throws when transitioning out of a terminal status (refunded)', () => {
    expect(() =>
      transitionPaymentStatus(session({ status: 'refunded' }), 'captured'),
    ).toThrow(/invalid/i);
  });

  test('throws when transitioning out of cancelled', () => {
    expect(() =>
      transitionPaymentStatus(session({ status: 'cancelled' }), 'authorized'),
    ).toThrow(/invalid/i);
  });
});

describe('[CRITICAL] PaymentProcessor - validatePaymentAmount', () => {
  test('returns valid when session amount matches cart total', () => {
    expect(validatePaymentAmount(session({ amount: 11875 }), 11875)).toEqual({ valid: true });
  });

  test('returns invalid with a descriptive error on amount mismatch', () => {
    const res = validatePaymentAmount(session({ amount: 10000 }), 11875);
    expect(res.valid).toBe(false);
    expect(res.error).toMatch(/mismatch/i);
  });

  test('rejects cartTotal <= 0', () => {
    expect(validatePaymentAmount(session(), 0).valid).toBe(false);
    expect(validatePaymentAmount(session(), -50).valid).toBe(false);
  });

  test('rejects empty currency_code on the session', () => {
    const res = validatePaymentAmount(session({ currency_code: '' }), 100);
    expect(res.valid).toBe(false);
    expect(res.error).toMatch(/currency_code/);
  });
});

describe('[CRITICAL] PaymentProcessor - processRefund', () => {
  test('refunds a captured payment successfully', () => {
    const captured = session({ status: 'captured' });
    const refunded = processRefund(captured, 5000);
    expect(refunded.status).toBe('refunded');
  });

  test('throws when refunding a non-captured session', () => {
    expect(() => processRefund(session({ status: 'authorized' }), 100)).toThrow(/captured/i);
    expect(() => processRefund(session({ status: 'pending' }), 100)).toThrow(/captured/i);
  });

  test('throws when refund amount exceeds session amount', () => {
    expect(() =>
      processRefund(session({ status: 'captured', amount: 100 }), 500),
    ).toThrow(/exceeds/i);
  });

  test('throws when refund amount is 0 or negative', () => {
    const captured = session({ status: 'captured' });
    expect(() => processRefund(captured, 0)).toThrow(/refundAmount/);
    expect(() => processRefund(captured, -10)).toThrow(/refundAmount/);
  });
});

describe('[MEDIUM] PaymentProcessor - getPaymentSummary', () => {
  test('aggregates amounts across all sessions and per-status buckets', () => {
    const summary = getPaymentSummary([
      session({ id: 'p1', status: 'pending', amount: 100 }),
      session({ id: 'p2', status: 'authorized', amount: 200 }),
      session({ id: 'p3', status: 'captured', amount: 300 }),
      session({ id: 'p4', status: 'captured', amount: 400 }),
      session({ id: 'p5', status: 'refunded', amount: 50 }),
    ]);
    expect(summary.total).toBe(1050);
    expect(summary.pending).toBe(100);
    expect(summary.authorized).toBe(200);
    expect(summary.captured).toBe(700);
    expect(summary.refunded).toBe(50);
  });

  test('returns all zeros for an empty list', () => {
    expect(getPaymentSummary([])).toEqual({
      total: 0,
      authorized: 0,
      captured: 0,
      refunded: 0,
      pending: 0,
    });
  });
});
