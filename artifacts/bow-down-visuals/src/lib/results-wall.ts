/* ─── Public Results Wall (Stack-200, dedupe audit #177 — TRULY NEW) ────
   FE pure layer for the wall docked in Promote (/promote).

   HONESTY LAW — mirrors the server (artifacts/api-server/src/lib/
   results-wall.ts), and the client never weakens it:
   - The wall renders ONLY events the API returned. The API derives every
     event from the platform's own records (digital_sales, follows, the
     credit_usage ledger, the play_events weekly chart) — there is no
     client path that creates, edits or inflates a number.
   - Unknown kinds are dropped, never rendered with a guessed label.
   - The single EXAMPLE card (shown only when the wall is empty, so a
     visitor can see the shape of the surface) is built from Thy Cheat
     Code — the real official account — and is flagged `example: true`
     end-to-end so the UI must label it as an example, never as a result.
   - Earnings are Visual Bucs only. No cash figure or conversion exists
     anywhere in this feature. */

export const RESULTS_WALL_KINDS = [
  "first_sale",
  "sales",
  "followers",
  "vb_earned",
  "chart_placement",
] as const;
export type ResultsWallKind = (typeof RESULTS_WALL_KINDS)[number];

const KIND_SET: ReadonlySet<string> = new Set(RESULTS_WALL_KINDS);

export function isResultsWallKind(value: unknown): value is ResultsWallKind {
  return typeof value === "string" && KIND_SET.has(value);
}

export interface ResultsWallEventDetail {
  source: "digital_sales" | "follows" | "credit_usage" | "play_events_chart";
  window?: string;
  trackTitle?: string;
}

export interface WallEventWire {
  id: string;
  kind: ResultsWallKind;
  threshold: number;
  value: number;
  detail: ResultsWallEventDetail;
  occurredAt: string;
  verifiedAt: string;
  creator: {
    profileId: string;
    slug: string;
    displayName: string;
    avatarUrl: string | null;
  };
}

export interface ResultsWallPrefsWire {
  optedIn: boolean;
  hiddenKinds: string[];
  lastScannedAt: string | null;
}

export interface MyResultsEvent {
  id: string;
  kind: ResultsWallKind;
  threshold: number;
  value: number;
  detail: ResultsWallEventDetail;
  occurredAt: string;
  verifiedAt: string;
  visibleOnWall: boolean;
}

export interface MyResultsState {
  hasProfile: boolean;
  prefs: ResultsWallPrefsWire;
  events: MyResultsEvent[];
}

/** Per-kind plain-words label for switches and card eyebrow text. */
export const RESULTS_WALL_KIND_LABELS: Record<ResultsWallKind, string> = {
  first_sale: "First sale",
  sales: "Sales milestones",
  followers: "Follower milestones",
  vb_earned: "Visual Bucs earned",
  chart_placement: "Chart placements",
};

/** Where the platform verified the number — named on every card so a
 *  visitor can see the proof source, not just trust the badge. */
export const RESULTS_WALL_SOURCE_LABELS: Record<ResultsWallEventDetail["source"], string> = {
  digital_sales: "Verified from platform sales records",
  follows: "Verified from platform follower records",
  credit_usage: "Verified from the Visual Bucs ledger",
  play_events_chart: "Verified from the platform's weekly chart",
};

const fmt = (n: number) => n.toLocaleString("en-US");

/**
 * The headline sentence for one verified milestone. Numbers come only
 * from the event itself (threshold/value the server derived); a kind we
 * don't know produces NO headline (the card is dropped upstream).
 */
export function milestoneHeadline(event: Pick<WallEventWire, "kind" | "threshold" | "value" | "detail">): string {
  switch (event.kind) {
    case "first_sale":
      return "Made their first sale";
    case "sales":
      return `Reached ${fmt(event.threshold)} sales`;
    case "followers":
      return `Reached ${fmt(event.threshold)} followers`;
    case "vb_earned":
      return `Earned ${fmt(event.threshold)} Visual Bucs`;
    case "chart_placement":
      return event.detail.trackTitle
        ? `Charted at #${event.value} with “${event.detail.trackTitle}”`
        : `Charted at #${event.value} on the weekly chart`;
    default:
      return "";
  }
}

/**
 * Defensive public shaping on the client, mirroring the server's
 * shapePublicWall: drop unknown kinds and malformed rows, sort newest
 * first, cap the wall. (Opt-in/hidden filtering is the server's job —
 * the public API only returns visible events; this layer never invents
 * visibility, it only refuses to render what it cannot label honestly.)
 */
export function shapeWallForDisplay(events: unknown, limit = 50): WallEventWire[] {
  if (!Array.isArray(events)) return [];
  const clean = events.filter((e): e is WallEventWire => {
    if (!e || typeof e !== "object") return false;
    const row = e as Partial<WallEventWire>;
    return (
      isResultsWallKind(row.kind) &&
      typeof row.id === "string" &&
      typeof row.occurredAt === "string" &&
      !Number.isNaN(Date.parse(row.occurredAt)) &&
      !!row.creator &&
      typeof row.creator.slug === "string" &&
      typeof row.creator.displayName === "string"
    );
  });
  return clean
    .slice()
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
    .slice(0, Math.max(1, limit));
}

/** Kinds a creator can hide, in display order, minus any already hidden. */
export function visibleKinds(hiddenKinds: readonly string[]): ResultsWallKind[] {
  const hidden = new Set(hiddenKinds);
  return RESULTS_WALL_KINDS.filter((k) => !hidden.has(k));
}

/* ─── Labeled example (empty-wall shape demo ONLY) ────────────────────────
   Uses Thy Cheat Code, the real official account (slug thy-cheat-code).
   `example: true` is part of the shape so the UI cannot present it as a
   real result; the numbers below illustrate the FORMAT of a milestone
   card and are never mixed into the real event list. */
export interface ExampleWallEvent extends WallEventWire {
  example: true;
}

export const EXAMPLE_WALL_EVENTS: ExampleWallEvent[] = [
  {
    example: true,
    id: "example-first-sale",
    kind: "first_sale",
    threshold: 1,
    value: 1,
    detail: { source: "digital_sales" },
    occurredAt: "2026-01-01T00:00:00.000Z",
    verifiedAt: "2026-01-01T00:00:00.000Z",
    creator: {
      profileId: "example",
      slug: "thy-cheat-code",
      displayName: "Thy Cheat Code",
      avatarUrl: null,
    },
  },
];
