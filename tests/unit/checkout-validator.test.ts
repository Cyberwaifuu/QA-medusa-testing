import { describe, test, expect } from 'vitest';
import {
  validateShippingAddress,
  validateCheckoutReadiness,
  validateEmail,
  getCheckoutStep,
  ShippingAddress,
  CheckoutContext,
} from '../../src/modules/checkout-validator';
import { Cart, LineItem } from '../../src/modules/cart-service';
import { PaymentSession } from '../../src/modules/payment-processor';

const goodAddress: ShippingAddress = {
  first_name: 'Ada',
  last_name: 'Lovelace',
  address_1: '221B Baker St',
  city: 'London',
  country_code: 'GB',
  postal_code: 'NW1 6XE',
  phone: '+44 20 7946 0958',
};

const tshirt: LineItem = {
  id: 'li_tshirt',
  title: 'Medusa T-Shirt',
  variant_id: 'var_medusa_ts_blk_m',
  unit_price: 2000,
  quantity: 1,
  tax_lines: [],
  adjustments: [],
};

function makeCart(items: LineItem[] = [tshirt]): Cart {
  return {
    id: 'cart_01',
    currency_code: 'eur',
    region_id: 'reg_eu',
    items,
    shipping_methods: [],
  };
}

function makeSession(overrides: Partial<PaymentSession> = {}): PaymentSession {
  return {
    id: 'pay_01',
    provider_id: 'stripe',
    status: 'authorized',
    amount: 2000,
    currency_code: 'eur',
    data: {},
    ...overrides,
  };
}

function makeContext(overrides: Partial<CheckoutContext> = {}): CheckoutContext {
  return {
    cart: makeCart(),
    shipping_address: goodAddress,
    billing_address: goodAddress,
    payment_session: makeSession(),
    has_shipping_method: true,
    inventory_checks: [{ variant_id: tshirt.variant_id, available: true }],
    ...overrides,
  };
}

describe('[HIGH] CheckoutValidator - validateShippingAddress', () => {
  test('accepts a fully-populated address', () => {
    const res = validateShippingAddress(goodAddress);
    expect(res.valid).toBe(true);
    expect(res.errors).toEqual([]);
  });

  test('rejects missing first_name, last_name, address_1, city', () => {
    const res = validateShippingAddress({
      first_name: '',
      last_name: '',
      address_1: '',
      city: '',
      country_code: 'US',
    });
    expect(res.valid).toBe(false);
    expect(res.errors).toContain('first_name is required');
    expect(res.errors).toContain('last_name is required');
    expect(res.errors).toContain('address_1 is required');
    expect(res.errors).toContain('city is required');
  });

  test('rejects whitespace-only required fields', () => {
    const res = validateShippingAddress({ ...goodAddress, first_name: '   ' });
    expect(res.valid).toBe(false);
    expect(res.errors).toContain('first_name is required');
  });

  test('rejects lowercase country_code (must be uppercase)', () => {
    const res = validateShippingAddress({ ...goodAddress, country_code: 'gb' });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('country_code'))).toBe(true);
  });

  test('rejects country_code with wrong length', () => {
    const res = validateShippingAddress({ ...goodAddress, country_code: 'USA' });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('country_code'))).toBe(true);
  });

  test('accepts optional postal_code / phone being absent', () => {
    const res = validateShippingAddress({
      first_name: 'Ada',
      last_name: 'Lovelace',
      address_1: '221B Baker St',
      city: 'London',
      country_code: 'GB',
    });
    expect(res.valid).toBe(true);
  });
});

describe('[CRITICAL] CheckoutValidator - validateCheckoutReadiness', () => {
  test('returns ready=true when all requirements are satisfied', () => {
    const res = validateCheckoutReadiness(makeContext());
    expect(res.ready).toBe(true);
    expect(res.errors).toEqual([]);
  });

  test('warns but does not error when billing_address is absent', () => {
    const res = validateCheckoutReadiness(makeContext({ billing_address: undefined }));
    expect(res.ready).toBe(true);
    expect(res.warnings.length).toBeGreaterThan(0);
  });

  test('fails when shipping_address is missing', () => {
    const res = validateCheckoutReadiness(makeContext({ shipping_address: undefined }));
    expect(res.ready).toBe(false);
    expect(res.errors).toContain('Shipping address is required');
  });

  test('fails when payment session is missing or not authorized', () => {
    expect(validateCheckoutReadiness(makeContext({ payment_session: undefined })).ready).toBe(
      false,
    );
    const pendingSession = makeSession({ status: 'pending' });
    const res = validateCheckoutReadiness(makeContext({ payment_session: pendingSession }));
    expect(res.ready).toBe(false);
    expect(res.errors.some((e) => e.includes('authorized'))).toBe(true);
  });

  test('fails when shipping method is not selected', () => {
    const res = validateCheckoutReadiness(makeContext({ has_shipping_method: false }));
    expect(res.ready).toBe(false);
    expect(res.errors).toContain('Shipping method must be selected');
  });

  test('fails when any inventory check is unavailable', () => {
    const res = validateCheckoutReadiness(
      makeContext({
        inventory_checks: [
          { variant_id: tshirt.variant_id, available: false },
          { variant_id: 'var_medusa_hd_wht_l', available: true },
        ],
      }),
    );
    expect(res.ready).toBe(false);
    expect(res.errors.some((e) => e.includes(tshirt.variant_id))).toBe(true);
  });

  test('fails when the cart has no items', () => {
    const res = validateCheckoutReadiness(makeContext({ cart: makeCart([]) }));
    expect(res.ready).toBe(false);
    expect(res.errors).toContain('Cart must have at least 1 item');
  });
});

describe('[MEDIUM] CheckoutValidator - validateEmail', () => {
  test('accepts standard and plus-alias emails', () => {
    expect(validateEmail('customer@example.com')).toBe(true);
    expect(validateEmail('qa+cart@shop.example.io')).toBe(true);
  });

  test('rejects missing @ or TLD', () => {
    expect(validateEmail('customer.example.com')).toBe(false);
    expect(validateEmail('customer@example')).toBe(false);
  });

  test('rejects empty string', () => {
    expect(validateEmail('')).toBe(false);
  });
});

describe('[MEDIUM] CheckoutValidator - getCheckoutStep', () => {
  test("returns 'address' when shipping_address is not set", () => {
    const ctx = makeContext({ shipping_address: undefined });
    expect(getCheckoutStep(ctx)).toBe('address');
  });

  test("returns 'shipping' when address is set but no shipping method chosen", () => {
    const ctx = makeContext({ has_shipping_method: false });
    expect(getCheckoutStep(ctx)).toBe('shipping');
  });

  test("returns 'payment' when shipping is chosen but no payment session", () => {
    const ctx = makeContext({ payment_session: undefined });
    expect(getCheckoutStep(ctx)).toBe('payment');
  });

  test("returns 'review' when all data is complete", () => {
    expect(getCheckoutStep(makeContext())).toBe('review');
  });
});
