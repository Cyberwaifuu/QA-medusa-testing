export interface InventoryItem {
  id: string;
  sku: string;
  requires_shipping: boolean;
  manage_inventory: boolean;
  allow_backorder: boolean;
}

export interface InventoryLevel {
  inventory_item_id: string;
  location_id: string;
  stocked_quantity: number;
  reserved_quantity: number;
  incoming_quantity: number;
}

export interface ReservationItem {
  id: string;
  inventory_item_id: string;
  location_id: string;
  quantity: number;
  description?: string;
}

function generateId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2, 12);
  return `${prefix}_${rand}`;
}

export function getAvailableQuantity(level: InventoryLevel): number {
  return Math.max(0, level.stocked_quantity - level.reserved_quantity);
}

export function checkAvailability(
  item: InventoryItem,
  levels: InventoryLevel[],
  locationIds: string[],
  requiredQuantity: number,
): { available: boolean; availableQuantity: number } {
  if (!item.manage_inventory) {
    return { available: true, availableQuantity: Infinity };
  }
  if (item.allow_backorder) {
    return { available: true, availableQuantity: Infinity };
  }
  const relevant = levels.filter(
    (l) => l.inventory_item_id === item.id && locationIds.includes(l.location_id),
  );
  const availableQuantity = relevant.reduce((sum, l) => sum + getAvailableQuantity(l), 0);
  return { available: availableQuantity >= requiredQuantity, availableQuantity };
}

export function createReservation(
  levels: InventoryLevel[],
  reservation: Omit<ReservationItem, 'id'>,
): { updatedLevels: InventoryLevel[]; reservation: ReservationItem } {
  const idx = levels.findIndex(
    (l) =>
      l.inventory_item_id === reservation.inventory_item_id &&
      l.location_id === reservation.location_id,
  );
  if (idx < 0) {
    throw new Error('Inventory level not found for the given item and location');
  }
  const level = levels[idx];
  const available = getAvailableQuantity(level);
  if (available < reservation.quantity) {
    throw new Error(
      `Insufficient stock: requested ${reservation.quantity}, available ${available}`,
    );
  }
  const updated: InventoryLevel = {
    ...level,
    reserved_quantity: level.reserved_quantity + reservation.quantity,
  };
  const updatedLevels = levels.map((l, i) => (i === idx ? updated : l));
  const newReservation: ReservationItem = { id: generateId('res'), ...reservation };
  return { updatedLevels, reservation: newReservation };
}

export function deleteReservation(
  levels: InventoryLevel[],
  reservationId: string,
  reservations: ReservationItem[],
): { updatedLevels: InventoryLevel[]; updatedReservations: ReservationItem[] } {
  const res = reservations.find((r) => r.id === reservationId);
  if (!res) {
    throw new Error(`Reservation ${reservationId} not found`);
  }
  const idx = levels.findIndex(
    (l) => l.inventory_item_id === res.inventory_item_id && l.location_id === res.location_id,
  );
  if (idx < 0) {
    throw new Error('Inventory level not found for reservation');
  }
  const level = levels[idx];
  const updated: InventoryLevel = {
    ...level,
    reserved_quantity: Math.max(0, level.reserved_quantity - res.quantity),
  };
  const updatedLevels = levels.map((l, i) => (i === idx ? updated : l));
  const updatedReservations = reservations.filter((r) => r.id !== reservationId);
  return { updatedLevels, updatedReservations };
}

export function fulfillReservation(
  levels: InventoryLevel[],
  reservationId: string,
  reservations: ReservationItem[],
): { updatedLevels: InventoryLevel[]; updatedReservations: ReservationItem[] } {
  const res = reservations.find((r) => r.id === reservationId);
  if (!res) {
    throw new Error(`Reservation ${reservationId} not found`);
  }
  const idx = levels.findIndex(
    (l) => l.inventory_item_id === res.inventory_item_id && l.location_id === res.location_id,
  );
  if (idx < 0) {
    throw new Error('Inventory level not found for reservation');
  }
  const level = levels[idx];
  // Fulfillment permanently removes the stock and frees the reservation slot.
  const updated: InventoryLevel = {
    ...level,
    stocked_quantity: level.stocked_quantity - res.quantity,
    reserved_quantity: Math.max(0, level.reserved_quantity - res.quantity),
  };
  const updatedLevels = levels.map((l, i) => (i === idx ? updated : l));
  const updatedReservations = reservations.filter((r) => r.id !== reservationId);
  return { updatedLevels, updatedReservations };
}

export function validateInventoryLevel(level: InventoryLevel): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (level.stocked_quantity < 0) {
    errors.push('stocked_quantity must be >= 0');
  }
  if (level.reserved_quantity < 0) {
    errors.push('reserved_quantity must be >= 0');
  }
  if (level.reserved_quantity > level.stocked_quantity) {
    errors.push('reserved_quantity must be <= stocked_quantity');
  }
  if (!level.location_id) {
    errors.push('location_id must not be empty');
  }
  if (!level.inventory_item_id) {
    errors.push('inventory_item_id must not be empty');
  }
  return { valid: errors.length === 0, errors };
}
