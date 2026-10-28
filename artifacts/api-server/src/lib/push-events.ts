import { eq } from "drizzle-orm";
import {
  db,
  notificationsTable,
  pushNotificationPrefsTable,
  type PushNotificationPrefs,
} from "@workspace/db";
import { logger } from "./logger";
import { sendPushToUser, type PushSendResult } from "./push";

/* ── Push events — the one door every device ping goes through ─────────
   Owner directive (Oct 28, 2026): "my app should have real
   notifications that ping your devices."

   notifyUserEvent is the single entry point for an event that may ping
   a user's devices:
     1. The in-app bell row ALWAYS lands (notifications table) — a
        preference silences the ping, never the record.
     2. The OS-level push is sent only when the user has that event
        category switched on (push_notification_prefs, migration 0299;
        no row = the defaults below).
   It never throws: callers sit on money and go-live paths where a
   notification failure must not fail the real work. */

export type PushCategory = "money" | "messages" | "live" | "mentions" | "social";

export const PUSH_CATEGORIES: readonly PushCategory[] = [
  "money",
  "messages",
  "live",
  "mentions",
  "social",
] as const;

/** The defaults the Settings control presents (no prefs row = these). */
export const PUSH_CATEGORY_DEFAULTS: Record<PushCategory, boolean> = {
  money: true,
  messages: true,
  live: true,
  mentions: true,
  social: false,
};

export type PushPreferenceMap = Record<PushCategory, boolean>;

const CATEGORY_COLUMN: Record<PushCategory, keyof PushNotificationPrefs> = {
  money: "moneyEnabled",
  messages: "messagesEnabled",
  live: "liveEnabled",
  mentions: "mentionsEnabled",
  social: "socialEnabled",
};

export function prefsFromRow(row: PushNotificationPrefs | undefined): PushPreferenceMap {
  if (!row) return { ...PUSH_CATEGORY_DEFAULTS };
  const out = { ...PUSH_CATEGORY_DEFAULTS };
  for (const category of PUSH_CATEGORIES) {
    const value = row[CATEGORY_COLUMN[category]];
    if (typeof value === "boolean") out[category] = value;
  }
  return out;
}

/** The user's resolved push preferences (defaults when unset). */
export async function getPushPreferences(userId: string): Promise<PushPreferenceMap> {
  const rows = await db
    .select()
    .from(pushNotificationPrefsTable)
    .where(eq(pushNotificationPrefsTable.userId, userId))
    .limit(1);
  return prefsFromRow(rows[0]);
}

/** Upsert a partial preference change; returns the resolved map. */
export async function updatePushPreferences(
  userId: string,
  patch: Partial<PushPreferenceMap>,
): Promise<PushPreferenceMap> {
  const set: Partial<PushNotificationPrefs> = { updatedAt: new Date() };
  for (const category of PUSH_CATEGORIES) {
    if (typeof patch[category] === "boolean") {
      (set as Record<string, unknown>)[CATEGORY_COLUMN[category] as string] = patch[category];
    }
  }
  const inserted = await db
    .insert(pushNotificationPrefsTable)
    .values({ userId, ...set })
    .onConflictDoUpdate({ target: pushNotificationPrefsTable.userId, set })
    .returning();
  return prefsFromRow(inserted[0]);
}

export interface UserEventInput {
  userId: string;
  category: PushCategory;
  /** Bell/push kind string (e.g. "sale", "export_done", "live"). */
  kind: string;
  title: string;
  body: string;
  /** In-app path the notification click opens ("/earnings"). */
  link: string;
}

export interface UserEventResult {
  bellLanded: boolean;
  /** Null when the category is switched off for this user. */
  push: PushSendResult | null;
  pushSkippedReason: "category_off" | null;
}

export interface NotifyDeps {
  getPrefs: (userId: string) => Promise<PushPreferenceMap>;
  insertBell: (input: UserEventInput) => Promise<void>;
  sendPush: (userId: string, payload: { title: string; body: string; link: string; kind: string }) => Promise<PushSendResult>;
}

const realDeps: NotifyDeps = {
  getPrefs: getPushPreferences,
  insertBell: async (input) => {
    await db.insert(notificationsTable).values({
      userId: input.userId,
      kind: input.kind,
      title: input.title,
      body: input.body,
      link: input.link,
    });
  },
  sendPush: (userId, payload) => sendPushToUser(userId, payload),
};

/**
 * Land the bell row and, when the category is on for this user, ping
 * their devices. Never throws.
 */
export async function notifyUserEvent(
  input: UserEventInput,
  deps: NotifyDeps = realDeps,
): Promise<UserEventResult> {
  const result: UserEventResult = { bellLanded: false, push: null, pushSkippedReason: null };
  try {
    await deps.insertBell(input);
    result.bellLanded = true;
  } catch (err) {
    logger.error({ err, userId: input.userId, kind: input.kind }, "push-events: bell insert failed");
  }
  try {
    const prefs = await deps.getPrefs(input.userId);
    if (!prefs[input.category]) {
      result.pushSkippedReason = "category_off";
      return result;
    }
    result.push = await deps.sendPush(input.userId, {
      title: input.title,
      body: input.body,
      link: input.link,
      kind: input.kind,
    });
  } catch (err) {
    logger.error({ err, userId: input.userId, kind: input.kind }, "push-events: push leg failed");
  }
  return result;
}

/**
 * Push-only gate for fan-outs that keep their own bell/dedupe handling
 * (the go-live ledger in live-alerts.ts): returns the send result, or
 * null when the category is off for this user. Never throws.
 */
export async function pushIfCategoryEnabled(
  userId: string,
  category: PushCategory,
  payload: { title: string; body: string; link: string; kind: string },
  deps: Pick<NotifyDeps, "getPrefs" | "sendPush"> = realDeps,
): Promise<PushSendResult | null> {
  try {
    const prefs = await deps.getPrefs(userId);
    if (!prefs[category]) return null;
    return await deps.sendPush(userId, payload);
  } catch (err) {
    logger.warn({ err, userId, kind: payload.kind }, "push-events: gated push failed");
    return null;
  }
}
