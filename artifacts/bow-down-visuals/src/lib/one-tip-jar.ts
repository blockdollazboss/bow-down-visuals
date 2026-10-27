/* ─── One Tip Jar — FE mirror (Stack-200 upgrade N4) ─────────────────────
   The client half of the one-jar rule: every tip door on the site —
   the profile Tip Jar button, the Shorts/video Tip button, QR codes,
   print cards — points at ONE canonical address, built here and
   nowhere else. The jar view itself comes from
   GET /api/tips/jar/:handle (api-server lib/one-tip-jar.ts); dollars
   and Visual Bucs are displayed in separate lanes, never summed. */

export type TipDoor = "tip_page" | "live_stream" | "world_stage";

export interface JarActivityEntry {
  door: TipDoor;
  unit: "USD" | "VB";
  amount: number;
  fromLabel: string;
  message: string | null;
  at: string;
}

export interface JarView {
  jar: {
    handle: string;
    displayName: string;
    message: string;
    canonicalUrl: string;
    qrTarget: string;
    suggestedAmounts: number[];
    paymentsLive: boolean;
  };
  goal: {
    label: string;
    targetAmount: number;
    raised: number | null;
    progress: number | null;
  } | null;
  totals: {
    usdCentsPaid: number;
    usdTipsCount: number;
    vbLive: number;
    vbStage: number;
    vbTotal: number;
  };
  activity: JarActivityEntry[];
}

/** THE canonical jar address — the only way tip links are built. The
 *  value may be the tip handle or the creator's profile slug; the jar
 *  resolves both namespaces to the same jar (and the printed/shared
 *  form is always the handle URL the jar view returns). */
export function jarPath(handleOrSlug: string): string {
  return `/tips/${encodeURIComponent(handleOrSlug)}`;
}

/** Absolute form for QR codes and print cards — what a phone camera
 *  should land on. */
export function jarAbsoluteUrl(handle: string, origin: string): string {
  return `${origin.replace(/\/$/, "")}${jarPath(handle)}`;
}

export const JAR_DOOR_LABELS: Record<TipDoor, string> = {
  tip_page: "Tip page",
  live_stream: "Live stream",
  world_stage: "World stage",
};

/** One activity row's amount in its own unit — cents become dollars
 *  for USD; VB stays whole Visual Bucs. */
export function formatJarAmount(entry: Pick<JarActivityEntry, "unit" | "amount">): string {
  if (entry.unit === "USD") return `$${(entry.amount / 100).toFixed(2)}`;
  return `${entry.amount.toLocaleString("en-US")} VB`;
}

export const ONE_TIP_JAR_COPY = {
  heading: "One tip jar",
  sub:
    "Every tip door — your tip page, your live streams, the World stage — lands in this one jar. Dollars and Visual Bucs are shown side by side, never mixed.",
  printCardTitle: "Tip me",
  printCardNote: "Scan to open my tip jar — every door lands in the same jar.",
} as const;
