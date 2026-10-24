/* Pure helpers for the Content Scheduler page — kept here so they're
   unit-testable without rendering the page. */

export type SchedulerPlatformKey = "instagram" | "tiktok" | "facebook";

/** Provenance snapshot stamped on a scheduled post at schedule time
 *  (wave-3 provenance-in-publish) — mirrors ScheduledPostProvenance in
 *  the API/@workspace/db. The record id rides the post; the snapshot is
 *  what the publish UI showed the creator before posting. */
export interface ScheduledPostProvenanceShape {
  assetId: string;
  title: string;
  tool: string;
  model: string | null;
  aiGenerated: boolean;
  licence: string;
  disclosureLine: string;
  linkedAt: string;
}

/** Where a platform honestly carries the AI disclosure:
 *  "caption" = it rides the caption/description text (Instagram,
 *  Facebook); "record_only" = the destination accepts no caption or
 *  AI-label field (TikTok drafts), so the disclosure stays on the
 *  asset's provenance record page; "not_applicable" = no AI
 *  generation is recorded, so there is nothing to disclose. */
export type DisclosureChannel = "caption" | "record_only" | "not_applicable";

export interface ScheduledPostShape {
  id: string;
  status: "draft" | "scheduled" | "publishing" | "posted" | "failed" | "canceled";
  mediaUrl: string;
  mediaType: "video" | "image";
  caption: string;
  hashtags: string;
  platforms: SchedulerPlatformKey[];
  accountIds: Partial<Record<SchedulerPlatformKey, string>>;
  scheduledAt: string | null; // ISO
  postedAt: string | null; // ISO
  attempts: number;
  lastError: string | null;
  creditsCharged: number;
  /** Distribution release this post announces (0143 attribution), or
   *  null when it wasn't scheduled from a release. */
  releaseId: string | null;
  /** Provenance snapshot (wave 3) — absent/null on posts scheduled
   *  without a library asset. Optional: older payloads lack it. */
  provenance?: ScheduledPostProvenanceShape | null;
  /** Server-computed per-platform disclosure plan for this post. */
  disclosure?: Partial<Record<SchedulerPlatformKey, DisclosureChannel>>;
  results: Array<{ platform: SchedulerPlatformKey; status: string; error?: string | null; disclosure?: DisclosureChannel }>;
  createdAt: string;
  updatedAt: string;
}

/** YYYY-MM-DD for a Date in local time. */
export function toLocalDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Value for <input type="date"> — today in local time. */
export function todayLocal(): string {
  return toLocalDate(new Date());
}

/** Value for <input type="time"> — HH:MM in local time. */
export function timeLocal(d: Date = new Date()): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * Combine a YYYY-MM-DD date string and HH:MM time string into a Date in
 * local time. Returns null when the inputs don't parse.
 */
export function combineLocalDateTime(dateStr: string, timeStr: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || !/^\d{2}:\d{2}$/.test(timeStr)) return null;
  const [y, m, day] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);
  const d = new Date(y!, m! - 1, day!, hh!, mm!, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** True when the local datetime is at least a minute in the future. */
export function isFutureLocal(dateStr: string, timeStr: string): boolean {
  const d = combineLocalDateTime(dateStr, timeStr);
  return d !== null && d.getTime() > Date.now() + 60_000;
}

/**
 * Move a post's scheduled time to a new YYYY-MM-DD date, keeping the same
 * local time-of-day. Used by drag-to-reschedule on the calendar.
 */
export function movePostToDate(scheduledAtISO: string, targetDate: string): string | null {
  const current = new Date(scheduledAtISO);
  if (Number.isNaN(current.getTime())) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) return null;
  const [y, m, day] = targetDate.split("-").map(Number);
  const moved = new Date(y!, m! - 1, day!, current.getHours(), current.getMinutes(), 0, 0);
  return Number.isNaN(moved.getTime()) ? null : moved.toISOString();
}

/**
 * Decide what a calendar drag means before anything moves. The month
 * grid's drop handler is optimistic: on a "move" plan it re-dates the
 * post in local state at once, PATCHes through the existing update
 * path, and rolls the post back to its original time if the write
 * fails. The other plans never touch the network:
 *  - "noop":    dropped on the day the post already sits on.
 *  - "past":    the moved time would be < 60s in the future — the same
 *               rule the server enforces (400 bad_time), caught here
 *               so the user hears about it without a round trip.
 *  - "invalid": no scheduled time to move, or an unparseable target.
 */
export type ReschedulePlan =
  | { kind: "move"; scheduledAt: string }
  | { kind: "noop" }
  | { kind: "past" }
  | { kind: "invalid" };

export function planReschedule(
  post: ScheduledPostShape,
  targetDate: string,
  nowMs: number = Date.now(),
): ReschedulePlan {
  if (!post.scheduledAt) return { kind: "invalid" };
  const moved = movePostToDate(post.scheduledAt, targetDate);
  if (!moved) return { kind: "invalid" };
  if (toLocalDate(new Date(moved)) === toLocalDate(new Date(post.scheduledAt))) {
    return { kind: "noop" };
  }
  if (new Date(moved).getTime() < nowMs + 60_000) return { kind: "past" };
  return { kind: "move", scheduledAt: moved };
}

/**
 * Per-platform connection state for the scheduler's "posting accounts"
 * strip — a structural read of the SAME account list the composer
 * picks from (GET /api/social/accounts), so the strip can never
 * disagree with the composer. A platform with any usable account is
 * "connected"; one whose accounts all expired is "expired" (the
 * composer silently filters expired accounts out, which made expired
 * indistinguishable from never-connected — the strip exists to say it
 * out loud); no account at all is "none".
 */
export interface PostingAccountLike {
  platform: string;
  username: string | null;
  pageName: string | null;
  usernameMasked: string | null;
  expired: boolean;
}

export interface PostingAccountState {
  platform: SchedulerPlatformKey;
  state: "connected" | "expired" | "none";
  /** Human label for the account (page name, else masked/raw username). */
  accountLabel: string | null;
}

const POSTING_PLATFORMS: SchedulerPlatformKey[] = ["instagram", "tiktok", "facebook"];

export function postingAccountStates(accounts: PostingAccountLike[]): PostingAccountState[] {
  return POSTING_PLATFORMS.map((platform) => {
    const mine = accounts.filter((a) => a.platform === platform);
    const labelOf = (a: PostingAccountLike) => a.pageName ?? a.usernameMasked ?? a.username;
    const usable = mine.find((a) => !a.expired);
    if (usable) return { platform, state: "connected", accountLabel: labelOf(usable) };
    if (mine.length > 0) return { platform, state: "expired", accountLabel: labelOf(mine[0]!) };
    return { platform, state: "none", accountLabel: null };
  });
}

/** Group scheduled posts by their local YYYY-MM-DD date. */
export function groupPostsByDay(posts: ScheduledPostShape[]): Map<string, ScheduledPostShape[]> {
  const map = new Map<string, ScheduledPostShape[]>();
  for (const p of posts) {
    if (!p.scheduledAt) continue;
    const key = toLocalDate(new Date(p.scheduledAt));
    const list = map.get(key) ?? [];
    list.push(p);
    map.set(key, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => (a.scheduledAt ?? "").localeCompare(b.scheduledAt ?? ""));
  }
  return map;
}

/** Human countdown: "in 3h 20m", "in 2d 4h", "now", or "overdue". */
export function countdownLabel(scheduledAtISO: string, nowMs: number = Date.now()): string {
  const target = new Date(scheduledAtISO).getTime();
  const diff = target - nowMs;
  if (diff <= 0) return "due now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "due now";
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) {
    const rem = mins % 60;
    return rem === 0 ? `in ${hours}h` : `in ${hours}h ${rem}m`;
  }
  const days = Math.floor(hours / 24);
  const remH = hours % 24;
  return remH === 0 ? `in ${days}d` : `in ${days}d ${remH}h`;
}

/** "Mon, Sep 28 · 6:00 PM" style label in local time. */
export function prettyDateTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${date} · ${time}`;
}

/** Cost in credits to schedule a post — flat 1 credit per post, no matter
    how many platforms it targets. */
export function scheduleCost(platforms: SchedulerPlatformKey[]): number {
  return platforms.length > 0 ? 1 : 0;
}

/** Normalize a hashtags field: ensure each tag starts with # and dedupe. */
export function normalizeHashtags(raw: string): string {
  const tags = raw
    .split(/[\s,]+/)
    .map((t) => t.trim().replace(/^#+/, ""))
    .filter((t) => t.length > 0 && t.length <= 60)
    .map((t) => `#${t}`);
  return [...new Set(tags)].join(" ");
}

/**
 * Release attribution (migration 0143) read TOLERANTLY. The API DTO
 * exposes `releaseId: string | null` on scheduled posts (set only by
 * the scheduler-from-release flow), but this reader accepts the field
 * as it may arrive — absent on rows serialized before 0143, null on
 * posts scheduled any other way — and yields the id only when it is
 * actually a non-empty string. Kept structural (no ScheduledPostShape
 * change) so surfaces can ask any post-shaped value.
 */
export function postReleaseId(post: ScheduledPostShape | Record<string, unknown>): string | null {
  const v = (post as { releaseId?: unknown }).releaseId;
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * Provenance snapshot read TOLERANTLY (same discipline as postReleaseId):
 * yields the snapshot only when the payload actually carries a
 * well-formed one — absent on posts scheduled before wave 3 or without
 * a library asset. Never invents a record from the media URL.
 */
export function postProvenance(
  post: ScheduledPostShape | Record<string, unknown> | null | undefined,
): ScheduledPostProvenanceShape | null {
  const v = (post as { provenance?: unknown } | null | undefined)?.provenance;
  if (!v || typeof v !== "object") return null;
  const p = v as Record<string, unknown>;
  if (typeof p.assetId !== "string" || !p.assetId) return null;
  if (typeof p.tool !== "string" || !p.tool) return null;
  return {
    assetId: p.assetId,
    title: typeof p.title === "string" ? p.title : "",
    tool: p.tool,
    model: typeof p.model === "string" ? p.model : null,
    aiGenerated: p.aiGenerated === true,
    licence: typeof p.licence === "string" ? p.licence : "all-rights-reserved",
    disclosureLine: typeof p.disclosureLine === "string" ? p.disclosureLine : "",
    linkedAt: typeof p.linkedAt === "string" ? p.linkedAt : "",
  };
}

/** Mirror of the API's disclosureChannelFor — the pre-publish plan the
 *  composer shows per selected platform. Depends only on the record's
 *  AI state and the platform's real capabilities in this integration. */
export function disclosureChannelFor(
  platform: SchedulerPlatformKey,
  provenance: { aiGenerated: boolean } | null | undefined,
): DisclosureChannel {
  if (!provenance || !provenance.aiGenerated) return "not_applicable";
  if (platform === "tiktok") return "record_only";
  return "caption";
}

/** Days (YYYY-MM-DD) for the visible month grid, including leading blanks. */
export function monthGridDays(year: number, month: number): { date: string | null }[] {
  const first = new Date(year, month, 1);
  const leadBlanks = first.getDay(); // 0 = Sunday
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: { date: string | null }[] = [];
  for (let i = 0; i < leadBlanks; i++) cells.push({ date: null });
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({
      date: `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
    });
  }
  return cells;
}
