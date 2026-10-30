/**
 * stream-overlay-client.ts — the pure half of the stream overlays
 * (stack900 lane C2): the pages a creator pastes into OBS /
 * Streamlabs as browser sources (/overlay/alerts, /overlay/goal).
 *
 * The shapes mirror the API DTOs in artifacts/api-server/src/routes/
 * stream-overlays.ts and lib/overlay-events.ts. Everything here is
 * string/number work — URL building, defensive message parsing, the
 * alert queue, goal math — so it is unit-testable without a DOM or a
 * socket. The socket + fetch glue lives in use-overlay-feed.ts.
 */

export type OverlayAlertKind = "tip" | "follow" | "member" | "test";

export interface OverlayAlertData {
  kind: OverlayAlertKind;
  title: string;
  body: string | null;
  amountVb: number | null;
  test: boolean;
  at: string;
}

export interface OverlayStateData {
  creator: { displayName: string };
  stream: { id: string; status: string; title: string } | null;
  latestFollower: { displayName: string; followedAt: string } | null;
  recentTips: Array<{ tipperName: string; amountVb: number; createdAt: string }>;
  goal: { goalVb: number | null; totalVb: number; tipCount: number };
}

export type OverlaySocketMessage =
  | { type: "state"; state: OverlayStateData }
  | { type: "alert"; alert: OverlayAlertData }
  | { type: "refresh" };

/** How long one alert stays on the program output. The card's CSS
 *  animation is timed to this same constant. */
export const ALERT_DISPLAY_MS = 7000;

/** Alerts never stack deeper than this — a burst of tips shows the
 *  newest few, not a half-hour backlog. */
export const ALERT_QUEUE_MAX = 5;

/** Default socket URL: same origin, ws/wss by page scheme — the
 *  same construction the live chat client uses. */
export function buildOverlayWsUrl(
  locationLike: { protocol: string; host: string },
  token: string,
): string {
  const scheme = locationLike.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${locationLike.host}/api/overlay/ws?token=${encodeURIComponent(token)}`;
}

const ALERT_KINDS: readonly string[] = ["tip", "follow", "member", "test"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function parseAlert(v: unknown): OverlayAlertData | null {
  if (!isRecord(v)) return null;
  if (typeof v["title"] !== "string" || v["title"].length === 0) return null;
  if (typeof v["kind"] !== "string" || !ALERT_KINDS.includes(v["kind"])) return null;
  return {
    kind: v["kind"] as OverlayAlertKind,
    title: v["title"],
    body: typeof v["body"] === "string" ? v["body"] : null,
    amountVb: typeof v["amountVb"] === "number" ? v["amountVb"] : null,
    test: v["test"] === true,
    at: typeof v["at"] === "string" ? v["at"] : "",
  };
}

function parseState(v: unknown): OverlayStateData | null {
  if (!isRecord(v) || !isRecord(v["creator"]) || !isRecord(v["goal"])) return null;
  if (typeof v["creator"]["displayName"] !== "string") return null;
  const goalVb = v["goal"]["goalVb"];
  if (goalVb !== null && typeof goalVb !== "number") return null;
  if (typeof v["goal"]["totalVb"] !== "number" || typeof v["goal"]["tipCount"] !== "number") return null;
  return v as unknown as OverlayStateData;
}

/** Parse one socket frame. Anything malformed — a half-sent frame, a
 *  future server shape, plain junk — parses to null and is ignored;
 *  an overlay must never crash on its own feed. */
export function parseOverlayMessage(raw: string): OverlaySocketMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  switch (parsed["type"]) {
    case "alert": {
      const alert = parseAlert(parsed["alert"]);
      return alert ? { type: "alert", alert } : null;
    }
    case "state": {
      const state = parseState(parsed["state"]);
      return state ? { type: "state", state } : null;
    }
    case "refresh":
      return { type: "refresh" };
    default:
      return null;
  }
}

export interface QueuedAlert {
  key: number;
  alert: OverlayAlertData;
}

/** Append an alert to the display queue, capping depth (oldest
 *  dropped past the cap — the freshest moments win the screen). */
export function enqueueAlert(
  queue: readonly QueuedAlert[],
  alert: OverlayAlertData,
  key: number,
): QueuedAlert[] {
  const next = [...queue, { key, alert }];
  return next.length > ALERT_QUEUE_MAX ? next.slice(next.length - ALERT_QUEUE_MAX) : next;
}

/** Goal progress as a whole percent, or null when no goal is set —
 *  the same honesty rule as the in-studio widget (goalProgress in
 *  stream-kit/widget-data.ts): no goal, no bar. */
export function goalPercent(goal: OverlayStateData["goal"]): number | null {
  if (!goal.goalVb || goal.goalVb <= 0) return null;
  return Math.round(Math.min(1, Math.max(0, goal.totalVb / goal.goalVb)) * 100);
}

export function formatVb(n: number): string {
  return n.toLocaleString("en-US");
}
