import path from "node:path";
import { eq } from "drizzle-orm";
import { db, liveStreamsTable, liveDestinationKeysTable, type LiveStream } from "@workspace/db";
import { getSession } from "./own-server-live";
import { selectedLiveTransport } from "./live-config";
import { relayPlan, startRelay, stopRelay, unprotectKey, type RelaySource } from "./multistream";
import { logger } from "./logger";

/* ── Fan-out worker (Stack 9 #1) ────────────────────────────────────────
   Drives live_streams.destinations transitions for non-site
   destinations:
     pending → live   (relay process running, bytes flowing to RTMP)
     pending → error  (with the honest reason: no key saved, codec
                       can't be copy-remuxed, wrong transport, relay
                       process died)
     live    → ended  (stream end — handled by closeOutDestinations
                       in routes/live-streams)
   The site destination is never touched here. Statuses are written
   onto the stream row's destinations JSONB — the same shape the
   studio/watch UI already renders. */

interface DestEntry {
  platform: string;
  label: string;
  status: string;
  save_recording?: boolean;
  vod_url?: string | null;
  vod_state?: string | null;
  error_reason?: string | null;
  has_key?: boolean;
  [k: string]: unknown;
}

function entriesOf(row: LiveStream): DestEntry[] {
  return Array.isArray(row.destinations) ? (row.destinations as DestEntry[]) : [];
}

async function writeEntries(streamId: string, entries: DestEntry[]): Promise<void> {
  await db
    .update(liveStreamsTable)
    .set({ destinations: entries, updated_at: new Date() })
    .where(eq(liveStreamsTable.id, streamId));
}

async function setEntry(streamId: string, platform: string, patch: Partial<DestEntry>): Promise<void> {
  const rows = await db.select().from(liveStreamsTable).where(eq(liveStreamsTable.id, streamId)).limit(1);
  const row = rows[0];
  if (!row) return;
  const entries = entriesOf(row).map((e) => (e.platform === platform ? { ...e, ...patch } : e));
  await writeEntries(streamId, entries);
}

export interface FanOutVerdict {
  platform: string;
  status: "live" | "error" | "pending";
  reason: string | null;
}

/**
 * Attempt fan-out for every configured non-site destination on a
 * live stream. Safe to call repeatedly (already-live relays are
 * left running) and from the ingest path (first chunk) or the
 * creator's manual retry. Never throws.
 */
export async function attemptFanOut(streamId: string): Promise<FanOutVerdict[]> {
  const verdicts: FanOutVerdict[] = [];
  try {
    const rows = await db.select().from(liveStreamsTable).where(eq(liveStreamsTable.id, streamId)).limit(1);
    const row = rows[0];
    if (!row || row.status !== "live") return verdicts;
    const transport = row.provider === "own-server" ? "own" : "cloudflare";
    const session = transport === "own" ? getSession(streamId) : null;
    const source: RelaySource = {
      transport,
      container: session?.ext ?? null,
      sourcePath: session ? path.join(session.liveDir, "playlist.m3u8") : null,
    };
    const keys = await db
      .select()
      .from(liveDestinationKeysTable)
      .where(eq(liveDestinationKeysTable.user_id, row.user_id));
    const keyByPlatform = new Map(keys.map((k) => [k.platform, k]));

    for (const entry of entriesOf(row)) {
      if (entry.platform === "site" || entry.status === "off") continue;
      const key = keyByPlatform.get(entry.platform);
      if (!key) {
        // No key saved: stays exactly what the UI already promises —
        // "coming soon"/not configured. Record has_key=false only.
        await setEntry(streamId, entry.platform, { has_key: false });
        verdicts.push({ platform: entry.platform, status: "pending", reason: "No stream key saved for this destination yet." });
        continue;
      }
      const plan = relayPlan(source, {
        platform: entry.platform,
        ingestUrl: key.ingest_url,
        streamKey: unprotectKey(key.stream_key),
      });
      if (!plan.ok) {
        await setEntry(streamId, entry.platform, { status: "error", error_reason: plan.reason, has_key: true });
        verdicts.push({ platform: entry.platform, status: "error", reason: plan.reason });
        continue;
      }
      if (entry.status === "live") {
        verdicts.push({ platform: entry.platform, status: "live", reason: null });
        continue;
      }
      const { started } = startRelay(streamId, entry.platform, plan.args, (code) => {
        // Relay died mid-stream: honest error, never a silent "live".
        void (async () => {
          const fresh = await db.select().from(liveStreamsTable).where(eq(liveStreamsTable.id, streamId)).limit(1);
          if (fresh[0]?.status === "live") {
            await setEntry(streamId, entry.platform, {
              status: "error",
              error_reason: `The relay to this destination stopped (exit ${code ?? "unknown"}). Check the destination and retry fan-out.`,
            }).catch(() => undefined);
          }
        })();
      });
      if (started) {
        await setEntry(streamId, entry.platform, { status: "live", error_reason: null, has_key: true });
        verdicts.push({ platform: entry.platform, status: "live", reason: null });
      } else {
        verdicts.push({ platform: entry.platform, status: "live", reason: null });
      }
    }
  } catch (err) {
    logger.error({ err, streamId }, "fanout: attempt failed");
  }
  return verdicts;
}

/** Stop one destination's relay and return it to pending (creator
 *  removed its key mid-stream, or toggled it off). */
export async function stopDestinationRelay(streamId: string, platform: string): Promise<void> {
  stopRelay(streamId, platform);
  await setEntry(streamId, platform, { status: "pending", error_reason: null }).catch(() => undefined);
}

export { selectedLiveTransport };
