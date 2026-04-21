import { describe, test, expect } from 'vitest';
import {
  validateEmail,
  validatePassword,
  calculateCartTotal,
  calculateRiskScore,
  formatCurrency,
  CartItem,
} from '../../src/validators';

// validateEmail
describe('validateEmail', () => {
  test('accepts a plain email', () => {
    expect(validateEmail('customer@example.com')).toBe(true);
  });

  test('accepts emails with subdomains and plus-aliases', () => {
    expect(validateEmail('qa+cart@mail.shop.example.com')).toBe(true);
    expect(validateEmail('first.last@sub.example.io')).toBe(true);
  });

  test('rejects missing @', () => {
    expect(validateEmail('customer.example.com')).toBe(false);
  });

  test('rejects missing TLD', () => {
    expect(validateEmail('customer@example')).toBe(false);
  });

  test('rejects empty string and whitespace-only', () => {
    expect(validateEmail('')).toBe(false);
    expect(validateEmail('   ')).toBe(false);
  });

  test('rejects null / undefined defensively', () => {
    expect(validateEmail(null as unknown as string)).toBe(false);
    expect(validateEmail(undefined as unknown as string)).toBe(false);
  });

  test('rejects emails longer than 254 characters', () => {
    const local = 'a'.repeat(250);
    expect(validateEmail(`${local}@b.co`)).toBe(false);
  });
});


// validatePassword
describe('validatePassword', () => {
  test('accepts an 8-char password with a letter and a digit', () => {
    const result = validatePassword('abcdefg1');
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('flags passwords shorter than 8 characters', () => {
    const result = validatePassword('ab1');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /8 characters/.test(e))).toBe(true);
  });

  test('flags passwords missing a digit', () => {
    const result = validatePassword('abcdefgh');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /digit/.test(e))).toBe(true);
  });

  test('flags passwords missing a letter', () => {
    const result = validatePassword('12345678');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /letter/.test(e))).toBe(true);
  });

  test('empty string returns all applicable errors', () => {
    const result = validatePassword('');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });

  test('non-string input is rejected', () => {
    const result = validatePassword(null as unknown as string);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test('accepts passwords well above the minimum length', () => {
    const result = validatePassword('Str0ngPassw0rd!');
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});


// calculateCartTotal
describe('calculateCartTotal', () => {
  test('returns 0 for an empty cart', () => {
    expect(calculateCartTotal([])).toBe(0);
  });

  test('sums price × quantity for multiple items without discount', () => {
    const items: CartItem[] = [
      { price: 10, quantity: 2 },
      { price: 25.5, quantity: 1 },
    ];
    expect(calculateCartTotal(items)).toBe(45.5);
  });

  test('applies per-line fractional discount correctly', () => {
    const items: CartItem[] = [{ price: 100, quantity: 2, discount: 0.1 }];
    // 100 * 2 * 0.9 = 180
    expect(calculateCartTotal(items)).toBe(180);
  });

  test('combines discounted and non-discounted lines', () => {
    const items: CartItem[] = [
      { price: 50, quantity: 2, discount: 0.5 }, // 50
      { price: 30, quantity: 1 }, // 30
    ];
    expect(calculateCartTotal(items)).toBe(80);
  });

  test('rounds to 2 decimals to avoid floating-point drift', () => {
    const items: CartItem[] = [{ price: 0.1, quantity: 3 }];
    expect(calculateCartTotal(items)).toBe(0.3);
  });

  test('throws on negative price', () => {
    expect(() => calculateCartTotal([{ price: -5, quantity: 1 }])).toThrow();
  });

  test('throws on negative quantity', () => {
    expect(() => calculateCartTotal([{ price: 10, quantity: -1 }])).toThrow();
  });

  test('throws on non-integer quantity', () => {
    expect(() => calculateCartTotal([{ price: 10, quantity: 1.5 }])).toThrow();
  });

  test('throws on discount outside [0, 1]', () => {
    expect(() => calculateCartTotal([{ price: 10, quantity: 1, discount: -0.1 }])).toThrow();
    expect(() => calculateCartTotal([{ price: 10, quantity: 1, discount: 1.5 }])).toThrow();
  });

  test('zero-quantity items contribute 0', () => {
    expect(calculateCartTotal([{ price: 99, quantity: 0 }])).toBe(0);
  });
});

// calculateRiskScore
describe('calculateRiskScore', () => {
  test('score 20 classifies as CRITICAL', () => {
    expect(calculateRiskScore(5, 4)).toEqual({ score: 20, priority: 'CRITICAL' });
  });

  test('score exactly 15 is CRITICAL (lower bound)', () => {
    expect(calculateRiskScore(5, 3)).toEqual({ score: 15, priority: 'CRITICAL' });
  });

  test('score 12 is HIGH', () => {
    expect(calculateRiskScore(4, 3)).toEqual({ score: 12, priority: 'HIGH' });
  });

  test('score exactly 10 is HIGH (lower bound)', () => {
    expect(calculateRiskScore(2, 5)).toEqual({ score: 10, priority: 'HIGH' });
  });

  test('score 6 is MEDIUM', () => {
    expect(calculateRiskScore(2, 3)).toEqual({ score: 6, priority: 'MEDIUM' });
  });

  test('score exactly 5 is MEDIUM (lower bound)', () => {
    expect(calculateRiskScore(1, 5)).toEqual({ score: 5, priority: 'MEDIUM' });
  });

  test('score 4 is LOW', () => {
    expect(calculateRiskScore(2, 2)).toEqual({ score: 4, priority: 'LOW' });
  });

  test('score 1 is LOW (minimum)', () => {
    expect(calculateRiskScore(1, 1)).toEqual({ score: 1, priority: 'LOW' });
  });

  test('throws when likelihood is out of range', () => {
    expect(() => calculateRiskScore(0, 3)).toThrow();
    expect(() => calculateRiskScore(6, 3)).toThrow();
  });

  test('throws when impact is out of range', () => {
    expect(() => calculateRiskScore(3, 0)).toThrow();
    expect(() => calculateRiskScore(3, 6)).toThrow();
  });

  test('throws on non-integer inputs', () => {
    expect(() => calculateRiskScore(2.5, 3)).toThrow();
    expect(() => calculateRiskScore(2, 3.1)).toThrow();
  });
});

// formatCurrency
describe('formatCurrency', () => {
  test('formats USD with leading $ and comma separators', () => {
    expect(formatCurrency(1234.56, 'USD')).toBe('$1,234.56');
  });

  test('formats EUR with trailing €', () => {
    expect(formatCurrency(1234.56, 'EUR')).toBe('1,234.56 €');
  });

  test('formats KZT with trailing ₸', () => {
    expect(formatCurrency(1234.56, 'KZT')).toBe('1,234.56 ₸');
  });

  test('handles zero amounts', () => {
    expect(formatCurrency(0, 'USD')).toBe('$0.00');
    expect(formatCurrency(0, 'EUR')).toBe('0.00 €');
  });

  test('pads sub-dollar amounts to 2 decimals', () => {
    expect(formatCurrency(0.1, 'USD')).toBe('$0.10');
    expect(formatCurrency(0.5, 'EUR')).toBe('0.50 €');
  });

  test('handles negative amounts with a leading minus', () => {
    expect(formatCurrency(-42.5, 'USD')).toBe('-$42.50');
    expect(formatCurrency(-42.5, 'EUR')).toBe('-42.50 €');
  });

  test('rounds to 2 decimals', () => {
    expect(formatCurrency(1.234, 'USD')).toBe('$1.23');
    expect(formatCurrency(1.236, 'USD')).toBe('$1.24');
  });

  test('throws on unsupported currency', () => {
    expect(() => formatCurrency(100, 'GBP')).toThrow();
    expect(() => formatCurrency(100, '')).toThrow();
  });

  test('throws on non-finite amount', () => {
    expect(() => formatCurrency(Number.NaN, 'USD')).toThrow();
    expect(() => formatCurrency(Number.POSITIVE_INFINITY, 'USD')).toThrow();
  });
});
