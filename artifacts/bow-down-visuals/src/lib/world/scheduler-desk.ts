/* ─── The in-world Scheduler desk (Stack-100 #45/#46) ───────────────
   The Promote Room's scheduler, completable where you stand: compose
   a post, schedule it on the site's REAL rails, see it on the
   in-world calendar list, edit it, cancel/delete it — no tab out,
   no "finish on the website". The rails are the 2D scheduler page's
   own (artifacts/api-server/src/routes/scheduler.ts):

     GET    /api/scheduler/posts            list (free)
     POST   /api/scheduler/posts            create — a future
                                            scheduledAt makes it a
                                            scheduled post; omitted
                                            → a free draft
     PATCH  /api/scheduler/posts/:id        edit / reschedule /
                                            unschedule (→ draft)
     DELETE /api/scheduler/posts/:id        scheduled → canceled
                                            (+ reservation refunded);
                                            draft/failed → deleted
     POST   /api/scheduler/best-time        AI best-time slots
     GET    /api/social/accounts            connected accounts the
                                            composer must pick per
                                            platform

   Money honesty (the rails' own model, read from the route +
   the 2D page's copy, scheduler.composer.costNote): scheduling a
   post carries the site's standard 100 Visual Buc reservation —
   charged when the post is scheduled, refunded automatically on
   cancel; drafts are free; a best-time ask is 100 Visual Bucs,
   refunded when the AI fails. This desk adds NO new price and
   never calls scheduling free where the rail charges. */

export const SCHEDULER_POST_COST_VISUAL_BUCS = 100;
export const SCHEDULER_BEST_TIME_COST_VISUAL_BUCS = 100;

export type SchedulerPlatformKey = "instagram" | "tiktok" | "facebook";

export const SCHEDULER_PLATFORMS: ReadonlyArray<{ key: SchedulerPlatformKey; label: string }> = [
  { key: "instagram", label: "Instagram" },
  { key: "tiktok", label: "TikTok" },
  { key: "facebook", label: "Facebook" },
];

export function isSchedulerPlatform(v: unknown): v is SchedulerPlatformKey {
  return v === "instagram" || v === "tiktok" || v === "facebook";
}

/* ─── Connected accounts (GET /api/social/accounts) ───────────────── */

export interface SchedulerAccount {
  id: string;
  platform: SchedulerPlatformKey;
  label: string;
  expired: boolean;
}

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export function parseSchedulerAccounts(data: unknown): SchedulerAccount[] {
  const rows = asRecord(data)["accounts"];
  if (!Array.isArray(rows)) return [];
  const out: SchedulerAccount[] = [];
  for (const raw of rows) {
    const r = asRecord(raw);
    const id = str(r["id"]);
    const platform = r["platform"];
    if (!id || !isSchedulerPlatform(platform)) continue;
    const label =
      str(r["pageName"]) ?? str(r["username"]) ?? str(r["usernameMasked"]) ?? "Connected account";
    out.push({ id, platform, label, expired: r["expired"] === true });
  }
  return out;
}

export function accountsForPlatform(
  accounts: SchedulerAccount[],
  platform: SchedulerPlatformKey,
): SchedulerAccount[] {
  return accounts.filter((a) => a.platform === platform);
}

/** The account a platform will post through: the composer's explicit
 *  pick when it is still connected for that platform, else the first
 *  live (non-expired) account, else null — the rail refuses a post
 *  whose platform has no account, so the desk refuses earlier, in
 *  words (see validateSchedulerCompose). */
export function resolveAccountId(
  accounts: SchedulerAccount[],
  platform: SchedulerPlatformKey,
  picked: string | undefined,
): string | null {
  const mine = accountsForPlatform(accounts, platform);
  if (picked && mine.some((a) => a.id === picked && !a.expired)) return picked;
  return mine.find((a) => !a.expired)?.id ?? null;
}

/* ─── Posts (GET /api/scheduler/posts) ────────────────────────────── */

export interface SchedulerDeskPost {
  id: string;
  caption: string;
  hashtags: string;
  platforms: SchedulerPlatformKey[];
  accountIds: Partial<Record<SchedulerPlatformKey, string>>;
  mediaUrl: string;
  mediaType: "video" | "image";
  scheduledAt: string | null;
  status: string;
  creditsCharged: number;
}

export function parseSchedulerDeskPosts(data: unknown): SchedulerDeskPost[] {
  const rows = asRecord(data)["posts"];
  if (!Array.isArray(rows)) return [];
  const out: SchedulerDeskPost[] = [];
  for (const raw of rows) {
    const p = asRecord(raw);
    const id = str(p["id"]);
    if (!id) continue;
    const rawAccounts = asRecord(p["accountIds"]);
    const accountIds: Partial<Record<SchedulerPlatformKey, string>> = {};
    for (const key of Object.keys(rawAccounts)) {
      const v = rawAccounts[key];
      if (isSchedulerPlatform(key) && typeof v === "string" && v.length > 0) {
        accountIds[key] = v;
      }
    }
    out.push({
      id,
      caption: str(p["caption"]) ?? "",
      hashtags: str(p["hashtags"]) ?? "",
      platforms: Array.isArray(p["platforms"])
        ? (p["platforms"] as unknown[]).filter(isSchedulerPlatform)
        : [],
      accountIds,
      mediaUrl: str(p["mediaUrl"]) ?? "",
      mediaType: p["mediaType"] === "image" ? "image" : "video",
      scheduledAt: str(p["scheduledAt"]),
      status: str(p["status"]) ?? "",
      creditsCharged: typeof p["creditsCharged"] === "number" ? p["creditsCharged"] : 0,
    });
  }
  return out;
}

/** The desk's calendar order: scheduled posts soonest first, then
 *  drafts (no time yet), then everything else by recency as stored. */
export function sortSchedulerDeskPosts(posts: SchedulerDeskPost[]): SchedulerDeskPost[] {
  const rank = (p: SchedulerDeskPost) =>
    p.status === "scheduled" ? 0 : p.status === "draft" ? 1 : 2;
  return posts.slice().sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    if (a.status === "scheduled" && b.status === "scheduled") {
      return (a.scheduledAt ?? "").localeCompare(b.scheduledAt ?? "");
    }
    return 0;
  });
}

export function editableSchedulerPost(p: SchedulerDeskPost): boolean {
  return p.status === "draft" || p.status === "scheduled";
}

/* ─── Compose ─────────────────────────────────────────────────────── */

export interface SchedulerPrefill {
  mediaUrl: string;
  mediaType: "video" | "image";
  caption?: string;
  hashtags?: string;
}

export interface SchedulerComposeDraft {
  mediaUrl: string;
  mediaType: "video" | "image";
  caption: string;
  hashtags: string;
  platforms: SchedulerPlatformKey[];
  accountIds: Partial<Record<SchedulerPlatformKey, string>>;
  /** A `datetime-local` value ("YYYY-MM-DDTHH:MM") or "" for a draft. */
  whenLocal: string;
}

export function emptySchedulerCompose(prefill?: SchedulerPrefill | null): SchedulerComposeDraft {
  return {
    mediaUrl: prefill?.mediaUrl ?? "",
    mediaType: prefill?.mediaType ?? "video",
    caption: prefill?.caption ?? "",
    hashtags: prefill?.hashtags ?? "",
    platforms: [],
    accountIds: {},
    whenLocal: "",
  };
}

export function composeFromPost(p: SchedulerDeskPost): SchedulerComposeDraft {
  return {
    mediaUrl: p.mediaUrl,
    mediaType: p.mediaType,
    caption: p.caption,
    hashtags: p.hashtags,
    platforms: [...p.platforms],
    accountIds: { ...p.accountIds },
    whenLocal: p.scheduledAt ? toDatetimeLocalValue(p.scheduledAt) : "",
  };
}

/** `datetime-local` value for an ISO instant, in the viewer's local
 *  time (the input's own frame). */
export function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** ISO instant for a `datetime-local` value, or null when empty/bad. */
export function fromDatetimeLocalValue(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** The rail only schedules a time more than a minute out. */
export function isSchedulableWhen(whenLocal: string, nowMs: number): boolean {
  const iso = fromDatetimeLocalValue(whenLocal);
  return iso !== null && new Date(iso).getTime() > nowMs + 60_000;
}

/** The composer's refusal, in words, or null when the draft can go.
 *  Mirrors the rail's own gates (media required, ≥1 platform, an
 *  account per platform, a future time when scheduling) so the
 *  member hears it at the desk, not from a failed call. */
export function validateSchedulerCompose(
  draft: SchedulerComposeDraft,
  accounts: SchedulerAccount[],
  opts: { forSchedule: boolean; nowMs: number },
): string | null {
  if (!draft.mediaUrl.trim()) return "Add the video or image this post carries first.";
  if (draft.platforms.length === 0) return "Pick at least one platform to post to.";
  for (const platform of draft.platforms) {
    if (!resolveAccountId(accounts, platform, draft.accountIds[platform])) {
      const label = SCHEDULER_PLATFORMS.find((p) => p.key === platform)?.label ?? platform;
      return `Connect a ${label} account first — a scheduled post needs an account to post through.`;
    }
  }
  if (opts.forSchedule && !isSchedulableWhen(draft.whenLocal, opts.nowMs)) {
    return "Pick a time at least a minute from now — or save it as a free draft.";
  }
  return null;
}

function resolvedAccountIds(
  draft: SchedulerComposeDraft,
  accounts: SchedulerAccount[],
): Partial<Record<SchedulerPlatformKey, string>> {
  const out: Partial<Record<SchedulerPlatformKey, string>> = {};
  for (const platform of draft.platforms) {
    const id = resolveAccountId(accounts, platform, draft.accountIds[platform]);
    if (id) out[platform] = id;
  }
  return out;
}

/** POST /api/scheduler/posts body. forSchedule=false omits
 *  scheduledAt entirely → the rail saves a free draft. */
export function buildSchedulerCreatePayload(
  draft: SchedulerComposeDraft,
  accounts: SchedulerAccount[],
  forSchedule: boolean,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    mediaUrl: draft.mediaUrl.trim(),
    mediaType: draft.mediaType,
    caption: draft.caption,
    hashtags: draft.hashtags,
    platforms: [...draft.platforms],
    accountIds: resolvedAccountIds(draft, accounts),
  };
  if (forSchedule) {
    const iso = fromDatetimeLocalValue(draft.whenLocal);
    if (iso) payload["scheduledAt"] = iso;
  }
  return payload;
}

/** PATCH /api/scheduler/posts/:id body. forSchedule=false sends
 *  scheduledAt: null — the rail unschedules (refunding a scheduled
 *  post's reservation) and the post lives on as a draft. */
export function buildSchedulerUpdatePayload(
  draft: SchedulerComposeDraft,
  accounts: SchedulerAccount[],
  forSchedule: boolean,
): Record<string, unknown> {
  return {
    mediaUrl: draft.mediaUrl.trim(),
    mediaType: draft.mediaType,
    caption: draft.caption,
    hashtags: draft.hashtags,
    platforms: [...draft.platforms],
    accountIds: resolvedAccountIds(draft, accounts),
    scheduledAt: forSchedule ? fromDatetimeLocalValue(draft.whenLocal) : null,
  };
}

/** The created/updated post out of a POST/PATCH response ({ post }). */
export function parseSchedulerPostResponse(data: unknown): SchedulerDeskPost | null {
  const posts = parseSchedulerDeskPosts({ posts: [asRecord(data)["post"]] });
  return posts[0] ?? null;
}

/** The DELETE answer: a scheduled post cancels (+ refund), anything
 *  else deletable is deleted outright. */
export function parseSchedulerDeleteResult(data: unknown): { canceled: boolean; refunded: number } {
  const d = asRecord(data);
  return {
    canceled: d["canceled"] === true,
    refunded: typeof d["refunded"] === "number" ? d["refunded"] : 0,
  };
}

/* ─── Best time (POST /api/scheduler/best-time) ───────────────────── */

export interface BestTimeSlot {
  date: string;
  time: string;
  platform: SchedulerPlatformKey;
  reason: string;
}

export function buildBestTimePayload(input: {
  niche: string;
  platforms: SchedulerPlatformKey[];
  postsPerWeek: number;
  timezone: string;
}): Record<string, unknown> {
  return {
    niche: input.niche.trim(),
    platforms: [...input.platforms],
    postsPerWeek: Math.min(14, Math.max(1, Math.round(input.postsPerWeek) || 3)),
    timezone: input.timezone || "America/New_York",
  };
}

export function parseBestTimeResult(data: unknown): { slots: BestTimeSlot[]; note: string | null } {
  const d = asRecord(data);
  const rows = Array.isArray(d["slots"]) ? d["slots"] : [];
  const slots: BestTimeSlot[] = [];
  for (const raw of rows) {
    const s = asRecord(raw);
    const date = str(s["date"]);
    const time = str(s["time"]);
    const platform = s["platform"];
    if (!date || !time || !isSchedulerPlatform(platform)) continue;
    slots.push({ date, time, platform, reason: str(s["reason"]) ?? "" });
  }
  return { slots, note: str(d["note"]) };
}

/** A best-time slot as a composer's `datetime-local` value. */
export function bestTimeSlotWhen(slot: BestTimeSlot): string {
  return `${slot.date}T${slot.time}`;
}
