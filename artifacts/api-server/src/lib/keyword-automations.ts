/**
 * Keyword automations (migration 0232, Wave 4 #32 — the ManyChat
 * pattern on our own rails).
 *
 * A creator defines keyword rules (routes/keyword-automations.ts,
 * docked beside the email automations in the PROMOTE workflow): when
 * a fan comments the keyword on the creator's content, the fan
 * instantly gets an in-app DM from the creator through the site's own
 * messages rail (conversations / messages — no external sends, ever),
 * and if the rule asks for it, the fan can reply in that DM with an
 * email address that is captured into the creator's EXISTING email
 * list (email_subscribers — the same row shape, welcome sequence and
 * free-tier cap as the public subscribe door; never a new silo).
 *
 * Trigger surfaces (hooks call handleKeywordComment after the comment
 * has landed — fire-and-forget, this module never throws into a
 * comment path):
 *   post  — POST /posts/:id/reply (routes/social.ts); owner = the
 *           replied-to post's profile owner.
 *   media — POST /media/:kind/:id/comments (routes/creator-platform.ts)
 *           for public comments only; owner = the media's profile
 *           owner. Shorts are videos on this rail.
 *   wall  — POST /creator-profiles/:id/comments (same file), public
 *           comments only; owner = the profile owner.
 *   live  — POST /live/:id/chat (routes/live-chat.ts); owner = the
 *           stream's user_id.
 *
 * Laws:
 *   - OFF means silent: only rules with enabled = TRUE can fire, and
 *     every rule carries the creator's explicit per-rule switch.
 *   - No self-triggers: a rule never fires on the creator's own
 *     comments, and triggers come ONLY from comment surfaces — never
 *     from DMs — so an automation DM can never set off another
 *     automation (no loops by construction).
 *   - One DM per (rule, fan, surface, surface ref): the events
 *     ledger's partial unique index is the law, checked before send
 *     and enforced by the database.
 *   - Rate limits (spam economics, from day one): per-rule hourly
 *     send cap, per-creator daily send cap, per-fan daily cap across
 *     a creator's rules. A capped fire records an honest
 *     'rate_limited' audit row (at most one per rule+fan per hour,
 *     so a troll can't flood the log either).
 *   - Honest outcomes only: every fire writes an audit row the
 *     creator can read — sent (with the DM's message id), blocked
 *     (the DM rail refused: blocked conversation or an unaccepted
 *     request the fan started), rate_limited, or failed with the
 *     reason. Nothing is ever recorded as sent that wasn't.
 *   - Email capture listens only on the fan's side of the DM: a
 *     pending capture exists only because a rule fired for that fan;
 *     the first email-shaped token in the fan's reply subscribes
 *     that address to the rule's list exactly once (the capture row
 *     flips to 'captured' and stops listening).
 */
import { randomUUID } from "node:crypto";
import { and, count, desc, eq, gt, inArray, isNull, type SQL } from "drizzle-orm";
import {
  db,
  conversationsTable,
  creatorProfilesTable,
  emailListsTable,
  emailSubscribersTable,
  followsTable,
  keywordAutomationCapturesTable,
  keywordAutomationEventsTable,
  keywordAutomationRulesTable,
  messagesTable,
  type KeywordAutomationRule,
  type KeywordAutomationSurface,
} from "@workspace/db";
import { queueWelcomeSequence } from "./email-campaign-sender";
import { logger } from "./logger";

/* ── Tunables ─────────────────────────────────────────────────────────── */

/** Rules a single creator may define. */
export const KW_MAX_RULES_PER_CREATOR = 25;
/** Sends one rule may fire per rolling hour. */
export const KW_RULE_HOURLY_SEND_CAP = 60;
/** Sends one creator's rules may fire per rolling 24h. */
export const KW_CREATOR_DAILY_SEND_CAP = 500;
/** Automation DMs one fan may receive from one creator per rolling 24h. */
export const KW_FAN_DAILY_CAP = 3;
/** How long a pending email capture listens for the fan's reply. */
export const KW_CAPTURE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** The list free-tier cap — mirrors EMAIL_FREE_SUBSCRIBER_LIMIT
 *  (routes/generate/email-list-helpers.ts), enforced by the public
 *  subscribe door the same way. */
export const KW_LIST_FREE_SUBSCRIBER_LIMIT = 1000;
/** Appended to the DM whenever a rule captures email, so the ask is
 *  explicit and identical for every fan. */
export const KW_CAPTURE_PROMPT =
  "\n\nWant it in your inbox too? Reply here with your email address and I'll add you to my list.";

/* ── Pure helpers (pinned directly by tests) ──────────────────────────── */

/** Keywords are single tokens: letters, numbers, underscore, hyphen. */
export const KEYWORD_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;

export function normalizeKeyword(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const kw = raw.trim().toLowerCase();
  return KEYWORD_RE.test(kw) ? kw : null;
}

/** Whole-word, case-insensitive match: "LINK" fires on "drop the
 *  link!" and "Link please" — never on "linkin" or "hyperlink". */
export function keywordMatches(body: string, keyword: string): boolean {
  const tokens = body.toLowerCase().split(/[^a-z0-9_-]+/);
  return tokens.includes(keyword);
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

/** The first email-shaped token in a message, lowercased — or null. */
export function extractEmail(body: string): string | null {
  const m = EMAIL_RE.exec(body);
  return m ? m[0].toLowerCase() : null;
}

/* ── The DM rail (mirrors routes/community.ts /dm/start + /dm/:id/send) ── */

function canonicalPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

async function isMutual(aUserId: string, bUserId: string): Promise<boolean> {
  const profiles = await db
    .select({ id: creatorProfilesTable.id, userId: creatorProfilesTable.userId })
    .from(creatorProfilesTable)
    .where(inArray(creatorProfilesTable.userId, [aUserId, bUserId]));
  const aProf = profiles.find((p) => p.userId === aUserId);
  const bProf = profiles.find((p) => p.userId === bUserId);
  if (!aProf || !bProf) return false;
  const rows = await db.select().from(followsTable).where(
    and(eq(followsTable.followerUserId, aUserId), eq(followsTable.profileId, bProf.id)),
  );
  const back = await db.select().from(followsTable).where(
    and(eq(followsTable.followerUserId, bUserId), eq(followsTable.profileId, aProf.id)),
  );
  return rows.length > 0 && back.length > 0;
}

export type AutomatedDmResult =
  | { ok: true; messageId: string; conversationId: string }
  | { ok: false; reason: "blocked" | "request_pending" };

/** Send one DM on the house rail, exactly as /dm/start + /dm/:id/send
 *  would: get-or-create the canonical conversation (mutual followers
 *  land in the inbox, everyone else in requests), refuse a blocked
 *  conversation, and refuse to write into a request thread the FAN
 *  started and the creator hasn't accepted (the rail's own gate —
 *  the automation never silently accepts on the creator's behalf). */
export async function sendAutomatedDm(
  fromUserId: string,
  toUserId: string,
  body: string,
): Promise<AutomatedDmResult> {
  const [a, b] = canonicalPair(fromUserId, toUserId);
  const [existing] = await db
    .select()
    .from(conversationsTable)
    .where(and(eq(conversationsTable.participantA, a), eq(conversationsTable.participantB, b)))
    .limit(1);

  let conversationId: string;
  if (existing) {
    if (existing.status === "blocked") return { ok: false, reason: "blocked" };
    if (existing.status === "request" && existing.requestedBy === toUserId) {
      return { ok: false, reason: "request_pending" };
    }
    conversationId = existing.id;
  } else {
    const mutual = await isMutual(fromUserId, toUserId);
    const [conv] = await db
      .insert(conversationsTable)
      .values({
        participantA: a,
        participantB: b,
        status: mutual ? "inbox" : "request",
        requestedBy: fromUserId,
      })
      .returning();
    if (!conv) throw new Error("conversation insert returned no row");
    conversationId = conv.id;
  }

  const [msg] = await db
    .insert(messagesTable)
    .values({ conversationId, senderUserId: fromUserId, body })
    .returning();
  if (!msg) throw new Error("message insert returned no row");
  await db
    .update(conversationsTable)
    .set({ lastMessageAt: new Date() })
    .where(eq(conversationsTable.id, conversationId));
  return { ok: true, messageId: msg.id, conversationId };
}

/* ── Audit ────────────────────────────────────────────────────────────── */

async function recordEvent(row: {
  rule: KeywordAutomationRule;
  fanUserId: string;
  surface: KeywordAutomationSurface;
  surfaceRef: string;
  outcome: "sent" | "rate_limited" | "blocked" | "failed";
  dmMessageId?: string;
  detail?: string;
}): Promise<void> {
  await db.insert(keywordAutomationEventsTable).values({
    ruleId: row.rule.id,
    creatorUserId: row.rule.creatorUserId,
    fanUserId: row.fanUserId,
    surface: row.surface,
    surfaceRef: row.surfaceRef,
    outcome: row.outcome,
    dmMessageId: row.dmMessageId ?? null,
    detail: row.detail ?? null,
  });
}

async function sentCountSince(
  where: SQL[],
  since: Date,
): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(keywordAutomationEventsTable)
    .where(and(...where, eq(keywordAutomationEventsTable.outcome, "sent"), gt(keywordAutomationEventsTable.createdAt, since)));
  return row?.value ?? 0;
}

/* ── The trigger ──────────────────────────────────────────────────────── */

export interface KeywordCommentTrigger {
  ownerUserId: string;
  commenterUserId: string;
  body: string;
  surface: KeywordAutomationSurface;
  /** The thing commented on (post id / media id / profile id / stream id). */
  surfaceRefId: string;
}

/** Evaluate one landed comment against the content owner's enabled
 *  keyword rules and fire what matches. Fire-and-forget by contract:
 *  catches everything, logs, never throws into the comment path. */
export async function handleKeywordComment(trigger: KeywordCommentTrigger): Promise<void> {
  try {
    const { ownerUserId, commenterUserId, body, surface, surfaceRefId } = trigger;
    if (!ownerUserId || !commenterUserId || commenterUserId === ownerUserId) return;

    const rules = await db
      .select()
      .from(keywordAutomationRulesTable)
      .where(
        and(
          eq(keywordAutomationRulesTable.creatorUserId, ownerUserId),
          eq(keywordAutomationRulesTable.enabled, true),
        ),
      )
      .orderBy(keywordAutomationRulesTable.createdAt);
    const now = new Date();
    const matching = rules.filter(
      (r) =>
        (r.enabledAt == null || r.enabledAt <= now) &&
        (r.surfaces ?? []).includes(surface) &&
        keywordMatches(body, r.keyword),
    );

    for (const rule of matching) {
      try {
        await fireRule(rule, { fanUserId: commenterUserId, surface, surfaceRefId, now });
      } catch (err) {
        logger.error({ err, ruleId: rule.id }, "[keyword-automations] rule fire failed");
        await recordEvent({
          rule,
          fanUserId: commenterUserId,
          surface,
          surfaceRef: surfaceRefId,
          outcome: "failed",
          detail: err instanceof Error ? err.message.slice(0, 200) : "unknown error",
        }).catch(() => undefined);
      }
    }
  } catch (err) {
    logger.error({ err }, "[keyword-automations] trigger evaluation failed");
  }
}

async function fireRule(
  rule: KeywordAutomationRule,
  args: { fanUserId: string; surface: KeywordAutomationSurface; surfaceRefId: string; now: Date },
): Promise<void> {
  const { fanUserId, surface, surfaceRefId, now } = args;

  /* Dedupe: this rule already DM'd this fan about this surface ref. */
  const [dupe] = await db
    .select({ id: keywordAutomationEventsTable.id })
    .from(keywordAutomationEventsTable)
    .where(
      and(
        eq(keywordAutomationEventsTable.ruleId, rule.id),
        eq(keywordAutomationEventsTable.fanUserId, fanUserId),
        eq(keywordAutomationEventsTable.surface, surface),
        eq(keywordAutomationEventsTable.surfaceRef, surfaceRefId),
        eq(keywordAutomationEventsTable.outcome, "sent"),
      ),
    )
    .limit(1);
  if (dupe) return;

  /* Rate limits — fan first (cheapest troll stop), then rule, then creator. */
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const fanSent = await sentCountSince(
    [eq(keywordAutomationEventsTable.creatorUserId, rule.creatorUserId), eq(keywordAutomationEventsTable.fanUserId, fanUserId)],
    dayAgo,
  );
  const ruleSent = fanSent < KW_FAN_DAILY_CAP
    ? await sentCountSince([eq(keywordAutomationEventsTable.ruleId, rule.id)], hourAgo)
    : KW_RULE_HOURLY_SEND_CAP;
  const creatorSent = ruleSent < KW_RULE_HOURLY_SEND_CAP
    ? await sentCountSince([eq(keywordAutomationEventsTable.creatorUserId, rule.creatorUserId)], dayAgo)
    : KW_CREATOR_DAILY_SEND_CAP;

  const capHit =
    fanSent >= KW_FAN_DAILY_CAP
      ? "fan_daily_cap"
      : ruleSent >= KW_RULE_HOURLY_SEND_CAP
        ? "rule_hourly_cap"
        : creatorSent >= KW_CREATOR_DAILY_SEND_CAP
          ? "creator_daily_cap"
          : null;
  if (capHit) {
    /* Audit the cap honestly, but at most once per rule+fan per hour. */
    const [recentCap] = await db
      .select({ id: keywordAutomationEventsTable.id })
      .from(keywordAutomationEventsTable)
      .where(
        and(
          eq(keywordAutomationEventsTable.ruleId, rule.id),
          eq(keywordAutomationEventsTable.fanUserId, fanUserId),
          eq(keywordAutomationEventsTable.outcome, "rate_limited"),
          gt(keywordAutomationEventsTable.createdAt, hourAgo),
        ),
      )
      .limit(1);
    if (!recentCap) {
      await recordEvent({ rule, fanUserId, surface, surfaceRef: surfaceRefId, outcome: "rate_limited", detail: capHit });
    }
    return;
  }

  const dmBody = rule.captureEmail && rule.listId ? rule.dmBody + KW_CAPTURE_PROMPT : rule.dmBody;
  const sent = await sendAutomatedDm(rule.creatorUserId, fanUserId, dmBody);
  if (!sent.ok) {
    await recordEvent({
      rule,
      fanUserId,
      surface,
      surfaceRef: surfaceRefId,
      outcome: "blocked",
      detail: sent.reason,
    });
    return;
  }

  await recordEvent({
    rule,
    fanUserId,
    surface,
    surfaceRef: surfaceRefId,
    outcome: "sent",
    dmMessageId: sent.messageId,
  });

  if (rule.captureEmail && rule.listId) {
    await db
      .insert(keywordAutomationCapturesTable)
      .values({
        ruleId: rule.id,
        creatorUserId: rule.creatorUserId,
        fanUserId,
        conversationId: sent.conversationId,
        status: "pending",
      })
      .onConflictDoNothing();
  }
}

/* ── Email capture (the fan's side of the DM) ─────────────────────────── */

export interface DmCaptureInput {
  senderUserId: string;
  conversationId: string;
  body: string;
}

/** Called (fire-and-forget) after any DM lands. If the sender is a
 *  fan with a pending keyword-automation capture in this
 *  conversation and the message carries an email address, subscribe
 *  that address to the rule's list — the existing list system, the
 *  existing welcome sequence, exactly once. Never throws. */
export async function handleDmEmailCapture(input: DmCaptureInput): Promise<void> {
  try {
    const email = extractEmail(input.body);
    if (!email) return;

    const pending = await db
      .select()
      .from(keywordAutomationCapturesTable)
      .where(
        and(
          eq(keywordAutomationCapturesTable.fanUserId, input.senderUserId),
          eq(keywordAutomationCapturesTable.conversationId, input.conversationId),
          eq(keywordAutomationCapturesTable.status, "pending"),
        ),
      )
      .orderBy(desc(keywordAutomationCapturesTable.createdAt))
      .limit(1);
    const capture = pending[0];
    if (!capture) return;

    if (Date.now() - capture.createdAt.getTime() > KW_CAPTURE_WINDOW_MS) {
      await db
        .update(keywordAutomationCapturesTable)
        .set({ status: "expired" })
        .where(eq(keywordAutomationCapturesTable.id, capture.id));
      return;
    }

    const [rule] = await db
      .select()
      .from(keywordAutomationRulesTable)
      .where(eq(keywordAutomationRulesTable.id, capture.ruleId))
      .limit(1);
    if (!rule || !rule.listId) return;

    const [list] = await db
      .select()
      .from(emailListsTable)
      .where(and(eq(emailListsTable.id, rule.listId), eq(emailListsTable.userId, capture.creatorUserId)))
      .limit(1);
    if (!list) return;

    const [existing] = await db
      .select()
      .from(emailSubscribersTable)
      .where(and(eq(emailSubscribersTable.listId, list.id), eq(emailSubscribersTable.email, email)))
      .limit(1);

    /* The capture belongs to the comment that started the flow: the
       audit row carries that fire's surface + ref, not the DM's. */
    const [fire] = await db
      .select({
        surface: keywordAutomationEventsTable.surface,
        surfaceRef: keywordAutomationEventsTable.surfaceRef,
      })
      .from(keywordAutomationEventsTable)
      .where(
        and(
          eq(keywordAutomationEventsTable.ruleId, rule.id),
          eq(keywordAutomationEventsTable.fanUserId, input.senderUserId),
          eq(keywordAutomationEventsTable.outcome, "sent"),
        ),
      )
      .orderBy(desc(keywordAutomationEventsTable.createdAt))
      .limit(1);
    const fireSurface = fire?.surface ?? "post";
    const fireRef = fire?.surfaceRef ?? capture.conversationId;

    let outcome: "captured" | "already_on_list";
    if (existing && !existing.unsubscribedAt) {
      outcome = "already_on_list";
    } else {
      const [subRow] = await db
        .select({ value: count() })
        .from(emailSubscribersTable)
        .where(and(eq(emailSubscribersTable.listId, list.id), isNull(emailSubscribersTable.unsubscribedAt)));
      if (!existing && (subRow?.value ?? 0) >= KW_LIST_FREE_SUBSCRIBER_LIMIT) {
        await db.insert(keywordAutomationEventsTable).values({
          ruleId: rule.id,
          creatorUserId: rule.creatorUserId,
          fanUserId: input.senderUserId,
          surface: fireSurface,
          surfaceRef: fireRef,
          outcome: "failed",
          capturedEmail: email,
          detail: "list_full",
        });
        return;
      }
      let subscriber = existing;
      if (existing) {
        /* Re-subscribing an unsubscribed address re-activates it —
           the public subscribe door's exact behavior. */
        const [fresh] = await db
          .update(emailSubscribersTable)
          .set({ unsubscribedAt: null, source: "keyword_automation" })
          .where(eq(emailSubscribersTable.id, existing.id))
          .returning();
        subscriber = fresh ?? existing;
      } else {
        const [fresh] = await db
          .insert(emailSubscribersTable)
          .values({
            listId: list.id,
            email,
            name: null,
            source: "keyword_automation",
            confirmed: true,
            unsubscribeToken: randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, ""),
          })
          .returning();
        subscriber = fresh;
      }
      if (subscriber) {
        await queueWelcomeSequence(list, subscriber).catch((err) =>
          logger.error({ err, listId: list.id }, "[keyword-automations] welcome sequence queue failed"),
        );
      }
      outcome = "captured";
    }

    await db
      .update(keywordAutomationCapturesTable)
      .set({ status: "captured", capturedEmail: email, capturedAt: new Date() })
      .where(eq(keywordAutomationCapturesTable.id, capture.id));
    await db.insert(keywordAutomationEventsTable).values({
      ruleId: rule.id,
      creatorUserId: rule.creatorUserId,
      fanUserId: input.senderUserId,
      surface: fireSurface,
      surfaceRef: fireRef,
      outcome,
      capturedEmail: email,
    });
  } catch (err) {
    logger.error({ err }, "[keyword-automations] DM email capture failed");
  }
}
