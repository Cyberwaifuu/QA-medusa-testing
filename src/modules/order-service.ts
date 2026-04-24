import type { Cart, CartTotals } from './cart-service';
import { getLineItemTotals } from './cart-service';

export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'processing'
  | 'fulfilled'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'refunded';

export type FulfillmentStatus = 'not_fulfilled' | 'partially_fulfilled' | 'fulfilled';

export type PaymentStatus_Order = 'awaiting' | 'captured' | 'refunded' | 'partially_refunded';

export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['processing', 'cancelled'],
  processing: ['fulfilled', 'cancelled'],
  fulfilled: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: ['refunded'],
  cancelled: [],
  refunded: [],
};

export interface OrderItem {
  id: string;
  title: string;
  variant_id: string;
  unit_price: number;
  quantity: number;
  fulfilled_quantity: number;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  total: number;
}

export interface Order {
  id: string;
  status: OrderStatus;
  fulfillment_status: FulfillmentStatus;
  payment_status: PaymentStatus_Order;
  items: OrderItem[];
  currency_code: string;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  shipping_total: number;
  total: number;
  created_at: Date;
  updated_at: Date;
}

function generateOrderId(): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2, 12);
  return `order_${rand}`;
}

export function createOrderFromCart(cart: Cart, cartTotals: CartTotals): Order {
  const now = new Date();
  const items: OrderItem[] = cart.items.map((item) => {
    const t = getLineItemTotals(item);
    return {
      id: item.id,
      title: item.title,
      variant_id: item.variant_id,
      unit_price: item.unit_price,
      quantity: item.quantity,
      fulfilled_quantity: 0,
      subtotal: t.subtotal,
      discount_total: t.discount_total,
      tax_total: t.tax_total,
      total: t.total,
    };
  });

  // Shipping total represents the final shipping charge (net of discounts, incl. tax).
  const shipping_total =
    cartTotals.shipping_subtotal -
    cartTotals.shipping_discount_total +
    cartTotals.shipping_tax_total;

  return {
    id: generateOrderId(),
    status: 'pending',
    fulfillment_status: 'not_fulfilled',
    payment_status: 'awaiting',
    items,
    currency_code: cart.currency_code,
    subtotal: cartTotals.subtotal,
    discount_total: cartTotals.discount_total,
    tax_total: cartTotals.tax_total,
    shipping_total,
    total: cartTotals.total,
    created_at: now,
    updated_at: now,
  };
}

export function transitionOrderStatus(order: Order, newStatus: OrderStatus): Order {
  const allowed = ORDER_TRANSITIONS[order.status];
  if (!allowed.includes(newStatus)) {
    throw new Error(`Invalid order status transition: ${order.status} -> ${newStatus}`);
  }
  return { ...order, status: newStatus, updated_at: new Date() };
}

export function fulfillItems(
  order: Order,
  itemFulfillments: Array<{ item_id: string; quantity: number }>,
): Order {
  const newItems: OrderItem[] = order.items.map((item) => {
    const f = itemFulfillments.find((x) => x.item_id === item.id);
    if (!f) return item;
    if (f.quantity < 0) {
      throw new Error(`Fulfillment quantity must be >= 0 for item ${item.id}`);
    }
    const newFulfilled = item.fulfilled_quantity + f.quantity;
    if (newFulfilled > item.quantity) {
      throw new Error(
        `Cannot fulfill ${newFulfilled} units of item ${item.id} — ordered quantity is ${item.quantity}`,
      );
    }
    return { ...item, fulfilled_quantity: newFulfilled };
  });

  const allFulfilled = newItems.every((i) => i.fulfilled_quantity >= i.quantity);
  const noneFulfilled = newItems.every((i) => i.fulfilled_quantity === 0);
  let fulfillment_status: FulfillmentStatus;
  if (allFulfilled) {
    fulfillment_status = 'fulfilled';
  } else if (noneFulfilled) {
    fulfillment_status = 'not_fulfilled';
  } else {
    fulfillment_status = 'partially_fulfilled';
  }

  return {
    ...order,
    items: newItems,
    fulfillment_status,
    updated_at: new Date(),
  };
}

export function calculateRefundAmount(order: Order, itemIds: string[]): number {
  return order.items
    .filter((i) => itemIds.includes(i.id) && i.fulfilled_quantity > 0)
    .reduce((sum, i) => sum + i.total, 0);
}

export function validateOrderTransition(
  currentStatus: OrderStatus,
  newStatus: OrderStatus,
): { valid: boolean; error?: string } {
  const allowed = ORDER_TRANSITIONS[currentStatus];
  if (!allowed.includes(newStatus)) {
    return {
      valid: false,
      error: `Invalid order status transition: ${currentStatus} -> ${newStatus}`,
    };
  }
  return { valid: true };
}

export function getOrderSummary(orders: Order[]): {
  totalRevenue: number;
  orderCount: number;
  averageOrderValue: number;
  statusBreakdown: Record<OrderStatus, number>;
} {
  const statusBreakdown: Record<OrderStatus, number> = {
    pending: 0,
    confirmed: 0,
    processing: 0,
    fulfilled: 0,
    shipped: 0,
    delivered: 0,
    cancelled: 0,
    refunded: 0,
  };
  let totalRevenue = 0;
  for (const o of orders) {
    totalRevenue += o.total;
    statusBreakdown[o.status] += 1;
  }
  const orderCount = orders.length;
  const averageOrderValue = orderCount > 0 ? totalRevenue / orderCount : 0;
  return { totalRevenue, orderCount, averageOrderValue, statusBreakdown };
}
