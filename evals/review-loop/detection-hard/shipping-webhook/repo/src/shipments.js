const STATUS_ORDER = ['pending', 'label_created', 'in_transit', 'delivered'];
const shipments = new Map();

export function createShipment(id) {
  shipments.set(id, { id, status: 'pending', trackingNumber: null });
  return shipments.get(id);
}

// Updates only move forward, so a repeated or late event cannot undo a newer status.
export async function updateShipment(id, { status, trackingNumber }) {
  const shipment = shipments.get(id);
  if (!shipment) return null;
  if (STATUS_ORDER.indexOf(status) > STATUS_ORDER.indexOf(shipment.status)) {
    shipment.status = status;
  }
  if (trackingNumber) {
    shipment.trackingNumber = trackingNumber;
  }
  return shipment;
}
