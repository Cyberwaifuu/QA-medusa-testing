import type { Cart } from './cart-service';
import type { PaymentSession } from './payment-processor';

export interface ShippingAddress {
  first_name: string;
  last_name: string;
  address_1: string;
  city: string;
  country_code: string;
  postal_code?: string;
  phone?: string;
}

export interface CheckoutContext {
  cart: Cart;
  shipping_address?: ShippingAddress;
  billing_address?: ShippingAddress;
  payment_session?: PaymentSession;
  has_shipping_method: boolean;
  inventory_checks: Array<{
    variant_id: string;
    available: boolean;
  }>;
}

export interface CheckoutValidationResult {
  ready: boolean;
  errors: string[];
  warnings: string[];
}

export function validateShippingAddress(
  address: ShippingAddress,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!address.first_name || !address.first_name.trim()) {
    errors.push('first_name is required');
  }
  if (!address.last_name || !address.last_name.trim()) {
    errors.push('last_name is required');
  }
  if (!address.address_1 || !address.address_1.trim()) {
    errors.push('address_1 is required');
  }
  if (!address.city || !address.city.trim()) {
    errors.push('city is required');
  }
  if (!address.country_code || !address.country_code.trim()) {
    errors.push('country_code is required');
  } else if (
    address.country_code.length !== 2 ||
    address.country_code !== address.country_code.toUpperCase()
  ) {
    errors.push('country_code must be exactly 2 uppercase characters');
  }
  return { valid: errors.length === 0, errors };
}

export function validateCheckoutReadiness(context: CheckoutContext): CheckoutValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!context.cart.items || context.cart.items.length < 1) {
    errors.push('Cart must have at least 1 item');
  }

  if (!context.shipping_address) {
    errors.push('Shipping address is required');
  } else {
    const res = validateShippingAddress(context.shipping_address);
    if (!res.valid) {
      for (const e of res.errors) {
        errors.push(`Shipping address: ${e}`);
      }
    }
  }

  if (!context.payment_session) {
    errors.push('Payment session is required');
  } else if (context.payment_session.status !== 'authorized') {
    errors.push(
      `Payment session must be authorized (current: ${context.payment_session.status})`,
    );
  }

  if (!context.has_shipping_method) {
    errors.push('Shipping method must be selected');
  }

  for (const check of context.inventory_checks) {
    if (!check.available) {
      errors.push(`Variant ${check.variant_id} is not available`);
    }
  }

  // Missing billing address is a soft issue — shipping address is used as fallback.
  if (!context.billing_address) {
    warnings.push('Billing address not set, shipping address will be used');
  }

  return { ready: errors.length === 0, errors, warnings };
}

export function validateEmail(email: string): boolean {
  if (!email) return false;
  const re = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
  return re.test(email);
}

export function getCheckoutStep(
  context: CheckoutContext,
): 'address' | 'shipping' | 'payment' | 'review' {
  if (!context.shipping_address) return 'address';
  if (!context.has_shipping_method) return 'shipping';
  if (!context.payment_session) return 'payment';
  return 'review';
}
