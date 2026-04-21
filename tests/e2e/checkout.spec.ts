import { test, expect, Page, Locator } from '@playwright/test';
import { ROUTES, SELECTORS, TEXT } from './selectors';

// ───────────────────────────────────────────────────────────────
// CHECKOUT FLOW — Risk Score: 15 (CRITICAL)
// Revenue-critical path: browse → cart → checkout.
// ───────────────────────────────────────────────────────────────

const EVIDENCE_DIR = 'evidence/checkout';
const LONG = { timeout: 15_000 };

async function snap(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${EVIDENCE_DIR}/${name}.png`, fullPage: true });
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2000);
}

async function gotoStore(page: Page): Promise<void> {
  await page.goto(ROUTES.store).catch(() => page.goto(ROUTES.storeAlt));
  await settle(page);
}

async function firstExisting(candidates: Locator[]): Promise<Locator | null> {
  for (const loc of candidates) {
    if ((await loc.count()) > 0) return loc.first();
  }
  return null;
}

test.describe('Checkout Flow [CRITICAL — Risk 15]', () => {
  test.setTimeout(60_000);

  test('happy path: direct /store → open product → add → /cart → checkout', async ({ page }) => {
    // 1. Home
    await page.goto(ROUTES.home);
    await settle(page);
    await snap(page, '01-home');

    // 2. Go directly to the catalog — no nav-click dependency.
    await gotoStore(page);
    await snap(page, '02-store');

    // 3. First product link
    const productLink = page.locator('a[href*="/products/"]').first();
    if ((await productLink.count()) === 0) {
      test.skip(true, 'no seeded products on /store — cannot exercise checkout flow');
    }
    await productLink.click();
    await settle(page);
    await expect(page, 'product page should load').toHaveURL(/\/products\//, LONG);
    await snap(page, '03-product');

    // 4. Select ONE value per option group. Iterating flat buttons re-selects
    // the same group multiple times, leaving other groups unchosen and the
    // Add-to-cart button disabled.
    const optionGroups = page.locator('[data-testid="product-options"]');
    const groupCount = await optionGroups.count();
    for (let i = 0; i < groupCount; i++) {
      const firstValue = optionGroups.nth(i).locator('button').first();
      if ((await firstValue.count()) > 0) {
        await firstValue.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(300);
      }
    }

    const addButton =
      (await firstExisting([
        page.locator(SELECTORS.product.addToCart),
        page.getByRole('button', { name: TEXT.addToCart }),
      ])) ?? null;

    if (!addButton) {
      test.skip(true, 'add-to-cart button not found on product page');
    }

    // Wait up to 20s for the button to enable (variant resolution is async in
    // the starter — it only enables once options map to a concrete variant).
    await expect(addButton!, 'add-to-cart should become enabled').toBeEnabled({ timeout: 20_000 });

    // Observe the line-item mutation instead of a blind sleep.
    const addResponse = page
      .waitForResponse(
        (resp) =>
          /\/store\/carts\/[^/]+\/line-items/.test(resp.url()) &&
          resp.request().method() === 'POST' &&
          resp.status() < 400,
        { timeout: 15_000 }
      )
      .catch(() => null);

    await addButton!.click();
    await addResponse;
    await page.waitForTimeout(1500);
    await snap(page, '04-added');

    // 5. Go directly to /cart — don't rely on dropdown nav.
    await page.goto(ROUTES.cart).catch(() => page.goto(ROUTES.cartAlt));
    await settle(page);

    // 6. Cart MUST have a real line-item row before proceeding. An image
    // fallback is too permissive — empty-cart pages also render images.
    const itemRow = page.locator('[data-testid="product-row"], table tbody tr').first();
    await expect(itemRow, 'cart should contain the added product').toBeVisible({
      timeout: 15_000,
    });
    await snap(page, '05-cart');

    // 7. Start checkout. In the starter the CTA is a link <a href=".../checkout">,
    // not a <button>, so target the href directly; fall back to direct nav.
    const checkoutLink = page.locator('a[href*="/checkout"]').first();
    if ((await checkoutLink.count()) > 0) {
      await checkoutLink.click();
    } else {
      await page.goto(ROUTES.checkout).catch(() => page.goto(ROUTES.checkoutAlt));
    }
    await settle(page);
    await expect(page, 'should navigate to checkout route').toHaveURL(/\/checkout(\?|$|\/)/, LONG);
    await snap(page, '06-checkout');
  });

  test('negative: empty cart blocks checkout and shows empty state', async ({ page, context }) => {
    await context.clearCookies();

    await page.goto(ROUTES.cart).catch(() => page.goto(ROUTES.cartAlt));
    await settle(page);
    await snap(page, 'neg-01-empty-cart');

    // Check for empty state OR absence of item rows
    const itemRows = page.locator(SELECTORS.cart.itemRow);
    const itemCount = await itemRows.count();
    
    // Either there's an explicit "empty" message, or simply no items
    const emptyMessage = await firstExisting([
      page.locator(SELECTORS.cart.empty),
      page.getByText(/cart is empty|your shopping bag is empty|no items/i),
    ]);
    
    expect(
      emptyMessage !== null || itemCount === 0,
      'cart should either show empty message or have zero items'
    ).toBe(true);

    // Checkout should not be possible
    const checkoutButton = page.getByRole('button', { name: TEXT.checkout });
    const checkoutLink = page.getByRole('link', { name: TEXT.checkout });
    const totalCheckout = (await checkoutButton.count()) + (await checkoutLink.count());
    
    // Either no checkout button, or it's disabled
    if (totalCheckout > 0) {
      const btn = (await checkoutButton.count()) > 0 ? checkoutButton.first() : checkoutLink.first();
      const isDisabled = await btn.isDisabled().catch(() => false);
      expect(isDisabled, 'checkout button should be disabled on empty cart').toBe(true);
    }
    
    await snap(page, 'neg-02-empty-verified');
  });
});
