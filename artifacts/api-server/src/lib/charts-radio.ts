/* ─── Charts Radio (Stack-200 #156, TRULY NEW) ─────────────────────────
   The house's 24/7 station: a continuous rotation built per-request
   from REAL chart data only — the This Week chart (play_events-backed,
   via discovery's topTracks) interleaved with the newest published
   drops. Nothing here invents a song, a play count, or a stat: every
   entry is a published profile track that arrived with a playable
   audio URL, and its chart rank is its real position in the week
   chart it was pulled from.

   The station is a place the listener CHOOSES to hear (smart law):
   the one persisted fact is the account's tuned_in choice
   (charts_radio_prefs, provisional migration 9999). It is a resume
   hint only — playback starts on an explicit press on every surface,
   every time. RADIO_AUTOPLAY_WITH_SOUND is pinned false and the FE
   mirrors it.

   No money moves here: listening is free, Visual Bucs are never
   charged for the station, and no cash rail is touched. */

import { db, chartsRadioPrefsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/** Smart-law pin: the station NEVER starts with sound on page load. */
export const RADIO_AUTOPLAY_WITH_SOUND = false;

export const RADIO_STATION = {
  name: "Charts Radio",
  tagline: "The house station — this week's chart and the newest drops, back to back.",
  /** The rotation is the week chart + fresh drops, stated honestly. */
  sources: ["week-chart", "newest-drops"] as const,
} as const;

/* ─── Rotation ──────────────────────────────────────────────────────── */

/** The minimal track shape the rotation builder reads — exactly what
 *  discovery's topTracks / the newest-drops query select (raw rows). */
export interface RadioTrackRow {
  id: string;
  title: string;
  audio_url: string | null;
  artwork_url: string | null;
  duration_sec: number | null;
  genre: string | null;
  play_count: number | null;
  window_plays?: number | null;
  display_name: string | null;
  slug: string | null;
}

export interface RadioRotationEntry {
  position: number;
  track_id: string;
  title: string;
  artist_name: string | null;
  artist_slug: string | null;
  artwork_url: string | null;
  audio_url: string;
  duration_sec: number | null;
  genre: string | null;
  /** Where this spin came from — the real week chart, or a new drop. */
  source: "chart" | "new-drop";
  /** 1-based rank in the week chart; null for new drops. */
  chart_rank: number | null;
  /** Real plays only: window plays when the chart carried them, else
   *  the track's all-time counter. Never fabricated. */
  plays: number | null;
}

function toEntry(
  row: RadioTrackRow,
  source: "chart" | "new-drop",
  chartRank: number | null,
): RadioRotationEntry | null {
  if (!row.audio_url) return null; // unplayable rows never enter the rotation
  return {
    position: 0, // assigned after the interleave
    track_id: row.id,
    title: row.title,
    artist_name: row.display_name,
    artist_slug: row.slug,
    artwork_url: row.artwork_url,
    audio_url: row.audio_url,
    duration_sec: row.duration_sec,
    genre: row.genre,
    source,
    chart_rank: chartRank,
    plays: row.window_plays ?? row.play_count ?? null,
  };
}

/** Build the station's rotation: week-chart tracks and newest drops
 *  interleaved chart, drop, chart, drop… so the station spins the
 *  charts AND the freshest releases. A track that is both charting
 *  and brand-new appears once, as its chart entry (rank wins).
 *  Deterministic: same inputs, same rotation. */
export function buildRadioRotation(
  chartTracks: RadioTrackRow[],
  newestTracks: RadioTrackRow[],
  limit = 24,
): RadioRotationEntry[] {
  const cap = Math.max(1, Math.min(50, Math.floor(limit) || 24));
  const seen = new Set<string>();
  const chart: RadioRotationEntry[] = [];
  chartTracks.forEach((row, i) => {
    const e = toEntry(row, "chart", i + 1);
    if (e && !seen.has(e.track_id)) {
      seen.add(e.track_id);
      chart.push(e);
    }
  });
  const drops: RadioRotationEntry[] = [];
  for (const row of newestTracks) {
    const e = toEntry(row, "new-drop", null);
    if (e && !seen.has(e.track_id)) {
      seen.add(e.track_id);
      drops.push(e);
    }
  }
  const out: RadioRotationEntry[] = [];
  let ci = 0;
  let di = 0;
  while (out.length < cap && (ci < chart.length || di < drops.length)) {
    if (ci < chart.length) out.push(chart[ci++]!);
    if (out.length >= cap) break;
    if (di < drops.length) out.push(drops[di++]!);
  }
  out.forEach((e, i) => {
    e.position = i + 1;
  });
  return out;
}

/* ─── Listener prefs (the tuned-in choice) ──────────────────────────── */

export interface ChartsRadioPrefsWire {
  tuned_in: boolean;
}

export const DEFAULT_CHARTS_RADIO_PREFS: ChartsRadioPrefsWire = {
  tuned_in: false,
};

export interface ChartsRadioPrefsStore {
  getRow(userId: string): Promise<ChartsRadioPrefsWire | null>;
  upsertRow(userId: string, prefs: ChartsRadioPrefsWire): Promise<void>;
}

export const drizzleChartsRadioPrefsStore: ChartsRadioPrefsStore = {
  async getRow(userId) {
    const rows = await db
      .select()
      .from(chartsRadioPrefsTable)
      .where(eq(chartsRadioPrefsTable.userId, userId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return { tuned_in: row.tunedIn };
  },
  async upsertRow(userId, prefs) {
    await db
      .insert(chartsRadioPrefsTable)
      .values({ userId, tunedIn: prefs.tuned_in })
      .onConflictDoUpdate({
        target: chartsRadioPrefsTable.userId,
        set: { tunedIn: prefs.tuned_in, updatedAt: new Date() },
      });
  },
};

/** The account's station choice — not tuned in when no row exists. */
export async function getChartsRadioPrefs(
  store: ChartsRadioPrefsStore,
  userId: string,
): Promise<ChartsRadioPrefsWire> {
  const row = await store.getRow(userId);
  return row ?? { ...DEFAULT_CHARTS_RADIO_PREFS };
}

/** Persist the listener's choice. A resume hint only — it never
 *  starts playback (RADIO_AUTOPLAY_WITH_SOUND stays false). */
export async function setChartsRadioPrefs(
  store: ChartsRadioPrefsStore,
  userId: string,
  patch: Partial<ChartsRadioPrefsWire>,
): Promise<ChartsRadioPrefsWire> {
  const current = await getChartsRadioPrefs(store, userId);
  const next: ChartsRadioPrefsWire = {
    tuned_in: patch.tuned_in ?? current.tuned_in,
  };
  await store.upsertRow(userId, next);
  return next;
}
