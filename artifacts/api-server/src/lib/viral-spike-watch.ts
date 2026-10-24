import { sql, eq, and } from "drizzle-orm";
import { db, notificationsTable, viralSpikeEpisodesTable } from "@workspace/db";
import { logger } from "./logger";

/**
 * Viral Spike Watch (Stack-100 #3, Wave 3, Lane 11) — VERIFY-FIRST lane.
 *
 * The round-3 scout could not confirm creators are alerted when one of
 * their tracks/videos suddenly spikes. Verification (full evidence in
 * the lane's .lane/VERDICT.md): they were NOT. The morning brief reads
 * all-time counters and writes nothing; milestones fire on ABSOLUTE
 * thresholds over stream counts creators log by hand from Spotify for
 * Artists; the public charts aggregate play_events but never notify an
 * owner. What DID exist — and what this detector is built on — is the
 * honest data half: `play_events`, one timestamped row per play
 * (kind, media_id, played_at), written by POST /play in
 * routes/discovery.ts. A baseline-relative spike is real arithmetic
 * over those rows; nothing here synthesizes a metric.
 *
 * ── What a spike is (the threshold, stated) ──────────────────────────
 * Windows: CURRENT = plays in the last 24 hours. BASELINE = plays in
 * the 7 days before that, expressed per-day (baseline_plays / 7).
 *
 * A spike fires when ALL of these hold:
 *   1. current >= 5 × baseline_daily   — the multiple: five times the
 *      item's OWN normal day. Baseline-relative by construction, so a
 *      flat-but-huge item (1,000/day every day) never fires.
 *   2. current >= 50                   — absolute floor for the window:
 *      a jump from 2/day to 12/day is 6× and still not a spike anyone
 *      should be pinged about.
 *   3. current − baseline_daily >= 25  — minimum absolute lift, so a
 *      mid-size item wobbling from 40/day to 65/day (ratio < 5 anyway)
 *      can never squeak through on rounding.
 * Cold start (baseline_plays = 0, ratio undefined): fires only at
 * current >= 100 — a brand-new or long-dormant item needs a genuinely
 * big day, not merely its first plays, to earn an alert.
 *
 * ── Alert fatigue discipline ─────────────────────────────────────────
 * One alert per item per EPISODE. Episode state lives in
 * viral_spike_episodes (see lib/db/src/schema/viral-spike-watch.ts;
 * migration SQL held for join numbering in the lane's
 * MIGRATION-NEEDED.md). While an episode is 'active', later runs only
 * refresh last_current_plays — no second bell. The episode re-arms
 * ('rearmed') only when the current window falls back near baseline:
 * current <= max(1.5 × baseline_daily, 10). An item still hot but no
 * longer spiking sits in the hysteresis band between the re-arm line
 * and the fire line — muted, not re-armed, exactly as intended.
 *
 * ── Where it runs ────────────────────────────────────────────────────
 * A guarded phase of the existing job-poller tick (lib/job-poller.ts),
 * throttled to one real pass per SPIKE_WATCH_INTERVAL_MS (default 1h —
 * the windows are 24h/7d, so hourly checks are already fine-grained).
 * No new scheduler, no new notification system, no email: the alert is
 * one row in the existing `notifications` table (kind 'viral_spike'),
 * read by the header bell like every other producer's rows.
 *
 * Fail-closed: episode state is loaded BEFORE anything can alert, and
 * any failure (e.g. the held migration not yet applied) aborts the
 * pass with a log line — a spike watch that cannot remember whom it
 * already told must tell nobody.
 */

export const SPIKE_WATCH = {
  CURRENT_WINDOW_HOURS: 24,
  BASELINE_DAYS: 7,
  MULTIPLE: 5,
  MIN_CURRENT_PLAYS: 50,
  MIN_LIFT_PLAYS: 25,
  COLD_START_MIN_PLAYS: 100,
  REARM_MULTIPLE: 1.5,
  REARM_FLOOR_PLAYS: 10,
} as const;

export const SPIKE_WATCH_INTERVAL_MS = Math.max(
  60_000,
  Number(process.env["SPIKE_WATCH_INTERVAL_MS"] ?? "3600000"),
);

export type SpikeKind = "track" | "video";

export interface SpikeEvaluation {
  spike: boolean;
  coldStart: boolean;
  /** Trailing-baseline plays per day (baseline_plays / 7). */
  baselineDaily: number;
}

/** Pure threshold logic — the whole definition lives here and in the
 *  header comment above; the DB pass below only feeds it real counts. */
export function evaluateSpike(currentPlays: number, baselinePlays: number): SpikeEvaluation {
  const baselineDaily = baselinePlays / SPIKE_WATCH.BASELINE_DAYS;
  if (baselinePlays === 0) {
    return {
      spike: currentPlays >= SPIKE_WATCH.COLD_START_MIN_PLAYS,
      coldStart: true,
      baselineDaily,
    };
  }
  const spike =
    currentPlays >= SPIKE_WATCH.MIN_CURRENT_PLAYS &&
    currentPlays >= SPIKE_WATCH.MULTIPLE * baselineDaily &&
    currentPlays - baselineDaily >= SPIKE_WATCH.MIN_LIFT_PLAYS;
  return { spike, coldStart: false, baselineDaily };
}

/** Fallen back near baseline? The re-arm line (see header). */
export function hasFallenBack(currentPlays: number, baselineDaily: number): boolean {
  return currentPlays <= Math.max(baselineDaily * SPIKE_WATCH.REARM_MULTIPLE, SPIKE_WATCH.REARM_FLOOR_PLAYS);
}

export interface SpikeWindowRow {
  kind: SpikeKind;
  mediaId: string;
  title: string;
  profileId: string;
  slug: string;
  ownerUserId: string;
  currentPlays: number;
  baselinePlays: number;
}

/** Per-kind source tables. Identifiers are constants — never user input. */
const MEDIA_TABLES: Record<SpikeKind, string> = {
  track: "profile_tracks",
  video: "profile_videos",
};

async function loadWindows(kind: SpikeKind): Promise<SpikeWindowRow[]> {
  const table = MEDIA_TABLES[kind];
  const r = await db.execute(sql`
    SELECT t.id AS media_id, t.title AS title, t.profile_id AS profile_id,
           p.slug AS slug, p.user_id AS owner_user_id,
           COUNT(*) FILTER (WHERE e.played_at >= NOW() - INTERVAL '${sql.raw(String(SPIKE_WATCH.CURRENT_WINDOW_HOURS))} hours')::int AS current_plays,
           COUNT(*) FILTER (WHERE e.played_at < NOW() - INTERVAL '${sql.raw(String(SPIKE_WATCH.CURRENT_WINDOW_HOURS))} hours')::int AS baseline_plays
    FROM play_events e
    JOIN ${sql.identifier(table)} t ON t.id = e.media_id
    JOIN creator_profiles p ON p.id = t.profile_id
    WHERE e.kind = ${kind}
      AND e.played_at >= NOW() - INTERVAL '${sql.raw(String(SPIKE_WATCH.BASELINE_DAYS + 1))} days'
      AND t.is_published
    GROUP BY t.id, p.id
  `);
  return (r.rows as Array<Record<string, unknown>>).map((row) => ({
    kind,
    mediaId: String(row["media_id"]),
    title: String(row["title"] ?? ""),
    profileId: String(row["profile_id"]),
    slug: String(row["slug"] ?? ""),
    ownerUserId: String(row["owner_user_id"]),
    currentPlays: Number(row["current_plays"] ?? 0),
    baselinePlays: Number(row["baseline_plays"] ?? 0),
  }));
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function fmtDaily(n: number): string {
  return n < 10 && n % 1 !== 0 ? n.toFixed(1) : fmt(n);
}

/** The bell copy. Every number in it is a computed value from
 *  play_events — current plays, baseline total, baseline per-day, and
 *  the multiple they imply. Exported for tests. */
export function spikeNotification(row: SpikeWindowRow, ev: SpikeEvaluation): {
  kind: string; title: string; body: string; link: string;
} {
  const noun = row.kind === "track" ? "track" : "video";
  const title = `Your ${noun} "${row.title}" is spiking`;
  const body = ev.coldStart
    ? `${fmt(row.currentPlays)} plays in the last 24 hours, from a standing start — ` +
      `it had no plays at all in the prior ${SPIKE_WATCH.BASELINE_DAYS} days.`
    : `${fmt(row.currentPlays)} plays in the last 24 hours — ` +
      `${fmtDaily(row.currentPlays / ev.baselineDaily)}× its usual ~${fmtDaily(ev.baselineDaily)} plays a day ` +
      `(${fmt(row.baselinePlays)} plays over the prior ${SPIKE_WATCH.BASELINE_DAYS} days).`;
  return { kind: "viral_spike", title, body, link: `/artist/${row.slug}` };
}

export interface SpikeWatchSummary {
  skipped: boolean;
  error: boolean;
  checked: number;
  fired: Array<{ kind: SpikeKind; mediaId: string; title: string; currentPlays: number; baselineDaily: number }>;
  rearmed: number;
}

let lastRunAt = 0;

/** One detection pass. Never throws — the poller phase also guards, but
 *  a watch that can crash its host is worse than a watch that skips. */
export async function runViralSpikeWatch(opts?: { force?: boolean }): Promise<SpikeWatchSummary> {
  const empty: SpikeWatchSummary = { skipped: false, error: false, checked: 0, fired: [], rearmed: 0 };
  const nowMs = Date.now();
  if (!opts?.force && lastRunAt > 0 && nowMs - lastRunAt < SPIKE_WATCH_INTERVAL_MS) {
    return { ...empty, skipped: true };
  }
  lastRunAt = nowMs;
  try {
    /* Episode state FIRST: if it cannot be read (held migration not yet
       applied), abort before any alert can be sent — fail closed. */
    const episodeRows = await db.select().from(viralSpikeEpisodesTable);
    const episodes = new Map<string, (typeof episodeRows)[number]>();
    for (const ep of episodeRows) episodes.set(`${ep.kind}:${ep.mediaId}`, ep);

    const windows = [
      ...(await loadWindows("track")),
      ...(await loadWindows("video")),
    ];
    const summary: SpikeWatchSummary = { ...empty, checked: windows.length, fired: [] };
    const seen = new Set<string>();

    for (const row of windows) {
      const key = `${row.kind}:${row.mediaId}`;
      seen.add(key);
      const ep = episodes.get(key);
      const ev = evaluateSpike(row.currentPlays, row.baselinePlays);

      if (ev.spike && (!ep || ep.episodeState === "rearmed")) {
        const n = spikeNotification(row, ev);
        await db.insert(notificationsTable).values({
          userId: row.ownerUserId,
          kind: n.kind,
          title: n.title,
          body: n.body,
          link: n.link,
        });
        await db
          .insert(viralSpikeEpisodesTable)
          .values({
            kind: row.kind,
            mediaId: row.mediaId,
            profileId: row.profileId,
            ownerUserId: row.ownerUserId,
            episodeState: "active",
            baselineDaily: ev.baselineDaily,
            lastCurrentPlays: row.currentPlays,
            notifiedAt: new Date(),
            rearmedAt: null,
          })
          .onConflictDoUpdate({
            target: [viralSpikeEpisodesTable.kind, viralSpikeEpisodesTable.mediaId],
            set: {
              profileId: row.profileId,
              ownerUserId: row.ownerUserId,
              episodeState: "active",
              baselineDaily: ev.baselineDaily,
              lastCurrentPlays: row.currentPlays,
              notifiedAt: new Date(),
              rearmedAt: null,
              updatedAt: new Date(),
            },
          });
        summary.fired.push({
          kind: row.kind, mediaId: row.mediaId, title: row.title,
          currentPlays: row.currentPlays, baselineDaily: ev.baselineDaily,
        });
      } else if (ep?.episodeState === "active") {
        if (!ev.spike && hasFallenBack(row.currentPlays, ev.baselineDaily)) {
          await db
            .update(viralSpikeEpisodesTable)
            .set({ episodeState: "rearmed", rearmedAt: new Date(), lastCurrentPlays: row.currentPlays, updatedAt: new Date() })
            .where(and(eq(viralSpikeEpisodesTable.kind, row.kind), eq(viralSpikeEpisodesTable.mediaId, row.mediaId)));
          summary.rearmed += 1;
        } else {
          await db
            .update(viralSpikeEpisodesTable)
            .set({ lastCurrentPlays: row.currentPlays, updatedAt: new Date() })
            .where(and(eq(viralSpikeEpisodesTable.kind, row.kind), eq(viralSpikeEpisodesTable.mediaId, row.mediaId)));
        }
      }
    }

    /* Active episodes whose item had NO play_events in the whole 8-day
       span never appear in the windows query — their current window is
       0 by definition, which is below every re-arm line. */
    for (const ep of episodeRows) {
      const key = `${ep.kind}:${ep.mediaId}`;
      if (ep.episodeState === "active" && !seen.has(key)) {
        await db
          .update(viralSpikeEpisodesTable)
          .set({ episodeState: "rearmed", rearmedAt: new Date(), lastCurrentPlays: 0, updatedAt: new Date() })
          .where(and(eq(viralSpikeEpisodesTable.kind, ep.kind), eq(viralSpikeEpisodesTable.mediaId, ep.mediaId)));
        summary.rearmed += 1;
      }
    }

    if (summary.fired.length > 0 || summary.rearmed > 0) {
      logger.info(
        { fired: summary.fired, rearmed: summary.rearmed, checked: summary.checked },
        "[viral-spike-watch] pass complete",
      );
    }
    return summary;
  } catch (err) {
    logger.error({ err }, "[viral-spike-watch] pass failed — no alerts sent");
    return { ...empty, error: true };
  }
}

/** Test seam — never used in production. */
export const __testHooks = {
  resetThrottle(): void {
    lastRunAt = 0;
  },
};
