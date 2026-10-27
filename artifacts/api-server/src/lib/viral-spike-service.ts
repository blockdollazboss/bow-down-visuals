/* ─── Viral-spike response kit — service (orphan wave) ──────────────────
   The wiring between the pure detector (lib/viral-spike.ts), the kit
   builder (lib/viral-spike-kit.ts) and the database (migration 9999:
   viral_spike_prefs / viral_spike_snapshots / viral_spike_alerts).

   INVARIANTS (the plan's rules, enforced here):
   - REAL SIGNALS ONLY: every check appends a timestamped snapshot of
     the content's actual cumulative counter (showcase_items.views /
     profile_videos.view_count) and runs the detector over the stored
     snapshot history. No history yet = insufficient_data, never a
     dressed-up guess.
   - CREATOR-ACTION ONLY: a fired spike records an alert row and
     returns a kit of LINKS. This module never posts, pins, or edits
     anything on the creator's behalf.
   - OPT-OUT IS TOTAL: prefs.enabled = false stops ALL sampling and
     surfacing — the check returns before a single snapshot is written,
     and the sweeper skips the account entirely.
   - ONE SPIKE, ONE KIT: the alerts table is the cooldown ledger; a
     piece of content inside its cooldown window surfaces its already-
     fired kit (rebuilt from the stored measured numbers) instead of
     firing a second one. */

import { and, desc, eq, gte } from "drizzle-orm";
import {
  db,
  creatorProfilesTable,
  profileVideosTable,
  showcaseItemsTable,
  viralSpikeAlertsTable,
  viralSpikePrefsTable,
  viralSpikeSnapshotsTable,
} from "@workspace/db";
import { logger } from "./logger";
import {
  DEFAULT_SPIKE_CONFIG,
  detectSpike,
  isInCooldown,
  type SpikeConfig,
  type SpikeVerdict,
  type ViewSample,
} from "./viral-spike";
import {
  buildViralSpikeKit,
  type SpikeContentRef,
  type ViralSpikeKit,
} from "./viral-spike-kit";

/* ── Wire shapes ─────────────────────────────────────────────────────── */

export interface ViralSpikePrefsWire {
  enabled: boolean;
}

export const DEFAULT_VIRAL_SPIKE_PREFS: ViralSpikePrefsWire = { enabled: true };

export interface ViralSpikeContentRow extends SpikeContentRef {
  /** The content's real cumulative view counter, read just now. */
  views: number;
}

export interface StoredSpikeAlert {
  content: SpikeContentRef;
  basis: "measured_multiplier" | "baseline_silent" | "first_surge";
  recentGain: number;
  recentVelocityPerHour: number;
  baselineVelocityPerHour: number | null;
  multiplier: number | null;
  detectedAtMs: number;
}

export type ViralSpikeCheckResult =
  | { status: "disabled"; sampled: 0; kits: ViralSpikeKit[]; measuring: 0 }
  | { status: "ok"; sampled: number; kits: ViralSpikeKit[]; measuring: number };

/* ── Storage seam (drizzle in production, in-memory in tests) ────────── */

export interface ViralSpikeStore {
  getPrefsRow(userId: string): Promise<{ enabled: boolean } | null>;
  upsertPrefsRow(userId: string, enabled: boolean): Promise<void>;
  listContent(userId: string): Promise<ViralSpikeContentRow[]>;
  listSnapshots(
    userId: string,
    kind: string,
    contentId: string,
    sinceMs: number,
  ): Promise<ViewSample[]>;
  appendSnapshot(
    userId: string,
    kind: string,
    contentId: string,
    views: number,
    atMs: number,
  ): Promise<void>;
  lastAlert(userId: string, kind: string, contentId: string): Promise<StoredSpikeAlert | null>;
  insertAlert(alert: StoredSpikeAlert & { userId: string }): Promise<void>;
  listWatchedUserIds(limit: number): Promise<string[]>;
}

function alertFromRow(row: typeof viralSpikeAlertsTable.$inferSelect): StoredSpikeAlert {
  return {
    content: {
      kind: row.contentKind === "short" ? "short" : "showcase",
      id: row.contentId,
      title: row.title,
    },
    basis:
      row.basis === "baseline_silent" || row.basis === "first_surge"
        ? row.basis
        : "measured_multiplier",
    recentGain: row.recentGain,
    recentVelocityPerHour: row.recentVelocityPerHour,
    baselineVelocityPerHour: row.baselineVelocityPerHour,
    multiplier: row.multiplier,
    detectedAtMs: row.detectedAt.getTime(),
  };
}

export const drizzleViralSpikeStore: ViralSpikeStore = {
  async getPrefsRow(userId) {
    const rows = await db
      .select()
      .from(viralSpikePrefsTable)
      .where(eq(viralSpikePrefsTable.userId, userId))
      .limit(1);
    const row = rows[0];
    return row ? { enabled: row.enabled } : null;
  },

  async upsertPrefsRow(userId, enabled) {
    await db
      .insert(viralSpikePrefsTable)
      .values({ userId, enabled })
      .onConflictDoUpdate({
        target: viralSpikePrefsTable.userId,
        set: { enabled, updatedAt: new Date() },
      });
  },

  async listContent(userId) {
    const showcase = await db
      .select({
        id: showcaseItemsTable.id,
        title: showcaseItemsTable.title,
        slug: showcaseItemsTable.slug,
        views: showcaseItemsTable.views,
      })
      .from(showcaseItemsTable)
      .where(eq(showcaseItemsTable.user_id, userId));
    const shorts = await db
      .select({
        id: profileVideosTable.id,
        title: profileVideosTable.title,
        views: profileVideosTable.viewCount,
      })
      .from(profileVideosTable)
      .innerJoin(
        creatorProfilesTable,
        eq(profileVideosTable.profileId, creatorProfilesTable.id),
      )
      .where(eq(creatorProfilesTable.userId, userId));
    return [
      ...showcase.map(
        (s): ViralSpikeContentRow => ({
          kind: "showcase",
          id: s.id,
          title: s.title,
          slug: s.slug,
          views: s.views,
        }),
      ),
      ...shorts.map(
        (s): ViralSpikeContentRow => ({
          kind: "short",
          id: s.id,
          title: s.title,
          views: s.views,
        }),
      ),
    ];
  },

  async listSnapshots(userId, kind, contentId, sinceMs) {
    const rows = await db
      .select()
      .from(viralSpikeSnapshotsTable)
      .where(
        and(
          eq(viralSpikeSnapshotsTable.userId, userId),
          eq(viralSpikeSnapshotsTable.contentKind, kind),
          eq(viralSpikeSnapshotsTable.contentId, contentId),
          gte(viralSpikeSnapshotsTable.recordedAt, new Date(sinceMs)),
        ),
      )
      .orderBy(viralSpikeSnapshotsTable.recordedAt);
    return rows.map((r) => ({ atMs: r.recordedAt.getTime(), views: r.views }));
  },

  async appendSnapshot(userId, kind, contentId, views, atMs) {
    await db.insert(viralSpikeSnapshotsTable).values({
      userId,
      contentKind: kind,
      contentId,
      views,
      recordedAt: new Date(atMs),
    });
  },

  async lastAlert(userId, kind, contentId) {
    const rows = await db
      .select()
      .from(viralSpikeAlertsTable)
      .where(
        and(
          eq(viralSpikeAlertsTable.userId, userId),
          eq(viralSpikeAlertsTable.contentKind, kind),
          eq(viralSpikeAlertsTable.contentId, contentId),
        ),
      )
      .orderBy(desc(viralSpikeAlertsTable.detectedAt))
      .limit(1);
    return rows[0] ? alertFromRow(rows[0]) : null;
  },

  async insertAlert(alert) {
    await db.insert(viralSpikeAlertsTable).values({
      userId: alert.userId,
      contentKind: alert.content.kind,
      contentId: alert.content.id,
      title: alert.content.title,
      basis: alert.basis,
      recentGain: alert.recentGain,
      recentVelocityPerHour: alert.recentVelocityPerHour,
      baselineVelocityPerHour: alert.baselineVelocityPerHour,
      multiplier: alert.multiplier,
      detectedAt: new Date(alert.detectedAtMs),
    });
  },

  async listWatchedUserIds(limit) {
    const showcaseOwners = await db
      .select({ userId: showcaseItemsTable.user_id })
      .from(showcaseItemsTable)
      .groupBy(showcaseItemsTable.user_id)
      .limit(limit);
    const ids = new Set<string>(showcaseOwners.map((r) => r.userId));
    if (ids.size < limit) {
      const profileOwners = await db
        .select({ userId: creatorProfilesTable.userId })
        .from(creatorProfilesTable)
        .innerJoin(
          profileVideosTable,
          eq(profileVideosTable.profileId, creatorProfilesTable.id),
        )
        .groupBy(creatorProfilesTable.userId)
        .limit(limit);
      for (const r of profileOwners) {
        ids.add(r.userId);
        if (ids.size >= limit) break;
      }
    }
    return [...ids].slice(0, limit);
  },
};

/* ── Prefs (the Settings on/off switch) ──────────────────────────────── */

/** The account's viral-spike switch — ON by default when no row exists. */
export async function getViralSpikePrefs(
  store: ViralSpikeStore,
  userId: string,
): Promise<ViralSpikePrefsWire> {
  const row = await store.getPrefsRow(userId);
  return row ? { enabled: row.enabled } : { ...DEFAULT_VIRAL_SPIKE_PREFS };
}

export async function setViralSpikePrefs(
  store: ViralSpikeStore,
  userId: string,
  patch: Partial<ViralSpikePrefsWire>,
): Promise<ViralSpikePrefsWire> {
  const current = await getViralSpikePrefs(store, userId);
  const next: ViralSpikePrefsWire = { enabled: patch.enabled ?? current.enabled };
  await store.upsertPrefsRow(userId, next.enabled);
  return next;
}

/* ── Kit reconstruction from a stored alert ──────────────────────────── */

/** Rebuild the kit for a spike that already fired (cooldown surfacing).
 *  The stored numbers are exactly the measured verdict numbers; the
 *  recent span is recovered from gain ÷ velocity — the same division
 *  the detector used — so the headline repeats the original measured
 *  claim, never a new one. */
export function kitFromStoredAlert(alert: StoredSpikeAlert): ViralSpikeKit | null {
  const recentSpanHours =
    alert.recentVelocityPerHour > 0
      ? alert.recentGain / alert.recentVelocityPerHour
      : 0;
  const verdict: Extract<SpikeVerdict, { status: "spike" }> = {
    status: "spike",
    basis: alert.basis,
    numbers: {
      recentGain: alert.recentGain,
      recentSpanHours,
      recentVelocityPerHour: alert.recentVelocityPerHour,
      baselineGain: null,
      baselineSpanHours: null,
      baselineVelocityPerHour: alert.baselineVelocityPerHour,
      multiplier: alert.multiplier,
      counterResetSeen: false,
    },
  };
  return buildViralSpikeKit(alert.content, verdict);
}

/* ── The check: sample → detect → (maybe) fire ───────────────────────── */

export interface ViralSpikeCheckOptions {
  nowMs?: number;
  config?: SpikeConfig;
}

/** One check for one creator: sample every real counter, run the
 *  detector over the stored history, fire at most one kit per piece
 *  of content per cooldown window. Disabled accounts are never
 *  sampled — the function returns before any store write. */
export async function runViralSpikeCheck(
  store: ViralSpikeStore,
  userId: string,
  opts: ViralSpikeCheckOptions = {},
): Promise<ViralSpikeCheckResult> {
  const prefs = await getViralSpikePrefs(store, userId);
  if (!prefs.enabled) {
    return { status: "disabled", sampled: 0, kits: [], measuring: 0 };
  }
  const config = opts.config ?? DEFAULT_SPIKE_CONFIG;
  const nowMs = opts.nowMs ?? Date.now();
  const historyMs =
    (config.baselineWindowHours + config.recentWindowHours + 1) * 3_600_000;

  const content = await store.listContent(userId);
  const kits: ViralSpikeKit[] = [];
  let measuring = 0;

  for (const item of content) {
    try {
      await store.appendSnapshot(userId, item.kind, item.id, item.views, nowMs);
      const samples = await store.listSnapshots(
        userId,
        item.kind,
        item.id,
        nowMs - historyMs,
      );
      const verdict = detectSpike(samples, config, nowMs);
      if (verdict.status === "insufficient_data") {
        measuring += 1;
        continue;
      }
      if (verdict.status !== "spike") continue;

      const last = await store.lastAlert(userId, item.kind, item.id);
      if (last && isInCooldown(last.detectedAtMs, nowMs, config)) {
        // Already fired for this spike — surface that kit, don't refire.
        // The stored alert predates a possible rename; prefer the live title.
        const kit = kitFromStoredAlert({ ...last, content: { ...last.content, title: item.title, slug: item.slug } });
        if (kit) kits.push(kit);
        continue;
      }

      const alert: StoredSpikeAlert & { userId: string } = {
        userId,
        content: { kind: item.kind, id: item.id, title: item.title, slug: item.slug },
        basis: verdict.basis,
        recentGain: verdict.numbers.recentGain,
        recentVelocityPerHour: verdict.numbers.recentVelocityPerHour,
        baselineVelocityPerHour: verdict.numbers.baselineVelocityPerHour,
        multiplier: verdict.numbers.multiplier,
        detectedAtMs: nowMs,
      };
      await store.insertAlert(alert);
      const kit = buildViralSpikeKit(alert.content, verdict);
      if (kit) kits.push(kit);
    } catch (err) {
      logger.error(
        { err, userId, contentKind: item.kind, contentId: item.id },
        "[viral-spike] content check failed — isolated",
      );
    }
  }

  return { status: "ok", sampled: content.length, kits, measuring };
}

/* ── Sweeper (the poller): sample opted-in creators on an interval ───── */

const SWEEP_INTERVAL_MS =
  Number(process.env["VIRAL_SPIKE_SWEEP_INTERVAL_MS"]) || 60 * 60 * 1000;
const SWEEP_STARTUP_DELAY_MS =
  Number(process.env["VIRAL_SPIKE_SWEEP_STARTUP_DELAY_MS"]) || 60 * 1000;
const SWEEP_USER_LIMIT =
  Number(process.env["VIRAL_SPIKE_SWEEP_USER_LIMIT"]) || 200;

export interface ViralSpikeSweepResult {
  users: number;
  kitsVisible: number;
  skippedDisabled: number;
}

/** One sweep: every creator who owns watchable content gets one check.
 *  Per-user failures are isolated; opted-out users are skipped by the
 *  check itself (which also guarantees no snapshot is written for
 *  them). Fail-closed like the spike-watch lane: a store error (e.g.
 *  the provisional migration not yet renumbered/applied at join) logs
 *  and skips — never a crash, never a phantom kit. */
export async function sweepViralSpikeWatchers(
  store: ViralSpikeStore = drizzleViralSpikeStore,
  opts: ViralSpikeCheckOptions = {},
): Promise<ViralSpikeSweepResult> {
  const totals: ViralSpikeSweepResult = { users: 0, kitsVisible: 0, skippedDisabled: 0 };
  let userIds: string[];
  try {
    userIds = await store.listWatchedUserIds(SWEEP_USER_LIMIT);
  } catch (err) {
    logger.error({ err }, "[viral-spike] watched-user scan failed — sweep skipped");
    return totals;
  }
  totals.users = userIds.length;
  for (const userId of userIds) {
    try {
      const result = await runViralSpikeCheck(store, userId, opts);
      if (result.status === "disabled") {
        totals.skippedDisabled += 1;
      } else {
        // Kits visible after this check — fresh fires plus kits still
        // inside their cooldown window being surfaced again.
        totals.kitsVisible += result.kits.length;
      }
    } catch (err) {
      logger.error({ err, userId }, "[viral-spike] user check crashed — continuing");
    }
  }
  return totals;
}

/** Starts the sampling sweeper: one run shortly after boot, then
 *  hourly (snapshots are the baseline history — the cadence is what
 *  makes a 6h recent window / 72h baseline measurable at all). */
export function startViralSpikeSweeper(
  store: ViralSpikeStore = drizzleViralSpikeStore,
): { stop: () => void } {
  const run = () =>
    sweepViralSpikeWatchers(store).catch((err) =>
      logger.error({ err }, "[viral-spike] sweep crashed"),
    );
  const startupTimer = setTimeout(run, SWEEP_STARTUP_DELAY_MS);
  const intervalTimer = setInterval(run, SWEEP_INTERVAL_MS);
  logger.info(
    { intervalMs: SWEEP_INTERVAL_MS, startupDelayMs: SWEEP_STARTUP_DELAY_MS },
    "[viral-spike] sampling sweeper started",
  );
  return {
    stop: () => {
      clearTimeout(startupTimer);
      clearInterval(intervalTimer);
    },
  };
}
