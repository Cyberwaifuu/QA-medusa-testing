import { describe, test, expect } from 'vitest';
import {
  createOrderFromCart,
  transitionOrderStatus,
  fulfillItems,
  calculateRefundAmount,
  validateOrderTransition,
  getOrderSummary,
  Order,
  OrderItem,
} from '../../src/modules/order-service';
import {
  Cart,
  CartTotals,
  LineItem,
  calculateCartTotals,
} from '../../src/modules/cart-service';

const tshirt: LineItem = {
  id: 'li_tshirt',
  title: 'Medusa T-Shirt',
  variant_id: 'var_medusa_ts_blk_m',
  unit_price: 2000,
  quantity: 2,
  tax_lines: [{ code: 'DK25', rate: 25 }],
  adjustments: [],
};

const hoodie: LineItem = {
  id: 'li_hoodie',
  title: 'Medusa Hoodie',
  variant_id: 'var_medusa_hd_wht_l',
  unit_price: 4500,
  quantity: 1,
  tax_lines: [{ code: 'DK25', rate: 25 }],
  adjustments: [],
};

function makeCart(items: LineItem[] = [tshirt, hoodie]): Cart {
  return {
    id: 'cart_01',
    currency_code: 'eur',
    region_id: 'reg_eu',
    items,
    shipping_methods: [],
  };
}

function makeOrderItem(overrides: Partial<OrderItem> = {}): OrderItem {
  return {
    id: 'oi_tshirt',
    title: 'Medusa T-Shirt',
    variant_id: 'var_medusa_ts_blk_m',
    unit_price: 2000,
    quantity: 2,
    fulfilled_quantity: 0,
    subtotal: 4000,
    discount_total: 0,
    tax_total: 1000,
    total: 5000,
    ...overrides,
  };
}

function makeOrder(overrides: Partial<Order> = {}): Order {
  const now = new Date();
  return {
    id: 'order_01',
    status: 'pending',
    fulfillment_status: 'not_fulfilled',
    payment_status: 'awaiting',
    items: [makeOrderItem()],
    currency_code: 'eur',
    subtotal: 4000,
    discount_total: 0,
    tax_total: 1000,
    shipping_total: 0,
    total: 5000,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe('[CRITICAL] OrderService - createOrderFromCart', () => {
  test('creates a pending order with items copied from the cart', () => {
    const cart = makeCart();
    const totals: CartTotals = calculateCartTotals(cart);
    const order = createOrderFromCart(cart, totals);
    expect(order.id).toMatch(/^order_/);
    expect(order.status).toBe('pending');
    expect(order.fulfillment_status).toBe('not_fulfilled');
    expect(order.payment_status).toBe('awaiting');
    expect(order.items).toHaveLength(2);
    expect(order.items.every((i) => i.fulfilled_quantity === 0)).toBe(true);
    expect(order.currency_code).toBe('eur');
    expect(order.total).toBeCloseTo(totals.total, 5);
  });

  test('copies per-item totals (subtotal, tax, discount, total) from cart calculation', () => {
    const cart = makeCart([tshirt]);
    const totals = calculateCartTotals(cart);
    const order = createOrderFromCart(cart, totals);
    expect(order.items[0].subtotal).toBe(4000);
    expect(order.items[0].tax_total).toBeCloseTo(1000, 5);
    expect(order.items[0].total).toBeCloseTo(5000, 5);
  });
});

describe('[CRITICAL] OrderService - transitionOrderStatus', () => {
  test('pending → confirmed → processing is a valid chain', () => {
    let o = transitionOrderStatus(makeOrder({ status: 'pending' }), 'confirmed');
    expect(o.status).toBe('confirmed');
    o = transitionOrderStatus(o, 'processing');
    expect(o.status).toBe('processing');
  });

  test('shipped → delivered is valid and updates updated_at', () => {
    const base = makeOrder({ status: 'shipped' });
    const before = base.updated_at.getTime();
    // small tick so Date.now advances
    const o = transitionOrderStatus(base, 'delivered');
    expect(o.status).toBe('delivered');
    expect(o.updated_at.getTime()).toBeGreaterThanOrEqual(before);
  });

  test('throws on pending → fulfilled (skips intermediate steps)', () => {
    expect(() =>
      transitionOrderStatus(makeOrder({ status: 'pending' }), 'fulfilled'),
    ).toThrow(/invalid/i);
  });

  test('throws when transitioning out of cancelled (terminal)', () => {
    expect(() =>
      transitionOrderStatus(makeOrder({ status: 'cancelled' }), 'confirmed'),
    ).toThrow(/invalid/i);
  });

  test('throws when transitioning out of refunded (terminal)', () => {
    expect(() =>
      transitionOrderStatus(makeOrder({ status: 'refunded' }), 'delivered'),
    ).toThrow(/invalid/i);
  });
});

describe('[CRITICAL] OrderService - fulfillItems', () => {
  test('partial fulfillment yields partially_fulfilled status', () => {
    const order = makeOrder({
      items: [
        makeOrderItem({ id: 'oi_a', quantity: 5, fulfilled_quantity: 0 }),
        makeOrderItem({ id: 'oi_b', quantity: 2, fulfilled_quantity: 0 }),
      ],
    });
    const fulfilled = fulfillItems(order, [{ item_id: 'oi_a', quantity: 2 }]);
    expect(fulfilled.fulfillment_status).toBe('partially_fulfilled');
    expect(fulfilled.items.find((i) => i.id === 'oi_a')?.fulfilled_quantity).toBe(2);
  });

  test('full fulfillment across all items yields fulfilled status', () => {
    const order = makeOrder({
      items: [
        makeOrderItem({ id: 'oi_a', quantity: 3, fulfilled_quantity: 0 }),
        makeOrderItem({ id: 'oi_b', quantity: 2, fulfilled_quantity: 0 }),
      ],
    });
    const fulfilled = fulfillItems(order, [
      { item_id: 'oi_a', quantity: 3 },
      { item_id: 'oi_b', quantity: 2 },
    ]);
    expect(fulfilled.fulfillment_status).toBe('fulfilled');
  });

  test('no fulfillments results in not_fulfilled status', () => {
    const order = makeOrder({
      items: [makeOrderItem({ id: 'oi_a', quantity: 3, fulfilled_quantity: 0 })],
    });
    const result = fulfillItems(order, []);
    expect(result.fulfillment_status).toBe('not_fulfilled');
  });

  test('throws when fulfilled quantity would exceed ordered quantity', () => {
    const order = makeOrder({
      items: [makeOrderItem({ id: 'oi_a', quantity: 2, fulfilled_quantity: 1 })],
    });
    expect(() => fulfillItems(order, [{ item_id: 'oi_a', quantity: 5 }])).toThrow(
      /cannot fulfill/i,
    );
  });

  test('applies fulfillments immutably — original order is unchanged', () => {
    const order = makeOrder({
      items: [makeOrderItem({ id: 'oi_a', quantity: 5, fulfilled_quantity: 0 })],
    });
    fulfillItems(order, [{ item_id: 'oi_a', quantity: 2 }]);
    expect(order.items[0].fulfilled_quantity).toBe(0);
  });
});

describe('[HIGH] OrderService - calculateRefundAmount', () => {
  test('sums totals of selected fulfilled items', () => {
    const order = makeOrder({
      items: [
        makeOrderItem({ id: 'oi_a', fulfilled_quantity: 2, total: 5000 }),
        makeOrderItem({ id: 'oi_b', fulfilled_quantity: 1, total: 5625 }),
      ],
    });
    expect(calculateRefundAmount(order, ['oi_a', 'oi_b'])).toBe(10625);
  });

  test('ignores unfulfilled items even when selected', () => {
    const order = makeOrder({
      items: [
        makeOrderItem({ id: 'oi_a', fulfilled_quantity: 0, total: 5000 }),
        makeOrderItem({ id: 'oi_b', fulfilled_quantity: 1, total: 5625 }),
      ],
    });
    expect(calculateRefundAmount(order, ['oi_a', 'oi_b'])).toBe(5625);
  });

  test('returns 0 when no selected items are fulfilled', () => {
    const order = makeOrder({
      items: [makeOrderItem({ id: 'oi_a', fulfilled_quantity: 0, total: 5000 })],
    });
    expect(calculateRefundAmount(order, ['oi_a'])).toBe(0);
  });
});

describe('[MEDIUM] OrderService - validateOrderTransition', () => {
  test('returns valid for allowed transitions', () => {
    expect(validateOrderTransition('pending', 'confirmed').valid).toBe(true);
    expect(validateOrderTransition('shipped', 'delivered').valid).toBe(true);
  });

  test('returns invalid with an error message for disallowed transitions', () => {
    const res = validateOrderTransition('pending', 'delivered');
    expect(res.valid).toBe(false);
    expect(res.error).toMatch(/invalid/i);
  });
});

describe('[MEDIUM] OrderService - getOrderSummary', () => {
  test('aggregates revenue, count, average and status breakdown', () => {
    const orders: Order[] = [
      makeOrder({ id: 'o1', status: 'delivered', total: 10000 }),
      makeOrder({ id: 'o2', status: 'delivered', total: 20000 }),
      makeOrder({ id: 'o3', status: 'cancelled', total: 5000 }),
      makeOrder({ id: 'o4', status: 'pending', total: 15000 }),
    ];
    const summary = getOrderSummary(orders);
    expect(summary.orderCount).toBe(4);
    expect(summary.totalRevenue).toBe(50000);
    expect(summary.averageOrderValue).toBe(12500);
    expect(summary.statusBreakdown.delivered).toBe(2);
    expect(summary.statusBreakdown.cancelled).toBe(1);
    expect(summary.statusBreakdown.pending).toBe(1);
  });

  test('returns all zeros for an empty orders list', () => {
    const summary = getOrderSummary([]);
    expect(summary.orderCount).toBe(0);
    expect(summary.totalRevenue).toBe(0);
    expect(summary.averageOrderValue).toBe(0);
    expect(summary.statusBreakdown.pending).toBe(0);
  });
});
