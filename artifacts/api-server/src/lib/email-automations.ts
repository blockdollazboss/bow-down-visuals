/**
 * Email automations (migration 0198).
 *
 * Three starter sequences on the tracked email rail (0189): a
 * post-purchase thank-you, an abandoned-checkout nudge, and a
 * membership winback. One email_automations row per (list, kind),
 * materialized lazily with enabled = FALSE — nothing ever sends for
 * a creator who hasn't switched an automation on.
 *
 * Sends ride the EXISTING dispatch machinery (lib/email-campaign-send):
 * each individual email gets its own carrier email_campaigns row
 * (automation_id set), because deliveries are unique per (campaign,
 * subscriber) and every physical email needs its own delivery row —
 * its token is what the tracking pixel, click redirect, one-click
 * unsubscribe, and the Resend webhook all resolve through. Carrier
 * campaigns are not newsletters: history filters them out and manual
 * dispatch refuses them.
 *
 * Trigger sources are rows the house already keeps — never invented:
 *   post_purchase       shop_events 'sale' rows that are confirmed
 *                       paid (paid_at set, or payment_status paid /
 *                       no_payment_required — legacy pre-0144 click
 *                       rows have neither and never fire), grouped
 *                       per checkout so a multi-line order earns ONE
 *                       thank-you; plus digital_sales rows still
 *                       'completed', buyer email resolved through
 *                       the auth rail (getUserEmail, the same lookup
 *                       Stripe Connect uses).
 *   abandoned_checkout  shop_events 'pending_sale' rows whose
 *                       checkout group / Stripe session never flipped
 *                       to 'sale'. Only the shop card checkout
 *                       writes pending rows (migration 0144), so
 *                       checkouts started anywhere else are invisible
 *                       to this trigger — the UI copy says exactly
 *                       that. Pending rows without a buyer email are
 *                       not actionable (no address was collected).
 *   membership_winback  fan_members rows in canceled / expired.
 *                       Address from fan_user_id via the auth rail,
 *                       or the fan_label when the creator recorded
 *                       an email address there.
 *
 * Laws:
 *   - enabled_at gate: a trigger older than the moment the creator
 *     switched the automation on never fires — enabling an
 *     automation doesn't spam fans about the past. Toggling back on
 *     re-arms the gate at the new switch-on time.
 *   - Dedupe: email_automation_sends' unique (automation, trigger
 *     ref) index is the law — a purchase / checkout / lapse can
 *     email a fan exactly once, however often the sweeper runs.
 *   - Unsubscribe suppression is absolute: subscribers are matched
 *     per list, an unsubscribed address records a
 *     'skipped_unsubscribed' claim instead of a send, and the
 *     subscriber row is re-read immediately before sending.
 *   - A trigger whose address is not a subscriber of the list is
 *     not actionable: no claim row, no send — automations only ever
 *     email the creator's own list, exactly like a campaign.
 *   - Honest outcomes: a send with no provider records
 *     'no_provider' — never a fake 'sent'. The claim stands (the
 *     rail's record-and-stop law, same as a failed campaign), and
 *     the status is visible in the creator's automation stats.
 */
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  creatorProfilesTable,
  digitalSalesTable,
  emailAutomationSendsTable,
  emailAutomationsTable,
  emailCampaignsTable,
  emailListsTable,
  emailSubscribersTable,
  fanMembersTable,
  shopEventsTable,
  shopsTable,
  EMAIL_AUTOMATION_KINDS,
  type EmailAutomation,
  type EmailAutomationKind,
  type EmailCampaign,
  type EmailList,
} from "@workspace/db";
import { prepareCampaignSend, sendCampaignDelivery } from "./email-campaign-send";
import { getUserEmail } from "./stripe-connect";
import { logger } from "./logger";
import {
  automationCopyFor,
  type AutomationDefaultCopy,
  type AutomationLocale,
} from "./email-automation-i18n";

/* ── Defaults + honest trigger copy ───────────────────────────────────
   The English literals live in lib/email-automation-i18n (the en
   entry of the per-locale catalog) so there is exactly one source;
   these re-exports keep the long-standing import surface. Seeding
   and DTO rendering resolve through the catalog per locale — an
   automation's STORED subject/body is the creator's own copy and
   is never rewritten by locale. */

export type { AutomationDefaultCopy };

const EN_COPY = automationCopyFor("en");

export const AUTOMATION_DEFAULTS: Record<EmailAutomationKind, AutomationDefaultCopy> =
  EN_COPY.defaults;

/** Plain-language statement of what fires each automation — including
 *  its blind spots. Rendered verbatim in the UI; never overclaim. */
export const AUTOMATION_TRIGGER_NOTES: Record<EmailAutomationKind, string> =
  EN_COPY.triggerNotes;

export const AUTOMATION_LABELS: Record<EmailAutomationKind, string> = EN_COPY.labels;

/* ── Provisioning ───────────────────────────────────────────────────── */

/** Lazily materialize the three starter automations for a list
 *  (defaults in, enabled FALSE) and return them in kind order.
 *  Idempotent — safe on every read. A list provisioned for the
 *  first time seeds its starter copy in the given locale; rows
 *  that already exist are the creator's data and are never
 *  rewritten — locale only shapes NEW rows. */
export async function ensureAutomationsForList(
  list: EmailList,
  locale: AutomationLocale = "en",
): Promise<EmailAutomation[]> {
  const defaults = automationCopyFor(locale).defaults;
  for (const kind of EMAIL_AUTOMATION_KINDS) {
    const kindDefaults = defaults[kind];
    await db
      .insert(emailAutomationsTable)
      .values({
        listId: list.id,
        kind,
        enabled: false,
        subject: kindDefaults.subject,
        body: kindDefaults.body,
        delayHours: kindDefaults.delayHours,
      })
      .onConflictDoNothing();
  }
  const rows = await db
    .select()
    .from(emailAutomationsTable)
    .where(eq(emailAutomationsTable.listId, list.id));
  const order = new Map(EMAIL_AUTOMATION_KINDS.map((k, i) => [k, i]));
  return rows.sort((a, b) => (order.get(a.kind) ?? 99) - (order.get(b.kind) ?? 99));
}

/* ── Stats (measured only) ──────────────────────────────────────────── */

export interface AutomationStats {
  sent: number;
  failed: number;
  noProvider: number;
  skippedUnsubscribed: number;
  delivered: number;
  opens: number;
  clicks: number;
}

/** Counts from the send ledger + the measured engagement counters on
 *  this automation's carrier campaigns. Zeros here are measured
 *  zeros (nothing sent yet), never placeholders. */
export async function automationStats(automationId: string): Promise<AutomationStats> {
  const sends = await db
    .select({ status: emailAutomationSendsTable.status })
    .from(emailAutomationSendsTable)
    .where(eq(emailAutomationSendsTable.automationId, automationId));
  const carriers = await db
    .select({
      deliveredCount: emailCampaignsTable.deliveredCount,
      openCount: emailCampaignsTable.openCount,
      clickCount: emailCampaignsTable.clickCount,
    })
    .from(emailCampaignsTable)
    .where(eq(emailCampaignsTable.automationId, automationId));
  return {
    sent: sends.filter((s) => s.status === "sent").length,
    failed: sends.filter((s) => s.status === "failed").length,
    noProvider: sends.filter((s) => s.status === "no_provider").length,
    skippedUnsubscribed: sends.filter((s) => s.status === "skipped_unsubscribed").length,
    delivered: carriers.reduce((n, c) => n + (c.deliveredCount ?? 0), 0),
    opens: carriers.reduce((n, c) => n + (c.openCount ?? 0), 0),
    clicks: carriers.reduce((n, c) => n + (c.clickCount ?? 0), 0),
  };
}

export interface AutomationDto extends AutomationStats {
  id: string;
  kind: EmailAutomationKind;
  label: string;
  triggerNote: string;
  enabled: boolean;
  subject: string;
  body: string;
  delayHours: number;
  enabledAt: string | null;
  lastRunAt: string | null;
}

/** The DTO's label + trigger note render in the caller's locale;
 *  subject/body are the row's stored copy, returned untouched. */
export async function automationDto(
  automation: EmailAutomation,
  locale: AutomationLocale = "en",
): Promise<AutomationDto> {
  const stats = await automationStats(automation.id);
  const copy = automationCopyFor(locale);
  return {
    id: automation.id,
    kind: automation.kind,
    label: copy.labels[automation.kind],
    triggerNote: copy.triggerNotes[automation.kind],
    enabled: automation.enabled,
    subject: automation.subject,
    body: automation.body,
    delayHours: automation.delayHours,
    enabledAt: automation.enabledAt ? automation.enabledAt.toISOString() : null,
    lastRunAt: automation.lastRunAt ? automation.lastRunAt.toISOString() : null,
    ...stats,
  };
}

/* ── Trigger collection ─────────────────────────────────────────────── */

export interface AutomationTrigger {
  /** Dedupe key (stored on the claim row). */
  ref: string;
  /** Lowercased recipient address. */
  email: string;
  /** When the triggering thing happened. */
  eventAt: Date;
}

export interface AutomationDeps {
  now: () => Date;
  resolveUserEmail: (userId: string) => Promise<string | null>;
}

const DEFAULT_DEPS: AutomationDeps = { now: () => new Date(), resolveUserEmail: getUserEmail };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const lower = (e: string) => e.trim().toLowerCase();

/** Shop sales, one trigger per checkout: a multi-line order is one
 *  purchase. Only confirmed-paid rows count (see header). */
async function collectShopSaleTriggers(ownerUserId: string): Promise<AutomationTrigger[]> {
  const shops = await db.select().from(shopsTable).where(eq(shopsTable.user_id, ownerUserId));
  if (shops.length === 0) return [];
  const events = await db
    .select()
    .from(shopEventsTable)
    .where(
      and(
        inArray(shopEventsTable.shop_id, shops.map((s) => s.id)),
        eq(shopEventsTable.event_type, "sale"),
      ),
    );
  const groups = new Map<string, { email: string | null; eventAt: Date }>();
  for (const ev of events) {
    if (!(ev.paid_at != null || ev.payment_status === "paid" || ev.payment_status === "no_payment_required")) {
      continue; /* not confirmed paid — legacy click rows and unpaid flips never fire */
    }
    const key = ev.checkout_group_id ?? ev.stripe_session_id ?? ev.id;
    const at = ev.created_at ? new Date(ev.created_at) : new Date(0);
    const cur = groups.get(key);
    if (!cur) {
      groups.set(key, { email: ev.buyer_email ? lower(ev.buyer_email) : null, eventAt: at });
    } else {
      if (!cur.email && ev.buyer_email) cur.email = lower(ev.buyer_email);
      if (at < cur.eventAt) cur.eventAt = at;
    }
  }
  return [...groups.entries()]
    .filter(([, g]) => g.email != null)
    .map(([key, g]) => ({ ref: `shop_checkout:${key}`, email: g.email!, eventAt: g.eventAt }));
}

/** Paid downloads: digital_sales still 'completed', scoped to the
 *  creator's own profiles; the buyer's address comes from the auth
 *  rail — an unresolvable buyer is simply not actionable. */
async function collectDigitalSaleTriggers(
  ownerUserId: string,
  deps: AutomationDeps,
): Promise<AutomationTrigger[]> {
  const profiles = await db
    .select()
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.userId, ownerUserId));
  if (profiles.length === 0) return [];
  const sales = await db
    .select()
    .from(digitalSalesTable)
    .where(
      and(
        inArray(digitalSalesTable.profileId, profiles.map((p) => p.id)),
        eq(digitalSalesTable.status, "completed"),
      ),
    );
  const out: AutomationTrigger[] = [];
  const emailByUser = new Map<string, string | null>();
  for (const sale of sales) {
    if (!emailByUser.has(sale.buyerUserId)) {
      const resolved = await deps.resolveUserEmail(sale.buyerUserId);
      emailByUser.set(sale.buyerUserId, resolved ? lower(resolved) : null);
    }
    const email = emailByUser.get(sale.buyerUserId);
    if (!email) continue;
    out.push({
      ref: `digital_sale:${sale.id}`,
      email,
      eventAt: sale.createdAt ? new Date(sale.createdAt) : new Date(0),
    });
  }
  return out;
}

/** Pending shop checkouts that never paid. A group counts as paid
 *  when any 'sale' row shares its checkout group or Stripe session. */
async function collectAbandonedTriggers(ownerUserId: string): Promise<AutomationTrigger[]> {
  const shops = await db.select().from(shopsTable).where(eq(shopsTable.user_id, ownerUserId));
  if (shops.length === 0) return [];
  const shopIds = shops.map((s) => s.id);
  const [pendings, sales] = await Promise.all([
    db
      .select()
      .from(shopEventsTable)
      .where(and(inArray(shopEventsTable.shop_id, shopIds), eq(shopEventsTable.event_type, "pending_sale"))),
    db
      .select()
      .from(shopEventsTable)
      .where(and(inArray(shopEventsTable.shop_id, shopIds), eq(shopEventsTable.event_type, "sale"))),
  ]);
  const paidGroups = new Set(sales.map((s) => s.checkout_group_id).filter(Boolean) as string[]);
  const paidSessions = new Set(sales.map((s) => s.stripe_session_id).filter(Boolean) as string[]);
  const groups = new Map<string, { email: string | null; eventAt: Date; paid: boolean }>();
  for (const ev of pendings) {
    const key = ev.checkout_group_id ?? ev.stripe_session_id ?? ev.id;
    const paid =
      (ev.checkout_group_id != null && paidGroups.has(ev.checkout_group_id)) ||
      (ev.stripe_session_id != null && paidSessions.has(ev.stripe_session_id));
    const at = ev.created_at ? new Date(ev.created_at) : new Date(0);
    const cur = groups.get(key);
    if (!cur) {
      groups.set(key, { email: ev.buyer_email ? lower(ev.buyer_email) : null, eventAt: at, paid });
    } else {
      if (!cur.email && ev.buyer_email) cur.email = lower(ev.buyer_email);
      if (at < cur.eventAt) cur.eventAt = at;
      cur.paid = cur.paid || paid;
    }
  }
  return [...groups.entries()]
    .filter(([, g]) => !g.paid && g.email != null)
    .map(([key, g]) => ({ ref: `checkout:${key}`, email: g.email!, eventAt: g.eventAt }));
}

/** Lapsed memberships (canceled / expired) owned by the creator. */
async function collectWinbackTriggers(
  ownerUserId: string,
  deps: AutomationDeps,
): Promise<AutomationTrigger[]> {
  const members = await db
    .select()
    .from(fanMembersTable)
    .where(and(eq(fanMembersTable.user_id, ownerUserId), inArray(fanMembersTable.status, ["canceled", "expired"])));
  const out: AutomationTrigger[] = [];
  const emailByUser = new Map<string, string | null>();
  for (const m of members) {
    let email: string | null = null;
    if (m.fan_user_id) {
      if (!emailByUser.has(m.fan_user_id)) {
        const resolved = await deps.resolveUserEmail(m.fan_user_id);
        emailByUser.set(m.fan_user_id, resolved ? lower(resolved) : null);
      }
      email = emailByUser.get(m.fan_user_id) ?? null;
    }
    if (!email && m.fan_label && EMAIL_RE.test(m.fan_label.trim())) {
      email = lower(m.fan_label);
    }
    if (!email) continue;
    const eventAt = m.canceled_at ?? m.current_period_end ?? m.updated_at ?? m.created_at;
    out.push({
      ref: `member:${m.id}`,
      email,
      eventAt: eventAt ? new Date(eventAt) : new Date(0),
    });
  }
  return out;
}

async function collectTriggers(
  automation: EmailAutomation,
  ownerUserId: string,
  deps: AutomationDeps,
): Promise<AutomationTrigger[]> {
  switch (automation.kind) {
    case "post_purchase": {
      const [shop, digital] = await Promise.all([
        collectShopSaleTriggers(ownerUserId),
        collectDigitalSaleTriggers(ownerUserId, deps),
      ]);
      return [...shop, ...digital];
    }
    case "abandoned_checkout":
      return collectAbandonedTriggers(ownerUserId);
    case "membership_winback":
      return collectWinbackTriggers(ownerUserId, deps);
    default:
      return [];
  }
}

/* ── The runner ─────────────────────────────────────────────────────── */

export interface AutomationRunSummary {
  candidates: number;
  sent: number;
  failed: number;
  noProvider: number;
  skippedUnsubscribed: number;
  notOnList: number;
  duplicates: number;
}

/** Mint the per-send carrier campaign (see header: one carrier per
 *  physical email, so every send gets its own tracked delivery). */
async function mintCarrier(automation: EmailAutomation, list: EmailList): Promise<EmailCampaign> {
  const [carrier] = await db
    .insert(emailCampaignsTable)
    .values({
      listId: list.id,
      subject: automation.subject,
      body: automation.body,
      status: "sending",
      automationId: automation.id,
    })
    .returning();
  return carrier!;
}

async function settleCarrier(
  carrier: EmailCampaign,
  outcome: "sent" | "failed" | "no_provider",
  now: Date,
): Promise<void> {
  const sentOk = outcome === "sent";
  await db
    .update(emailCampaignsTable)
    .set({
      status: sentOk ? "sent" : "failed",
      recipientCount: 1,
      deliveredCount: sentOk ? 1 : 0,
      ...(sentOk ? { sentAt: now } : {}),
    })
    .where(eq(emailCampaignsTable.id, carrier.id));
}

/** Evaluate ONE enabled automation: collect its triggers, apply the
 *  enabled-at + delay gates, claim each surviving trigger exactly
 *  once, and send through the tracked rail. */
export async function runAutomation(
  automation: EmailAutomation,
  list: EmailList,
  depsIn: Partial<AutomationDeps> = {},
): Promise<AutomationRunSummary> {
  const deps: AutomationDeps = { ...DEFAULT_DEPS, ...depsIn };
  const now = deps.now();
  const summary: AutomationRunSummary = {
    candidates: 0,
    sent: 0,
    failed: 0,
    noProvider: 0,
    skippedUnsubscribed: 0,
    notOnList: 0,
    duplicates: 0,
  };
  try {
    if (!automation.enabled) return summary;
    const since = automation.enabledAt ?? automation.createdAt;
    const delayMs = Math.max(0, automation.delayHours) * 3_600_000;
    const triggers = (await collectTriggers(automation, list.userId, deps))
      .filter((t) => since != null && t.eventAt >= since && t.eventAt.getTime() + delayMs <= now.getTime())
      .sort((a, b) => a.eventAt.getTime() - b.eventAt.getTime());
    summary.candidates = triggers.length;
    if (triggers.length === 0) return summary;

    const subscribers = await db
      .select()
      .from(emailSubscribersTable)
      .where(eq(emailSubscribersTable.listId, list.id));
    const subByEmail = new Map(subscribers.map((s) => [lower(s.email), s]));

    let prep: ReturnType<typeof prepareCampaignSend> | null = null;
    for (const trigger of triggers) {
      const sub = subByEmail.get(trigger.email);
      if (!sub) {
        summary.notOnList++;
        continue; /* not on this list — not actionable, no claim */
      }
      if (sub.unsubscribedAt) {
        const [row] = await db
          .insert(emailAutomationSendsTable)
          .values({
            automationId: automation.id,
            subscriberId: sub.id,
            triggerKind: automation.kind,
            triggerRef: trigger.ref,
            recipientEmail: sub.email,
            status: "skipped_unsubscribed",
          })
          .onConflictDoNothing()
          .returning();
        if (row) summary.skippedUnsubscribed++;
        else summary.duplicates++;
        continue;
      }
      const [claim] = await db
        .insert(emailAutomationSendsTable)
        .values({
          automationId: automation.id,
          subscriberId: sub.id,
          triggerKind: automation.kind,
          triggerRef: trigger.ref,
          recipientEmail: sub.email,
          status: "queued",
        })
        .onConflictDoNothing()
        .returning();
      if (!claim) {
        summary.duplicates++;
        continue; /* an earlier run owns this trigger */
      }

      /* Suppression re-check at send time: the subscriber row is
         re-read immediately before the send — an unsubscribe that
         landed after evaluation still stops the email. */
      const [fresh] = await db
        .select()
        .from(emailSubscribersTable)
        .where(eq(emailSubscribersTable.id, sub.id))
        .limit(1);
      if (!fresh || fresh.unsubscribedAt) {
        await db
          .update(emailAutomationSendsTable)
          .set({ status: "skipped_unsubscribed" })
          .where(eq(emailAutomationSendsTable.id, claim.id));
        summary.skippedUnsubscribed++;
        continue;
      }

      const carrier = await mintCarrier(automation, list);
      prep ??= prepareCampaignSend(carrier);
      const { outcome, deliveryId } = await sendCampaignDelivery(carrier, fresh, prep);
      const status =
        outcome === "sent" || outcome === "already_sent"
          ? "sent"
          : outcome === "no_provider"
            ? "no_provider"
            : "failed";
      await settleCarrier(carrier, status, now);
      await db
        .update(emailAutomationSendsTable)
        .set({
          status,
          deliveryId: deliveryId ?? null,
          ...(status === "sent" ? { sentAt: deps.now() } : {}),
        })
        .where(eq(emailAutomationSendsTable.id, claim.id));
      await db
        .update(emailAutomationsTable)
        .set({ campaignId: carrier.id })
        .where(eq(emailAutomationsTable.id, automation.id));
      if (status === "sent") summary.sent++;
      else if (status === "no_provider") summary.noProvider++;
      else summary.failed++;
    }
    return summary;
  } finally {
    /* lastRunAt = the honest "last checked" the UI shows: stamped on
       every completed evaluation of an enabled automation, sends or
       not. A crashed run doesn't stamp — the check didn't complete. */
    if (automation.enabled) {
      try {
        await db
          .update(emailAutomationsTable)
          .set({ lastRunAt: now })
          .where(eq(emailAutomationsTable.id, automation.id));
      } catch {
        /* lastRunAt is bookkeeping — never fail a run over it */
      }
    }
  }
}

/** Evaluate every enabled automation on every list. */
export async function runEmailAutomationsOnce(
  depsIn: Partial<AutomationDeps> = {},
): Promise<{ automations: number; sent: number; failed: number; noProvider: number; skippedUnsubscribed: number }> {
  const enabled = await db
    .select()
    .from(emailAutomationsTable)
    .where(eq(emailAutomationsTable.enabled, true));
  const totals = { automations: 0, sent: 0, failed: 0, noProvider: 0, skippedUnsubscribed: 0 };
  for (const automation of enabled) {
    const [list] = await db
      .select()
      .from(emailListsTable)
      .where(eq(emailListsTable.id, automation.listId))
      .limit(1);
    if (!list) continue;
    totals.automations++;
    try {
      const s = await runAutomation(automation, list, depsIn);
      totals.sent += s.sent;
      totals.failed += s.failed;
      totals.noProvider += s.noProvider;
      totals.skippedUnsubscribed += s.skippedUnsubscribed;
    } catch (err) {
      logger.error({ err, automationId: automation.id }, "[email-automations] run failed");
    }
  }
  if (totals.sent > 0 || totals.failed > 0 || totals.noProvider > 0) {
    logger.info(totals, "[email-automations] sweep complete");
  }
  return totals;
}

/* ── Sweeper (house pattern: boot run + interval, never fatal) ─────── */

const SWEEP_INTERVAL_MS =
  Number(process.env["EMAIL_AUTOMATION_SWEEP_INTERVAL_MS"]) || 15 * 60 * 1000;
const SWEEP_STARTUP_DELAY_MS =
  Number(process.env["EMAIL_AUTOMATION_SWEEP_STARTUP_DELAY_MS"]) || 45 * 1000;

export function startEmailAutomationSweeper(
  depsIn: Partial<AutomationDeps> = {},
): { stop: () => void } {
  const run = () =>
    runEmailAutomationsOnce(depsIn).catch((err) =>
      logger.error({ err }, "[email-automations] sweep crashed"),
    );
  const startupTimer = setTimeout(run, SWEEP_STARTUP_DELAY_MS);
  const intervalTimer = setInterval(run, SWEEP_INTERVAL_MS);
  logger.info(
    { intervalMs: SWEEP_INTERVAL_MS, startupDelayMs: SWEEP_STARTUP_DELAY_MS },
    "[email-automations] sweeper started",
  );
  return {
    stop: () => {
      clearTimeout(startupTimer);
      clearInterval(intervalTimer);
    },
  };
}
