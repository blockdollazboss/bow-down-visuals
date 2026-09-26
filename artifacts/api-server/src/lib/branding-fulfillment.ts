import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";
import {
  submitOrder,
  refreshOrder,
  fulfillmentMode,
  toOrderStatus,
  type PrintfulOrderItem,
  type PrintfulRecipient,
} from "./printful";

interface OrderRow {
  id: string;
  user_id: string;
  items: Array<{
    product: string;
    color: string;
    size: string;
    qty: number;
    unitPriceCents: number;
    designUrl?: string;
  }>;
  total_cents: number;
  name: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  status: string;
  provider: string;
  provider_order_id: string | null;
  paid: boolean;
}

/* Mark a branding order paid and submit it to fulfillment (Printful live
   or the clearly-labeled mock sandbox). Idempotent: if the order already
   has a provider_order_id, the existing fulfillment is returned. Called
   from the Stripe webhook (after checkout.session.completed) and from the
   mock-checkout path. */
export async function fulfillBrandingOrder(orderId: string): Promise<{
  provider: string;
  providerOrderId: string;
  status: string;
}> {
  const result = await db.execute(sql`
    SELECT id, user_id, items, total_cents, name, email, address, city, state, zip,
           status, provider, provider_order_id, paid
    FROM branding_orders
    WHERE id = ${orderId}
    LIMIT 1
  `);
  const order = result.rows[0] as unknown as OrderRow | undefined;
  if (!order) throw new Error(`Branding order not found: ${orderId}`);

  if (order.provider_order_id) {
    return {
      provider: order.provider,
      providerOrderId: order.provider_order_id,
      status: order.status,
    };
  }

  const recipient: PrintfulRecipient = {
    name: order.name,
    email: order.email,
    address1: order.address,
    city: order.city,
    stateCode: order.state,
    zip: order.zip,
    countryCode: "US",
  };
  const items: PrintfulOrderItem[] = order.items.map((i) => ({
    product: i.product,
    size: i.size,
    color: i.color,
    quantity: i.qty,
    designUrl: i.designUrl,
  }));

  const fulfillment = await submitOrder(recipient, items);
  const orderStatus = toOrderStatus(fulfillment.status);

  await db.execute(sql`
    UPDATE branding_orders
    SET provider = ${fulfillmentMode()},
        provider_order_id = ${fulfillment.providerOrderId},
        status = ${orderStatus},
        tracking_number = ${fulfillment.trackingNumber ?? null},
        tracking_url = ${fulfillment.trackingUrl ?? null}
    WHERE id = ${orderId}
  `);

  logger.info(
    { orderId, provider: fulfillmentMode(), providerOrderId: fulfillment.providerOrderId },
    "[branding] order submitted to fulfillment"
  );

  return {
    provider: fulfillmentMode(),
    providerOrderId: fulfillment.providerOrderId,
    status: orderStatus,
  };
}

/* Pull the latest fulfillment state for an order from the provider and
   persist it. Returns the refreshed status fields. */
export async function refreshBrandingOrder(orderId: string, userId: string): Promise<{
  status: string;
  trackingNumber: string | null;
  trackingUrl: string | null;
}> {
  const result = await db.execute(sql`
    SELECT provider_order_id FROM branding_orders
    WHERE id = ${orderId} AND user_id = ${userId}
    LIMIT 1
  `);
  const row = result.rows[0] as unknown as { provider_order_id: string | null } | undefined;
  if (!row) throw new Error("Order not found");
  if (!row.provider_order_id) {
    return { status: "received", trackingNumber: null, trackingUrl: null };
  }

  const fulfillment = await refreshOrder(row.provider_order_id);
  const orderStatus = toOrderStatus(fulfillment.status);

  await db.execute(sql`
    UPDATE branding_orders
    SET status = ${orderStatus},
        tracking_number = ${fulfillment.trackingNumber ?? null},
        tracking_url = ${fulfillment.trackingUrl ?? null}
    WHERE id = ${orderId}
  `);

  return {
    status: orderStatus,
    trackingNumber: fulfillment.trackingNumber ?? null,
    trackingUrl: fulfillment.trackingUrl ?? null,
  };
}

/* Mark an order paid (after Stripe confirms). Idempotent. */
export async function markBrandingOrderPaid(
  orderId: string,
  stripeSessionId: string
): Promise<void> {
  await db.execute(sql`
    UPDATE branding_orders
    SET paid = TRUE, stripe_session_id = ${stripeSessionId}
    WHERE id = ${orderId} AND paid = FALSE
  `);
}

/* Confirm a submitted draft with the provider once payment lands, so
   production actually starts. Live Printful drafts are NOT charged until
   confirmed — this is the money-move gate. Mock mode: no-op. */
export async function confirmBrandingFulfillment(orderId: string): Promise<void> {
  const result = await db.execute(sql`
    SELECT provider, provider_order_id FROM branding_orders
    WHERE id = ${orderId}
    LIMIT 1
  `);
  const row = result.rows[0] as unknown as {
    provider: string;
    provider_order_id: string | null;
  } | undefined;
  if (!row || row.provider !== "printful" || !row.provider_order_id) return;
  const { confirmPrintfulOrder } = await import("./printful");
  await confirmPrintfulOrder(row.provider_order_id);
  logger.info({ orderId }, "[branding] fulfillment confirmed with Printful — production starting");
}
