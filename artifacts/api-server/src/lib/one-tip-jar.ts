/* ─── One Tip Jar (Stack-200 upgrade N4) ─────────────────────────────────
   Three doors take tips today — the public tip page (real dollars via
   Stripe, tip_jar_tips), live-stream tips (Visual Bucs,
   live_stream_tips), and World stage tips (Visual Bucs,
   world_stage_tips). They are separate RAILS and stay separate: a
   dollar is not a Visual Buc and the two are never summed together.
   What was missing is the ONE JAR they all belong to: a single
   identity (the creator's tip handle), a single canonical address
   every door, profile button, QR code and print card points at, and
   a single activity view where the creator sees every door's tips
   together — each labeled with its door and its own unit.

   This module is the pure half: the merge, the totals, the canonical
   address. The endpoint (GET /api/tips/jar/:handle, in
   routes/generate/tip-jar.ts where the jar lives) feeds it rows. */

export type TipDoor = "tip_page" | "live_stream" | "world_stage";
export type TipUnit = "USD" | "VB";

export interface JarActivityEntry {
  door: TipDoor;
  unit: TipUnit;
  /** Cents when unit is USD; whole Visual Bucs when unit is VB. */
  amount: number;
  fromLabel: string;
  message: string | null;
  /** ISO instant of the tip (paid_at for page tips, created_at else). */
  at: string;
}

export interface JarTotals {
  /** Paid tip-page money, integer cents — the only USD figure. */
  usdCentsPaid: number;
  usdTipsCount: number;
  /** Visual Bucs per VB door, and their (VB-only) sum. */
  vbLive: number;
  vbStage: number;
  vbTotal: number;
}

/** The one address of the jar. Every surface — profile tip buttons,
 *  video tip doors, QR codes, print cards — points HERE and nowhere
 *  else; doors never invent their own tip URLs. */
export function canonicalJarUrl(handle: string): string {
  return `/tips/${handle}`;
}

/** What every QR code for this jar encodes: the canonical address. */
export function jarQrTarget(handle: string): string {
  return canonicalJarUrl(handle);
}

export const JAR_DOOR_LABELS: Record<TipDoor, string> = {
  tip_page: "Tip page",
  live_stream: "Live stream",
  world_stage: "World stage",
};

export const ONE_TIP_JAR_COPY = {
  heading: "One tip jar",
  sub:
    "Every tip door — your tip page, your live streams, the World stage — lands in this one jar. Dollars and Visual Bucs are shown side by side, never mixed.",
} as const;

const DEFAULT_ACTIVITY_LIMIT = 20;

/** Merge the three doors' activity into one newest-first feed.
 *  Pure and total: unstable/invalid instants sort last, never crash. */
export function mergeJarActivity(
  entries: JarActivityEntry[],
  limit: number = DEFAULT_ACTIVITY_LIMIT,
): JarActivityEntry[] {
  const time = (e: JarActivityEntry) => {
    const t = Date.parse(e.at);
    return Number.isFinite(t) ? t : 0;
  };
  return [...entries]
    .sort((a, b) => time(b) - time(a))
    .slice(0, Math.max(0, limit));
}

/** Totals per rail, from the same entries the feed shows (plus the
 *  paid-page count). USD and VB are computed in separate lanes on
 *  purpose — there is deliberately no combined figure. */
export function jarTotals(entries: JarActivityEntry[]): JarTotals {
  let usdCentsPaid = 0;
  let usdTipsCount = 0;
  let vbLive = 0;
  let vbStage = 0;
  for (const e of entries) {
    if (e.door === "tip_page" && e.unit === "USD") {
      usdCentsPaid += e.amount;
      usdTipsCount += 1;
    } else if (e.door === "live_stream" && e.unit === "VB") {
      vbLive += e.amount;
    } else if (e.door === "world_stage" && e.unit === "VB") {
      vbStage += e.amount;
    }
  }
  return { usdCentsPaid, usdTipsCount, vbLive, vbStage, vbTotal: vbLive + vbStage };
}
