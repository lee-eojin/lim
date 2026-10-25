/**
 * Events the shipping provider posts to our webhook. The body is JSON signed with an HMAC of
 * the raw bytes in the x-signature header. The provider retries until it gets a 2xx and may
 * deliver an event more than once or out of order.
 *
 * @typedef {object} ShippingEvent
 * @property {'ping' | 'label_created' | 'in_transit' | 'delivered'} type
 * @property {object} [data] absent on ping
 * @property {string} data.shipmentId
 * @property {'label_created' | 'in_transit' | 'delivered'} data.status
 * @property {{ number: string, url: string }} [data.tracking] absent on label_created
 */
export {};
