import { describe, test, expect } from 'vitest';
import {
  getLineItemTotals,
  getShippingMethodTotals,
  calculateCartTotals,
  roundToMinorUnit,
  validateCart,
  addLineItem,
  removeLineItem,
  CURRENCIES,
  Cart,
  LineItem,
  ShippingMethod,
} from '../../src/modules/cart-service';

const tshirt: LineItem = {
  id: 'li_tshirt',
  title: 'Medusa T-Shirt',
  variant_id: 'var_medusa_ts_blk_m',
  unit_price: 2000,
  quantity: 2,
  tax_lines: [],
  adjustments: [],
};

const hoodie: LineItem = {
  id: 'li_hoodie',
  title: 'Medusa Hoodie',
  variant_id: 'var_medusa_hd_wht_l',
  unit_price: 4500,
  quantity: 1,
  tax_lines: [],
  adjustments: [],
};

const stickers: LineItem = {
  id: 'li_stickers',
  title: 'Medusa Sticker Pack',
  variant_id: 'var_medusa_stk',
  unit_price: 500,
  quantity: 3,
  tax_lines: [],
  adjustments: [],
};

function makeCart(overrides: Partial<Cart> = {}): Cart {
  return {
    id: 'cart_01',
    currency_code: 'eur',
    region_id: 'reg_eu',
    items: [tshirt, hoodie],
    shipping_methods: [],
    ...overrides,
  };
}

describe('[CRITICAL] CartService - getLineItemTotals', () => {
  test('computes subtotal and total for a plain item without discounts or taxes', () => {
    const totals = getLineItemTotals(tshirt);
    expect(totals.subtotal).toBe(4000);
    expect(totals.discount_total).toBe(0);
    expect(totals.tax_total).toBe(0);
    expect(totals.total).toBe(4000);
  });

  test('applies a single adjustment (WELCOME10 → 400 off a 4000 subtotal)', () => {
    const item: LineItem = { ...tshirt, adjustments: [{ code: 'WELCOME10', amount: 400 }] };
    const t = getLineItemTotals(item);
    expect(t.subtotal).toBe(4000);
    expect(t.discount_total).toBe(400);
    expect(t.total).toBe(3600);
  });

  test('applies a 25% Danish VAT on top of a taxable base', () => {
    const item: LineItem = { ...hoodie, tax_lines: [{ code: 'DK25', rate: 25 }] };
    const t = getLineItemTotals(item);
    expect(t.subtotal).toBe(4500);
    expect(t.tax_total).toBeCloseTo(1125, 5);
    expect(t.total).toBeCloseTo(5625, 5);
  });

  test('applies discount then tax — tax computed on subtotal - discount', () => {
    const item: LineItem = {
      ...hoodie,
      adjustments: [{ code: 'WELCOME10', amount: 500 }],
      tax_lines: [{ code: 'DK25', rate: 25 }],
    };
    const t = getLineItemTotals(item);
    // taxable = 4500 - 500 = 4000; tax = 1000; total = 5000
    expect(t.discount_total).toBe(500);
    expect(t.tax_total).toBeCloseTo(1000, 5);
    expect(t.total).toBeCloseTo(5000, 5);
  });

  test('returns subtotal = 0 when quantity is 0 (invalid input, still computes)', () => {
    const item: LineItem = { ...tshirt, quantity: 0 };
    const t = getLineItemTotals(item);
    expect(t.subtotal).toBe(0);
    expect(t.total).toBe(0);
  });

  test('returns negative subtotal when unit_price is negative (validation lives elsewhere)', () => {
    const item: LineItem = { ...tshirt, unit_price: -100 };
    const t = getLineItemTotals(item);
    expect(t.subtotal).toBe(-200);
    // discount is floored at 0 because subtotal < any adjustment sum of 0
    expect(t.discount_total).toBe(0);
  });

  test('caps discount at subtotal when adjustments exceed item price', () => {
    const item: LineItem = {
      ...stickers,
      adjustments: [{ code: 'OVER50', amount: 9999 }],
    };
    const t = getLineItemTotals(item);
    expect(t.subtotal).toBe(1500);
    expect(t.discount_total).toBe(1500);
    expect(t.total).toBe(0);
  });

  test('sums multiple tax lines (e.g. NYC 4% state + 4.875% city = 8.875%)', () => {
    const item: LineItem = {
      ...tshirt,
      tax_lines: [
        { code: 'US_NY_STATE', rate: 4 },
        { code: 'US_NY_CITY', rate: 4.875 },
      ],
    };
    const t = getLineItemTotals(item);
    expect(t.subtotal).toBe(4000);
    expect(t.tax_total).toBeCloseTo(355, 5);
    expect(t.total).toBeCloseTo(4355, 5);
  });

  test('handles empty adjustments and empty tax_lines gracefully', () => {
    const t = getLineItemTotals({ ...tshirt, adjustments: [], tax_lines: [] });
    expect(t.discount_total).toBe(0);
    expect(t.tax_total).toBe(0);
    expect(t.total).toBe(4000);
  });

  test('negative tax rate produces a negative tax_total (no rate validation here)', () => {
    const item: LineItem = {
      ...tshirt,
      tax_lines: [{ code: 'BOGUS', rate: -5 }],
    };
    const t = getLineItemTotals(item);
    // taxable 4000 * -5 / 100 = -200
    expect(t.tax_total).toBeCloseTo(-200, 5);
    expect(t.total).toBeCloseTo(3800, 5);
  });
});

describe('[CRITICAL] CartService - getShippingMethodTotals', () => {
  const standard: ShippingMethod = {
    id: 'sm_std',
    name: 'Standard',
    amount: 1000,
    tax_lines: [],
    adjustments: [],
  };

  test('computes total equal to amount when no taxes or adjustments', () => {
    const t = getShippingMethodTotals(standard);
    expect(t.subtotal).toBe(1000);
    expect(t.total).toBe(1000);
  });

  test('applies FREESHIP-style adjustment equal to shipping cost', () => {
    const t = getShippingMethodTotals({
      ...standard,
      adjustments: [{ code: 'FREESHIP', amount: 1000 }],
    });
    expect(t.discount_total).toBe(1000);
    expect(t.total).toBe(0);
  });

  test('applies VAT on shipping fee', () => {
    const t = getShippingMethodTotals({
      ...standard,
      tax_lines: [{ code: 'DK25', rate: 25 }],
    });
    expect(t.tax_total).toBeCloseTo(250, 5);
    expect(t.total).toBeCloseTo(1250, 5);
  });
});

describe('[CRITICAL] CartService - calculateCartTotals', () => {
  test('aggregates items and shipping into a coherent totals breakdown', () => {
    const cart = makeCart({
      items: [
        { ...tshirt, tax_lines: [{ code: 'DK25', rate: 25 }] },
        { ...hoodie, tax_lines: [{ code: 'DK25', rate: 25 }] },
      ],
      shipping_methods: [
        {
          id: 'sm_std',
          name: 'Standard',
          amount: 1000,
          tax_lines: [{ code: 'DK25', rate: 25 }],
          adjustments: [],
        },
      ],
    });
    const t = calculateCartTotals(cart);
    expect(t.item_subtotal).toBe(8500);
    expect(t.shipping_subtotal).toBe(1000);
    expect(t.subtotal).toBe(9500);
    expect(t.tax_total).toBeCloseTo(2375, 5);
    expect(t.total).toBeCloseTo(11875, 5);
  });

  test('returns zeros for an empty cart (no items, no shipping)', () => {
    const t = calculateCartTotals(makeCart({ items: [], shipping_methods: [] }));
    expect(t.subtotal).toBe(0);
    expect(t.tax_total).toBe(0);
    expect(t.discount_total).toBe(0);
    expect(t.total).toBe(0);
  });

  test('applies item-level discounts into item_discount_total', () => {
    const cart = makeCart({
      items: [
        { ...tshirt, adjustments: [{ code: 'WELCOME10', amount: 400 }] },
      ],
      shipping_methods: [],
    });
    const t = calculateCartTotals(cart);
    expect(t.item_discount_total).toBe(400);
    expect(t.discount_total).toBe(400);
    expect(t.total).toBe(3600);
  });
});

describe('[CRITICAL] CartService - roundToMinorUnit', () => {
  test('rounds USD to 2 decimals', () => {
    expect(roundToMinorUnit(19.995, CURRENCIES.usd)).toBeCloseTo(20.0, 5);
    expect(roundToMinorUnit(19.994, CURRENCIES.usd)).toBeCloseTo(19.99, 5);
  });

  test('rounds JPY to integer (0 decimals)', () => {
    expect(roundToMinorUnit(1999.5, CURRENCIES.jpy)).toBe(2000);
    expect(roundToMinorUnit(1999.4, CURRENCIES.jpy)).toBe(1999);
  });

  test('rounds KWD to 3 decimals', () => {
    expect(roundToMinorUnit(1.23456, CURRENCIES.kwd)).toBeCloseTo(1.235, 5);
  });

  test('snaps CHF to the nearest 0.05 (Swiss Rappen rounding)', () => {
    expect(roundToMinorUnit(1.02, CURRENCIES.chf)).toBe(1.0);
    expect(roundToMinorUnit(1.03, CURRENCIES.chf)).toBe(1.05);
    expect(roundToMinorUnit(1.075, CURRENCIES.chf)).toBeCloseTo(1.1, 5);
  });

  test('handles zero and negative amounts', () => {
    expect(roundToMinorUnit(0, CURRENCIES.usd)).toBe(0);
    expect(roundToMinorUnit(-19.995, CURRENCIES.usd)).toBeCloseTo(-19.99, 5);
  });
});

describe('[HIGH] CartService - validateCart', () => {
  test('accepts a valid cart with items and region', () => {
    const res = validateCart(makeCart());
    expect(res.valid).toBe(true);
    expect(res.errors).toEqual([]);
  });

  test('rejects an empty cart', () => {
    const res = validateCart(makeCart({ items: [] }));
    expect(res.valid).toBe(false);
    expect(res.errors).toContain('Cart must have at least 1 item');
  });

  test('rejects cart with missing region_id', () => {
    const res = validateCart(makeCart({ region_id: '' }));
    expect(res.valid).toBe(false);
    expect(res.errors).toContain('region_id must not be empty');
  });

  test('rejects cart where an item has quantity <= 0', () => {
    const bad: LineItem = { ...tshirt, quantity: 0 };
    const res = validateCart(makeCart({ items: [bad] }));
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('quantity'))).toBe(true);
  });

  test('rejects cart where an item has negative unit_price', () => {
    const bad: LineItem = { ...tshirt, unit_price: -100 };
    const res = validateCart(makeCart({ items: [bad] }));
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('unit_price'))).toBe(true);
  });

  test('accumulates multiple errors at once', () => {
    const res = validateCart({ ...makeCart({ items: [] }), currency_code: '', region_id: '' });
    expect(res.valid).toBe(false);
    expect(res.errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe('[HIGH] CartService - addLineItem', () => {
  test('adds a new variant as a fresh line item', () => {
    const cart = makeCart({ items: [tshirt] });
    const result = addLineItem(cart, hoodie);
    expect(result.items).toHaveLength(2);
    expect(result.items[1].variant_id).toBe(hoodie.variant_id);
  });

  test('merges quantity when variant already exists', () => {
    const cart = makeCart({ items: [tshirt] });
    const additional: LineItem = { ...tshirt, id: 'li_tshirt_dup', quantity: 3 };
    const result = addLineItem(cart, additional);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].quantity).toBe(5);
  });

  test('does not mutate the original cart (immutability)', () => {
    const cart = makeCart({ items: [tshirt] });
    const originalQty = cart.items[0].quantity;
    addLineItem(cart, { ...tshirt, quantity: 10 });
    expect(cart.items[0].quantity).toBe(originalQty);
  });

  test('does not validate the incoming item — accepts quantity=0 or negative unit_price', () => {
    // addLineItem is intentionally un-opinionated; callers rely on validateCart.
    const cart = makeCart({ items: [] });
    const result = addLineItem(cart, { ...tshirt, quantity: 0, unit_price: -100 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].quantity).toBe(0);
    expect(result.items[0].unit_price).toBe(-100);
  });
});

describe('[HIGH] CartService - removeLineItem', () => {
  test('removes an existing line item by id', () => {
    const cart = makeCart({ items: [tshirt, hoodie] });
    const result = removeLineItem(cart, tshirt.id);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe(hoodie.id);
  });

  test('throws when item id does not exist', () => {
    const cart = makeCart({ items: [tshirt] });
    expect(() => removeLineItem(cart, 'li_does_not_exist')).toThrow(/not found/i);
  });

  test('does not mutate the original cart', () => {
    const cart = makeCart({ items: [tshirt, hoodie] });
    removeLineItem(cart, tshirt.id);
    expect(cart.items).toHaveLength(2);
  });
});
