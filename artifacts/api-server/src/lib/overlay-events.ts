import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  db,
  creatorOverlayTokensTable,
  creatorProfilesTable,
} from "@workspace/db";
import { RoomHub } from "./live-ws";
import { logger } from "./logger";

/* ── Stream overlay events (stack900 lane C2) ────────────────────────────
   The fan-out behind the overlay pages a creator pastes into OBS /
   Streamlabs as browser sources (/overlay/alerts, /overlay/goal).

   WHY A NEW HUB: the rails that already move these moments — the
   live chat socket (session-authed, per-stream) and notifyUserEvent
   (bell rows + device push) — can't be subscribed to by a browser
   source, which holds no site session. So the overlay hub is fed at
   the SAME points those rails are fed (the tip handler, the follow
   handler, the membership joins, the World stage-tip credit), with
   the same names and amounts they carry. One event, two doors —
   never a second, invented feed.

   The only credential an overlay ever holds is the creator's
   overlay token (creator_overlay_tokens, migration 0300): random,
   revocable, read-only. Nothing here can move money or change
   state; every emit is best-effort and never throws into a money
   path. */

export type OverlayAlertKind = "tip" | "follow" | "member" | "test";

export interface OverlayAlert {
  kind: OverlayAlertKind;
  /** The line the alert pops with — the same words the bell carries. */
  title: string;
  /** The fan's own words (a tip message) or a short context line. */
  body: string | null;
  /** Tips only: the Visual Bucs amount that actually moved. */
  amountVb: number | null;
  /** Desk-fired test alerts only — the overlay labels them TEST. */
  test: boolean;
  at: string;
}

export type OverlaySocketMessage =
  | { type: "alert"; alert: OverlayAlert }
  /** State changed under the overlay (e.g. the tip goal was edited):
   *  the client refetches GET /api/overlay/state. */
  | { type: "refresh" };

export const overlayHub = new RoomHub();

export function overlayRoom(userId: string): string {
  return `overlay:${userId}`;
}

/** Broadcast one alert to every overlay the creator has open.
 *  Best-effort by design: an overlay hiccup must never fail a tip,
 *  a follow, or a membership join. */
export function emitOverlayAlert(
  userId: string,
  alert: {
    kind: OverlayAlertKind;
    title: string;
    body?: string | null;
    amountVb?: number | null;
    test?: boolean;
  },
): void {
  try {
    const full: OverlayAlert = {
      kind: alert.kind,
      title: alert.title,
      body: alert.body ?? null,
      amountVb: alert.amountVb ?? null,
      test: alert.test ?? false,
      at: new Date().toISOString(),
    };
    overlayHub.broadcast(overlayRoom(userId), {
      type: "alert",
      alert: full,
    } satisfies OverlaySocketMessage);
  } catch (err) {
    logger.warn({ err, userId }, "overlay alert emit failed (event itself landed)");
  }
}

/** Nudge open overlays to refetch their state (goal edits, etc.). */
export function emitOverlayRefresh(userId: string): void {
  try {
    overlayHub.broadcast(overlayRoom(userId), {
      type: "refresh",
    } satisfies OverlaySocketMessage);
  } catch (err) {
    logger.warn({ err, userId }, "overlay refresh emit failed");
  }
}

/** A membership join alert, with the fan's name resolved the same
 *  way the tip alerts resolve tipper names (their creator-profile
 *  display name, "Someone" when they have none). */
export async function emitOverlayMemberAlert(
  creatorUserId: string,
  fanUserId: string,
  tierName: string | null,
): Promise<void> {
  try {
    const rows = await db
      .select({ displayName: creatorProfilesTable.displayName })
      .from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.userId, fanUserId))
      .limit(1);
    const name = rows[0]?.displayName ?? "Someone";
    emitOverlayAlert(creatorUserId, {
      kind: "member",
      title: tierName ? `${name} just joined ${tierName}` : `${name} just became a member`,
      body: "A new member just walked in — say welcome.",
    });
  } catch (err) {
    logger.warn({ err, creatorUserId }, "overlay member alert failed (join itself landed)");
  }
}

/* ── Overlay tokens ──────────────────────────────────────────────────────
   256 bits of randomness, base64url. The token names no user and
   grants nothing but the read-only overlay surface. One row per
   creator; reset rewrites the row, so the old token stops
   resolving immediately. */

const OVERLAY_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function isOverlayTokenShape(token: string): boolean {
  return OVERLAY_TOKEN_RE.test(token);
}

export function newOverlayToken(): string {
  return randomBytes(32).toString("base64url");
}

/** The creator's overlay token, minted on first ask. */
export async function getOrCreateOverlayToken(userId: string): Promise<string> {
  const rows = await db
    .select()
    .from(creatorOverlayTokensTable)
    .where(eq(creatorOverlayTokensTable.userId, userId))
    .limit(1);
  if (rows[0]) return rows[0].token;
  const token = newOverlayToken();
  await db
    .insert(creatorOverlayTokensTable)
    .values({ userId, token })
    .onConflictDoNothing();
  const after = await db
    .select()
    .from(creatorOverlayTokensTable)
    .where(eq(creatorOverlayTokensTable.userId, userId))
    .limit(1);
  return after[0]?.token ?? token;
}

/** Replace the creator's token. Every overlay URL carrying the old
 *  token dies the moment this lands. */
export async function resetOverlayToken(userId: string): Promise<string> {
  const token = newOverlayToken();
  await db
    .insert(creatorOverlayTokensTable)
    .values({ userId, token })
    .onConflictDoUpdate({
      target: creatorOverlayTokensTable.userId,
      set: { token, updatedAt: new Date() },
    });
  return token;
}

/** Token → creator user id, or null. Shape-checked first so junk
 *  never reaches the database. */
export async function resolveOverlayToken(token: string): Promise<string | null> {
  if (!isOverlayTokenShape(token)) return null;
  const rows = await db
    .select({ userId: creatorOverlayTokensTable.userId })
    .from(creatorOverlayTokensTable)
    .where(eq(creatorOverlayTokensTable.token, token))
    .limit(1);
  return rows[0]?.userId ?? null;
}
