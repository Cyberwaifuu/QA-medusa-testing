export type CartItem = {
  price: number;
  quantity: number;
  /** Fractional discount in [0, 1]. 0.1 means 10% off this line. */
  discount?: number;
};

export type PasswordResult = {
  valid: boolean;
  errors: string[];
};

export type RiskResult = {
  score: number;
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
};

const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'KZT'] as const;
type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

const CURRENCY_SYMBOL: Record<SupportedCurrency, string> = {
  USD: '$',
  EUR: '€',
  KZT: '₸',
};

// RFC-5322 is overkill for storefront input — a pragmatic pattern matches
// the cases real checkout forms care about.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateEmail(email: string): boolean {
  if (typeof email !== 'string' || email.length === 0 || email.length > 254) {
    return false;
  }
  return EMAIL_RE.test(email);
}

export function validatePassword(password: string): PasswordResult {
  const errors: string[] = [];

  if (typeof password !== 'string') {
    return { valid: false, errors: ['password must be a string'] };
  }
  if (password.length < 8) {
    errors.push('password must be at least 8 characters');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('password must contain at least one digit');
  }
  if (!/[A-Za-z]/.test(password)) {
    errors.push('password must contain at least one letter');
  }

  return { valid: errors.length === 0, errors };
}

export function calculateCartTotal(items: CartItem[]): number {
  if (!Array.isArray(items) || items.length === 0) return 0;

  let total = 0;
  for (const item of items) {
    if (item.price < 0) throw new Error('price must be non-negative');
    if (item.quantity < 0) throw new Error('quantity must be non-negative');
    if (!Number.isInteger(item.quantity)) {
      throw new Error('quantity must be an integer');
    }

    const discount = item.discount ?? 0;
    if (discount < 0 || discount > 1) {
      throw new Error('discount must be a fraction between 0 and 1');
    }

    total += item.price * item.quantity * (1 - discount);
  }

  // Round to 2 decimals to avoid floating-point noise on totals.
  return Math.round(total * 100) / 100;
}

export function calculateRiskScore(likelihood: number, impact: number): RiskResult {
  const inRange = (n: number) => Number.isInteger(n) && n >= 1 && n <= 5;
  if (!inRange(likelihood)) {
    throw new Error('likelihood must be an integer between 1 and 5');
  }
  if (!inRange(impact)) {
    throw new Error('impact must be an integer between 1 and 5');
  }

  const score = likelihood * impact;
  const priority: RiskResult['priority'] =
    score >= 15 ? 'CRITICAL' : score >= 10 ? 'HIGH' : score >= 5 ? 'MEDIUM' : 'LOW';

  return { score, priority };
}

export function formatCurrency(amount: number, currency: string): string {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    throw new Error('amount must be a finite number');
  }
  if (!SUPPORTED_CURRENCIES.includes(currency as SupportedCurrency)) {
    throw new Error(`Unsupported currency: ${currency}`);
  }

  const symbol = CURRENCY_SYMBOL[currency as SupportedCurrency];
  const negative = amount < 0;
  const absFixed = Math.abs(amount).toFixed(2);
  const [whole, frac] = absFixed.split('.');
  const withThousands = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = `${withThousands}.${frac}`;
  const sign = negative ? '-' : '';

  // USD puts the symbol in front; EUR / KZT after the number.
  return currency === 'USD' ? `${sign}${symbol}${body}` : `${sign}${body} ${symbol}`;
}
