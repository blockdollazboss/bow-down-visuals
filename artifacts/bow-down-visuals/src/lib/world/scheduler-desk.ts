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

export type SchedulerPlatformKey = "instagram" | "tiktok" | "facebook" | "x";

export const SCHEDULER_PLATFORMS: ReadonlyArray<{ key: SchedulerPlatformKey; label: string }> = [
  { key: "instagram", label: "Instagram" },
  { key: "tiktok", label: "TikTok" },
  { key: "facebook", label: "Facebook" },
  { key: "x", label: "X" },
];

function isSchedulerPlatform(v: unknown): v is SchedulerPlatformKey {
  return v === "instagram" || v === "tiktok" || v === "facebook" || v === "x";
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

/** The composer's refusal copy — the desk passes its catalog
 *  strings in; unbundled calls render the English lines verbatim
 *  (worldScheduleRelease i18n, unit 45). `needAccount` carries a
 *  {{label}} token the seam fills with the platform's name. */
export interface SchedulerComposeStrings {
  needMedia: string;
  needPlatform: string;
  needAccount: string;
  needFutureTime: string;
}

export const SCHEDULER_COMPOSE_EN: SchedulerComposeStrings = {
  needMedia: "Add the video or image this post carries first.",
  needPlatform: "Pick at least one platform to post to.",
  needAccount: "Connect a {{label}} account first — a scheduled post needs an account to post through.",
  needFutureTime: "Pick a time at least a minute from now — or save it as a free draft.",
};

/** The composer's refusal, in words, or null when the draft can go.
 *  Mirrors the rail's own gates (media required, ≥1 platform, an
 *  account per platform, a future time when scheduling) so the
 *  member hears it at the desk, not from a failed call. */
export function validateSchedulerCompose(
  draft: SchedulerComposeDraft,
  accounts: SchedulerAccount[],
  opts: { forSchedule: boolean; nowMs: number; strings?: SchedulerComposeStrings },
): string | null {
  const s = opts.strings ?? SCHEDULER_COMPOSE_EN;
  if (!draft.mediaUrl.trim()) return s.needMedia;
  if (draft.platforms.length === 0) return s.needPlatform;
  for (const platform of draft.platforms) {
    if (!resolveAccountId(accounts, platform, draft.accountIds[platform])) {
      const label = SCHEDULER_PLATFORMS.find((p) => p.key === platform)?.label ?? platform;
      return s.needAccount.split("{{label}}").join(label);
    }
  }
  if (opts.forSchedule && !isSchedulableWhen(draft.whenLocal, opts.nowMs)) {
    return s.needFutureTime;
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

/* ─── The schedule-success receipt (Stack-100 #2 item 71) ───────────
   A completed schedule answers back WHAT was scheduled, WHEN it
   goes out, and on WHICH channels — the creator never has to hunt
   the calendar to confirm the post they just made. Built from the
   server's own post when it parsed; when the response didn't
   parse, the receipt falls back to the draft the member just
   saved (its caption, its picked time, its platforms) rather than
   claiming a when/channel it doesn't know. A draft's receipt is
   honest that nothing is scheduled yet. */

/** The receipt's copy — the desk passes its catalog strings in;
 *  unbundled calls render the English lines verbatim
 *  (worldScheduleRelease i18n, unit 45). */
export interface SchedulerReceiptStrings {
  yourPost: string;
  draftReceipt: string;
  scheduledPrefix: string;
  whenPart: string;
  channelsPart: string;
  channelsAnd: string;
  receiptTail: string;
}

export const SCHEDULER_RECEIPT_EN: SchedulerReceiptStrings = {
  yourPost: "Your post",
  draftReceipt: "Saved as a draft — “{{title}}” is free and waiting. Give it a time whenever you're ready and it joins the calendar.",
  scheduledPrefix: "Scheduled — “{{title}}”",
  whenPart: "for {{when}}",
  channelsPart: "on {{channels}}",
  channelsAnd: " and ",
  receiptTail: ". It's on your calendar below, and you can edit or cancel it right here.",
};

function receiptTitle(caption: string, fallback: string): string {
  const t = caption.trim().replace(/\s+/g, " ");
  if (!t) return fallback;
  return t.length > 60 ? `${t.slice(0, 57)}…` : t;
}

function receiptChannels(platforms: SchedulerPlatformKey[], and: string): string {
  const labels = platforms.map(
    (p) => SCHEDULER_PLATFORMS.find((s) => s.key === p)?.label ?? p,
  );
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0]!;
  return `${labels.slice(0, -1).join(", ")}${and}${labels[labels.length - 1]}`;
}

export function schedulerSavedReceipt(
  post: SchedulerDeskPost | null,
  draft: SchedulerComposeDraft,
  willSchedule: boolean,
  strings?: SchedulerReceiptStrings,
): string {
  const s = strings ?? SCHEDULER_RECEIPT_EN;
  const title = receiptTitle(post?.caption || draft.caption, s.yourPost);
  if (!willSchedule) {
    return s.draftReceipt.split("{{title}}").join(title);
  }
  const whenIso = post?.scheduledAt ?? fromDatetimeLocalValue(draft.whenLocal);
  const when = whenIso ? prettyDateTime(whenIso) : null;
  const channels = receiptChannels(
    post && post.platforms.length > 0 ? post.platforms : draft.platforms,
    s.channelsAnd,
  );
  const parts = [s.scheduledPrefix.split("{{title}}").join(title)];
  if (when) parts.push(s.whenPart.split("{{when}}").join(when));
  if (channels) parts.push(s.channelsPart.split("{{channels}}").join(channels));
  return `${parts.join(" ")}${s.receiptTail}`;
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

/* ─── Full surface (Stack-100 #57): calendar + connect ──────────────
   Wave 1 shipped compose/edit/cancel + best-time. The 2D scheduler's
   remaining surface is the month calendar (with drag-reschedule on
   the page's own planReschedule rail — PATCH { scheduledAt }) and
   the posting-accounts strip (connect via the platform OAuth
   auth-url rails, disconnect via DELETE /api/social/accounts/:id).
   The pure helpers below reuse the 2D page's own lib/scheduler
   shaping so the in-world calendar can never disagree with it. */

import {
  monthGridDays,
  planReschedule,
  postingAccountStates,
  prettyDateTime,
  toLocalDate,
  type PostingAccountState,
  type ScheduledPostShape,
} from "@/lib/scheduler";

export type { PostingAccountState };

/** Per-platform connection state from the raw /social/accounts
 *  payload — the 2D strip's own derivation (connected / expired /
 *  none), so an expired connection never reads as never-connected. */
export function parseSchedulerAccountStates(data: unknown): PostingAccountState[] {
  const rows = asRecord(data)["accounts"];
  const likes = (Array.isArray(rows) ? rows : []).map((raw) => {
    const r = asRecord(raw);
    return {
      platform: typeof r["platform"] === "string" ? r["platform"] : "",
      username: str(r["username"]),
      pageName: str(r["pageName"]),
      usernameMasked: str(r["usernameMasked"]),
      expired: r["expired"] === true,
    };
  });
  return postingAccountStates(likes);
}

interface SocialConnectPlatform {
  key: SchedulerPlatformKey;
  label: string;
  /** GET → { authUrl } — the OAuth start rail the 2D Settings panel
   *  uses; connecting is a full-page redirect by the providers'
   *  own requirement, exactly as on the website. */
  authPath: string;
  blurb: string;
}

export const SOCIAL_CONNECT_PLATFORMS: ReadonlyArray<SocialConnectPlatform> = [
  {
    key: "instagram",
    label: "Instagram",
    authPath: "/api/social/instagram/auth-url",
    blurb: "Needs a Business or Creator account linked to a Facebook Page.",
  },
  {
    key: "tiktok",
    label: "TikTok",
    authPath: "/api/social/tiktok/auth-url",
    blurb: "Any TikTok account works — uploads land in your TikTok drafts, never auto-posted.",
  },
  {
    key: "facebook",
    label: "Facebook",
    authPath: "/api/social/facebook/auth-url",
    blurb: "Connect your Facebook Pages — exports post as Reels.",
  },
  {
    key: "x",
    label: "X",
    authPath: "/api/social/x/auth-url",
    blurb: "Connect your X account — scheduled posts go to your timeline (280 characters).",
  },
];

/** The OAuth start URL out of an auth-url response, or null. */
export function parseSocialAuthUrl(data: unknown): string | null {
  return str(asRecord(data)["authUrl"]);
}

/* ─── Calendar ────────────────────────────────────────────────────── */

/** The desk post as the 2D calendar's shape (only the fields the
 *  calendar helpers read are load-bearing; the rest are honest
 *  defaults from this desk's own parse). */
function toCalendarShape(p: SchedulerDeskPost): ScheduledPostShape {
  return {
    id: p.id,
    status: (["draft", "scheduled", "publishing", "posted", "failed", "canceled"].includes(p.status)
      ? p.status
      : "scheduled") as ScheduledPostShape["status"],
    mediaUrl: p.mediaUrl,
    mediaType: p.mediaType,
    caption: p.caption,
    hashtags: p.hashtags,
    platforms: [...p.platforms],
    accountIds: { ...p.accountIds },
    scheduledAt: p.scheduledAt,
    postedAt: null,
    attempts: 0,
    lastError: null,
    creditsCharged: p.creditsCharged,
    releaseId: null,
    results: [],
    createdAt: "",
    updatedAt: "",
  };
}

/** Scheduled posts grouped by local day (YYYY-MM-DD), each day's
 *  posts in time order — the 2D calendar's own grouping. */
export function calendarPostsByDay(posts: SchedulerDeskPost[]): Map<string, SchedulerDeskPost[]> {
  const map = new Map<string, SchedulerDeskPost[]>();
  for (const p of posts) {
    if (p.status !== "scheduled" || !p.scheduledAt) continue;
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

/** Month grid cells (leading blanks + YYYY-MM-DD days). */
export function calendarMonthCells(year: number, month: number): Array<{ date: string | null }> {
  return monthGridDays(year, month);
}

export function calendarMonthLabel(year: number, month: number, locale?: string): string {
  return new Date(year, month, 1).toLocaleDateString(locale ?? "en-US", { month: "long", year: "numeric" });
}

/** Today as a local YYYY-MM-DD (the grid's own frame). */
export function calendarToday(nowMs: number): string {
  return toLocalDate(new Date(nowMs));
}

type DeskReschedulePlan =
  | { kind: "move"; scheduledAt: string }
  | { kind: "noop" }
  | { kind: "past" }
  | { kind: "invalid" };

/** Drag/move planning — the 2D calendar's planReschedule, verbatim
 *  semantics: same-day is a noop, a target landing under a minute
 *  out is "past", anything else moves KEEPING the time of day. */
export function planDeskReschedule(
  post: SchedulerDeskPost,
  targetDate: string,
  nowMs: number,
): DeskReschedulePlan {
  const plan = planReschedule(toCalendarShape(post), targetDate, nowMs);
  if (plan.kind === "move") return { kind: "move", scheduledAt: plan.scheduledAt };
  return { kind: plan.kind };
}

/** PATCH body for a reschedule — the rail's own minimal shape. */
export function buildReschedulePayload(scheduledAt: string): Record<string, unknown> {
  return { scheduledAt };
}

/** A day-cell tap seeds the composer at midday local on that day —
 *  a starting time the member then adjusts in the When field. */
export function composeWhenForDay(date: string): string {
  return `${date}T12:00`;
}

||||||| 44426f660
/* ─── Publish now (Stack-400 census B item B-12) ────────────────────
   The desk above handled accounts, auth and scheduling — publishing
   NOW had no in-World action: the four publish rails were only
   reachable from the 2D post modals (components/InstagramPostModal,
   TikTokPostModal, FacebookPostModal, XPostModal). These helpers
   give the Scheduler Desk the same publish actions on the same
   rails — POST /api/social/{platform}/publish, 100 Visual Bucs per
   rail in the registry — and the publish bench rides confirmedFetch
   exactly like the modals, so cancel means no charge and no error.

   Payloads mirror the modals byte-for-byte on every case the modals
   cover: { accountId, videoUrl, caption, idempotencyKey } for
   Instagram / TikTok / Facebook, and text-first
   { accountId, text, videoUrl?, idempotencyKey } for X. The caption
   text is the scheduler worker's own composition (scheduler-jobs'
   fullCaption: caption + "\n" + hashtags) so a post published from
   the desk reads exactly like the same post published by the
   calendar. One extension beyond the modals: an image draft on X
   rides the rail's imageUrl field — the modals are video-only
   composers and never face that case; dropping the member's image
   silently would be the worse lie.

   The idempotencyKey discipline is the modals': one key per publish
   intent (per platform + media), persisted in sessionStorage,
   reused across retries so a retry replays the SAME server attempt,
   and retired only on confirmed success — a deliberate repost mints
   a fresh key. */

import { getCreditCost } from "../credit-costs";

/** Registry cost for an endpoint; throws if unregistered so the desk
 *  can never display (or confirm against) an invented price. */
function socialPublishRegistryCost(endpoint: string): number {
  const entry = getCreditCost(endpoint);
  if (!entry) throw new Error(`No registered credit cost for ${endpoint}`);
  return entry.cost;
}

export const SOCIAL_PUBLISH_PATHS: Record<SchedulerPlatformKey, string> = {
  instagram: "/api/social/instagram/publish",
  facebook: "/api/social/facebook/publish",
  tiktok: "/api/social/tiktok/publish",
  x: "/api/social/x/publish",
};

/** The live registry price of one platform's publish rail — the same
 *  row the 2D modal reads (getCreditCost(path)?.cost with the same
 *  registry behind it). */
export function socialPublishCost(platform: SchedulerPlatformKey): number {
  return socialPublishRegistryCost(SOCIAL_PUBLISH_PATHS[platform]);
}

/** The single publish price the bench shows in its intro — all four
 *  rails carry the same registry row today; the tests pin that. */
export const SOCIAL_PUBLISH_COST_VISUAL_BUCS = socialPublishRegistryCost(
  SOCIAL_PUBLISH_PATHS.instagram,
);

/** X's post cap — the rail schema's max and the X modal's TEXT_LIMIT. */
export const SOCIAL_PUBLISH_X_TEXT_LIMIT = 280;

/** The text a publish sends — the scheduler worker's fullCaption
 *  composition, verbatim: trimmed caption, then trimmed hashtags,
 *  joined with a newline. */
export function schedulerPublishText(draft: SchedulerComposeDraft): string {
  const tags = draft.hashtags.trim();
  const cap = draft.caption.trim();
  return [cap, tags].filter(Boolean).join("\n");
}

export interface SocialPublishStrings {
  needMedia: string;
  needVideo: string;
  needAccount: string;
  needText: string;
  textTooLong: string;
}

const fillPublish = (template: string, vars: Record<string, string | number>): string =>
  Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{{${k}}}`).join(String(v)), template);

const SOCIAL_PUBLISH_EN: SocialPublishStrings = {
  needMedia: "Add the video this post carries first.",
  needVideo: "{{label}} publishes video — this post carries an image.",
  needAccount: "Connect your {{label}} account first — publishing needs an account to post through.",
  needText: "Write the post text first.",
  textTooLong: "X posts cap at 280 characters — this one is {{count}}.",
};

/** Words for a publish refusal, or null when the draft can publish.
 *  Account first (nothing to post through), then the per-rail media
 *  rules: Instagram / TikTok / Facebook publish video; X is
 *  text-first (media optional) with the 280-character cap the rail
 *  enforces — refused here in words, never truncated. */
export function validateSocialPublish(
  platform: SchedulerPlatformKey,
  draft: SchedulerComposeDraft,
  accounts: SchedulerAccount[],
  strings?: Partial<SocialPublishStrings>,
): string | null {
  const s: SocialPublishStrings = { ...SOCIAL_PUBLISH_EN, ...(strings ?? {}) };
  const label = SCHEDULER_PLATFORMS.find((p) => p.key === platform)?.label ?? platform;
  if (!resolveAccountId(accounts, platform, draft.accountIds[platform])) {
    return fillPublish(s.needAccount, { label });
  }
  if (platform === "x") {
    const text = schedulerPublishText(draft);
    if (!text) return s.needText;
    if (text.length > SOCIAL_PUBLISH_X_TEXT_LIMIT) {
      return fillPublish(s.textTooLong, { count: text.length });
    }
    return null;
  }
  if (!draft.mediaUrl.trim()) return s.needMedia;
  if (draft.mediaType !== "video") return fillPublish(s.needVideo, { label });
  return null;
}

/** The wire body for one platform's publish rail — the modal's body,
 *  field for field. Null when no live account resolves (the bench
 *  validates first; this is the belt-and-braces twin of that check). */
export function buildSocialPublishPayload(
  platform: SchedulerPlatformKey,
  draft: SchedulerComposeDraft,
  accounts: SchedulerAccount[],
  idempotencyKey: string,
): Record<string, unknown> | null {
  const accountId = resolveAccountId(accounts, platform, draft.accountIds[platform]);
  if (!accountId) return null;
  const text = schedulerPublishText(draft);
  if (platform === "x") {
    const mediaUrl = draft.mediaUrl.trim();
    return {
      accountId,
      text,
      ...(mediaUrl && draft.mediaType === "video" ? { videoUrl: mediaUrl } : {}),
      ...(mediaUrl && draft.mediaType === "image" ? { imageUrl: mediaUrl } : {}),
      idempotencyKey,
    };
  }
  return {
    accountId,
    videoUrl: draft.mediaUrl.trim(),
    caption: text,
    idempotencyKey,
  };
}

/** sessionStorage slot for one publish intent — the modals' shape
 *  (`<prefix>-publish-key:${videoUrl}`), keyed per platform so the
 *  four rails never share an attempt. X text-only intents key on
 *  "text-only", like the modal. */
export function socialPublishStorageKey(
  platform: SchedulerPlatformKey,
  mediaUrl: string,
): string {
  return `world-publish-key:${platform}:${mediaUrl.trim() || "text-only"}`;
}

/** Load the persisted key for this intent, or mint + persist one.
 *  Falls back to the caller's in-memory cache when storage is
 *  unavailable (private mode, webview without sessionStorage) — the
 *  discipline survives either way: same intent, same key. */
export function loadSocialPublishKey(
  platform: SchedulerPlatformKey,
  mediaUrl: string,
  storage: Pick<Storage, "getItem" | "setItem"> | null,
  cache: Map<string, string>,
  mint: () => string = () => crypto.randomUUID(),
): string {
  const slot = socialPublishStorageKey(platform, mediaUrl);
  const cached = cache.get(slot);
  if (cached) return cached;
  if (storage) {
    try {
      const existing = storage.getItem(slot);
      if (existing && existing.length >= 8) {
        cache.set(slot, existing);
        return existing;
      }
      const fresh = mint();
      storage.setItem(slot, fresh);
      cache.set(slot, fresh);
      return fresh;
    } catch {
      /* storage refused — the in-memory cache below still holds it */
    }
  }
  const fresh = mint();
  cache.set(slot, fresh);
  return fresh;
}

/** Retire an intent's key after a CONFIRMED success — the next
 *  publish of the same media is a deliberate new post. */
export function retireSocialPublishKey(
  platform: SchedulerPlatformKey,
  mediaUrl: string,
  storage: Pick<Storage, "removeItem"> | null,
  cache: Map<string, string>,
): void {
  const slot = socialPublishStorageKey(platform, mediaUrl);
  cache.delete(slot);
  if (storage) {
    try {
      storage.removeItem(slot);
    } catch {
      /* nothing persisted to retire */
    }
  }
}

export interface SocialPublishResult {
  /** The platform-side id: mediaId (Instagram), publishId (TikTok),
   *  videoId (Facebook) or tweetId (X) — whichever the rail named. */
  mediaId: string | null;
  permalink: string | null;
  creditsUsed: number | null;
  creditsRemaining: number | null;
  /** TikTok's honest shape: the video landed in the member's drafts,
   *  never auto-posted — fresh successes say so in the status field,
   *  stored replays carry the uniform result shape instead. */
  deliveredToDrafts: boolean;
  /** True when the rail answered with a stored replay of an earlier
   *  attempt (same idempotency key) rather than a fresh publish. */
  deduped: boolean;
}

/** A publish answer read generously, null on real drift — every rail
 *  names its id differently, TikTok's fresh success carries no
 *  permalink at all, and replays return the stored uniform shape.
 *  An answer with no id, no permalink and no credits line is not a
 *  publish result and reads as null (the bench shows its failure
 *  words, never a painted-over success). */
export function parseSocialPublishResult(data: unknown): SocialPublishResult | null {
  const d = asRecord(data);
  const mediaId =
    str(d.mediaId) ?? str(d.publishId) ?? str(d.videoId) ?? str(d.tweetId);
  const permalink = str(d.permalink);
  const creditsUsed = numOrNull(d.creditsUsed);
  if (!mediaId && !permalink && creditsUsed === null) return null;
  return {
    mediaId,
    permalink,
    creditsUsed,
    creditsRemaining: numOrNull(d.creditsRemaining),
    deliveredToDrafts: d.status === "sent_to_tiktok_inbox",
    deduped: d.deduped === true,
  };
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export type SocialPublishOutcome =
  | { kind: "ok"; result: SocialPublishResult }
  | { kind: "out-of-credits" }
  | { kind: "in-progress" }
  | { kind: "failed"; message: string };

/** The modals' answer handling, classified once for all four rails:
 *  402 / out_of_credits → the top-up state; 409 publish_in_progress
 *  → the "already publishing" notice (NOT an error — the first
 *  attempt is still landing); a 2xx that doesn't parse is a failure,
 *  never a painted success; anything else carries the rail's own
 *  message or the platform fallback. */
export function classifySocialPublishResponse(
  status: number,
  data: unknown,
  fallback: string,
): SocialPublishOutcome {
  const d = asRecord(data);
  const error = str(d.error);
  if (status === 402 || error === "out_of_credits") return { kind: "out-of-credits" };
  if (status === 409 && error === "publish_in_progress") return { kind: "in-progress" };
  if (status >= 200 && status < 300) {
    const result = parseSocialPublishResult(data);
    return result ? { kind: "ok", result } : { kind: "failed", message: fallback };
  }
  return { kind: "failed", message: str(d.message) ?? fallback };/* ─── Stack 400 · census B-19 — Content Calendar Auto-Fill ────
   The Wave8 single rail that belongs to this desk's family
   (manifest lane s400-world-wave8, joining AFTER the social
   publish section above): the Calendar Auto-Fill bench
   stacked with the Scheduler family in the Promote Room.

     POST /api/wave8/calendar/autofill        150  CalendarAutofill
     GET  /api/wave8/calendar/slots?weekStart=…  0  the week's slots

   The autofill payload is shaped EXACTLY as the page shapes
   it (the Monday week start, the pillars split on commas,
   trimmed, capped at six, the voice note trimmed-or-absent)
   and its answer is read through the same slot reader as the
   free week read — one slot shape for both rails. Slot
   management (drag between days, delete) stays with the 2D
   calendar and this desk's composer; the bench drafts the
   week and shows it. The registry read goes through a
   namespace import so this section never collides with the
   publish section's named import, whichever order the two
   sections join in. */
import * as creditCosts from "../credit-costs";

export const CALENDAR_AUTOFILL_PATH = "/api/wave8/calendar/autofill";
export const CALENDAR_SLOTS_PATH = "/api/wave8/calendar/slots";

/** POST /api/wave8/calendar/autofill — registry 150. */
export function calendarAutofillCost(): number {
  const entry = creditCosts.getCreditCost(CALENDAR_AUTOFILL_PATH);
  if (!entry) throw new Error(`No registered credit cost for ${CALENDAR_AUTOFILL_PATH}`);
  return entry.cost;
}

/** The week's free read path for a Monday week-start ISO date. */
export function calendarSlotsPath(weekStart: string): string {
  return `${CALENDAR_SLOTS_PATH}?weekStart=${encodeURIComponent(weekStart)}`;
}

/** The page's Monday math, verbatim: the Monday of the week
 *  containing `from` (Mon = 0), as an ISO date. */
export function calendarWeekMonday(from: Date): string {
  const d = new Date(from);
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return d.toISOString().slice(0, 10);
}

/** The page's week shift, verbatim: whole weeks from a
 *  week-start ISO date. */
export function calendarShiftWeek(weekStart: string, deltaWeeks: number): string {
  const d = new Date(`${weekStart}T00:00:00`);
  d.setDate(d.getDate() + deltaWeeks * 7);
  return d.toISOString().slice(0, 10);
}

/** The page's pillar parse, verbatim: split on commas, trim,
 *  drop empties, cap at six. */
export function parseCalendarPillars(text: string): string[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 6);
}

/** The page's autofill body, field for field. */
export function buildCalendarAutofillPayload(input: {
  weekStart: string;
  pillarsText: string;
  voice: string;
}): { weekStart: string; pillars: string[]; vaultVoice: string | undefined } {
  return {
    weekStart: input.weekStart,
    pillars: parseCalendarPillars(input.pillarsText),
    vaultVoice: input.voice.trim() || undefined,
  };
}

export interface Wave8CalendarSlot {
  id: string;
  weekStart: string;
  dayIndex: number;
  position: number;
  title: string;
  postType: string;
  notes: string;
  status: string;
}

function calendarIsRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function calendarNum(v: unknown): number | null {
  return typeof v === "number" && isFinite(v) ? v : null;
}

/** The one slot reader both calendar rails share: `{ slots }`
 *  with every slot carrying the page's CalendarSlot fields, or
 *  null — a drifted payload is a failed read, never a
 *  dressed-up week. */
export function calendarSlotsOf(data: unknown): Wave8CalendarSlot[] | null {
  if (!calendarIsRecord(data) || !Array.isArray(data.slots)) return null;
  const out: Wave8CalendarSlot[] = [];
  for (const raw of data.slots as unknown[]) {
    if (!calendarIsRecord(raw)) return null;
    const dayIndex = calendarNum(raw.day_index);
    const position = calendarNum(raw.position);
    if (dayIndex === null || position === null) return null;
    if (typeof raw.id !== "string" && typeof raw.id !== "number") return null;
    out.push({
      id: String(raw.id),
      weekStart: typeof raw.week_start === "string" ? raw.week_start : "",
      dayIndex,
      position,
      title: typeof raw.title === "string" ? raw.title : "",
      postType: typeof raw.post_type === "string" ? raw.post_type : "",
      notes: typeof raw.notes === "string" ? raw.notes : "",
      status: typeof raw.status === "string" ? raw.status : "",
    });
  }
  return out;
}

/** The page's suggested-time read: the autofill hides its
 *  best posting time in the notes as a "Suggested time: HH:MM"
 *  line (the page's own detection, multiline) — the bench
 *  captures the full HH:MM for display. */
export function calendarSlotBestTime(notes: string): string | null {
  const m = /^Suggested time:\s*(([01]\d|2[0-3]):[0-5]\d)/m.exec(notes);
  return m ? m[1] : null;
}

/** The page's notes clean-up, verbatim: the visible brief is
 *  the notes minus their hidden suggested-time line. */
export function calendarSlotNotes(notes: string): string {
  return notes.replace(/^Suggested time:\s*\d{2}:\d{2}\s*\n?/m, "").trim();
}
