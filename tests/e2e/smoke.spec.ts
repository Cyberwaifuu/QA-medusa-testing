import { test, expect } from '@playwright/test';

test.describe('Medusa Storefront - Smoke Tests', () => {
  test('homepage loads successfully', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Medusa/i);
    expect(page.url()).toContain('localhost:8000');
  });

  test('products page is accessible', async ({ page }) => {
    await page.goto('/dk/store');
    await expect(page.locator('body')).toBeVisible();
  });
});