import { eq } from "drizzle-orm";
import {
  db,
  followsTable,
  notificationsTable,
  liveGoLiveDeliveriesTable,
  type LiveStream,
} from "@workspace/db";
import { logger } from "./logger";
import { sendPushToUser } from "./push";

/* ── Go-live alerts ──────────────────────────────────────────────────────
   When a creator goes live, every follower gets exactly one alert:
   an in-app notification (the notifications table) plus a web push
   for followers who registered one. Exactly-once is enforced by the
   live_go_live_deliveries ledger (migration 0133): a follower's row
   is inserted ON CONFLICT DO NOTHING and only a row that actually
   lands produces a notification — a retried or double-fired go-live
   path can never double-notify. Push failure never blocks the
   in-app alert, and unset VAPID keys make push a logged no-op. */

export interface GoLiveAlertResult {
  followers: number;
  notified: number;
  /** Followers whose delivery row already existed (a repeat fire). */
  alreadyDelivered: number;
  pushSent: number;
}

export async function fanOutGoLiveAlerts(
  stream: Pick<LiveStream, "id" | "user_id" | "profile_id" | "title">,
  creator: { displayName: string; slug: string },
): Promise<GoLiveAlertResult> {
  const result: GoLiveAlertResult = { followers: 0, notified: 0, alreadyDelivered: 0, pushSent: 0 };
  try {
    const followerRows = await db
      .select({ followerUserId: followsTable.followerUserId })
      .from(followsTable)
      .where(eq(followsTable.profileId, stream.profile_id));
    const followerIds = [...new Set(followerRows.map((r) => r.followerUserId))].filter(
      (id) => id !== stream.user_id,
    );
    result.followers = followerIds.length;

    const title = `${creator.displayName} is live: ${stream.title}`;
    const body = "Tap to watch on their page.";
    const link = `/live/${stream.id}`;

    for (const followerUserId of followerIds) {
      const landed = await db
        .insert(liveGoLiveDeliveriesTable)
        .values({ stream_id: stream.id, follower_user_id: followerUserId })
        .onConflictDoNothing()
        .returning();
      if (!landed[0]) {
        result.alreadyDelivered++;
        continue;
      }
      await db.insert(notificationsTable).values({
        userId: followerUserId,
        kind: "live",
        title,
        body,
        link,
      });
      result.notified++;
      // Push rides along best-effort: unset keys / dead endpoints are
      // handled (and logged) inside sendPushToUser.
      const push = await sendPushToUser(followerUserId, { title, body, link, kind: "live" }).catch(
        (err) => {
          logger.warn({ err, followerUserId }, "go-live alert: push attempt failed");
          return null;
        },
      );
      if (push) result.pushSent += push.sent;
    }
  } catch (err) {
    // Alerts are a fan-out off the go-live path: a failure here must
    // never fail the stream creation itself, but it is logged loudly.
    logger.error({ err, streamId: stream.id }, "go-live alert fan-out failed");
  }
  return result;
}
