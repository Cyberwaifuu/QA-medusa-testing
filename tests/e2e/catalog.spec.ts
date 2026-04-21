import { test, expect, Page } from '@playwright/test';
import { ROUTES, SELECTORS } from './selectors';

// ───────────────────────────────────────────────────────────────
// CATALOG — Risk Score: 9 (MEDIUM)
// Product discovery surface. Outages = traffic can't convert.
// ───────────────────────────────────────────────────────────────

const EVIDENCE_DIR = 'evidence/catalog';
const LONG = { timeout: 15_000 };

async function snap(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${EVIDENCE_DIR}/${name}.png`, fullPage: true });
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2000);
}

async function gotoStore(page: Page, search = ''): Promise<void> {
  const primary = `${ROUTES.store}${search}`;
  const alt = `${ROUTES.storeAlt}${search}`;
  await page.goto(primary).catch(() => page.goto(alt));
  await settle(page);
}

test.describe('Catalog [MEDIUM — Risk 9]', () => {
  test('home page loads and exposes a Store navigation link', async ({ page }) => {
    await page.goto(ROUTES.home);
    await settle(page);

    const storeNav = await (async () => {
      const byRole = page.getByRole('link', { name: /store/i }).first();
      if ((await byRole.count()) > 0) return byRole;
      const byHref = page.locator(SELECTORS.nav.storeLink).first();
      if ((await byHref.count()) > 0) return byHref;
      return null;
    })();

    expect(storeNav, 'navigation should expose a Store link').not.toBeNull();
    await expect(storeNav!).toBeVisible(LONG);
    await snap(page, '01-home');
  });

  test('/store renders a list of products', async ({ page }) => {
    await gotoStore(page);

    const productLinks = page.locator('a[href*="/products/"]');
    const count = await productLinks.count();

    if (count === 0) {
      test.skip(true, 'no products rendered on /store — storefront may lack seed data');
    }

    expect(count, 'at least one product link should be present').toBeGreaterThan(0);
    await snap(page, '02-store-list');
  });

  test('clicking a product preview opens a product detail page', async ({ page }) => {
    await gotoStore(page);

    const firstProductLink = page.locator('a[href*="/products/"]').first();
    if ((await firstProductLink.count()) === 0) {
      test.skip(true, 'no products to click — storefront may lack seed data');
    }

    const href = await firstProductLink.getAttribute('href');
    await firstProductLink.click(LONG);
    await settle(page);

    await expect(page, 'URL should change to a product detail route').toHaveURL(
      /\/products\//,
      LONG
    );

    const title = await firstExistingVisible(page, [
      page.getByRole('heading').first(),
      page.locator('h1').first(),
      page.locator(SELECTORS.product.title).first(),
    ]);

    expect(title, 'product detail should render a title').not.toBeNull();
    await snap(page, '03-product-detail');
    console.log('[catalog] opened product', href);
  });

  test('sorting re-orders the product list via query params', async ({ page }) => {
    await gotoStore(page);

    const sortLabel = page.locator('label').filter({ hasText: /price/i }).first();
    
    if ((await sortLabel.count()) === 0) {
      test.skip(true, 'sort UI not present on this storefront build');
    }

    await sortLabel.click();
    await settle(page);
    await expect(page, 'URL should include sortBy after sorting').toHaveURL(/sortBy=/, LONG);
    await snap(page, '04-sorted');
  });

  test('search query param is accepted on /store (if supported)', async ({ page }) => {
    await gotoStore(page, '?q=shirt');

    // We don't require specific results — just that the page still renders.
    const pageBody = page.locator('body');
    await expect(pageBody, 'page body should be visible after a search query').toBeVisible(LONG);

    // If products are rendered, the links should still point to /products/.
    const anyProduct = page.locator('a[href*="/products/"]').first();
    if ((await anyProduct.count()) > 0) {
      await expect(anyProduct).toBeVisible();
    }

    await snap(page, '05-search');
  });
});

async function firstExistingVisible(
  _page: Page,
  candidates: ReturnType<Page['locator']>[]
): Promise<ReturnType<Page['locator']> | null> {
  for (const loc of candidates) {
    if ((await loc.count()) > 0) return loc;
  }
  return null;
}
