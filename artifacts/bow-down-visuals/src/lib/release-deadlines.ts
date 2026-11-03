/* ─── Release deadline engine (org wave #2, rank 6c) ──────────────────
   The clock the release calendar watches. Pure classification of
   scheduled posts against "now": a post whose moment has passed but
   never fired is OVERDUE, one landing today is DUE TODAY, one inside
   the next 48 hours is DUE SOON. Everything else is just scheduled.
   The Scheduler's calendar tab renders these flags; nothing here
   touches the network or the DOM, so the rules are unit-pinned. */

export type DeadlineFlag = "overdue" | "due-today" | "due-soon";

export interface DeadlinePost {
  id: string;
  status: string;
  scheduledAt: string | null;
}

export interface FlaggedDeadline<T extends DeadlinePost = DeadlinePost> {
  post: T;
  flag: DeadlineFlag;
  /** Whole hours past the deadline (overdue only, >= 1 once an hour late). */
  hoursLate: number;
}

export const DUE_SOON_WINDOW_MS = 48 * 60 * 60 * 1000;

/** Local YYYY-MM-DD for a timestamp — the calendar's day grain. */
function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * The flag for one post at one moment, or null when the post needs no
 * clock-watching: drafts (no moment set), posts already out
 * (posted/canceled), and posts comfortably in the future.
 * A FAILED post whose moment has passed is overdue — it needs a
 * human, which is exactly what the flag is for.
 */
export function deadlineFlagFor(post: DeadlinePost, nowMs: number): DeadlineFlag | null {
  if (!post.scheduledAt) return null;
  if (post.status !== "scheduled" && post.status !== "failed") return null;
  const at = Date.parse(post.scheduledAt);
  if (Number.isNaN(at)) return null;
  if (at < nowMs) return "overdue";
  if (localDay(at) === localDay(nowMs)) return "due-today";
  if (at - nowMs <= DUE_SOON_WINDOW_MS) return "due-soon";
  return null;
}

/** Every flagged post, worst first: overdue (oldest first), then due-today, then due-soon. */
export function flaggedDeadlines<T extends DeadlinePost>(posts: readonly T[], nowMs: number): FlaggedDeadline<T>[] {
  const rank: Record<DeadlineFlag, number> = { overdue: 0, "due-today": 1, "due-soon": 2 };
  const out: FlaggedDeadline<T>[] = [];
  for (const post of posts) {
    const flag = deadlineFlagFor(post, nowMs);
    if (!flag) continue;
    const at = Date.parse(post.scheduledAt!);
    out.push({
      post,
      flag,
      hoursLate: flag === "overdue" ? Math.max(0, Math.floor((nowMs - at) / 3_600_000)) : 0,
    });
  }
  return out.sort((a, b) =>
    rank[a.flag] - rank[b.flag] || Date.parse(a.post.scheduledAt!) - Date.parse(b.post.scheduledAt!),
  );
}

/** The one-line human label for a flag — the calendar's chip text. */
export function deadlineFlagLabel(flag: DeadlineFlag, hoursLate = 0): string {
  switch (flag) {
    case "overdue":
      return hoursLate >= 1 ? `Overdue ${hoursLate}h` : "Overdue";
    case "due-today":
      return "Due today";
    case "due-soon":
      return "Due soon";
  }
}
