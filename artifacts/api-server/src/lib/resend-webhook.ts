/**
 * Resend webhook (POST /api/resend-webhook) — the provider half of
 * the email engagement signal path (migration 0188).
 *
 * Resend signs webhooks with Svix. Verification here follows the same
 * discipline as the Stripe webhook in app.ts: the route is mounted
 * BEFORE express.json() with a raw body, the handler fails CLOSED
 * (503 when RESEND_WEBHOOK_SECRET is unset, 401 on any signature or
 * timestamp failure), and NOTHING in an unverified body is ever
 * trusted or recorded.
 *
 * Events handled: email.opened / email.clicked feed the engagement
 * recorder (first-signal-wins against the house pixel/redirect, so
 * an open is counted once whichever path reports it); email.bounced
 * marks the delivery; email.complained marks the delivery and
 * suppresses the subscriber (unsubscribed_at set — a complaint is an
 * unsubscribe with legal weight). Everything else is acknowledged and
 * ignored so Resend doesn't retry noise forever.
 */
import { createHmac, timingSafeEqual } from "crypto";
import type { Request, Response } from "express";
import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  emailCampaignDeliveriesTable,
  emailCampaignLinksTable,
  emailCampaignsTable,
  emailSubscribersTable,
} from "@workspace/db";
import { recordEngagement } from "./email-tracking";
import { logger } from "./logger";

const TIMESTAMP_TOLERANCE_SECONDS = 300; /* Svix's own default window */

/** Verify a Svix signature per the Svix spec. Returns false on any anomaly. */
export function verifySvixSignature(args: {
  secret: string;
  msgId: string;
  timestamp: string;
  signatureHeader: string;
  rawBody: string;
  nowSeconds?: number;
}): boolean {
  const { secret, msgId, timestamp, signatureHeader, rawBody } = args;
  if (!secret.startsWith("whsec_")) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const now = args.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > TIMESTAMP_TOLERANCE_SECONDS) return false;
  let key: Buffer;
  try {
    key = Buffer.from(secret.slice("whsec_".length), "base64");
  } catch {
    return false;
  }
  if (key.length === 0) return false;
  const expected = createHmac("sha256", key).update(`${msgId}.${timestamp}.${rawBody}`).digest();
  for (const part of signatureHeader.split(" ")) {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) continue;
    let candidate: Buffer;
    try {
      candidate = Buffer.from(sig, "base64");
    } catch {
      continue;
    }
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) return true;
  }
  return false;
}

interface ResendEvent {
  type?: string;
  created_at?: string;
  data?: {
    email_id?: string;
    to?: string[] | string;
    tags?: Record<string, string>;
    click?: { link?: string };
    [key: string]: unknown;
  };
}

async function findDelivery(event: ResendEvent) {
  const emailId = event.data?.email_id;
  if (emailId) {
    const [byProvider] = await db
      .select()
      .from(emailCampaignDeliveriesTable)
      .where(eq(emailCampaignDeliveriesTable.providerMessageId, emailId))
      .limit(1);
    if (byProvider) return byProvider;
  }
  return null;
}

export async function resendWebhookHandler(req: Request, res: Response): Promise<void> {
  const secret = process.env["RESEND_WEBHOOK_SECRET"];
  if (!secret) {
    /* Fail closed: without the secret nothing can be verified, so
       nothing is accepted. */
    res.status(503).json({ error: "webhook_not_configured" });
    return;
  }
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
  const msgId = req.header("svix-id") ?? "";
  const timestamp = req.header("svix-timestamp") ?? "";
  const signature = req.header("svix-signature") ?? "";
  if (!msgId || !timestamp || !signature || !verifySvixSignature({ secret, msgId, timestamp, signatureHeader: signature, rawBody })) {
    res.status(401).json({ error: "invalid_signature" });
    return;
  }

  let event: ResendEvent;
  try {
    event = JSON.parse(rawBody) as ResendEvent;
  } catch {
    res.status(400).json({ error: "invalid_json" });
    return;
  }

  try {
    const type = event.type ?? "";
    if (!["email.opened", "email.clicked", "email.bounced", "email.complained"].includes(type)) {
      res.json({ received: true, ignored: type || "unknown" });
      return;
    }
    const delivery = await findDelivery(event);
    if (!delivery) {
      /* A verified event for a send this house didn't track (e.g. a
         transactional email) — acknowledge, record nothing. */
      res.json({ received: true, matched: false });
      return;
    }
    const [campaignRow] = await db
      .select({ listId: emailCampaignsTable.listId, id: emailCampaignsTable.id })
      .from(emailCampaignsTable)
      .where(eq(emailCampaignsTable.id, delivery.campaignId))
      .limit(1);
    if (!campaignRow) {
      res.json({ received: true, matched: false });
      return;
    }

    if (type === "email.opened") {
      await recordEngagement({
        deliveryId: delivery.id,
        campaignId: delivery.campaignId,
        subscriberId: delivery.subscriberId,
        listId: campaignRow.listId,
        kind: "open",
        source: "resend_webhook",
        providerEventId: msgId,
      });
    } else if (type === "email.clicked") {
      const linkUrl = event.data?.click?.link;
      let linkId: string | null = null;
      if (linkUrl) {
        /* Our own redirect URL carries the link token; Resend's
           tracked URL wraps it, so match by containment. A click we
           cannot tie to a stored link is not recorded — no guessing. */
        const links = await db
          .select()
          .from(emailCampaignLinksTable)
          .where(eq(emailCampaignLinksTable.deliveryId, delivery.id));
        const hit = links.find((l) => linkUrl.includes(l.token) || linkUrl === l.targetUrl);
        if (hit) linkId = hit.id;
        else {
          res.json({ received: true, matched: true, recorded: false });
          return;
        }
      }
      await recordEngagement({
        deliveryId: delivery.id,
        campaignId: delivery.campaignId,
        subscriberId: delivery.subscriberId,
        listId: campaignRow.listId,
        kind: "click",
        linkId,
        source: "resend_webhook",
        providerEventId: msgId,
      });
    } else if (type === "email.bounced") {
      await recordEngagement({
        deliveryId: delivery.id,
        campaignId: delivery.campaignId,
        subscriberId: delivery.subscriberId,
        listId: campaignRow.listId,
        kind: "bounce",
        source: "resend_webhook",
        providerEventId: msgId,
      });
      await db
        .update(emailCampaignDeliveriesTable)
        .set({ status: "bounced" })
        .where(eq(emailCampaignDeliveriesTable.id, delivery.id));
    } else if (type === "email.complained") {
      await recordEngagement({
        deliveryId: delivery.id,
        campaignId: delivery.campaignId,
        subscriberId: delivery.subscriberId,
        listId: campaignRow.listId,
        kind: "complaint",
        source: "resend_webhook",
        providerEventId: msgId,
      });
      await db
        .update(emailCampaignDeliveriesTable)
        .set({ status: "complained" })
        .where(eq(emailCampaignDeliveriesTable.id, delivery.id));
      /* A complaint suppresses the address, same as an unsubscribe. */
      await db
        .update(emailSubscribersTable)
        .set({ unsubscribedAt: new Date() })
        .where(and(eq(emailSubscribersTable.id, delivery.subscriberId), isNull(emailSubscribersTable.unsubscribedAt)));
    }
    res.json({ received: true, matched: true });
  } catch (err) {
    logger.error({ err }, "[resend-webhook] processing failed");
    res.status(500).json({ error: "processing_failed" });
  }
}
