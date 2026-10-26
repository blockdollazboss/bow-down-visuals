/* ─── Evergreen recycling (Wave-4 #48) — client contract ──────────────────
   The Scheduler's evergreen desk: the house proposes resurfacing your
   own back catalog inside YOUR windows; nothing ever posts from here.
   The server (api-server lib/evergreen.ts) owns the rules; this module
   mirrors its vocabulary: paths, labels, skip-reason wording, and the
   exact honesty copy every evergreen surface must carry. */

export interface EvergreenWindowsDto {
  days: number[]; // 0 = Sunday … 6 = Saturday
  startHour: number;
  endHour: number;
  timezone: string;
}

export interface EvergreenSettingsDto {
  enabled: boolean;
  windows: EvergreenWindowsDto;
  base_spacing_days: number;
  max_cycles: number;
}

export interface EvergreenCandidateDto {
  post_id: string;
  caption: string;
  media_url: string;
  media_type: string;
  platforms: string[];
  posted_at: string | null;
  cycles_used: number;
  max_cycles: number;
  skip_reason: string | null; // null = ready to resurface
}

export interface EvergreenProposalDto {
  id: string;
  source_post_id: string;
  cycle: number;
  proposed_slot: string;
  status: string; // pending_approval | approved | rejected | expired
  draft_post_id: string | null;
  created_at: string;
  source_caption?: string;
  source_media_url?: string | null;
  source_platforms?: string[];
}

export const EVERGREEN_PATHS = {
  settings: "/api/evergreen/settings",
  candidates: "/api/evergreen/candidates",
  proposals: "/api/evergreen/proposals",
  generate: "/api/evergreen/proposals/generate",
} as const;

export function evergreenProposalActionPath(id: string, action: "approve" | "reject"): string {
  return `/api/evergreen/proposals/${encodeURIComponent(id)}/${action}`;
}

/* MUST stay sentence-identical to the API's EVERGREEN_COPY. */
export const EVERGREEN_COPY = {
  neverAutoPosts:
    "Evergreen never posts on its own. It only proposes — nothing resurfaces until you approve it, and approving creates a draft you still schedule yourself.",
  approvalGate: "Every resurfacing needs your approval first.",
  decayStop:
    "Returns slow down on purpose: the wait doubles every cycle, and a post stops for good at your cycle cap.",
} as const;

export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Plain-words reason a post isn't being proposed right now. */
export function skipReasonLabel(reason: string | null): string {
  switch (reason) {
    case null:
      return "Ready to resurface";
    case "not_posted":
      return "Hasn't posted yet";
    case "too_new":
      return "Still new — back catalog starts after 14 days";
    case "max_cycles":
      return "Reached your cycle cap — done for good";
    case "spacing":
      return "Resting — spacing hasn't elapsed yet";
    case "pending_proposal":
      return "Already proposed — waiting on you";
    default:
      return reason;
  }
}

export function proposalStatusLabel(status: string): string {
  switch (status) {
    case "pending_approval":
      return "Waiting for your approval";
    case "approved":
      return "Approved — draft created in your Scheduler";
    case "rejected":
      return "Declined";
    case "expired":
      return "Expired";
    default:
      return status;
  }
}

/** Client-side mirror of the server settings rule, for instant form
 *  feedback (the server re-validates — this never substitutes). */
export function settingsValidationError(s: EvergreenSettingsDto): string | null {
  if (s.windows.days.length === 0) return "Pick at least one day for your evergreen windows.";
  if (s.windows.endHour <= s.windows.startHour) return "Window end hour must be after the start hour.";
  if (s.base_spacing_days < 1 || s.base_spacing_days > 90) return "Spacing must be 1–90 days.";
  if (s.max_cycles < 1 || s.max_cycles > 6) return "Max cycles must be 1–6.";
  return null;
}
