/* ─── Per-group activity digest ─────────────────────────────────────────
   A periodic digest per group for each member: what happened in the
   group since that member's last digest — feed posts, forum threads
   and replies, new members, and the most-liked post — delivered as ONE
   row in the existing `notifications` table (kind 'group_digest'),
   read by the header bell like every other producer's rows. Email is
   a second channel ONLY for members who opted in (email_enabled,
   default OFF), sent through the existing lib/email.ts rail:
   sendEmail returns { sent:false, reason:'no-provider' } when no
   RESEND_API_KEY is configured, and a digest email is only recorded
   as delivered when the rail confirms sent:true — a skipped or failed
   email is never recorded as sent (fail closed, respect the rail).

   ── Activity sources (real tables only) ─────────────────────────────
   group_posts · group_forum_threads · group_forum_replies ·
   group_members (joins). Platform events are profile-scoped, not
   group-scoped, so they are NOT counted — no invented group activity.
   The recipient's OWN activity is excluded: your own posts are not
   news to you, and a window containing only your own activity sends
   nothing.

   ── Anti-spam / exactly-once ────────────────────────────────────────
   · Per-user on/off + frequency live in group_digest_prefs (Settings
     card: GET/PATCH /api/group-digest-prefs). Disabled = never sent.
   · A digest is due only when a full window (daily 24h / weekly 7d)
     has elapsed since the member's high-water mark — the last
     delivery's period_end, or their group join date before the first
     digest. A brand-new member is never instantly spammed.
   · Zero activity in the window sends NOTHING and does not advance
     the high-water mark, so quiet periods lose nothing.
   · group_digest_deliveries UNIQUE (user_id, group_id, period_end):
     the sweep claims a digest by inserting its ledger row in the same
     transaction as the notification — a duplicate or racing sweep
     can never send twice.

   ── Where it runs ────────────────────────────────────────────────────
   A guarded phase of the existing job-poller tick (lib/job-poller.ts),
   throttled to one real pass per GROUP_DIGEST_INTERVAL_MS (default
   1h). No new scheduler, no new notification system.

   Fail-closed: prefs are loaded BEFORE anything can send; if they
   cannot be read (e.g. the provisional migration not yet applied),
   the pass aborts and tells nobody — a digest that cannot honor
   opt-outs must not fire. */

import { and, desc, eq, gte, lt, ne, sql } from "drizzle-orm";
import {
  db,
  groupDigestDeliveriesTable,
  groupDigestPrefsTable,
  groupForumRepliesTable,
  groupForumThreadsTable,
  groupMembersTable,
  groupPostsTable,
  groupsTable,
  notificationsTable,
  type GroupDigestFrequency,
} from "@workspace/db";
import { logger } from "./logger";
import { isEmailConfigured, sendEmail, type SendEmailResult } from "./email";
import { getSupabaseAdmin } from "./supabase-admin";

export const GROUP_DIGEST_KIND = "group_digest";

export const GROUP_DIGEST_WINDOW_MS: Record<GroupDigestFrequency, number> = {
  daily: 24 * 3600_000,
  weekly: 7 * 24 * 3600_000,
};

export const GROUP_DIGEST_INTERVAL_MS = Math.max(
  60_000,
  Number(process.env["GROUP_DIGEST_INTERVAL_MS"] ?? "3600000"),
);

/** Safety cap on memberships scanned per pass (oldest joins first). */
export const GROUP_DIGEST_BATCH = 1000;

/* ── Preferences ─────────────────────────────────────────────────────── */

export interface GroupDigestPrefsWire {
  enabled: boolean;
  frequency: GroupDigestFrequency;
  email_enabled: boolean;
}

export const DEFAULT_GROUP_DIGEST_PREFS: GroupDigestPrefsWire = {
  enabled: true,
  frequency: "weekly",
  email_enabled: false,
};

export type GroupDigestPrefsPatch = Partial<GroupDigestPrefsWire>;

export function normalizeGroupDigestFrequency(v: unknown): GroupDigestFrequency {
  return v === "daily" ? "daily" : "weekly";
}

/** Storage seam: the drizzle store in production, an in-memory store
 *  in tests — identical read/merge/write rules against either
 *  (the sound-prefs house pattern). */
export interface GroupDigestPrefsStore {
  getRow(userId: string): Promise<GroupDigestPrefsWire | null>;
  upsertRow(userId: string, prefs: GroupDigestPrefsWire): Promise<void>;
}

function rowToWire(row: {
  enabled: boolean;
  frequency: string;
  emailEnabled: boolean;
}): GroupDigestPrefsWire {
  return {
    enabled: row.enabled,
    frequency: normalizeGroupDigestFrequency(row.frequency),
    email_enabled: row.emailEnabled,
  };
}

export const drizzleGroupDigestPrefsStore: GroupDigestPrefsStore = {
  async getRow(userId) {
    const rows = await db
      .select()
      .from(groupDigestPrefsTable)
      .where(eq(groupDigestPrefsTable.userId, userId))
      .limit(1);
    return rows[0] ? rowToWire(rows[0]) : null;
  },
  async upsertRow(userId, prefs) {
    await db
      .insert(groupDigestPrefsTable)
      .values({
        userId,
        enabled: prefs.enabled,
        frequency: prefs.frequency,
        emailEnabled: prefs.email_enabled,
      })
      .onConflictDoUpdate({
        target: groupDigestPrefsTable.userId,
        set: {
          enabled: prefs.enabled,
          frequency: prefs.frequency,
          emailEnabled: prefs.email_enabled,
          updatedAt: new Date(),
        },
      });
  },
};

/** The account's digest prefs — the default (on / weekly / bell-only)
 *  when no row exists yet. */
export async function getGroupDigestPrefs(
  store: GroupDigestPrefsStore,
  userId: string,
): Promise<GroupDigestPrefsWire> {
  const row = await store.getRow(userId);
  return row ?? { ...DEFAULT_GROUP_DIGEST_PREFS };
}

/** Merge a partial patch over the current prefs (or the default) and
 *  persist the full row. Returns the persisted prefs. */
export async function setGroupDigestPrefs(
  store: GroupDigestPrefsStore,
  userId: string,
  patch: GroupDigestPrefsPatch,
): Promise<GroupDigestPrefsWire> {
  const current = await getGroupDigestPrefs(store, userId);
  const next: GroupDigestPrefsWire = {
    enabled: patch.enabled ?? current.enabled,
    frequency:
      patch.frequency !== undefined
        ? normalizeGroupDigestFrequency(patch.frequency)
        : current.frequency,
    email_enabled: patch.email_enabled ?? current.email_enabled,
  };
  await store.upsertRow(userId, next);
  return next;
}

/* ── Aggregation ─────────────────────────────────────────────────────── */

export interface GroupActivityTopPost {
  body: string;
  likeCount: number;
}

export interface GroupActivity {
  newPosts: number;
  newThreads: number;
  newReplies: number;
  newMembers: number;
  topPost: GroupActivityTopPost | null;
}

export function totalActivity(a: GroupActivity): number {
  return a.newPosts + a.newThreads + a.newReplies + a.newMembers;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function snippet(body: string, max = 90): string {
  const clean = body.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

/** The digest copy for one group window, or null when there is nothing
 *  to report (the sweep sends nothing for a null — empty groups and
 *  quiet windows stay silent). Pure: the tests pin the arithmetic and
 *  the wording here. */
export function buildDigestContent(
  groupName: string,
  frequency: GroupDigestFrequency,
  activity: GroupActivity,
): { title: string; body: string } | null {
  if (totalActivity(activity) === 0) return null;
  const parts: string[] = [];
  if (activity.newPosts > 0) parts.push(plural(activity.newPosts, "new post", "new posts"));
  if (activity.newThreads > 0)
    parts.push(plural(activity.newThreads, "new forum thread", "new forum threads"));
  if (activity.newReplies > 0)
    parts.push(plural(activity.newReplies, "forum reply", "forum replies"));
  if (activity.newMembers > 0)
    parts.push(plural(activity.newMembers, "new member", "new members"));
  let body = `Since your last digest: ${parts.join(", ")}.`;
  if (activity.topPost && activity.topPost.likeCount > 0) {
    body += ` Most liked: “${snippet(activity.topPost.body)}” (${activity.topPost.likeCount} likes).`;
  }
  return {
    title: `${groupName} — your ${frequency === "daily" ? "daily" : "weekly"} digest`,
    body,
  };
}

/** Due = a full window has elapsed since the high-water mark. */
export function isDigestDue(now: Date, since: Date, frequency: GroupDigestFrequency): boolean {
  return now.getTime() - since.getTime() >= GROUP_DIGEST_WINDOW_MS[frequency];
}

/* ── Sweep store seam ────────────────────────────────────────────────── */

export interface DigestMembership {
  groupId: string;
  groupSlug: string;
  groupName: string;
  userId: string;
  joinedAt: Date;
}

export interface GroupDigestStore {
  listMemberships(): Promise<DigestMembership[]>;
  aggregate(
    groupId: string,
    recipientUserId: string,
    since: Date,
    until: Date,
  ): Promise<GroupActivity>;
  lastDeliveryEnd(userId: string, groupId: string): Promise<Date | null>;
  /** Claim + notify atomically: insert the ledger row (channels =
   *  'notification') and the bell notification together. Returns false
   *  when the claim was already taken (duplicate/racing sweep). */
  claimAndNotify(input: {
    userId: string;
    groupId: string;
    periodStart: Date;
    periodEnd: Date;
    title: string;
    body: string;
    link: string;
  }): Promise<boolean>;
  setDeliveryChannels(
    userId: string,
    groupId: string,
    periodEnd: Date,
    channels: string,
  ): Promise<void>;
}

async function countWhere(
  table: typeof groupPostsTable | typeof groupForumThreadsTable | typeof groupForumRepliesTable,
  groupId: string,
  recipientUserId: string,
  since: Date,
  until: Date,
): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(table)
    .where(
      and(
        eq(table.groupId, groupId),
        ne(table.authorUserId, recipientUserId),
        gte(table.createdAt, since),
        lt(table.createdAt, until),
      ),
    );
  return rows[0]?.n ?? 0;
}

export const drizzleGroupDigestStore: GroupDigestStore = {
  async listMemberships() {
    const rows = await db
      .select({
        groupId: groupMembersTable.groupId,
        groupSlug: groupsTable.slug,
        groupName: groupsTable.name,
        userId: groupMembersTable.userId,
        joinedAt: groupMembersTable.joinedAt,
      })
      .from(groupMembersTable)
      .innerJoin(groupsTable, eq(groupMembersTable.groupId, groupsTable.id))
      .orderBy(groupMembersTable.joinedAt)
      .limit(GROUP_DIGEST_BATCH);
    return rows;
  },

  async aggregate(groupId, recipientUserId, since, until) {
    const [newPosts, newThreads, newReplies, memberRows, topRows] = await Promise.all([
      countWhere(groupPostsTable, groupId, recipientUserId, since, until),
      countWhere(groupForumThreadsTable, groupId, recipientUserId, since, until),
      countWhere(groupForumRepliesTable, groupId, recipientUserId, since, until),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(groupMembersTable)
        .where(
          and(
            eq(groupMembersTable.groupId, groupId),
            ne(groupMembersTable.userId, recipientUserId),
            gte(groupMembersTable.joinedAt, since),
            lt(groupMembersTable.joinedAt, until),
          ),
        ),
      db
        .select({ body: groupPostsTable.body, likeCount: groupPostsTable.likeCount })
        .from(groupPostsTable)
        .where(
          and(
            eq(groupPostsTable.groupId, groupId),
            ne(groupPostsTable.authorUserId, recipientUserId),
            gte(groupPostsTable.createdAt, since),
            lt(groupPostsTable.createdAt, until),
          ),
        )
        .orderBy(desc(groupPostsTable.likeCount), desc(groupPostsTable.createdAt))
        .limit(1),
    ]);
    return {
      newPosts,
      newThreads,
      newReplies,
      newMembers: memberRows[0]?.n ?? 0,
      topPost: topRows[0] ? { body: topRows[0].body, likeCount: topRows[0].likeCount } : null,
    };
  },

  async lastDeliveryEnd(userId, groupId) {
    const rows = await db
      .select({ periodEnd: groupDigestDeliveriesTable.periodEnd })
      .from(groupDigestDeliveriesTable)
      .where(
        and(
          eq(groupDigestDeliveriesTable.userId, userId),
          eq(groupDigestDeliveriesTable.groupId, groupId),
        ),
      )
      .orderBy(desc(groupDigestDeliveriesTable.periodEnd))
      .limit(1);
    return rows[0]?.periodEnd ?? null;
  },

  async claimAndNotify(input) {
    return db.transaction(async (tx) => {
      const claimed = await tx
        .insert(groupDigestDeliveriesTable)
        .values({
          userId: input.userId,
          groupId: input.groupId,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          channels: "notification",
        })
        .onConflictDoNothing()
        .returning({ id: groupDigestDeliveriesTable.id });
      if (claimed.length === 0) return false;
      await tx.insert(notificationsTable).values({
        userId: input.userId,
        kind: GROUP_DIGEST_KIND,
        title: input.title,
        body: input.body,
        link: input.link,
      });
      return true;
    });
  },

  async setDeliveryChannels(userId, groupId, periodEnd, channels) {
    await db
      .update(groupDigestDeliveriesTable)
      .set({ channels })
      .where(
        and(
          eq(groupDigestDeliveriesTable.userId, userId),
          eq(groupDigestDeliveriesTable.groupId, groupId),
          eq(groupDigestDeliveriesTable.periodEnd, periodEnd),
        ),
      );
  },
};

/* ── Email channel ───────────────────────────────────────────────────── */

/** Resolve a member's email through Supabase Auth admin — the same
 *  lookup stripe-connect's getUserEmail performs. Null when unknown;
 *  a null address simply means the email channel stays silent. */
export async function resolveGroupDigestEmail(userId: string): Promise<string | null> {
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin.auth.admin.getUserById(userId);
    if (error || !data?.user?.email) return null;
    return data.user.email;
  } catch {
    return null;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildDigestEmailHtml(title: string, body: string, link: string): string {
  const base = (process.env["PUBLIC_SITE_URL"] ?? "https://bowdownvisuals.com").replace(/\/$/, "");
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a1a1a">
  <h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(title)}</h1>
  <p style="font-size:15px;line-height:1.55;margin:0 0 20px">${escapeHtml(body)}</p>
  <a href="${base}${escapeHtml(link)}" style="display:inline-block;background:#C9A84C;color:#111;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Open the group</a>
  <p style="font-size:12px;color:#777;margin-top:24px">You get this because group digest emails are on in your Bow Down Visuals settings. Turn them off any time in Settings → Group digests.</p>
</div>`;
}

/* ── The sweep ───────────────────────────────────────────────────────── */

export interface GroupDigestDeps {
  prefsStore?: GroupDigestPrefsStore;
  store?: GroupDigestStore;
  now?: Date;
  resolveEmail?: (userId: string) => Promise<string | null>;
  sendEmailFn?: (opts: {
    to: string;
    subject: string;
    html: string;
    text?: string;
  }) => Promise<SendEmailResult>;
  emailConfigured?: () => boolean;
}

export interface GroupDigestSummary {
  skipped: boolean;
  error: boolean;
  checked: number;
  sent: number;
  emailed: number;
}

let lastRunAt = 0;

/** Test hook: reset the throttle so a suite can run passes back to back. */
export function __resetGroupDigestThrottle(): void {
  lastRunAt = 0;
}

/**
 * One digest pass. Never throws — the poller phase also guards, but a
 * digest that can crash its host is worse than a digest that skips.
 * Returns how many NEW digests were delivered (bell) and emailed.
 */
export async function runGroupDigestSweep(
  opts?: { force?: boolean; deps?: GroupDigestDeps },
): Promise<GroupDigestSummary> {
  const empty: GroupDigestSummary = { skipped: false, error: false, checked: 0, sent: 0, emailed: 0 };
  const deps = opts?.deps ?? {};
  const now = deps.now ?? new Date();
  if (!opts?.force && lastRunAt > 0 && now.getTime() - lastRunAt < GROUP_DIGEST_INTERVAL_MS) {
    return { ...empty, skipped: true };
  }
  lastRunAt = now.getTime();

  const prefsStore = deps.prefsStore ?? drizzleGroupDigestPrefsStore;
  const store = deps.store ?? drizzleGroupDigestStore;
  const resolveEmail = deps.resolveEmail ?? resolveGroupDigestEmail;
  const sendEmailFn = deps.sendEmailFn ?? sendEmail;
  const emailConfigured = deps.emailConfigured ?? isEmailConfigured;

  let memberships: DigestMembership[];
  try {
    memberships = await store.listMemberships();
  } catch (err) {
    // Tables may not exist yet on a fresh database — non-fatal, fail closed.
    logger.warn({ err }, "[group-digest] membership scan failed; skipping pass");
    return { ...empty, error: true };
  }

  /* Prefs for every distinct member FIRST: if opt-outs cannot be read,
     nobody is sent anything this pass (fail closed). */
  const prefsByUser = new Map<string, GroupDigestPrefsWire>();
  try {
    for (const userId of new Set(memberships.map((m) => m.userId))) {
      prefsByUser.set(userId, await getGroupDigestPrefs(prefsStore, userId));
    }
  } catch (err) {
    logger.warn({ err }, "[group-digest] prefs load failed; aborting pass (fail closed)");
    return { ...empty, error: true };
  }

  const summary: GroupDigestSummary = { ...empty, checked: memberships.length };
  for (const m of memberships) {
    try {
      const prefs = prefsByUser.get(m.userId);
      if (!prefs || !prefs.enabled) continue; // opt-out honored
      const lastEnd = await store.lastDeliveryEnd(m.userId, m.groupId);
      const since = lastEnd ?? m.joinedAt;
      if (!isDigestDue(now, since, prefs.frequency)) continue;
      const activity = await store.aggregate(m.groupId, m.userId, since, now);
      const content = buildDigestContent(m.groupName, prefs.frequency, activity);
      if (!content) continue; // quiet window: send nothing, keep the high-water mark
      const link = `/groups/${m.groupSlug}`;
      const claimed = await store.claimAndNotify({
        userId: m.userId,
        groupId: m.groupId,
        periodStart: since,
        periodEnd: now,
        title: content.title,
        body: content.body,
        link,
      });
      if (!claimed) continue; // a racing sweep already delivered this period
      summary.sent++;

      /* Email channel: opt-in only, and only recorded when the rail
         confirms the send. No provider key → sendEmail reports
         sent:false and the ledger honestly stays 'notification'. */
      if (prefs.email_enabled && emailConfigured()) {
        const address = await resolveEmail(m.userId).catch(() => null);
        if (address) {
          const result = await sendEmailFn({
            to: address,
            subject: content.title,
            text: `${content.body}\n\nOpen the group: ${link}`,
            html: buildDigestEmailHtml(content.title, content.body, link),
          }).catch(() => ({ sent: false }) as SendEmailResult);
          if (result.sent) {
            summary.emailed++;
            await store
              .setDeliveryChannels(m.userId, m.groupId, now, "notification+email")
              .catch((err) =>
                logger.warn({ err, userId: m.userId }, "[group-digest] channel stamp failed"),
              );
          }
        }
      }
    } catch (err) {
      logger.warn(
        { err, userId: m.userId, groupId: m.groupId },
        "[group-digest] digest failed for one membership; continuing",
      );
    }
  }
  if (summary.sent > 0) {
    logger.info(
      { sent: summary.sent, emailed: summary.emailed, checked: summary.checked },
      "[group-digest] pass complete",
    );
  }
  return summary;
}
