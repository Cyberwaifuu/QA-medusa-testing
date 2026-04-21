// Resilient selectors for Medusa Next.js Starter Storefront.
// Strategy: prefer role/text/href; keep legacy data-testid as a fallback via
// comma-separated CSS. Every CSS selector here should work on both bare and
// /us-prefixed routes.

export const ROUTES = {
  home: '/',
  homeRegion: '/dk',
  store: '/dk/store',
  storeAlt: '/store',
  cart: '/dk/cart',
  cartAlt: '/cart',
  checkout: '/dk/checkout',
  checkoutAlt: '/checkout',
  account: '/dk/account',
  accountAlt: '/account',
} as const;

export const SELECTORS = {
  nav: {
    storeLink: 'a[href$="/store"], a[href*="/store?"], [data-testid="nav-store-link"]',
    cartLink: 'a[href$="/cart"], a[href*="/cart?"], [data-testid="nav-cart-link"]',
    accountLink: 'a[href$="/account"], a[href*="/account/"], [data-testid="nav-account-link"]',
  },
  store: {
    pageTitle: 'h1, [data-testid="store-page-title"]',
    productsList: 'ul, [data-testid="products-list"]',
    productCard:
      'a[href*="/products/"], [data-testid="product-wrapper"], [data-testid="product-wrapper"] a',
  },
  product: {
    container: 'main, [data-testid="product-container"]',
    title: 'h1, [data-testid="product-title"]',
    optionButton:
      'button[data-testid="option-button"], [data-testid="product-options"] button, [aria-label^="Select"] button',
    addToCart:
      'button[data-testid="add-product-button"], button[data-testid="mobile-cart-button"]',
  },
  cart: {
    container: '[data-testid="cart-container"], main',
    empty: '[data-testid="empty-cart-message"]',
    itemRow: '[data-testid="product-row"], table tbody tr',
    checkoutButton: '[data-testid="checkout-button"], a[href*="/checkout"]',
  },
  auth: {
    loginPage: '[data-testid="login-page"], form',
    emailInput: 'input[type="email"], input[name="email"], [data-testid="email-input"]',
    passwordInput:
      'input[type="password"], input[name="password"], [data-testid="password-input"]',
    signInButton: 'button[type="submit"], [data-testid="sign-in-button"]',
    loginError: '[data-testid="login-error-message"], [role="alert"], .text-rose-500',
    registerToggle: '[data-testid="register-button"]',
    registerPage: '[data-testid="register-page"], form',
    firstNameInput: 'input[name="first_name"], [data-testid="first-name-input"]',
    lastNameInput: 'input[name="last_name"], [data-testid="last-name-input"]',
    phoneInput: 'input[name="phone"], [data-testid="phone-input"]',
    welcomeMessage: '[data-testid="welcome-message"]',
  },
} as const;

// Text patterns used with getByText / getByRole name matchers.
export const TEXT = {
  addToCart: /add to cart/i,
  signIn: /sign in|log in/i,
  register: /register|create account|sign up/i,
  checkout: /go to checkout|checkout/i,
  storeNav: /^\s*store\s*$/i,
  cartNav: /^\s*cart\s*$/i,
  accountNav: /^\s*account\s*$/i,
} as const;
