import webpush from "web-push";
import { eq } from "drizzle-orm";
import { db, pushSubscriptionsTable, type PushSubscriptionRow } from "@workspace/db";
import { logger } from "./logger";

/* ── Web push delivery ───────────────────────────────────────────────────
   The push channel for in-app alerts (go-live today). VAPID keys come
   from env (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT). When
   they are unset in an environment, push is simply off: callers still
   land their in-app notification, and sendPushToUser no-ops with a
   logged reason — it NEVER pretends a push was sent. Dead endpoints
   (404/410 from the push service) are pruned so the table stays real. */

export interface PushPayload {
  title: string;
  body: string;
  /** Deep link the notification click opens. */
  link: string;
  kind: string;
}

export interface PushConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export function pushConfig(env: NodeJS.ProcessEnv = process.env): PushConfig | null {
  const publicKey = env["VAPID_PUBLIC_KEY"]?.trim() ?? "";
  const privateKey = env["VAPID_PRIVATE_KEY"]?.trim() ?? "";
  if (!publicKey || !privateKey) return null;
  return {
    publicKey,
    privateKey,
    subject: env["VAPID_SUBJECT"]?.trim() || "https://bowdownvisuals.com",
  };
}

export function isPushConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return pushConfig(env) !== null;
}

export interface PushSendResult {
  sent: number;
  pruned: number;
  failed: number;
  /** Set when nothing was attempted at all — the honest reason. */
  skippedReason: "vapid_unset" | "no_subscriptions" | null;
}

type Sender = (sub: PushSubscriptionRow, payloadJson: string) => Promise<void>;

function realSender(config: PushConfig): Sender {
  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  return async (sub, payloadJson) => {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      payloadJson,
    );
  };
}

/**
 * Deliver one payload to one subscription list. Split out from the
 * DB/VAPID wiring so tests can drive it with a fake sender.
 */
export async function deliverPushToSubscriptions(
  subscriptions: PushSubscriptionRow[],
  payload: PushPayload,
  sender: Sender,
  prune: (sub: PushSubscriptionRow) => Promise<void>,
): Promise<PushSendResult> {
  const result: PushSendResult = {
    sent: 0,
    pruned: 0,
    failed: 0,
    skippedReason: subscriptions.length === 0 ? "no_subscriptions" : null,
  };
  const payloadJson = JSON.stringify(payload);
  for (const sub of subscriptions) {
    try {
      await sender(sub, payloadJson);
      result.sent++;
    } catch (err) {
      const statusCode = (err as { statusCode?: number })?.statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await prune(sub).catch(() => undefined);
        result.pruned++;
      } else {
        result.failed++;
        logger.warn({ err, endpoint: sub.endpoint }, "push: send failed");
      }
    }
  }
  return result;
}

/** Send a push to every subscription a user has registered. */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PushSendResult> {
  const config = pushConfig(env);
  if (!config) {
    logger.info({ userId, kind: payload.kind }, "push: skipped — VAPID keys are not set in this environment");
    return { sent: 0, pruned: 0, failed: 0, skippedReason: "vapid_unset" };
  }
  const subs = await db
    .select()
    .from(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.user_id, userId));
  return deliverPushToSubscriptions(subs, payload, realSender(config), async (sub) => {
    await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.id, sub.id));
  });
}
