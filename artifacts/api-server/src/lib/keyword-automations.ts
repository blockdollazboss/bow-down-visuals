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
 *
 * Data access is raw SQL through db.execute — the house pattern for
 * pg-mem-verifiable libs (the lip-sync job store, booking reminders):
 * the $0 suite drives this module against an in-memory Postgres, and
 * drizzle's typed selects cannot run there.
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, type EmailList, type EmailSubscriber } from "@workspace/db";
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

export type KwSurface = "post" | "media" | "wall" | "live";

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

/* ── Row shapes (raw SQL returns snake_case) ──────────────────────────── */

interface RuleRow {
  id: string;
  creator_user_id: string;
  list_id: string | null;
  keyword: string;
  surfaces: unknown;
  dm_body: string;
  capture_email: boolean;
  enabled: boolean;
  enabled_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface CaptureRow {
  id: string;
  rule_id: string;
  creator_user_id: string;
  fan_user_id: string;
  conversation_id: string;
  status: string;
  captured_email: string | null;
  created_at: Date | string;
  captured_at: Date | string | null;
}

function asDate(v: Date | string | null | undefined): Date | null {
  if (v == null) return null;
  return v instanceof Date ? v : new Date(v);
}

function asSurfaces(v: unknown): KwSurface[] {
  const arr = Array.isArray(v) ? v : typeof v === "string" ? JSON.parse(v) as unknown : [];
  return (Array.isArray(arr) ? arr : []).filter(
    (s): s is KwSurface => s === "post" || s === "media" || s === "wall" || s === "live",
  );
}

async function rows<T>(query: Parameters<typeof db.execute>[0]): Promise<T[]> {
  const res = await db.execute(query);
  return res.rows as T[];
}

async function first<T>(query: Parameters<typeof db.execute>[0]): Promise<T | null> {
  const r = await rows<T>(query);
  return r[0] ?? null;
}

/* ── The DM rail (mirrors routes/community.ts /dm/start + /dm/:id/send) ── */

function canonicalPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

async function isMutual(aUserId: string, bUserId: string): Promise<boolean> {
  const profiles = await rows<{ id: string; user_id: string }>(sql`
    SELECT id, user_id FROM creator_profiles WHERE user_id IN (${aUserId}, ${bUserId})`);
  const aProf = profiles.find((p) => p.user_id === aUserId);
  const bProf = profiles.find((p) => p.user_id === bUserId);
  if (!aProf || !bProf) return false;
  const follows = await rows<{ follower_user_id: string; profile_id: string }>(sql`
    SELECT follower_user_id, profile_id FROM follows
    WHERE (follower_user_id = ${aUserId} AND profile_id = ${bProf.id})
       OR (follower_user_id = ${bUserId} AND profile_id = ${aProf.id})`);
  const aFollowsB = follows.some((f) => f.follower_user_id === aUserId && f.profile_id === bProf.id);
  const bFollowsA = follows.some((f) => f.follower_user_id === bUserId && f.profile_id === aProf.id);
  return aFollowsB && bFollowsA;
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
  const existing = await first<{ id: string; status: string; requested_by: string | null }>(sql`
    SELECT id, status, requested_by FROM conversations
    WHERE participant_a = ${a} AND participant_b = ${b} LIMIT 1`);

  let conversationId: string;
  if (existing) {
    if (existing.status === "blocked") return { ok: false, reason: "blocked" };
    if (existing.status === "request" && existing.requested_by === toUserId) {
      return { ok: false, reason: "request_pending" };
    }
    conversationId = existing.id;
  } else {
    const mutual = await isMutual(fromUserId, toUserId);
    conversationId = randomUUID();
    await db.execute(sql`
      INSERT INTO conversations (id, participant_a, participant_b, status, requested_by)
      VALUES (${conversationId}, ${a}, ${b}, ${mutual ? "inbox" : "request"}, ${fromUserId})`);
  }

  const messageId = randomUUID();
  await db.execute(sql`
    INSERT INTO messages (id, conversation_id, sender_user_id, body)
    VALUES (${messageId}, ${conversationId}, ${fromUserId}, ${body})`);
  await db.execute(sql`
    UPDATE conversations SET last_message_at = now() WHERE id = ${conversationId}`);
  return { ok: true, messageId, conversationId };
}

/* ── Audit ────────────────────────────────────────────────────────────── */

async function recordEvent(row: {
  ruleId: string;
  creatorUserId: string;
  fanUserId: string;
  surface: KwSurface;
  surfaceRef: string;
  outcome: "sent" | "rate_limited" | "blocked" | "failed" | "captured" | "already_on_list";
  dmMessageId?: string;
  capturedEmail?: string;
  detail?: string;
}): Promise<void> {
  await db.execute(sql`
    INSERT INTO keyword_automation_events
      (rule_id, creator_user_id, fan_user_id, surface, surface_ref, outcome, dm_message_id, captured_email, detail)
    VALUES (${row.ruleId}, ${row.creatorUserId}, ${row.fanUserId}, ${row.surface}, ${row.surfaceRef},
            ${row.outcome}, ${row.dmMessageId ?? null}, ${row.capturedEmail ?? null}, ${row.detail ?? null})`);
}

async function sentCountSince(whereSql: ReturnType<typeof sql>, since: Date): Promise<number> {
  const row = await first<{ value: number }>(sql`
    SELECT count(*)::int AS value FROM keyword_automation_events
    WHERE outcome = 'sent' AND created_at > ${since} AND ${whereSql}`);
  return row?.value ?? 0;
}

/* ── The trigger ──────────────────────────────────────────────────────── */

export interface KeywordCommentTrigger {
  ownerUserId: string;
  commenterUserId: string;
  body: string;
  surface: KwSurface;
  /** The thing commented on (post id / media id / profile id / stream id). */
  surfaceRefId: string;
}

/** The hook entry point for comment routes: the evaluation is
 *  scheduled for the next loop tick, so the engine adds zero
 *  footprint — not even its first rules read — to the request that
 *  landed the comment. The comment is already a landed row by then;
 *  nothing about the fire depends on the request still being open. */
export function queueKeywordComment(trigger: KeywordCommentTrigger): void {
  setImmediate(() => {
    void handleKeywordComment(trigger);
  });
}

/** Same contract for the DM-send hook (see handleDmEmailCapture). */
export function queueDmEmailCapture(input: DmCaptureInput): void {
  setImmediate(() => {
    void handleDmEmailCapture(input);
  });
}

/** Evaluate one landed comment against the content owner's enabled
 *  keyword rules and fire what matches. Fire-and-forget by contract:
 *  catches everything, logs, never throws into the comment path. */
export async function handleKeywordComment(trigger: KeywordCommentTrigger): Promise<void> {
  try {
    const { ownerUserId, commenterUserId, body, surface, surfaceRefId } = trigger;
    if (!ownerUserId || !commenterUserId || commenterUserId === ownerUserId) return;

    const rules = await rows<RuleRow>(sql`
      SELECT * FROM keyword_automation_rules
      WHERE creator_user_id = ${ownerUserId} AND enabled = true
      ORDER BY created_at ASC`);
    const now = new Date();
    const matching = rules.filter((r) => {
      const enabledAt = asDate(r.enabled_at);
      return (
        (enabledAt == null || enabledAt <= now) &&
        asSurfaces(r.surfaces).includes(surface) &&
        keywordMatches(body, r.keyword)
      );
    });

    for (const rule of matching) {
      try {
        await fireRule(rule, { fanUserId: commenterUserId, surface, surfaceRefId, now });
      } catch (err) {
        logger.error({ err, ruleId: rule.id }, "[keyword-automations] rule fire failed");
        await recordEvent({
          ruleId: rule.id,
          creatorUserId: rule.creator_user_id,
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
  rule: RuleRow,
  args: { fanUserId: string; surface: KwSurface; surfaceRefId: string; now: Date },
): Promise<void> {
  const { fanUserId, surface, surfaceRefId, now } = args;

  /* Dedupe: this rule already DM'd this fan about this surface ref. */
  const dupe = await first<{ id: string }>(sql`
    SELECT id FROM keyword_automation_events
    WHERE rule_id = ${rule.id} AND fan_user_id = ${fanUserId}
      AND surface = ${surface} AND surface_ref = ${surfaceRefId} AND outcome = 'sent'
    LIMIT 1`);
  if (dupe) return;

  /* Rate limits — fan first (cheapest troll stop), then rule, then creator. */
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const fanSent = await sentCountSince(
    sql`creator_user_id = ${rule.creator_user_id} AND fan_user_id = ${fanUserId}`, dayAgo);
  const ruleSent = fanSent < KW_FAN_DAILY_CAP
    ? await sentCountSince(sql`rule_id = ${rule.id}`, hourAgo)
    : KW_RULE_HOURLY_SEND_CAP;
  const creatorSent = ruleSent < KW_RULE_HOURLY_SEND_CAP
    ? await sentCountSince(sql`creator_user_id = ${rule.creator_user_id}`, dayAgo)
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
    const recentCap = await first<{ id: string }>(sql`
      SELECT id FROM keyword_automation_events
      WHERE rule_id = ${rule.id} AND fan_user_id = ${fanUserId}
        AND outcome = 'rate_limited' AND created_at > ${hourAgo}
      LIMIT 1`);
    if (!recentCap) {
      await recordEvent({
        ruleId: rule.id, creatorUserId: rule.creator_user_id, fanUserId,
        surface, surfaceRef: surfaceRefId, outcome: "rate_limited", detail: capHit,
      });
    }
    return;
  }

  const dmBody = rule.capture_email && rule.list_id ? rule.dm_body + KW_CAPTURE_PROMPT : rule.dm_body;
  const sent = await sendAutomatedDm(rule.creator_user_id, fanUserId, dmBody);
  if (!sent.ok) {
    await recordEvent({
      ruleId: rule.id, creatorUserId: rule.creator_user_id, fanUserId,
      surface, surfaceRef: surfaceRefId, outcome: "blocked", detail: sent.reason,
    });
    return;
  }

  await recordEvent({
    ruleId: rule.id, creatorUserId: rule.creator_user_id, fanUserId,
    surface, surfaceRef: surfaceRefId, outcome: "sent", dmMessageId: sent.messageId,
  });

  if (rule.capture_email && rule.list_id) {
    await db.execute(sql`
      INSERT INTO keyword_automation_captures
        (rule_id, creator_user_id, fan_user_id, conversation_id, status)
      VALUES (${rule.id}, ${rule.creator_user_id}, ${fanUserId}, ${sent.conversationId}, 'pending')
      ON CONFLICT DO NOTHING`);
  }
}

/* ── Email capture (the fan's side of the DM) ─────────────────────────── */

export interface DmCaptureInput {
  senderUserId: string;
  conversationId: string;
  body: string;
}

interface ListRow {
  id: string; user_id: string; name: string; handle: string;
  description: string | null; welcome_subject: string | null; welcome_body: string | null;
  welcome2_subject: string | null; welcome2_body: string | null;
  welcome3_subject: string | null; welcome3_body: string | null;
  created_at: Date | string;
}

interface SubscriberRow {
  id: string; list_id: string; email: string; name: string | null;
  source: string; confirmed: boolean; opens: number; clicks: number;
  unsubscribe_token: string | null; unsubscribed_at: Date | string | null;
  subscribed_at: Date | string;
}

function toEmailList(r: ListRow): EmailList {
  return {
    id: r.id, userId: r.user_id, name: r.name, handle: r.handle,
    description: r.description, welcomeSubject: r.welcome_subject, welcomeBody: r.welcome_body,
    welcome2Subject: r.welcome2_subject, welcome2Body: r.welcome2_body,
    welcome3Subject: r.welcome3_subject, welcome3Body: r.welcome3_body,
    createdAt: asDate(r.created_at) ?? new Date(),
  } as EmailList;
}

function toEmailSubscriber(r: SubscriberRow): EmailSubscriber {
  return {
    id: r.id, listId: r.list_id, email: r.email, name: r.name,
    source: r.source, confirmed: r.confirmed, opens: r.opens, clicks: r.clicks,
    unsubscribeToken: r.unsubscribe_token, unsubscribedAt: asDate(r.unsubscribed_at),
    subscribedAt: asDate(r.subscribed_at) ?? new Date(),
  } as EmailSubscriber;
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

    const capture = await first<CaptureRow>(sql`
      SELECT * FROM keyword_automation_captures
      WHERE fan_user_id = ${input.senderUserId} AND conversation_id = ${input.conversationId}
        AND status = 'pending'
      ORDER BY created_at DESC LIMIT 1`);
    if (!capture) return;

    if (Date.now() - (asDate(capture.created_at)?.getTime() ?? 0) > KW_CAPTURE_WINDOW_MS) {
      await db.execute(sql`
        UPDATE keyword_automation_captures SET status = 'expired' WHERE id = ${capture.id}`);
      return;
    }

    const rule = await first<RuleRow>(sql`
      SELECT * FROM keyword_automation_rules WHERE id = ${capture.rule_id} LIMIT 1`);
    if (!rule || !rule.list_id) return;

    const listRow = await first<ListRow>(sql`
      SELECT * FROM email_lists WHERE id = ${rule.list_id} AND user_id = ${capture.creator_user_id} LIMIT 1`);
    if (!listRow) return;
    const list = toEmailList(listRow);

    /* The capture belongs to the comment that started the flow: the
       audit row carries that fire's surface + ref, not the DM's. */
    const fire = await first<{ surface: KwSurface; surface_ref: string }>(sql`
      SELECT surface, surface_ref FROM keyword_automation_events
      WHERE rule_id = ${rule.id} AND fan_user_id = ${input.senderUserId} AND outcome = 'sent'
      ORDER BY created_at DESC LIMIT 1`);
    const fireSurface = fire?.surface ?? "post";
    const fireRef = fire?.surface_ref ?? capture.conversation_id;

    const existing = await first<SubscriberRow>(sql`
      SELECT * FROM email_subscribers WHERE list_id = ${list.id} AND email = ${email} LIMIT 1`);

    let outcome: "captured" | "already_on_list";
    if (existing && !existing.unsubscribed_at) {
      outcome = "already_on_list";
    } else {
      if (!existing) {
        const countRow = await first<{ value: number }>(sql`
          SELECT count(*)::int AS value FROM email_subscribers
          WHERE list_id = ${list.id} AND unsubscribed_at IS NULL`);
        if ((countRow?.value ?? 0) >= KW_LIST_FREE_SUBSCRIBER_LIMIT) {
          await recordEvent({
            ruleId: rule.id, creatorUserId: rule.creator_user_id, fanUserId: input.senderUserId,
            surface: fireSurface, surfaceRef: fireRef, outcome: "failed",
            capturedEmail: email, detail: "list_full",
          });
          return;
        }
      }
      let subscriber: EmailSubscriber;
      if (existing) {
        /* Re-subscribing an unsubscribed address re-activates it —
           the public subscribe door's exact behavior. */
        await db.execute(sql`
          UPDATE email_subscribers SET unsubscribed_at = NULL, source = 'keyword_automation'
          WHERE id = ${existing.id}`);
        subscriber = toEmailSubscriber({ ...existing, unsubscribed_at: null, source: "keyword_automation" });
      } else {
        const subId = randomUUID();
        const token = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
        await db.execute(sql`
          INSERT INTO email_subscribers (id, list_id, email, name, source, confirmed, unsubscribe_token)
          VALUES (${subId}, ${list.id}, ${email}, NULL, 'keyword_automation', true, ${token})`);
        subscriber = toEmailSubscriber({
          id: subId, list_id: list.id, email, name: null, source: "keyword_automation",
          confirmed: true, opens: 0, clicks: 0, unsubscribe_token: token,
          unsubscribed_at: null, subscribed_at: new Date(),
        });
      }
      await queueWelcomeSequence(list, subscriber).catch((err) =>
        logger.error({ err, listId: list.id }, "[keyword-automations] welcome sequence queue failed"),
      );
      outcome = "captured";
    }

    await db.execute(sql`
      UPDATE keyword_automation_captures
      SET status = 'captured', captured_email = ${email}, captured_at = now()
      WHERE id = ${capture.id}`);
    await recordEvent({
      ruleId: rule.id, creatorUserId: rule.creator_user_id, fanUserId: input.senderUserId,
      surface: fireSurface, surfaceRef: fireRef, outcome, capturedEmail: email,
    });
  } catch (err) {
    logger.error({ err }, "[keyword-automations] DM email capture failed");
  }
}
