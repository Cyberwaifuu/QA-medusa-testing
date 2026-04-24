export type PaymentStatus =
  | 'pending'
  | 'authorized'
  | 'captured'
  | 'refunded'
  | 'cancelled'
  | 'requires_action';

export interface PaymentSession {
  id: string;
  provider_id: string;
  status: PaymentStatus;
  amount: number;
  currency_code: string;
  data: Record<string, unknown>;
  authorized_at?: Date;
  captured_at?: Date;
}

export const VALID_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  pending: ['authorized', 'cancelled', 'requires_action'],
  requires_action: ['authorized', 'cancelled'],
  authorized: ['captured', 'cancelled', 'refunded'],
  captured: ['refunded'],
  refunded: [],
  cancelled: [],
};

function generateId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2, 12);
  return `${prefix}_${rand}`;
}

export function createPaymentSession(params: {
  provider_id: string;
  amount: number;
  currency_code: string;
  data?: Record<string, unknown>;
}): PaymentSession {
  if (!params.provider_id) {
    throw new Error('provider_id must not be empty');
  }
  if (!params.currency_code) {
    throw new Error('currency_code must not be empty');
  }
  if (params.amount <= 0) {
    throw new Error('amount must be > 0');
  }
  return {
    id: generateId('pay'),
    provider_id: params.provider_id,
    status: 'pending',
    amount: params.amount,
    currency_code: params.currency_code,
    data: params.data ?? {},
  };
}

export function transitionPaymentStatus(
  session: PaymentSession,
  newStatus: PaymentStatus,
): PaymentSession {
  const allowed = VALID_TRANSITIONS[session.status];
  if (!allowed.includes(newStatus)) {
    throw new Error(`Invalid payment status transition: ${session.status} -> ${newStatus}`);
  }
  const next: PaymentSession = { ...session, status: newStatus };
  if (newStatus === 'authorized') {
    next.authorized_at = new Date();
  }
  if (newStatus === 'captured') {
    next.captured_at = new Date();
  }
  return next;
}

export function validatePaymentAmount(
  session: PaymentSession,
  cartTotal: number,
): { valid: boolean; error?: string } {
  if (cartTotal <= 0) {
    return { valid: false, error: 'cartTotal must be > 0' };
  }
  if (!session.currency_code) {
    return { valid: false, error: 'currency_code must not be empty' };
  }
  if (session.amount !== cartTotal) {
    return {
      valid: false,
      error: `Amount mismatch: session=${session.amount}, cart=${cartTotal}`,
    };
  }
  return { valid: true };
}

export function processRefund(session: PaymentSession, refundAmount: number): PaymentSession {
  if (session.status !== 'captured') {
    throw new Error('Only captured payments can be refunded');
  }
  if (refundAmount <= 0) {
    throw new Error('refundAmount must be > 0');
  }
  if (refundAmount > session.amount) {
    throw new Error('refundAmount exceeds session amount');
  }
  return transitionPaymentStatus(session, 'refunded');
}

export function getPaymentSummary(sessions: PaymentSession[]): {
  total: number;
  authorized: number;
  captured: number;
  refunded: number;
  pending: number;
} {
  const summary = { total: 0, authorized: 0, captured: 0, refunded: 0, pending: 0 };
  for (const s of sessions) {
    summary.total += s.amount;
    if (s.status === 'authorized') summary.authorized += s.amount;
    else if (s.status === 'captured') summary.captured += s.amount;
    else if (s.status === 'refunded') summary.refunded += s.amount;
    else if (s.status === 'pending') summary.pending += s.amount;
  }
  return summary;
}
