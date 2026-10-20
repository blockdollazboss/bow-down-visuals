/**
 * Email campaign sender — the missing half of the Email List Builder.
 *
 * Until now a "campaign send" was a lie the API permitted: POSTing a
 * campaign inserted one row into email_campaigns and nothing ever sent
 * it (the audit: hidden_files/email-builder-audit.md, Finding 4). This
 * module is the actual sender, built on the staging transactional rail
 * (lib/email.ts → Resend, verified domain, EMAIL_FROM):
 *
 *  - Campaigns: claims `queued` rows (queued → sending → sent/failed —
 *    status is SERVER-OWNED; the route no longer accepts client-set
 *    "sent"), loads the list's ACTIVE subscribers (unsubscribedAt IS
 *    NULL), and sends per-recipient so one bad address fails one send
 *    log row, never the batch. Every attempt lands in
 *    email_campaign_sends with its provider id or honest error.
 *  - Welcome sequence: queueWelcomeSequence() is called by the public
 *    subscribe route for every NEW subscriber and writes one delivery
 *    row per configured step (1: now, 2: +24h, 3: +72h after step 2 —
 *    WELCOME_STEP_DELAYS_HOURS). drainEmailQueue() sends due rows,
 *    templating from the list's stored welcome{,2,3}Subject/Body.
 *  - Every send carries a working one-click unsubscribe link
 *    (/api/email-list/unsubscribe/:token) in the footer AND the
 *    List-Unsubscribe / List-Unsubscribe-Post headers.
 *  - FAIL-CLOSED for campaigns (unlike transactional fail-open): if
 *    Resend is not configured, claimed work is stamped `failed` with
 *    reason "no-provider" — a campaign must never report "sent" for
 *    mail that never left the building.
 *  - Open tracking stays HONEST: nothing here records opens, and the
 *    dashboard's opensTracked: false is untouched. Opens need Resend
 *    webhooks + a pixel — a separate build, not a fabricated stat.
 *
 * Trigger: the job poller (lib/job-poller.ts) calls drainEmailQueue()
 * on its existing tick — no new infrastructure, restart-safe because
 * all state lives in Postgres rows.
 *
 * Caveat for the staging gate: legacy welcome rows the OLD subscribe
 * code inserted as list-wide campaign rows (recipientCount: 1, no
 * recipient stored) are indistinguishable from real campaigns. Clear
 * any stale `queued` campaign rows on staging before this sender's
 * first drain, or they will send to the whole list.
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull, lte } from "drizzle-orm";
import {
  db as defaultDb,
  emailListsTable,
  emailSubscribersTable,
  emailCampaignsTable,
  emailSequenceDeliveriesTable,
  emailCampaignSendsTable,
  WELCOME_STEP_DELAYS_HOURS,
  type EmailList,
  type EmailSubscriber,
  type EmailCampaign,
  type EmailSequenceDelivery,
} from "@workspace/db";
import {
  sendEmail as defaultSendEmail,
  isEmailConfigured as defaultIsEmailConfigured,
  emailShell,
  escapeHtml,
  baseUrlForEmail,
  type SendEmailResult,
} from "./email";
import { logger } from "./logger";

/* ─── Dependency-injection seams (tests stub these; mirrors the
       SchedulerDeps pattern in scheduler-jobs.ts) ─────────────────────── */

export interface EmailSenderDeps {
  /** Claim queued campaigns: queued → sending, atomically per row. */
  claimQueuedCampaigns?: (limit: number) => Promise<EmailCampaign[]>;
  /** Claim due sequence deliveries: queued → sending, atomically per row. */
  claimDueDeliveries?: (limit: number, now: Date) => Promise<EmailSequenceDelivery[]>;
  loadList?: (listId: string) => Promise<EmailList | null>;
  loadActiveSubscribers?: (listId: string) => Promise<EmailSubscriber[]>;
  loadSubscriber?: (subscriberId: string) => Promise<EmailSubscriber | null>;
  recordSend?: (row: {
    campaignId?: string | null;
    deliveryId?: string | null;
    subscriberId?: string | null;
    email: string;
    status: "sent" | "failed";
    providerId?: string | null;
    error?: string | null;
    sentAt?: Date | null;
  }) => Promise<void>;
  updateCampaign?: (id: string, patch: Partial<EmailCampaign>) => Promise<void>;
  updateDelivery?: (id: string, patch: Partial<EmailSequenceDelivery>) => Promise<void>;
  /** Enqueue one sequence-delivery row; must be idempotent per (subscriber, step). */
  insertDelivery?: (row: {
    listId: string;
    subscriberId: string;
    step: number;
    scheduledFor: Date;
  }) => Promise<void>;
  send?: (opts: {
    to: string;
    subject: string;
    html: string;
    text?: string;
    headers?: Record<string, string>;
  }) => Promise<SendEmailResult>;
  isConfigured?: () => boolean;
  now?: () => Date;
  baseUrl?: () => string;
}

const CAMPAIGN_BATCH = 5;
const DELIVERY_BATCH = 25;

/* ─── Pure helpers (unit-tested directly) ──────────────────────────────── */

/** One-click unsubscribe URL for a subscriber (public, token-gated). */
export function unsubscribeUrlFor(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/$/, "")}/api/email-list/unsubscribe/${token}`;
}

export function listUnsubscribeHeaders(unsubscribeUrl: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${unsubscribeUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

/** Plain-text body → branded HTML: escaped paragraphs + unsubscribe footer. */
export function buildEmailHtml(subject: string, bodyText: string, unsubscribeUrl: string): string {
  const paragraphs = bodyText
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(
      (p) =>
        `<p style="margin:0 0 14px;line-height:1.6;">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`,
    )
    .join("");
  const footer =
    `<p style="margin:20px 0 0;font-size:12px;color:#888;">` +
    `Don't want these emails? <a href="${unsubscribeUrl}" style="color:#d4af37;">Unsubscribe</a>` +
    `</p>`;
  return emailShell(subject, paragraphs + footer);
}

/** The stored template for one sequence step, or null if unconfigured. */
export function welcomeStepContent(
  list: Pick<
    EmailList,
    | "welcomeSubject"
    | "welcomeBody"
    | "welcome2Subject"
    | "welcome2Body"
    | "welcome3Subject"
    | "welcome3Body"
  >,
  step: number,
): { subject: string; body: string } | null {
  const byStep: Record<number, { subject: string | null; body: string | null }> = {
    1: { subject: list.welcomeSubject, body: list.welcomeBody },
    2: { subject: list.welcome2Subject, body: list.welcome2Body },
    3: { subject: list.welcome3Subject, body: list.welcome3Body },
  };
  const tpl = byStep[step];
  if (!tpl || !tpl.subject || !tpl.body) return null;
  return { subject: tpl.subject, body: tpl.body };
}

/** Scheduled time for each step, anchored at signup. Step 3 is +72h
    after step 2 per the locked sequence spec (so +96h from signup). */
export function welcomeStepTimes(anchor: Date): Record<number, Date> {
  const times: Record<number, Date> = {};
  let cursor = anchor.getTime();
  for (const step of [1, 2, 3]) {
    cursor += (WELCOME_STEP_DELAYS_HOURS[step] ?? 0) * 3_600_000;
    times[step] = new Date(cursor);
  }
  return times;
}

/** Tokens are server-generated; legacy rows were backfilled in 0181. */
export function ensureUnsubscribeToken(sub: EmailSubscriber): string {
  return sub.unsubscribeToken ?? randomUUID().replace(/-/g, "");
}

/* ─── Default (real DB) deps ───────────────────────────────────────────── */

function defaultDeps(): Required<EmailSenderDeps> {
  const db = defaultDb;
  return {
    claimQueuedCampaigns: async (limit) => {
      const queued = await db
        .select({ id: emailCampaignsTable.id })
        .from(emailCampaignsTable)
        .where(eq(emailCampaignsTable.status, "queued"))
        .orderBy(asc(emailCampaignsTable.createdAt))
        .limit(limit);
      const claimed: EmailCampaign[] = [];
      for (const { id } of queued) {
        const [row] = await db
          .update(emailCampaignsTable)
          .set({ status: "sending" })
          .where(and(eq(emailCampaignsTable.id, id), eq(emailCampaignsTable.status, "queued")))
          .returning();
        if (row) claimed.push(row);
      }
      return claimed;
    },
    claimDueDeliveries: async (limit, now) => {
      const due = await db
        .select({ id: emailSequenceDeliveriesTable.id })
        .from(emailSequenceDeliveriesTable)
        .where(
          and(
            eq(emailSequenceDeliveriesTable.status, "queued"),
            lte(emailSequenceDeliveriesTable.scheduledFor, now),
          ),
        )
        .orderBy(asc(emailSequenceDeliveriesTable.scheduledFor))
        .limit(limit);
      const claimed: EmailSequenceDelivery[] = [];
      for (const { id } of due) {
        const [row] = await db
          .update(emailSequenceDeliveriesTable)
          .set({ status: "sending" })
          .where(
            and(
              eq(emailSequenceDeliveriesTable.id, id),
              eq(emailSequenceDeliveriesTable.status, "queued"),
            ),
          )
          .returning();
        if (row) claimed.push(row);
      }
      return claimed;
    },
    loadList: async (listId) => {
      const [list] = await db
        .select()
        .from(emailListsTable)
        .where(eq(emailListsTable.id, listId))
        .limit(1);
      return list ?? null;
    },
    loadActiveSubscribers: async (listId) =>
      db
        .select()
        .from(emailSubscribersTable)
        .where(
          and(
            eq(emailSubscribersTable.listId, listId),
            isNull(emailSubscribersTable.unsubscribedAt),
          ),
        ),
    loadSubscriber: async (subscriberId) => {
      const [sub] = await db
        .select()
        .from(emailSubscribersTable)
        .where(eq(emailSubscribersTable.id, subscriberId))
        .limit(1);
      return sub ?? null;
    },
    recordSend: async (row) => {
      await db.insert(emailCampaignSendsTable).values(row);
    },
    updateCampaign: async (id, patch) => {
      await db.update(emailCampaignsTable).set(patch).where(eq(emailCampaignsTable.id, id));
    },
    updateDelivery: async (id, patch) => {
      await db
        .update(emailSequenceDeliveriesTable)
        .set(patch)
        .where(eq(emailSequenceDeliveriesTable.id, id));
    },
    insertDelivery: async (row) => {
      await db
        .insert(emailSequenceDeliveriesTable)
        .values({ ...row, status: "queued" })
        .onConflictDoNothing();
    },
    send: (opts) => defaultSendEmail(opts),
    isConfigured: () => defaultIsEmailConfigured(),
    now: () => new Date(),
    baseUrl: () => baseUrlForEmail(),
  };
}

function resolveDeps(deps: EmailSenderDeps): Required<EmailSenderDeps> {
  return { ...defaultDeps(), ...deps } as Required<EmailSenderDeps>;
}

/* ─── Welcome sequence trigger ─────────────────────────────────────────── */

/**
 * Queue the welcome sequence for a NEW subscriber. Only steps with a
 * stored template on the list are queued. Best-effort by contract: the
 * caller (subscribe route) treats a throw as non-fatal to the signup.
 * Returns the steps queued.
 */
export async function queueWelcomeSequence(
  list: EmailList,
  subscriber: EmailSubscriber,
  deps: EmailSenderDeps = {},
): Promise<number[]> {
  const d = resolveDeps(deps);
  const times = welcomeStepTimes(d.now());
  const queued: number[] = [];
  for (const step of [1, 2, 3]) {
    if (!welcomeStepContent(list, step)) continue;
    await d.insertDelivery({
      listId: list.id,
      subscriberId: subscriber.id,
      step,
      scheduledFor: times[step]!,
    });
    queued.push(step);
  }
  return queued;
}

/* ─── Sending ──────────────────────────────────────────────────────────── */

interface SendOutcome {
  delivered: number;
  attempted: number;
}

async function sendToRecipient(
  d: Required<EmailSenderDeps>,
  args: {
    campaignId?: string | null;
    deliveryId?: string | null;
    subscriber: EmailSubscriber;
    subject: string;
    bodyText: string;
  },
): Promise<boolean> {
  const url = unsubscribeUrlFor(d.baseUrl(), ensureUnsubscribeToken(args.subscriber));
  const result = await d.send({
    to: args.subscriber.email,
    subject: args.subject,
    html: buildEmailHtml(args.subject, args.bodyText, url),
    text: `${args.bodyText}\n\nUnsubscribe: ${url}`,
    headers: listUnsubscribeHeaders(url),
  });
  await d.recordSend({
    campaignId: args.campaignId ?? null,
    deliveryId: args.deliveryId ?? null,
    subscriberId: args.subscriber.id,
    email: args.subscriber.email,
    status: result.sent ? "sent" : "failed",
    providerId: result.id ?? null,
    error: result.sent ? null : (result.reason ?? "send-failed"),
    sentAt: result.sent ? d.now() : null,
  });
  return result.sent;
}

async function sendOneCampaign(
  d: Required<EmailSenderDeps>,
  campaign: EmailCampaign,
): Promise<SendOutcome> {
  if (!d.isConfigured()) {
    await d.updateCampaign(campaign.id, { status: "failed" });
    logger.warn({ campaignId: campaign.id }, "[email-sender] campaign failed: no provider configured");
    return { delivered: 0, attempted: 0 };
  }
  const subscribers = await d.loadActiveSubscribers(campaign.listId);
  let delivered = 0;
  for (const sub of subscribers) {
    try {
      if (await sendToRecipient(d, { campaignId: campaign.id, subscriber: sub, subject: campaign.subject, bodyText: campaign.body })) {
        delivered += 1;
      }
    } catch (err) {
      /* Per-recipient isolation: log the failure, keep the batch moving. */
      logger.warn({ err, campaignId: campaign.id, subscriberId: sub.id }, "[email-sender] recipient send threw; continuing batch");
      await d
        .recordSend({
          campaignId: campaign.id,
          subscriberId: sub.id,
          email: sub.email,
          status: "failed",
          error: err instanceof Error ? err.message : "exception",
        })
        .catch(() => undefined);
    }
  }
  const attempted = subscribers.length;
  if (attempted > 0 && delivered === 0) {
    await d.updateCampaign(campaign.id, { status: "failed", recipientCount: 0 });
  } else {
    await d.updateCampaign(campaign.id, {
      status: "sent",
      sentAt: d.now(),
      recipientCount: delivered,
    });
  }
  return { delivered, attempted };
}

async function sendOneDelivery(
  d: Required<EmailSenderDeps>,
  delivery: EmailSequenceDelivery,
): Promise<void> {
  const [list, subscriber] = await Promise.all([
    d.loadList(delivery.listId),
    d.loadSubscriber(delivery.subscriberId),
  ]);
  if (!list || !subscriber || subscriber.unsubscribedAt) {
    await d.updateDelivery(delivery.id, {
      status: "skipped",
      error: !list ? "list-gone" : !subscriber ? "subscriber-gone" : "unsubscribed",
    });
    return;
  }
  const tpl = welcomeStepContent(list, delivery.step);
  if (!tpl) {
    await d.updateDelivery(delivery.id, { status: "skipped", error: "no-template" });
    return;
  }
  if (!d.isConfigured()) {
    await d.updateDelivery(delivery.id, { status: "failed", error: "no-provider" });
    return;
  }
  const body = `Hi${subscriber.name ? ` ${subscriber.name}` : ""},\n\n${tpl.body}`;
  const ok = await sendToRecipient(d, {
    deliveryId: delivery.id,
    subscriber,
    subject: tpl.subject,
    bodyText: body,
  });
  await d.updateDelivery(delivery.id, {
    status: ok ? "sent" : "failed",
    sentAt: ok ? d.now() : null,
    error: ok ? null : "send-failed",
  });
}

/**
 * One drain pass: queued campaigns first, then due welcome deliveries.
 * Called by the job poller tick; safe to call any time (claims are
 * conditional updates, so overlapping passes can't double-send).
 */
export async function drainEmailQueue(
  deps: EmailSenderDeps = {},
): Promise<{ campaigns: SendOutcome; deliveries: number }> {
  const d = resolveDeps(deps);
  const campaigns = await d.claimQueuedCampaigns(CAMPAIGN_BATCH);
  let deliveredTotal = 0;
  let attemptedTotal = 0;
  for (const campaign of campaigns) {
    const outcome = await sendOneCampaign(d, campaign);
    deliveredTotal += outcome.delivered;
    attemptedTotal += outcome.attempted;
  }
  const deliveries = await d.claimDueDeliveries(DELIVERY_BATCH, d.now());
  for (const delivery of deliveries) {
    try {
      await sendOneDelivery(d, delivery);
    } catch (err) {
      logger.warn({ err, deliveryId: delivery.id }, "[email-sender] delivery threw; continuing");
      await d
        .updateDelivery(delivery.id, { status: "failed", error: "exception" })
        .catch(() => undefined);
    }
  }
  if (campaigns.length || deliveries.length) {
    logger.info(
      { campaigns: campaigns.length, deliveries: deliveries.length },
      "[email-sender] drain pass complete",
    );
  }
  return {
    campaigns: { delivered: deliveredTotal, attempted: attemptedTotal },
    deliveries: deliveries.length,
  };
}

export const __testHooks = { sendOneCampaign, sendOneDelivery };
