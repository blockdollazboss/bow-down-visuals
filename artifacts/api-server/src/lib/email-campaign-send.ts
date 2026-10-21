/**
 * Campaign dispatch (migration 0188).
 *
 * Until this lane, an email_campaigns row was a record that never
 * sent: no code path moved a queued campaign to a single inbox. The
 * dispatch below is the send step of the EXISTING campaign rail (not
 * a second sender): it resolves the campaign's audience — the whole
 * list, or the campaign's segment through lib/email-segments so the
 * audience a creator previewed is the audience that sends — creates
 * one delivery row per recipient, and sends each through the house
 * Resend helper (lib/email.ts) with the tracking instrumentation
 * from lib/email-tracking.ts.
 *
 * Automations (migration 0197) ride the same rail one recipient at
 * a time through sendCampaignDelivery below — an automation's
 * carrier campaign holds its deliveries so the tracking pixel, the
 * click redirect, the unsubscribe flow, and the Resend webhook all
 * resolve exactly like a newsletter send. A carrier is never a
 * newsletter: dispatchCampaign refuses it outright; the automation
 * runner (lib/email-automations.ts) is its only sender.
 *
 * Honesty rules:
 *   - Unsubscribed subscribers are never in an audience (the segment
 *     evaluator excludes them; the whole-list path filters the same
 *     way). Suppression is absolute.
 *   - No provider configured → deliveries are recorded as
 *     'no_provider', the campaign lands 'failed', and the caller gets
 *     reason 'no_provider'. Nothing is ever marked sent that wasn't.
 *   - A re-dispatch is resumable: deliveries already 'sent' are
 *     skipped, so a crashed send retried later never double-emails.
 */
import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  emailCampaignDeliveriesTable,
  emailCampaignLinksTable,
  emailCampaignsTable,
  emailListsTable,
  emailSegmentsTable,
  emailSubscribersTable,
} from "@workspace/db";
import { isEmailConfigured, sendEmail, baseUrlForEmail } from "./email";
import { extractBodyLinks, newTrackingToken, renderTrackedCampaignHtml } from "./email-tracking";
import { evaluateSegment, parseStoredCriteria } from "./email-segments";
import { logger } from "./logger";

export interface DispatchResult {
  ok: boolean;
  reason?: string;
  audience: number;
  sent: number;
  failed: number;
}

async function failCampaign(campaignId: string, reason: string): Promise<DispatchResult> {
  await db
    .update(emailCampaignsTable)
    .set({ status: "failed" })
    .where(eq(emailCampaignsTable.id, campaignId));
  return { ok: false, reason, audience: 0, sent: 0, failed: 0 };
}

/* ── One-recipient send (shared by dispatch + the automation runner) ── */

/** Per-campaign send context, computed once per dispatch/run: whether
 *  the provider can take sends at all, the body's distinct links (to
 *  wrap per delivery), and the public base the tracking URLs hang
 *  off. */
export interface PreparedSend {
  providerReady: boolean;
  bodyLinks: string[];
  base: string;
}

export function prepareCampaignSend(campaign: { body: string }): PreparedSend {
  return {
    providerReady: isEmailConfigured(),
    bodyLinks: extractBodyLinks(campaign.body),
    base: baseUrlForEmail().replace(/\/$/, ""),
  };
}

export type DeliveryOutcome = "sent" | "failed" | "no_provider" | "already_sent" | "raced";

/**
 * Send ONE campaign to ONE subscriber through the tracked rail:
 * find-or-create the (campaign, subscriber) delivery, wrap its links,
 * render the tracked HTML, send, and record the honest outcome on
 * the delivery row. `already_sent` means a previous pass delivered
 * it — the caller counts it as sent without re-emailing. `raced`
 * means a concurrent insert claimed the delivery first; nothing was
 * sent by this call.
 */
export async function sendCampaignDelivery(
  campaign: { id: string; subject: string; body: string },
  sub: { id: string; email: string },
  prep: PreparedSend,
): Promise<{ outcome: DeliveryOutcome; deliveryId: string | null }> {
  let [delivery] = await db
    .select()
    .from(emailCampaignDeliveriesTable)
    .where(
      and(
        eq(emailCampaignDeliveriesTable.campaignId, campaign.id),
        eq(emailCampaignDeliveriesTable.subscriberId, sub.id),
      ),
    )
    .limit(1);
  if (!delivery) {
    [delivery] = await db
      .insert(emailCampaignDeliveriesTable)
      .values({
        campaignId: campaign.id,
        subscriberId: sub.id,
        email: sub.email,
        status: "queued",
        token: newTrackingToken(),
      })
      .onConflictDoNothing()
      .returning();
    if (!delivery) return { outcome: "raced", deliveryId: null }; /* raced insert — the other row owns it */
  }
  if (delivery.status === "sent") {
    return { outcome: "already_sent", deliveryId: delivery.id };
  }
  if (!prep.providerReady) {
    await db
      .update(emailCampaignDeliveriesTable)
      .set({ status: "no_provider" })
      .where(eq(emailCampaignDeliveriesTable.id, delivery.id));
    return { outcome: "no_provider", deliveryId: delivery.id };
  }

  /* Wrap this delivery's links (rows first, then render). */
  const wrapped = new Map<string, string>();
  for (const url of prep.bodyLinks) {
    let [link] = await db
      .select()
      .from(emailCampaignLinksTable)
      .where(
        and(
          eq(emailCampaignLinksTable.deliveryId, delivery.id),
          eq(emailCampaignLinksTable.targetUrl, url),
        ),
      )
      .limit(1);
    if (!link) {
      [link] = await db
        .insert(emailCampaignLinksTable)
        .values({ deliveryId: delivery.id, targetUrl: url, token: newTrackingToken() })
        .onConflictDoNothing()
        .returning();
    }
    if (link) wrapped.set(url, `${prep.base}/api/email-track/c/${link.token}`);
  }

  const html = renderTrackedCampaignHtml({ body: campaign.body, deliveryToken: delivery.token, wrappedLinks: wrapped, baseUrl: prep.base });
  const result = await sendEmail({
    to: sub.email,
    subject: campaign.subject,
    html,
    tags: [
      { name: "campaign_id", value: campaign.id },
      { name: "subscriber_id", value: sub.id },
    ],
  });
  if (result.sent) {
    await db
      .update(emailCampaignDeliveriesTable)
      .set({ status: "sent", providerMessageId: result.id ?? null, sentAt: new Date() })
      .where(eq(emailCampaignDeliveriesTable.id, delivery.id));
    return { outcome: "sent", deliveryId: delivery.id };
  }
  await db
    .update(emailCampaignDeliveriesTable)
    .set({ status: "failed" })
    .where(eq(emailCampaignDeliveriesTable.id, delivery.id));
  logger.warn({ campaignId: campaign.id, reason: result.reason }, "[email-campaign] delivery failed");
  return { outcome: "failed", deliveryId: delivery.id };
}

export async function dispatchCampaign(campaignId: string): Promise<DispatchResult> {
  const [campaign] = await db
    .select()
    .from(emailCampaignsTable)
    .where(eq(emailCampaignsTable.id, campaignId))
    .limit(1);
  if (!campaign) return { ok: false, reason: "not_found", audience: 0, sent: 0, failed: 0 };
  /* Automation carriers are not newsletters — the automation runner
     is their only sender (lib/email-automations.ts). */
  if (campaign.automationId) {
    return { ok: false, reason: "automation_carrier", audience: 0, sent: 0, failed: 0 };
  }
  if (campaign.status !== "queued" && campaign.status !== "sending") {
    return { ok: false, reason: `not_dispatchable:${campaign.status}`, audience: 0, sent: 0, failed: 0 };
  }
  const [list] = await db
    .select()
    .from(emailListsTable)
    .where(eq(emailListsTable.id, campaign.listId))
    .limit(1);
  if (!list) return failCampaign(campaignId, "list_missing");

  await db
    .update(emailCampaignsTable)
    .set({ status: "sending" })
    .where(eq(emailCampaignsTable.id, campaignId));

  /* ── Audience ──────────────────────────────────────────────────── */
  let audience;
  if (campaign.segmentId) {
    const [segment] = await db
      .select()
      .from(emailSegmentsTable)
      .where(and(eq(emailSegmentsTable.id, campaign.segmentId), eq(emailSegmentsTable.listId, list.id)))
      .limit(1);
    if (!segment) return failCampaign(campaignId, "segment_missing");
    audience = await evaluateSegment(list, parseStoredCriteria(segment.criteria));
  } else {
    audience = await db
      .select()
      .from(emailSubscribersTable)
      .where(and(eq(emailSubscribersTable.listId, list.id), isNull(emailSubscribersTable.unsubscribedAt)));
  }

  const prep = prepareCampaignSend(campaign);
  const providerReady = prep.providerReady;
  let sent = 0;
  let failed = 0;

  for (const sub of audience) {
    /* One delivery per (campaign, subscriber); a re-dispatch reuses
       the row and skips anyone already sent. */
    const { outcome } = await sendCampaignDelivery(campaign, sub, prep);
    if (outcome === "sent" || outcome === "already_sent") sent++;
    else if (outcome === "failed" || outcome === "no_provider") failed++;
  }

  const deliveries = await db
    .select({ id: emailCampaignDeliveriesTable.id, status: emailCampaignDeliveriesTable.status })
    .from(emailCampaignDeliveriesTable)
    .where(eq(emailCampaignDeliveriesTable.campaignId, campaign.id));
  const deliveredCount = deliveries.filter((d) => d.status === "sent").length;
  const finalStatus = !providerReady ? "failed" : deliveredCount > 0 ? "sent" : "failed";
  await db
    .update(emailCampaignsTable)
    .set({
      status: finalStatus,
      recipientCount: deliveries.length,
      deliveredCount,
      ...(finalStatus === "sent" ? { sentAt: new Date() } : {}),
    })
    .where(eq(emailCampaignsTable.id, campaign.id));

  if (!providerReady) {
    return { ok: false, reason: "no_provider", audience: audience.length, sent, failed };
  }
  return { ok: finalStatus === "sent", reason: finalStatus === "sent" ? undefined : "all_deliveries_failed", audience: audience.length, sent, failed };
}
