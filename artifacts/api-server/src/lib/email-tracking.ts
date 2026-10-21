/**
 * Email engagement tracking (migration 0188).
 *
 * The signal path, end to end:
 *   1. Campaign sends render through renderTrackedCampaignHtml below:
 *      every http(s) link in the body is wrapped in a house redirect
 *      (/api/email-track/c/:linkToken) whose target URL is stored on
 *      the email_campaign_links row — the request never carries a
 *      destination, so the redirect can never be an open redirect —
 *      and a 1×1 pixel (/api/email-track/o/:deliveryToken.gif) rides
 *      at the bottom of the HTML.
 *   2. The pixel and the redirect record into email_engagement_events
 *      via recordEngagement. The signature-verified Resend webhook
 *      (lib/resend-webhook.ts) feeds the SAME recorder for the opens
 *      and clicks it observes, plus bounces and complaints.
 *   3. First signal wins: the events table's unique indexes make a
 *      second open (or a second click on the same link) for one
 *      delivery a no-op insert, whichever source reports first — an
 *      open is counted exactly once per delivered email. The recorder
 *      maintains the counters on email_subscribers (opens/clicks) and
 *      email_campaigns (open_count/click_count) only when its insert
 *      actually landed.
 *
 * Tracking is disclosed in the email-list UI footer and in every sent
 * email's footer (the unsubscribe line sits next to it).
 */
import { randomUUID } from "crypto";
import { eq, sql } from "drizzle-orm";
import {
  db,
  emailCampaignsTable,
  emailEngagementEventsTable,
  emailSubscribersTable,
} from "@workspace/db";
import { baseUrlForEmail, escapeHtml } from "./email";
import { logger } from "./logger";

export type EngagementKind = "open" | "click" | "bounce" | "complaint";
export type EngagementSource = "pixel" | "redirect" | "resend_webhook";

export interface EngagementInput {
  deliveryId: string;
  campaignId: string;
  subscriberId: string;
  listId: string;
  kind: EngagementKind;
  linkId?: string | null;
  source: EngagementSource;
  providerEventId?: string | null;
}

/**
 * Record one engagement signal. Returns { recorded: true } only when
 * this call was the first signal of its kind for the delivery (and
 * therefore moved the counters); duplicates from any source return
 * { recorded: false } and change nothing.
 */
export async function recordEngagement(input: EngagementInput): Promise<{ recorded: boolean }> {
  let inserted: Array<{ id: string }> = [];
  try {
    inserted = await db
      .insert(emailEngagementEventsTable)
      .values({
        deliveryId: input.deliveryId,
        campaignId: input.campaignId,
        subscriberId: input.subscriberId,
        listId: input.listId,
        kind: input.kind,
        linkId: input.linkId ?? null,
        source: input.source,
        providerEventId: input.providerEventId ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: emailEngagementEventsTable.id });
  } catch (err) {
    /* A unique violation that slips past ON CONFLICT (e.g. the
       provider-event index racing the delivery-kind index) is still
       just a duplicate signal — never an error worth surfacing. */
    logger.warn({ err, kind: input.kind, deliveryId: input.deliveryId }, "[email-tracking] duplicate engagement signal ignored");
    return { recorded: false };
  }
  if (inserted.length === 0) return { recorded: false };

  if (input.kind === "open") {
    await db
      .update(emailSubscribersTable)
      .set({ opens: sql`${emailSubscribersTable.opens} + 1` })
      .where(eq(emailSubscribersTable.id, input.subscriberId));
    await db
      .update(emailCampaignsTable)
      .set({ openCount: sql`${emailCampaignsTable.openCount} + 1` })
      .where(eq(emailCampaignsTable.id, input.campaignId));
  } else if (input.kind === "click") {
    await db
      .update(emailSubscribersTable)
      .set({ clicks: sql`${emailSubscribersTable.clicks} + 1` })
      .where(eq(emailSubscribersTable.id, input.subscriberId));
    await db
      .update(emailCampaignsTable)
      .set({ clickCount: sql`${emailCampaignsTable.clickCount} + 1` })
      .where(eq(emailCampaignsTable.id, input.campaignId));
  }
  return { recorded: true };
}

/* ─── Tracked HTML rendering ──────────────────────────────────────────── */

const URL_RE = /https?:\/\/[^\s<>"')\]]+/g;

/** Distinct http(s) URLs in a plain-text campaign body, in order. */
export function extractBodyLinks(body: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of body.matchAll(URL_RE)) {
    /* Trailing sentence punctuation is not part of the link. */
    const url = m[0].replace(/[.,;:!?]+$/, "");
    if (!seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
  }
  return out;
}

export function newTrackingToken(): string {
  return randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
}

export interface TrackedHtmlOpts {
  body: string;
  deliveryToken: string;
  /** Map of target URL → wrapped tracking URL for this delivery. */
  wrappedLinks: Map<string, string>;
  baseUrl?: string;
}

/**
 * Render a campaign body (plain text) to the HTML that actually sends:
 * paragraphs preserved, links wrapped, tracking pixel + an honest
 * footer (one-click unsubscribe + tracking disclosure) appended.
 */
export function renderTrackedCampaignHtml(opts: TrackedHtmlOpts): string {
  const base = (opts.baseUrl ?? baseUrlForEmail()).replace(/\/$/, "");
  const escaped = escapeHtml(opts.body);
  const linked = escaped.replace(URL_RE, (raw) => {
    const url = raw.replace(/[.,;:!?]+$/, "");
    const tail = raw.slice(url.length);
    /* The map is keyed by the raw body URL; the text here is escaped,
       so look up the unescaped form as well (& → &amp;). */
    const wrapped = opts.wrappedLinks.get(url.replace(/&amp;/g, "&")) ?? opts.wrappedLinks.get(url);
    if (!wrapped) return raw;
    return `<a href="${escapeHtml(wrapped)}" style="color:#d4af37;">${url}</a>${tail}`;
  });
  const paragraphs = linked
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;line-height:1.55;">${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
  const unsubUrl = `${base}/api/email-track/u/${opts.deliveryToken}`;
  const pixelUrl = `${base}/api/email-track/o/${opts.deliveryToken}.gif`;
  return (
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#eee;">` +
    paragraphs +
    `<div style="margin-top:28px;padding-top:16px;border-top:1px solid #2a2a2a;font-size:12px;color:#888;line-height:1.5;">` +
    `You're getting this because you subscribed to this creator's email list on Bow Down Visuals. ` +
    `<a href="${unsubUrl}" style="color:#d4af37;">Unsubscribe in one click</a> — you'll never be emailed again. ` +
    `Opens and link clicks on this email are tracked so the creator can see what lands.` +
    `</div>` +
    `<img src="${pixelUrl}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;" />` +
    `</div>`
  );
}

/** 1×1 transparent GIF for the tracking pixel response. */
export const TRACKING_PIXEL_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);
