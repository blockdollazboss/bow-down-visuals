import {
  FIX_PAGES,
  FIX_SEVERITIES,
  PITCH_CATEGORIES,
  type PitchFixSubmission,
} from "@/lib/pitch-fix";

/* ─── Pitch & Fix board seam (stack1100 world parity) ──────────────
   The kingdom's suggestion board, native at the Kingdom Board — on
   the pitch-fix router's own rails, the same endpoints
   pages/pitch-fix.tsx calls:

     GET  /api/pitch-fix/board     → { pitches, fixes, shipped,
                                       viewerVotedIds } (public;
                                       approved rows only — the
                                       moderation gate is the rail's)
     POST /api/pitch-fix/pitches   → file an idea (member)
     POST /api/pitch-fix/fixes     → report a break (member)
     GET  /api/pitch-fix/mine      → the caller's own filings, every
                                     moderation state (member)
     POST /api/pitch-fix/:id/vote  → toggle an upvote on a public
                                     pitch; answers { voted,
                                     upvoteCount }

   The vocabulary (categories, fix pages, severities, the wire type)
   is the shared frontend lib/pitch-fix.ts — the page, the admin
   bench and this board speak the same words. Rewards are the
   owner's ruling (Oct 25): a shipped pitch earns 500 VB, a shipped
   fix 100–250 VB, first voice only, from the shared pool — the
   board's line mirrors the page's rewardsLine exactly. */

export const PITCH_FIX_BOARD_PATH = "/api/pitch-fix/board";
export const PITCH_FIX_PITCHES_PATH = "/api/pitch-fix/pitches";
export const PITCH_FIX_FIXES_PATH = "/api/pitch-fix/fixes";
export const PITCH_FIX_MINE_PATH = "/api/pitch-fix/mine";

export function pitchVotePath(id: string): string {
  return `/api/pitch-fix/${encodeURIComponent(id)}/vote`;
}

/** The page's own rewards line (locales: pitchFix.rewardsLine). */
export const PITCH_FIX_REWARDS_LINE = "Shipped pitches earn 500 VB · shipped fixes earn 100–250 VB";

export const PITCH_CATEGORY_LABELS: Record<string, string> = {
  create: "Create",
  world: "The World",
  money: "Money",
  social: "Social",
  other: "Other",
};

export const FIX_PAGE_LABELS: Record<string, string> = {
  video_editor: "Video Editor",
  make_song_video: "Make Song + Video",
  audio_studio: "Audio Studio",
  thumbnail_studio: "Thumbnail Studio",
  branding_kit: "Branding Kit",
  the_world: "The World",
  go_live: "Go Live",
  earnings: "Earnings",
  profile: "Profile",
  somewhere_else: "Somewhere else",
};

export const FIX_SEVERITY_LABELS: Record<string, string> = {
  blocks_me: "Blocks me",
  annoying: "Annoying",
  small: "Small",
};

export function pitchCategoryLabel(key: string | null): string {
  return (key && PITCH_CATEGORY_LABELS[key]) || "Other";
}

export function fixPageLabel(key: string | null): string {
  return (key && FIX_PAGE_LABELS[key]) || "Somewhere else";
}

export function fixSeverityLabel(key: string | null): string {
  return (key && FIX_SEVERITY_LABELS[key]) || "Small";
}

/* ─── Payload normalization ────────────────────────────────────────
   A row the guard can't read makes the whole answer a failed
   attempt (null) — the board shows its error state and retries
   rather than painting a partial board as the kingdom's voice. */

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function normalizeSubmission(raw: unknown): PitchFixSubmission | null {
  const r = asRecord(raw);
  if (!r) return null;
  const id = str(r["id"]);
  const kind = str(r["kind"]);
  const title = str(r["title"]);
  if (!id || !title || (kind !== "pitch" && kind !== "fix" && kind !== "feedback")) return null;
  const moderation = str(r["moderationStatus"]);
  return {
    id,
    kind,
    source: str(r["source"]) === "feedback_popup" ? "feedback_popup" : "door",
    submitterUserId: str(r["submitterUserId"]),
    submitterName: str(r["submitterName"], "Creator"),
    title,
    body: str(r["body"]),
    why: strOrNull(r["why"]),
    category: strOrNull(r["category"]),
    page: strOrNull(r["page"]),
    severity: strOrNull(r["severity"]),
    rating: typeof r["rating"] === "number" ? r["rating"] : null,
    status: str(r["status"], "received"),
    moderationStatus:
      moderation === "approved" || moderation === "rejected" ? moderation : "pending",
    upvoteCount: num(r["upvoteCount"]),
    rewardStatus:
      r["rewardStatus"] === "queued" || r["rewardStatus"] === "paid" || r["rewardStatus"] === "ineligible"
        ? r["rewardStatus"]
        : "none",
    rewardAmount: typeof r["rewardAmount"] === "number" ? r["rewardAmount"] : null,
    rewardQueuedAt: strOrNull(r["rewardQueuedAt"]),
    rewardPaidAt: strOrNull(r["rewardPaidAt"]),
    duplicateOfId: strOrNull(r["duplicateOfId"]),
    shippedAt: strOrNull(r["shippedAt"]),
    createdAt: str(r["createdAt"]),
    updatedAt: str(r["updatedAt"]),
  };
}

function normalizeList(v: unknown): PitchFixSubmission[] | null {
  if (!Array.isArray(v)) return null;
  const out: PitchFixSubmission[] = [];
  for (const raw of v) {
    const row = normalizeSubmission(raw);
    if (!row) return null;
    out.push(row);
  }
  return out;
}

export interface PitchFixBoardData {
  pitches: PitchFixSubmission[];
  fixes: PitchFixSubmission[];
  shipped: PitchFixSubmission[];
  viewerVotedIds: string[];
}

export function normalizePitchFixBoard(payload: unknown): PitchFixBoardData | null {
  const root = asRecord(payload);
  if (!root) return null;
  const pitches = normalizeList(root["pitches"]);
  const fixes = normalizeList(root["fixes"]);
  const shipped = normalizeList(root["shipped"]);
  if (!pitches || !fixes || !shipped) return null;
  const voted = root["viewerVotedIds"];
  return {
    pitches,
    fixes,
    shipped,
    viewerVotedIds: Array.isArray(voted)
      ? voted.filter((x): x is string => typeof x === "string")
      : [],
  };
}

export function normalizeMySubmissions(payload: unknown): PitchFixSubmission[] | null {
  const root = asRecord(payload);
  if (!root) return null;
  return normalizeList(root["submissions"]);
}

/* ─── A filing's standing, in the member's words ───────────────────
   For the Mine strip: the moderation gate first (a pending filing
   is with the team, whatever its status says), then the team's own
   status ladder. Rewards speak only when the rail says so. */

export function submissionStatusLine(s: PitchFixSubmission): string {
  if (s.moderationStatus === "pending") return "With the team — in review";
  if (s.moderationStatus === "rejected") return "Not taken up this time";
  if (s.status === "shipped" || s.status === "fixed") return "Shipped — it's live";
  if (s.status === "building" || s.status === "fixing") return "Being built now";
  return "On the board";
}

export function submissionRewardLine(s: PitchFixSubmission): string | null {
  if (s.rewardStatus === "paid" && s.rewardAmount != null) return `+${s.rewardAmount} Bucs landed`;
  if (s.rewardStatus === "queued") return "Reward queued";
  return null;
}

/* ─── Forms — the rail's schemas (routes/pitch-fix.ts) ─────────────
   Pitch: title 1–90, body 1–400, why ≤400, category in the enum.
   Fix: title 1–90, body ≤400 optional, page + severity in enums. */

export interface PitchForm {
  title: string;
  body: string;
  why: string;
  category: string;
}

export function pitchFormReady(form: PitchForm): boolean {
  const title = form.title.trim();
  const body = form.body.trim();
  return (
    title.length >= 1 &&
    title.length <= 90 &&
    body.length >= 1 &&
    body.length <= 400 &&
    form.why.trim().length <= 400 &&
    (PITCH_CATEGORIES as readonly string[]).includes(form.category)
  );
}

export function buildPitchBody(form: PitchForm): Record<string, unknown> {
  return {
    title: form.title.trim(),
    body: form.body.trim(),
    why: form.why.trim() || undefined,
    category: form.category,
  };
}

export interface FixForm {
  title: string;
  body: string;
  page: string;
  severity: string;
}

export function fixFormReady(form: FixForm): boolean {
  const title = form.title.trim();
  return (
    title.length >= 1 &&
    title.length <= 90 &&
    form.body.trim().length <= 400 &&
    (FIX_PAGES as readonly string[]).includes(form.page) &&
    (FIX_SEVERITIES as readonly string[]).includes(form.severity)
  );
}

export function buildFixBody(form: FixForm): Record<string, unknown> {
  return {
    title: form.title.trim(),
    body: form.body.trim() || undefined,
    page: form.page,
    severity: form.severity,
  };
}

/** The vote toggle's answer: the caller's new state + the pitch's
 *  new count, straight from the rail. Null on any other shape. */
export function parseVoteResult(payload: unknown): { voted: boolean; upvoteCount: number } | null {
  const root = asRecord(payload);
  if (!root || typeof root["voted"] !== "boolean" || typeof root["upvoteCount"] !== "number") {
    return null;
  }
  return { voted: root["voted"], upvoteCount: root["upvoteCount"] };
}
