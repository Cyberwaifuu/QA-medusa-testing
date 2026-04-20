import { describe, test, expect, beforeAll } from 'vitest';
import { AxiosInstance } from 'axios';
import { createApiClient, registerTestLogging } from './helpers';

registerTestLogging();

const api: AxiosInstance = createApiClient();

let seedProductId: string | undefined;
let seedVariantId: string | undefined;
let seedRegionId: string | undefined;

beforeAll(async () => {
  const productsRes = await api.get('/store/products', { params: { limit: 5 } });
  if (productsRes.status === 200 && productsRes.data?.products?.length) {
    const product = productsRes.data.products[0];
    seedProductId = product.id;
    seedVariantId = product.variants?.[0]?.id;
  }

  const regionsRes = await api.get('/store/regions');
  if (regionsRes.status === 200 && regionsRes.data?.regions?.length) {
    seedRegionId = regionsRes.data.regions[0].id;
  }
});

// ───────────────────────────────────────────────────────────────
// PRODUCTS API — Risk Score: 6 (Medium Risk)
// ───────────────────────────────────────────────────────────────
describe('Products API [Medium Risk]', () => {
  test('GET /store/products returns 200 with products array', async () => {
    const res = await api.get('/store/products');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data.products)).toBe(true);
  });

  test('GET /store/products/:id returns 200 with product object', async () => {
    expect(seedProductId, 'no seed product available').toBeDefined();
    const res = await api.get(`/store/products/${seedProductId}`);
    expect(res.status).toBe(200);
    expect(res.data.product).toBeDefined();
    expect(res.data.product.id).toBe(seedProductId);
  });

  test('GET /store/products with invalid query handled gracefully', async () => {
    const res = await api.get('/store/products', { params: { limit: 'not-a-number' } });
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(500);
  });
});

// ───────────────────────────────────────────────────────────────
// CART API — Risk Score: 12 (High Risk)
// ───────────────────────────────────────────────────────────────
describe('Cart API [High Risk]', () => {
  test('POST /store/carts creates a new cart with id', async () => {
    const res = await api.post('/store/carts', { region_id: seedRegionId });
    expect(res.status).toBe(200);
    expect(res.data.cart).toBeDefined();
    expect(res.data.cart.id).toMatch(/^cart_/);
  });

  test('POST /store/carts/:id/line-items adds a line item to cart', async () => {
    expect(seedVariantId, 'no seed variant available').toBeDefined();

    const cartRes = await api.post('/store/carts', { region_id: seedRegionId });
    const cartId = cartRes.data.cart.id;

    const res = await api.post(`/store/carts/${cartId}/line-items`, {
      variant_id: seedVariantId,
      quantity: 1,
    });

    expect(res.status).toBe(200);
    expect(res.data.cart.items?.length ?? 0).toBeGreaterThan(0);
  });

  test('DELETE /store/carts/:id/line-items/:item_id removes item from cart', async () => {
    expect(seedVariantId, 'no seed variant available').toBeDefined();

    const cartRes = await api.post('/store/carts', { region_id: seedRegionId });
    const cartId = cartRes.data.cart.id;

    const addRes = await api.post(`/store/carts/${cartId}/line-items`, {
      variant_id: seedVariantId,
      quantity: 1,
    });
    const itemId = addRes.data.cart.items[0].id;

    const delRes = await api.delete(`/store/carts/${cartId}/line-items/${itemId}`);
    expect(delRes.status).toBe(200);

    const afterRes = await api.get(`/store/carts/${cartId}`);
    const remaining = afterRes.data.cart.items?.find((i: any) => i.id === itemId);
    expect(remaining).toBeUndefined();
  });

  test('GET /store/carts/:id retrieves cart by id', async () => {
    const created = await api.post('/store/carts', { region_id: seedRegionId });
    const cartId = created.data.cart.id;

    const res = await api.get(`/store/carts/${cartId}`);
    expect(res.status).toBe(200);
    expect(res.data.cart.id).toBe(cartId);
  });
});

// ───────────────────────────────────────────────────────────────
// CUSTOMER AUTH API — Risk Score: 10 (High Risk)
// ───────────────────────────────────────────────────────────────
describe('Customer Auth API [High Risk]', () => {
  const uniqueSuffix = Date.now();
  const email = `qa.test.${uniqueSuffix}@example.com`;
  const password = 'SuperSecret!123';

  test('POST /auth/customer/emailpass/register registers a new customer', async () => {
    const res = await api.post('/auth/customer/emailpass/register', { email, password });
    expect([200, 201]).toContain(res.status);
    expect(res.data.token).toBeTypeOf('string');
  });

  test('POST /auth/customer/emailpass logs in with valid credentials', async () => {
    const res = await api.post('/auth/customer/emailpass', { email, password });
    expect(res.status).toBe(200);
    expect(res.data.token).toBeTypeOf('string');
  });

  test('POST /auth/customer/emailpass rejects wrong password with 401', async () => {
    const res = await api.post('/auth/customer/emailpass', {
      email,
      password: 'definitely-wrong-password',
    });
    expect(res.status).toBe(401);
  });

  test('POST /auth/customer/emailpass rejects empty fields', async () => {
    const res = await api.post('/auth/customer/emailpass', { email: '', password: '' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});

// ───────────────────────────────────────────────────────────────
// REGIONS API — Risk Score: 4 (Medium Risk)
// ───────────────────────────────────────────────────────────────
describe('Regions API [Medium Risk]', () => {
  test('GET /store/regions returns a list of regions', async () => {
    const res = await api.get('/store/regions');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data.regions)).toBe(true);
    expect(res.data.regions.length).toBeGreaterThan(0);
  });

  test('GET /store/regions/:id returns a specific region', async () => {
    expect(seedRegionId, 'no seed region available').toBeDefined();
    const res = await api.get(`/store/regions/${seedRegionId}`);
    expect(res.status).toBe(200);
    expect(res.data.region.id).toBe(seedRegionId);
  });
});
