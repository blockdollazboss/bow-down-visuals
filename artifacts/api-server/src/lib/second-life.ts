/* ─── Second Life (#161) — UPGRADE of Viral Spike Watch ────────────────
   The spike watch already detects a back-catalog item gaining speed
   and alerts its creator once per episode. This delta adds the two
   things the audit scoped on top of it:

   1. THE ONE-TAP REVIVAL, attached to the alert. When a spike fires,
      a revival PROPOSAL is recorded alongside the notification: re-cut
      the item as a short + a fresh cover, both as pre-loaded Create
      links. A proposal is a plan, never an action — it sits at
      'proposed' until the creator approves or dismisses it, and
      approving posts NOTHING (the creator publishes from Create).

   2. THE SETTINGS OFF-SWITCH for catalog watching. One row per
      account in second_life_prefs; no row = watching ON (the shipped
      default). Off means the watch skips the creator's catalog
      entirely — no alerts, no proposals.

   Honesty rules carried from the watch itself: the numbers stored on
   a proposal are the REAL play_events counts from the spike
   evaluation that fired it; the plan is built only from the spiking
   item's own ids — nothing is synthesized. */

import { db, secondLifePrefsTable, secondLifeRevivalsTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { logger } from "./logger";
import type { SpikeEvaluation, SpikeKind, SpikeWindowRow } from "./viral-spike-watch";

/* ── Watch prefs ──────────────────────────────────────────────────── */

export interface SecondLifePrefsWire {
  watch_enabled: boolean;
}

export const DEFAULT_SECOND_LIFE_PREFS: SecondLifePrefsWire = { watch_enabled: true };

export interface SecondLifePrefsStore {
  getRow(userId: string): Promise<SecondLifePrefsWire | null>;
  upsertRow(userId: string, prefs: SecondLifePrefsWire): Promise<void>;
}

export const drizzleSecondLifePrefsStore: SecondLifePrefsStore = {
  async getRow(userId) {
    const rows = await db
      .select()
      .from(secondLifePrefsTable)
      .where(eq(secondLifePrefsTable.userId, userId))
      .limit(1);
    const row = rows[0];
    return row ? { watch_enabled: row.watchEnabled } : null;
  },
  async upsertRow(userId, prefs) {
    await db
      .insert(secondLifePrefsTable)
      .values({ userId, watchEnabled: prefs.watch_enabled })
      .onConflictDoUpdate({
        target: secondLifePrefsTable.userId,
        set: { watchEnabled: prefs.watch_enabled, updatedAt: new Date() },
      });
  },
};

export async function getSecondLifePrefs(
  store: SecondLifePrefsStore,
  userId: string,
): Promise<SecondLifePrefsWire> {
  return (await store.getRow(userId)) ?? { ...DEFAULT_SECOND_LIFE_PREFS };
}

export async function setSecondLifeWatchEnabled(
  store: SecondLifePrefsStore,
  userId: string,
  watchEnabled: boolean,
): Promise<SecondLifePrefsWire> {
  const prefs: SecondLifePrefsWire = { watch_enabled: watchEnabled };
  await store.upsertRow(userId, prefs);
  return prefs;
}

/** The watch's gate. An opt-out is a deliberate act recorded in a
 *  row; an UNREADABLE pref (e.g. the provisional migration not yet
 *  applied at join) is not an opt-out — the watch keeps its shipped
 *  default (on) and the failure is logged, never silent. */
export async function isSecondLifeWatchEnabled(userId: string): Promise<boolean> {
  try {
    const prefs = await getSecondLifePrefs(drizzleSecondLifePrefsStore, userId);
    return prefs.watch_enabled;
  } catch (err) {
    logger.warn({ err, userId }, "[second-life] prefs unreadable — treating as watch-on (the default)");
    return true;
  }
}

/* ── Revival proposals ────────────────────────────────────────────── */

export interface RevivalPlanStep {
  action: "recut_short" | "fresh_cover";
  sourceKind: SpikeKind;
  sourceMediaId: string;
  /** Pre-loaded Create link — panel + source + intent. Following it
   *  is the creator's act; nothing here posts or publishes. */
  createLink: string;
}

export interface RevivalPlan {
  steps: RevivalPlanStep[];
}

/** Pure plan builder — the whole revival definition lives here.
 *  A video re-cuts in the video panel; a track's revival short is a
 *  song-video built from the track. The cover step is a fresh cover
 *  in the cover-art panel for either kind. */
export function buildRevivalPlan(row: Pick<SpikeWindowRow, "kind" | "mediaId">): RevivalPlan {
  const recutPanel = row.kind === "video" ? "video" : "song-video";
  return {
    steps: [
      {
        action: "recut_short",
        sourceKind: row.kind,
        sourceMediaId: row.mediaId,
        createLink: `/create?panel=${recutPanel}&source=${row.mediaId}&intent=recut-short`,
      },
      {
        action: "fresh_cover",
        sourceKind: row.kind,
        sourceMediaId: row.mediaId,
        createLink: `/create?panel=coverart&source=${row.mediaId}&intent=fresh-cover`,
      },
    ],
  };
}

export interface RevivalStore {
  insert(row: {
    ownerUserId: string;
    profileId: string;
    kind: SpikeKind;
    mediaId: string;
    plan: RevivalPlan;
    currentPlays: number;
    baselineDaily: number;
  }): Promise<{ id: string }>;
  listForOwner(ownerUserId: string, status?: string): Promise<Array<Record<string, unknown>>>;
  decide(id: string, ownerUserId: string, status: "approved" | "dismissed"): Promise<boolean>;
}

export const drizzleRevivalStore: RevivalStore = {
  async insert(row) {
    const inserted = await db
      .insert(secondLifeRevivalsTable)
      .values({
        ownerUserId: row.ownerUserId,
        profileId: row.profileId,
        kind: row.kind,
        mediaId: row.mediaId,
        plan: row.plan,
        currentPlays: row.currentPlays,
        baselineDaily: row.baselineDaily,
      })
      .returning({ id: secondLifeRevivalsTable.id });
    return { id: inserted[0]!.id };
  },
  async listForOwner(ownerUserId, status) {
    const rows = await db
      .select()
      .from(secondLifeRevivalsTable)
      .where(
        status
          ? and(
              eq(secondLifeRevivalsTable.ownerUserId, ownerUserId),
              eq(secondLifeRevivalsTable.status, status),
            )
          : eq(secondLifeRevivalsTable.ownerUserId, ownerUserId),
      )
      .orderBy(desc(secondLifeRevivalsTable.createdAt));
    return rows as Array<Record<string, unknown>>;
  },
  async decide(id, ownerUserId, status) {
    const updated = await db
      .update(secondLifeRevivalsTable)
      .set({ status, decidedAt: new Date() })
      .where(
        and(
          eq(secondLifeRevivalsTable.id, id),
          eq(secondLifeRevivalsTable.ownerUserId, ownerUserId),
          eq(secondLifeRevivalsTable.status, "proposed"),
        ),
      )
      .returning({ id: secondLifeRevivalsTable.id });
    return updated.length > 0;
  },
};

/** Record the proposal for a spike that just fired. Called by the
 *  watch AFTER its notification insert. A proposal failure must never
 *  un-send or crash the alert — it is logged loudly and reported via
 *  the return value so the watch summary can count it. */
export async function proposeRevivalForSpike(
  store: RevivalStore,
  row: SpikeWindowRow,
  ev: SpikeEvaluation,
): Promise<{ id: string } | null> {
  try {
    return await store.insert({
      ownerUserId: row.ownerUserId,
      profileId: row.profileId,
      kind: row.kind,
      mediaId: row.mediaId,
      plan: buildRevivalPlan(row),
      currentPlays: row.currentPlays,
      baselineDaily: ev.baselineDaily,
    });
  } catch (err) {
    logger.error(
      { err, kind: row.kind, mediaId: row.mediaId },
      "[second-life] revival proposal insert failed — spike alert stands, proposal missing",
    );
    return null;
  }
}
