export interface TaxLine {
  code: string;
  rate: number;
}

export interface Adjustment {
  code: string;
  amount: number;
}

export interface LineItem {
  id: string;
  title: string;
  variant_id: string;
  unit_price: number;
  quantity: number;
  tax_lines: TaxLine[];
  adjustments: Adjustment[];
}

export interface ShippingMethod {
  id: string;
  name: string;
  amount: number;
  tax_lines: TaxLine[];
  adjustments: Adjustment[];
}

export interface LineItemTotals {
  subtotal: number;
  discount_total: number;
  tax_total: number;
  total: number;
}

export interface CurrencyInfo {
  code: string;
  decimal_digits: number;
}

export interface Cart {
  id: string;
  currency_code: string;
  region_id: string;
  items: LineItem[];
  shipping_methods: ShippingMethod[];
}

export interface CartTotals {
  item_subtotal: number;
  item_tax_total: number;
  item_discount_total: number;
  shipping_subtotal: number;
  shipping_tax_total: number;
  shipping_discount_total: number;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  total: number;
}

export const CURRENCIES: Record<string, CurrencyInfo> = {
  usd: { code: 'usd', decimal_digits: 2 },
  eur: { code: 'eur', decimal_digits: 2 },
  gbp: { code: 'gbp', decimal_digits: 2 },
  jpy: { code: 'jpy', decimal_digits: 0 },
  kwd: { code: 'kwd', decimal_digits: 3 },
  kzt: { code: 'kzt', decimal_digits: 2 },
  chf: { code: 'chf', decimal_digits: 2 },
};

function sumAdjustments(adjustments: Adjustment[]): number {
  return adjustments.reduce((acc, a) => acc + a.amount, 0);
}

function sumTaxRates(taxLines: TaxLine[]): number {
  return taxLines.reduce((acc, t) => acc + t.rate, 0);
}

export function getLineItemTotals(item: LineItem): LineItemTotals {
  const subtotal = item.unit_price * item.quantity;
  const rawDiscount = sumAdjustments(item.adjustments);
  // Discount cannot exceed subtotal and cannot be negative.
  const discount_total = Math.max(0, Math.min(rawDiscount, subtotal));
  const taxable = subtotal - discount_total;
  const tax_total = (taxable * sumTaxRates(item.tax_lines)) / 100;
  const total = taxable + tax_total;
  return { subtotal, discount_total, tax_total, total };
}

export function getShippingMethodTotals(method: ShippingMethod): LineItemTotals {
  const subtotal = method.amount;
  const rawDiscount = sumAdjustments(method.adjustments);
  const discount_total = Math.max(0, Math.min(rawDiscount, subtotal));
  const taxable = subtotal - discount_total;
  const tax_total = (taxable * sumTaxRates(method.tax_lines)) / 100;
  const total = taxable + tax_total;
  return { subtotal, discount_total, tax_total, total };
}

export function calculateCartTotals(cart: Cart): CartTotals {
  let item_subtotal = 0;
  let item_tax_total = 0;
  let item_discount_total = 0;
  for (const item of cart.items) {
    const t = getLineItemTotals(item);
    item_subtotal += t.subtotal;
    item_tax_total += t.tax_total;
    item_discount_total += t.discount_total;
  }

  let shipping_subtotal = 0;
  let shipping_tax_total = 0;
  let shipping_discount_total = 0;
  for (const sm of cart.shipping_methods) {
    const t = getShippingMethodTotals(sm);
    shipping_subtotal += t.subtotal;
    shipping_tax_total += t.tax_total;
    shipping_discount_total += t.discount_total;
  }

  const subtotal = item_subtotal + shipping_subtotal;
  const discount_total = item_discount_total + shipping_discount_total;
  const tax_total = item_tax_total + shipping_tax_total;
  const total = subtotal - discount_total + tax_total;

  return {
    item_subtotal,
    item_tax_total,
    item_discount_total,
    shipping_subtotal,
    shipping_tax_total,
    shipping_discount_total,
    subtotal,
    discount_total,
    tax_total,
    total,
  };
}

export function roundToMinorUnit(amount: number, currency: CurrencyInfo): number {
  // Swiss Rappen rounding — CHF cash amounts snap to the nearest 0.05.
  if (currency.code === 'chf') {
    return Math.round(amount * 20) / 20;
  }
  const factor = Math.pow(10, currency.decimal_digits);
  return Math.round(amount * factor) / factor;
}

export function validateCart(cart: Cart): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!cart.items || cart.items.length < 1) {
    errors.push('Cart must have at least 1 item');
  }
  for (const item of cart.items ?? []) {
    if (item.quantity <= 0) {
      errors.push(`Item ${item.id} must have quantity > 0`);
    }
    if (item.unit_price < 0) {
      errors.push(`Item ${item.id} must have unit_price >= 0`);
    }
  }
  if (!cart.region_id) {
    errors.push('region_id must not be empty');
  }
  if (!cart.currency_code) {
    errors.push('currency_code must not be empty');
  }
  return { valid: errors.length === 0, errors };
}

export function addLineItem(cart: Cart, item: LineItem): Cart {
  const existingIdx = cart.items.findIndex((i) => i.variant_id === item.variant_id);
  let newItems: LineItem[];
  if (existingIdx >= 0) {
    newItems = cart.items.map((existing, idx) =>
      idx === existingIdx
        ? { ...existing, quantity: existing.quantity + item.quantity }
        : existing,
    );
  } else {
    newItems = [...cart.items, item];
  }
  return { ...cart, items: newItems };
}

export function removeLineItem(cart: Cart, itemId: string): Cart {
  const exists = cart.items.some((i) => i.id === itemId);
  if (!exists) {
    throw new Error(`Line item ${itemId} not found in cart`);
  }
  return { ...cart, items: cart.items.filter((i) => i.id !== itemId) };
}
