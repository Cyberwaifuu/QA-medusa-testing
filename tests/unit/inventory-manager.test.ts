import { describe, test, expect } from 'vitest';
import {
  getAvailableQuantity,
  checkAvailability,
  createReservation,
  deleteReservation,
  fulfillReservation,
  validateInventoryLevel,
  InventoryItem,
  InventoryLevel,
  ReservationItem,
} from '../../src/modules/inventory-manager';

const tshirtItem: InventoryItem = {
  id: 'iitem_tshirt',
  sku: 'MEDUSA-TS-BLK-M',
  requires_shipping: true,
  manage_inventory: true,
  allow_backorder: false,
};

const hoodieItem: InventoryItem = {
  id: 'iitem_hoodie',
  sku: 'MEDUSA-HD-WHT-L',
  requires_shipping: true,
  manage_inventory: true,
  allow_backorder: false,
};

function level(overrides: Partial<InventoryLevel>): InventoryLevel {
  return {
    inventory_item_id: tshirtItem.id,
    location_id: 'loc_warehouse_nyc',
    stocked_quantity: 100,
    reserved_quantity: 0,
    incoming_quantity: 0,
    ...overrides,
  };
}

describe('[HIGH] InventoryManager - getAvailableQuantity', () => {
  test('returns stocked - reserved when positive', () => {
    expect(getAvailableQuantity(level({ stocked_quantity: 100, reserved_quantity: 20 }))).toBe(80);
  });

  test('returns 0 when all stock is reserved', () => {
    expect(getAvailableQuantity(level({ stocked_quantity: 50, reserved_quantity: 50 }))).toBe(0);
  });

  test('floors at 0 even when reserved exceeds stocked (shouldn-t-happen safety)', () => {
    expect(getAvailableQuantity(level({ stocked_quantity: 5, reserved_quantity: 20 }))).toBe(0);
  });
});

describe('[CRITICAL] InventoryManager - checkAvailability', () => {
  test('reports available when stock covers the required quantity', () => {
    const levels = [level({ stocked_quantity: 100, reserved_quantity: 20 })];
    const res = checkAvailability(tshirtItem, levels, ['loc_warehouse_nyc'], 10);
    expect(res.available).toBe(true);
    expect(res.availableQuantity).toBe(80);
  });

  test('reports unavailable when stock cannot cover the requested quantity', () => {
    const levels = [level({ stocked_quantity: 5, reserved_quantity: 3 })];
    const res = checkAvailability(tshirtItem, levels, ['loc_warehouse_nyc'], 10);
    expect(res.available).toBe(false);
    expect(res.availableQuantity).toBe(2);
  });

  test('always available when manage_inventory is false', () => {
    const unmanaged: InventoryItem = { ...tshirtItem, manage_inventory: false };
    const res = checkAvailability(unmanaged, [], ['loc_warehouse_nyc'], 9999);
    expect(res.available).toBe(true);
    expect(res.availableQuantity).toBe(Infinity);
  });

  test('always available when allow_backorder is true', () => {
    const backorderable: InventoryItem = { ...tshirtItem, allow_backorder: true };
    const levels = [level({ stocked_quantity: 0, reserved_quantity: 0 })];
    const res = checkAvailability(backorderable, levels, ['loc_warehouse_nyc'], 100);
    expect(res.available).toBe(true);
    expect(res.availableQuantity).toBe(Infinity);
  });

  test('sums stock across multiple locations when fulfilling from several warehouses', () => {
    const levels = [
      level({ stocked_quantity: 10, reserved_quantity: 0, location_id: 'loc_warehouse_nyc' }),
      level({ stocked_quantity: 15, reserved_quantity: 5, location_id: 'loc_warehouse_la' }),
    ];
    const res = checkAvailability(
      tshirtItem,
      levels,
      ['loc_warehouse_nyc', 'loc_warehouse_la'],
      20,
    );
    expect(res.available).toBe(true);
    expect(res.availableQuantity).toBe(20);
  });

  test('ignores levels from locations not in the requested list', () => {
    const levels = [
      level({ stocked_quantity: 100, reserved_quantity: 0, location_id: 'loc_warehouse_la' }),
    ];
    const res = checkAvailability(tshirtItem, levels, ['loc_warehouse_nyc'], 1);
    expect(res.available).toBe(false);
    expect(res.availableQuantity).toBe(0);
  });
});

describe('[CRITICAL] InventoryManager - createReservation', () => {
  test('creates a reservation and increments reserved_quantity', () => {
    const levels = [level({ stocked_quantity: 100, reserved_quantity: 0 })];
    const { updatedLevels, reservation } = createReservation(levels, {
      inventory_item_id: tshirtItem.id,
      location_id: 'loc_warehouse_nyc',
      quantity: 5,
      description: 'order_123',
    });
    expect(reservation.id).toMatch(/^res_/);
    expect(updatedLevels[0].reserved_quantity).toBe(5);
    // original levels must not be mutated
    expect(levels[0].reserved_quantity).toBe(0);
  });

  test('throws when available stock is insufficient', () => {
    const levels = [level({ stocked_quantity: 3, reserved_quantity: 0 })];
    expect(() =>
      createReservation(levels, {
        inventory_item_id: tshirtItem.id,
        location_id: 'loc_warehouse_nyc',
        quantity: 10,
      }),
    ).toThrow(/insufficient stock/i);
  });

  test('throws when the inventory level does not exist for the location', () => {
    const levels = [level({ location_id: 'loc_warehouse_la' })];
    expect(() =>
      createReservation(levels, {
        inventory_item_id: tshirtItem.id,
        location_id: 'loc_warehouse_nyc',
        quantity: 1,
      }),
    ).toThrow(/not found/i);
  });
});

describe('[HIGH] InventoryManager - deleteReservation', () => {
  test('removes reservation and decrements reserved_quantity', () => {
    const levels = [level({ stocked_quantity: 100, reserved_quantity: 5 })];
    const reservations: ReservationItem[] = [
      {
        id: 'res_abc',
        inventory_item_id: tshirtItem.id,
        location_id: 'loc_warehouse_nyc',
        quantity: 5,
      },
    ];
    const { updatedLevels, updatedReservations } = deleteReservation(
      levels,
      'res_abc',
      reservations,
    );
    expect(updatedLevels[0].reserved_quantity).toBe(0);
    expect(updatedReservations).toHaveLength(0);
  });

  test('throws when the reservation id does not exist', () => {
    const levels = [level({})];
    expect(() => deleteReservation(levels, 'res_missing', [])).toThrow(/not found/i);
  });
});

describe('[CRITICAL] InventoryManager - fulfillReservation', () => {
  test('decrements both stocked and reserved, and drops the reservation', () => {
    const levels = [level({ stocked_quantity: 100, reserved_quantity: 5 })];
    const reservations: ReservationItem[] = [
      {
        id: 'res_xyz',
        inventory_item_id: tshirtItem.id,
        location_id: 'loc_warehouse_nyc',
        quantity: 5,
      },
    ];
    const { updatedLevels, updatedReservations } = fulfillReservation(
      levels,
      'res_xyz',
      reservations,
    );
    expect(updatedLevels[0].stocked_quantity).toBe(95);
    expect(updatedLevels[0].reserved_quantity).toBe(0);
    expect(updatedReservations).toHaveLength(0);
  });

  test('throws when fulfilling an unknown reservation id', () => {
    expect(() => fulfillReservation([level({})], 'res_ghost', [])).toThrow(/not found/i);
  });
});

describe('[MEDIUM] InventoryManager - validateInventoryLevel', () => {
  test('accepts a valid level', () => {
    const res = validateInventoryLevel(
      level({ stocked_quantity: 100, reserved_quantity: 10 }),
    );
    expect(res.valid).toBe(true);
    expect(res.errors).toEqual([]);
  });

  test('rejects negative stocked_quantity', () => {
    const res = validateInventoryLevel(level({ stocked_quantity: -1 }));
    expect(res.valid).toBe(false);
    expect(res.errors).toContain('stocked_quantity must be >= 0');
  });

  test('rejects negative reserved_quantity', () => {
    const res = validateInventoryLevel(level({ reserved_quantity: -3 }));
    expect(res.valid).toBe(false);
    expect(res.errors).toContain('reserved_quantity must be >= 0');
  });

  test('rejects when reserved > stocked', () => {
    const res = validateInventoryLevel(
      level({ stocked_quantity: 5, reserved_quantity: 10 }),
    );
    expect(res.valid).toBe(false);
    expect(res.errors).toContain('reserved_quantity must be <= stocked_quantity');
  });

  test('rejects empty location_id and inventory_item_id', () => {
    const res = validateInventoryLevel(
      level({ location_id: '', inventory_item_id: '' }),
    );
    expect(res.valid).toBe(false);
    expect(res.errors).toContain('location_id must not be empty');
    expect(res.errors).toContain('inventory_item_id must not be empty');
  });
});
