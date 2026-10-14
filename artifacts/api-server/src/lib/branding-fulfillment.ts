import { randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";
import {
  submitOrder,
  findExistingOrder,
  refreshOrder,
  fulfillmentMode,
  toOrderStatus,
  type PrintfulOrderItem,
  type PrintfulRecipient,
} from "./printful";
import {
  printkkConfigured,
  fulfillRugOrder,
  PRINTKK_RUG_PRODUCTS,
} from "./printkk";

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
    /* PrintKK per-item resume state, written into the items jsonb as each
       rug is submitted (see submitToProvider). Absent = not yet submitted. */
    providerOrderId?: string;
    designCode?: string;
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

/* ── Order-level fulfillment claim ───────────────────────────────────────
   fulfillBrandingOrder used to be check-then-act on provider_order_id:
   read NULL → submit to the provider → persist the returned id. The
   webhook's stripe_payments claim (commit 15e29c9d) serializes Stripe
   deliveries, but the window INSIDE fulfillment stayed open: a crash
   after the provider accepted an order but before provider_order_id was
   persisted left the row NULL, so the retry submitted a SECOND provider
   order (for PrintKK, its per-item loop resubmitted — and re-paid —
   every rug).

   The claim: provider_order_id doubles as the claim slot (it is free
   text with an index; the status column cannot carry a claim state —
   its CHECK constraint admits only the fulfillment vocabulary). A
   worker claims the order with ONE atomic conditional UPDATE that
   writes a sentinel token `claim:<uuid>:<claimedAtMs>` only where
   provider_order_id IS NULL (or, for a stale claim, only where it still
   equals the exact stale token). Exactly one worker wins; a loser
   observes either the winner's real provider id (returned as-is) or a
   live claim (BrandingFulfillmentInProgressError — callers already
   treat a throw as "retry later": the webhook 500s for a Stripe retry,
   the shop routes keep the order 'received').

   Failure semantics mirror claimStripePayment's failed/stale reclaim:
   - the provider call itself throws → nothing was accepted, so the
     claim is released (CAS back to NULL) and a retry may start at once;
   - the provider accepted but persisting the result fails → the claim
     is HELD, so no instant resubmission is possible; it goes stale
     after FULFILLMENT_CLAIM_STALE_MS and a later retry reclaims it and
     resumes (PrintKK resume skips items whose ids are already recorded
     in the items jsonb).
   Persist writes are claim-CAS UPDATEs with a short internal retry and
   a verify-by-reread, so a write whose response was lost after landing
   still counts as success — the provider is never re-asked.

   Provider-side idempotency (the final inch): the claim alone could
   not cover a process death between the provider accepting a Printful
   draft and the first persist attempt — the draft existed at Printful,
   bound to nothing we recorded, and a stale-claim reclaim would have
   submitted a second one (harmless to money — drafts are never charged
   until confirmed — but a real duplicate). Printful submissions now
   carry our branding_orders.id as the provider's external_id, and
   every submission is preceded by an external-id lookup: a found
   draft is ADOPTED — its id flows through the same claim-CAS persist
   below — instead of resubmitted. PrintKK has no equivalent: its
   create-order call takes no merchant reference and its only order
   read is by PrintKK's own id (exactly the value lost in the window),
   so the PrintKK remainder stays the per-item window the resume logic
   already narrows it to. */

const CLAIM_TOKEN_PREFIX = "claim:";
const FULFILLMENT_CLAIM_STALE_MS = 5 * 60 * 1000; // mirrors CLAIM_STALE_MS in payment-record.ts
const CLAIMED_WRITE_ATTEMPTS = 3;

export class BrandingFulfillmentInProgressError extends Error {
  constructor(orderId: string) {
    super(`Branding order ${orderId} is already being fulfilled`);
    this.name = "BrandingFulfillmentInProgressError";
  }
}

/** Internal marker: the provider HAS accepted work but recording it
    failed — the claim must be held, never released for an instant retry. */
class ProviderWorkAcceptedError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ProviderWorkAcceptedError";
  }
}

function isClaimToken(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(CLAIM_TOKEN_PREFIX);
}

function claimTimestampMs(token: string): number {
  const ms = Number(token.slice(token.lastIndexOf(":") + 1));
  return Number.isFinite(ms) ? ms : 0;
}

function newClaimToken(): string {
  return `${CLAIM_TOKEN_PREFIX}${randomUUID()}:${Date.now()}`;
}

async function selectOrder(orderId: string): Promise<OrderRow | undefined> {
  const result = await db.execute(sql`
    SELECT id, user_id, items, total_cents, name, email, address, city, state, zip,
           status, provider, provider_order_id, paid
    FROM branding_orders
    WHERE id = ${orderId}
    LIMIT 1
  `);
  return result.rows[0] as unknown as OrderRow | undefined;
}

/* Run a claim-guarded UPDATE (… WHERE provider_order_id = <our claim>
   RETURNING id) with a short retry. A 0-row result is verified by
   re-reading the order: if an earlier attempt actually landed (its
   response was lost), verify() sees the written state and the write
   counts as done. Throws the last error after CLAIMED_WRITE_ATTEMPTS. */
async function claimedWrite(
  orderId: string,
  build: () => SQL,
  verify: (row: OrderRow) => boolean,
  what: string
): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= CLAIMED_WRITE_ATTEMPTS; attempt++) {
    try {
      const res = await db.execute(build());
      if (res.rows.length > 0) return;
      const row = await selectOrder(orderId);
      if (row && verify(row)) return;
      throw new Error(
        `Branding order ${orderId}: lost the fulfillment claim while ${what}`
      );
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`Branding order ${orderId}: failed while ${what}`);
}

/* Best-effort claim release after a provider-call failure. CAS on our
   exact token so a successor's claim is never stomped; if the release
   itself fails (DB down) the claim simply goes stale and is reclaimed. */
async function releaseClaim(orderId: string, claim: string): Promise<void> {
  try {
    await db.execute(sql`
      UPDATE branding_orders
      SET provider_order_id = NULL
      WHERE id = ${orderId} AND provider_order_id = ${claim}
    `);
  } catch {
    /* best-effort — see above */
  }
}

interface FulfillmentOutcome {
  provider: string;
  providerOrderId: string;
  status: string;
  trackingNumber: string | null;
  trackingUrl: string | null;
}

/* Submit the (claimed) order to its provider. PrintKK rug orders persist
   each item's provider id into the items jsonb the moment that item is
   submitted, so a later attempt resumes after the last completed item
   instead of resubmitting — and re-paying — the whole order. */
async function submitToProvider(
  order: OrderRow,
  recipient: PrintfulRecipient,
  claim: string
): Promise<FulfillmentOutcome> {
  /* Route rug items to PrintKK (POD rugs), everything else to Printful.
     For MVP: if order is rug-only, use PrintKK exclusively. */
  const rugItems = order.items.filter((i) => i.product === "rug");
  const otherItems = order.items.filter((i) => i.product !== "rug");

  if (rugItems.length > 0 && otherItems.length === 0 && printkkConfigured()) {
    // Rug-only order → PrintKK (fulfill each rug item)
    const items = order.items.map((i) => ({ ...i }));
    let lastOrderId = "";
    let lastDesignCode = "";
    for (const [idx, rug] of items.entries()) {
      if (rug.providerOrderId) {
        // Already submitted by an earlier attempt — resume past it.
        lastOrderId = rug.providerOrderId;
        lastDesignCode = rug.designCode ?? "";
        continue;
      }
      if (!rug.designUrl) {
        throw new Error(`Rug item missing designUrl (logo) for order ${order.id}`);
      }
      // Download logo from R2/URL
      const logoRes = await fetch(rug.designUrl);
      if (!logoRes.ok) throw new Error(`Failed to download rug logo: ${rug.designUrl}`);
      const logoBuffer = Buffer.from(await logoRes.arrayBuffer());
      const fileName = `rug-logo-${order.id}.png`;

      // Map size to PrintKK product (default to rectangle)
      const rugProduct = PRINTKK_RUG_PRODUCTS.rectangle;

      const [firstName, ...lastNameParts] = order.name.split(" ");
      const result = await fulfillRugOrder(
        logoBuffer,
        fileName,
        rugProduct.code,
        rugProduct.printAreaCode,
        rug.qty,
        {
          firstName: firstName || "Customer",
          lastName: lastNameParts.join(" ") || "Customer",
          phone: "",
          email: order.email,
          address1: order.address,
          city: order.city,
          state: order.state,
          zip: order.zip,
          country: "US",
        }
      );
      items[idx] = { ...rug, providerOrderId: result.orderId, designCode: result.designCode };
      lastOrderId = result.orderId;
      lastDesignCode = result.designCode;

      /* Per-item resume point: the rug is submitted AND paid at PrintKK,
         so record its id immediately. If recording ultimately fails, the
         provider has accepted work — surface ProviderWorkAcceptedError
         so the caller holds the claim instead of releasing it. */
      try {
        await claimedWrite(
          order.id,
          () => sql`
            UPDATE branding_orders
            SET items = ${JSON.stringify(items)}::jsonb
            WHERE id = ${order.id} AND provider_order_id = ${claim}
            RETURNING id
          `,
          (row) => row.items[idx]?.providerOrderId === result.orderId,
          "recording PrintKK item progress"
        );
      } catch (err) {
        throw new ProviderWorkAcceptedError(
          `PrintKK accepted rug item ${idx} of branding order ${order.id} (provider order ${result.orderId}) but its progress could not be recorded`,
          { cause: err }
        );
      }
    }

    logger.info(
      { orderId: order.id, provider: "printkk", providerOrderId: lastOrderId, designCode: lastDesignCode },
      "[branding] rug order submitted to PrintKK"
    );

    /* Status vocabulary note: this used to write 'waitingForFulfillment',
       which exists in neither the branding_orders status CHECK constraint
       (migration 0013) nor BRANDING_ORDER_STATUSES — the write could never
       land, itself a double-submit window. 'pending_fulfillment' is the
       vocabulary's value for exactly this state (submitted to the
       provider, awaiting fulfillment), the same status the Printful path
       lands on via toOrderStatus('pending'). */
    return {
      provider: "printkk",
      providerOrderId: lastOrderId,
      status: "pending_fulfillment",
      trackingNumber: null,
      trackingUrl: null,
    };
  }

  const items: PrintfulOrderItem[] = order.items.map((i) => ({
    product: i.product,
    size: i.size,
    color: i.color,
    quantity: i.qty,
    designUrl: i.designUrl,
  }));

  /* Adopt before submitting: ask Printful for an order already bound
     to our order id (sent as external_id on every submission). The
     lookup runs on every attempt, not just stale-claim reclaims — it
     is one idempotent GET, and it also covers the claim-release path
     (the create POST's response was lost after Printful accepted the
     draft), where no signal in this module can tell the retry apart
     from a first attempt. A non-404 lookup failure throws out of the
     provider phase: the claim is released and a later retry looks
     again — we never submit blind when an existing draft cannot be
     ruled out. Mock mode: findExistingOrder returns null without a
     provider call, so demo semantics are unchanged. */
  const existing = await findExistingOrder(order.id);
  if (existing) {
    logger.info(
      { orderId: order.id, providerOrderId: existing.providerOrderId },
      "[branding] adopted the Printful order already bound to this order id — no duplicate submission"
    );
  }
  const fulfillment = existing ?? (await submitOrder(recipient, items, order.id));

  return {
    provider: fulfillmentMode(),
    providerOrderId: fulfillment.providerOrderId,
    status: toOrderStatus(fulfillment.status),
    trackingNumber: fulfillment.trackingNumber ?? null,
    trackingUrl: fulfillment.trackingUrl ?? null,
  };
}

/* Mark a branding order paid and submit it to fulfillment (Printful live
   or the clearly-labeled mock sandbox). Exactly-once submission is
   enforced by the order-level claim described above: if the order
   already has a real provider_order_id, the existing fulfillment is
   returned; if another worker holds a live claim, this call throws
   BrandingFulfillmentInProgressError instead of submitting a duplicate.
   Called from the Stripe webhook (after checkout.session.completed) and
   from the mock-checkout path. */
export async function fulfillBrandingOrder(orderId: string): Promise<{
  provider: string;
  providerOrderId: string;
  status: string;
}> {
  let order = await selectOrder(orderId);
  if (!order) throw new Error(`Branding order not found: ${orderId}`);

  /* ── Acquire the claim ───────────────────────────────────────────────
     Loop: re-read after every lost CAS so a concurrent winner's real
     provider id is returned rather than resubmitted. */
  let claim: string | null = null;
  for (let spin = 0; spin < 3 && !claim; spin++) {
    const current = order.provider_order_id;
    if (current && !isClaimToken(current)) {
      return {
        provider: order.provider,
        providerOrderId: current,
        status: order.status,
      };
    }
    if (
      current &&
      isClaimToken(current) &&
      Date.now() - claimTimestampMs(current) < FULFILLMENT_CLAIM_STALE_MS
    ) {
      throw new BrandingFulfillmentInProgressError(orderId);
    }
    const token = newClaimToken();
    const res = current
      ? await db.execute(sql`
          UPDATE branding_orders
          SET provider_order_id = ${token}
          WHERE id = ${orderId} AND provider_order_id = ${current}
          RETURNING id
        `)
      : await db.execute(sql`
          UPDATE branding_orders
          SET provider_order_id = ${token}
          WHERE id = ${orderId} AND provider_order_id IS NULL
          RETURNING id
        `);
    if (res.rows.length > 0) {
      claim = token;
    } else {
      const fresh = await selectOrder(orderId);
      if (!fresh) throw new Error(`Branding order not found: ${orderId}`);
      order = fresh;
    }
  }
  if (!claim) throw new BrandingFulfillmentInProgressError(orderId);

  const recipient: PrintfulRecipient = {
    name: order.name,
    email: order.email,
    address1: order.address,
    city: order.city,
    stateCode: order.state,
    zip: order.zip,
    countryCode: "US",
  };

  /* ── Phase 1: provider submit. A throw from the provider call itself
     means nothing was accepted → release the claim for an immediate
     retry. ProviderWorkAcceptedError means the provider DID accept work
     whose recording failed → hold the claim. */
  let outcome: FulfillmentOutcome;
  try {
    outcome = await submitToProvider(order, recipient, claim);
  } catch (err) {
    if (!(err instanceof ProviderWorkAcceptedError)) {
      await releaseClaim(orderId, claim);
    }
    throw err;
  }

  /* ── Phase 2: persist the provider result under the claim. A failure
     here leaves the claim held (never released): the provider order
     exists, and only the stale-claim reclaim may reopen submission. */
  await claimedWrite(
    orderId,
    () => sql`
      UPDATE branding_orders
      SET provider = ${outcome.provider},
          provider_order_id = ${outcome.providerOrderId},
          status = ${outcome.status},
          tracking_number = ${outcome.trackingNumber},
          tracking_url = ${outcome.trackingUrl}
      WHERE id = ${orderId} AND provider_order_id = ${claim}
      RETURNING id
    `,
    (row) => row.provider_order_id === outcome.providerOrderId,
    "persisting the provider result"
  );

  logger.info(
    { orderId, provider: outcome.provider, providerOrderId: outcome.providerOrderId },
    "[branding] order submitted to fulfillment"
  );

  return {
    provider: outcome.provider,
    providerOrderId: outcome.providerOrderId,
    status: outcome.status,
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
    SELECT provider_order_id, status FROM branding_orders
    WHERE id = ${orderId} AND user_id = ${userId}
    LIMIT 1
  `);
  const row = result.rows[0] as unknown as {
    provider_order_id: string | null;
    status: string;
  } | undefined;
  if (!row) throw new Error("Order not found");
  if (!row.provider_order_id) {
    return { status: "received", trackingNumber: null, trackingUrl: null };
  }
  if (isClaimToken(row.provider_order_id)) {
    /* A fulfillment claim is in flight — there is no provider order to
       refresh yet, and the claim token must never reach the provider. */
    return { status: row.status, trackingNumber: null, trackingUrl: null };
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

/* Statuses that are only reachable AFTER a successful provider confirm:
   production cannot start, and nothing can ship, for an unconfirmed
   draft. A confirm call for an order in one of these states is by
   definition a duplicate — skip the provider POST entirely. */
const ALREADY_CONFIRMED_STATUSES: ReadonlySet<string> = new Set([
  "in_production",
  "shipped",
  "delivered",
]);
/* Terminal states a confirm can never apply to. */
const UNCONFIRMABLE_STATUSES: ReadonlySet<string> = new Set(["canceled", "failed"]);

/* Confirm a submitted draft with the provider once payment lands, so
   production actually starts. Live Printful drafts are NOT charged until
   confirmed — this is the money-move gate. Mock mode: no-op.
   Idempotent: an order whose status shows it was already confirmed (or
   can never be confirmed) is skipped without a provider call. Within
   'pending_fulfillment' the stored status cannot distinguish a draft
   from a confirmed-but-queued order (printful.ts maps both provider
   states to 'pending'), so the confirm POST remains the arbiter there —
   the webhook's payment claim already prevents re-entry after a fully
   completed pass. */
export async function confirmBrandingFulfillment(orderId: string): Promise<void> {
  const result = await db.execute(sql`
    SELECT provider, provider_order_id, status FROM branding_orders
    WHERE id = ${orderId}
    LIMIT 1
  `);
  const row = result.rows[0] as unknown as {
    provider: string;
    provider_order_id: string | null;
    status: string;
  } | undefined;
  if (!row || row.provider !== "printful" || !row.provider_order_id) return;
  if (isClaimToken(row.provider_order_id)) {
    /* Submission still in flight — no provider order exists to confirm. */
    return;
  }
  if (ALREADY_CONFIRMED_STATUSES.has(row.status)) {
    logger.info(
      { orderId, status: row.status },
      "[branding] fulfillment already confirmed — skipping provider confirm"
    );
    return;
  }
  if (UNCONFIRMABLE_STATUSES.has(row.status)) {
    logger.warn(
      { orderId, status: row.status },
      "[branding] fulfillment in a terminal state — skipping provider confirm"
    );
    return;
  }
  const { confirmPrintfulOrder } = await import("./printful");
  await confirmPrintfulOrder(row.provider_order_id);
  logger.info({ orderId }, "[branding] fulfillment confirmed with Printful — production starting");
}
