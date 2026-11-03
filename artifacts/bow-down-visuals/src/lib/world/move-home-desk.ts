/* ─── Move-home desk seam (stack1500 world parity wave #4b, census
   item 31 — the guided five-step "move your home here" setup) ────
   pages/move-home.tsx native in the My Studio stack on the page's
   own rails (routes/move-home.ts, every one auth + free):

     GET   /api/move-home                     → { moveHome: Status }
     PUT   /api/move-home/answers             → save the intake
           (the page's answers schema — the desk's form mirrors it)
     POST  /api/move-home/draft               → assemble the five
           step drafts from the answers (+ catalog context)
     PATCH /api/move-home/drafts/:step        → per-step edits,
           each on that step's own strict draft schema
     POST  /api/move-home/steps/:step/approve → put that piece live
     POST  /api/move-home/steps/:step/skip    → skip it, honestly
     POST  /api/move-home/steps/:step/reopen  → bring it back

   FREE, END TO END: the credit registry prices the draft rail at
   { "/api/move-home/draft": { cost: 0, feature: "Move Home
   (free)" } } and the desk pins that row through the house
   registryCost helper — a future price change would have to land
   in the registry and be pinned here before this desk could ever
   charge, and approve/skip/reopen have no registry rows at all.

   HONESTY: step titles, blurbs, and blockers come FROM the rail
   (the page renders the same server copy per locale) — the desk
   never invents a step name or hides a blocker. A blocked step
   (no_connected_accounts / needs_media / needs_profile) shows its
   blocker in the rail's own words with NO approve button — the
   approving rail would refuse it anyway. Draft copy provenance
   (copySource: "ai" | "assembled") is shown, never laundered.
   Approving a step is a real publish (profile text goes live,
   the welcome email saves, posts queue) — the desk says what
   approve does per step, in plain words, before the click.

   THE LOCALE RIDES ALONG: every call carries ?locale= like the
   page does, so titles/blurbs arrive in the walker's language. */

import { getCreditCost } from "@/lib/credit-costs";

/** The registry row this desk's priced surface is priced by —
 *  the throw-on-unregistered helper (the email-list desk's
 *  registryCost pattern): if the row ever disappears, importing
 *  this seam throws instead of silently mispricing the desk. */
export const MOVE_HOME_DRAFT_ENDPOINT = "/api/move-home/draft";
export function moveHomeDraftCost(): number {
  const entry = getCreditCost(MOVE_HOME_DRAFT_ENDPOINT);
  if (!entry) throw new Error(`Move-home draft endpoint is not registered: ${MOVE_HOME_DRAFT_ENDPOINT}`);
  return entry.cost;
}

export const MOVE_HOME_PATH = "/api/move-home";
export const MOVE_HOME_ANSWERS_PATH = "/api/move-home/answers";

export function moveHomeDraftPath(step: string): string {
  return `${MOVE_HOME_PATH}/drafts/${encodeURIComponent(step)}`;
}

export function moveHomeStepPath(step: string, verb: "approve" | "skip" | "reopen"): string {
  return `${MOVE_HOME_PATH}/steps/${encodeURIComponent(step)}/${verb}`;
}

export function withLocale(path: string, locale: string | undefined): string {
  return locale ? `${path}?locale=${encodeURIComponent(locale)}` : path;
}

/* ─── The rail's own vocabularies (lib/move-home.ts mirrors) ────── */

export const MOVE_HOME_STEPS = ["profile", "store", "press_kit", "email_list", "launch_posts"] as const;
export type MoveHomeStepKey = (typeof MOVE_HOME_STEPS)[number];

export type MoveHomeStepStatus = "pending" | "drafted" | "approved" | "skipped";
export type MoveHomeBlockedReason = "no_connected_accounts" | "needs_media" | "needs_profile";

export const MOVE_HOME_VERTICALS = [
  "music", "video", "gaming", "podcast", "film", "tv", "influencer", "education", "other",
] as const;

/** The blockers in plain words (the desk explains; the rail decides). */
export const MOVE_HOME_BLOCKER_COPY: Record<MoveHomeBlockedReason, string> = {
  no_connected_accounts: "Connect a social account first — launch posts need somewhere to post.",
  needs_media: "Add a song or video to your library first — this step builds from your work.",
  needs_profile: "Approve your profile first — this step builds on it.",
};

/** What approve actually does, per step — stated before the click. */
export const MOVE_HOME_APPROVE_COPY: Record<MoveHomeStepKey, string> = {
  profile: "Approve puts this name, bio, and link live on your profile.",
  store: "Approve saves these as product drafts in your shop — nothing is for sale until you publish them there.",
  press_kit: "Approve saves this press kit to your profile.",
  email_list: "Approve creates your email list with this welcome email.",
  launch_posts: "Approve queues these posts to your connected accounts.",
};

/* ─── Shapes (the rail's MoveHomeStatus, guarded) ───────────────── */

export interface MoveHomeAnswers {
  displayName?: string;
  vertical?: string;
  genre?: string;
  bioSeed?: string;
  tagline?: string;
  location?: string;
  handle?: string;
  socialLinks?: Record<string, string>;
  starterProductTitle?: string;
}

export interface MoveHomeStepView {
  key: MoveHomeStepKey;
  title: string;
  blurb: string;
  status: MoveHomeStepStatus;
  blockedReason?: MoveHomeBlockedReason;
  appliedRef?: string;
}

export interface MoveHomeContextView {
  hasProfile: boolean;
  profileSlug: string | null;
  connectedPlatforms: Array<{ platform: string; label: string }>;
  trackCount: number;
  videoCount: number;
}

export interface MoveHomeStatusView {
  answers: MoveHomeAnswers;
  /** The rail's per-step draft objects, kept raw — the desk's
   *  preview reads + the typed editors patch them. */
  drafts: Record<string, unknown>;
  copySource: "ai" | "assembled" | null;
  steps: MoveHomeStepView[];
  completedAt: string | null;
  context: MoveHomeContextView;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function isStepKey(v: unknown): v is MoveHomeStepKey {
  return typeof v === "string" && (MOVE_HOME_STEPS as readonly string[]).includes(v);
}

function isStepStatus(v: unknown): v is MoveHomeStepStatus {
  return v === "pending" || v === "drafted" || v === "approved" || v === "skipped";
}

function isBlockedReason(v: unknown): v is MoveHomeBlockedReason {
  return v === "no_connected_accounts" || v === "needs_media" || v === "needs_profile";
}

function answersOf(raw: unknown): MoveHomeAnswers {
  if (!isRecord(raw)) return {};
  const out: MoveHomeAnswers = {};
  const keys = ["displayName", "vertical", "genre", "bioSeed", "tagline", "location", "handle", "starterProductTitle"] as const;
  for (const k of keys) {
    const v = raw[k];
    if (typeof v === "string" && v) out[k] = v;
  }
  if (isRecord(raw["socialLinks"])) {
    const links: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw["socialLinks"])) {
      if (typeof v === "string" && v) links[k] = v;
    }
    if (Object.keys(links).length > 0) out.socialLinks = links;
  }
  return out;
}

export function moveHomeStatusOfResponse(data: unknown): MoveHomeStatusView | null {
  if (!isRecord(data) || !isRecord(data["moveHome"])) return null;
  const s = data["moveHome"];
  if (!Array.isArray(s["steps"]) || !isRecord(s["context"])) return null;
  const steps: MoveHomeStepView[] = [];
  for (const raw of s["steps"]) {
    if (!isRecord(raw) || !isStepKey(raw["key"]) || !isStepStatus(raw["status"])) continue;
    const step: MoveHomeStepView = {
      key: raw["key"],
      title: str(raw["title"]) || raw["key"],
      blurb: str(raw["blurb"]),
      status: raw["status"],
    };
    if (isBlockedReason(raw["blockedReason"])) step.blockedReason = raw["blockedReason"];
    if (typeof raw["appliedRef"] === "string" && raw["appliedRef"]) step.appliedRef = raw["appliedRef"];
    steps.push(step);
  }
  if (steps.length === 0) return null;
  const drafts = isRecord(s["drafts"]) ? s["drafts"] : {};
  const copySource =
    isRecord(s["drafts"]) && (s["drafts"]["copySource"] === "ai" || s["drafts"]["copySource"] === "assembled")
      ? (s["drafts"]["copySource"] as "ai" | "assembled")
      : null;
  const ctx = s["context"];
  const platforms: Array<{ platform: string; label: string }> = [];
  if (Array.isArray(ctx["connectedPlatforms"])) {
    for (const p of ctx["connectedPlatforms"]) {
      if (isRecord(p) && typeof p["platform"] === "string") {
        platforms.push({ platform: p["platform"], label: str(p["label"]) || p["platform"] });
      }
    }
  }
  return {
    answers: answersOf(s["answers"]),
    drafts,
    copySource,
    steps,
    completedAt: typeof s["completedAt"] === "string" ? s["completedAt"] : null,
    context: {
      hasProfile: ctx["hasProfile"] === true,
      profileSlug: typeof ctx["profileSlug"] === "string" ? ctx["profileSlug"] : null,
      connectedPlatforms: platforms,
      trackCount: typeof ctx["trackCount"] === "number" ? ctx["trackCount"] : 0,
      videoCount: typeof ctx["videoCount"] === "number" ? ctx["videoCount"] : 0,
    },
  };
}

/** One step's draft object, or null when the run hasn't drafted it. */
export function moveHomeDraftOf(status: MoveHomeStatusView, step: MoveHomeStepKey): Record<string, unknown> | null {
  const d = status.drafts[step];
  return isRecord(d) ? d : null;
}

/** True once every step is approved or skipped — the rail's own
 *  done state, mirrored for the desk's completion line. */
export function moveHomeAllSettled(status: MoveHomeStatusView): boolean {
  return status.steps.every((s) => s.status === "approved" || s.status === "skipped");
}

/* ─── Payload builders (the route schemas, mirrored) ────────────── */

export interface MoveHomeAnswersDraft {
  displayName: string;
  vertical: string;
  genre: string;
  bioSeed: string;
  tagline: string;
  location: string;
  handle: string;
  starterProductTitle: string;
}

export function moveHomeAnswersDraftOf(answers: MoveHomeAnswers): MoveHomeAnswersDraft {
  return {
    displayName: answers.displayName ?? "",
    vertical: answers.vertical ?? "music",
    genre: answers.genre ?? "",
    bioSeed: answers.bioSeed ?? "",
    tagline: answers.tagline ?? "",
    location: answers.location ?? "",
    handle: answers.handle ?? "",
    starterProductTitle: answers.starterProductTitle ?? "",
  };
}

/** Answers payload: blank optionals ride as absent (the schema's
 *  fields are all optional; the page saves the same way). */
export function buildMoveHomeAnswersPayload(draft: MoveHomeAnswersDraft): MoveHomeAnswers {
  const out: MoveHomeAnswers = {};
  const put = (k: keyof MoveHomeAnswersDraft, max: number) => {
    const v = draft[k].trim().slice(0, max);
    if (v) out[k] = v;
  };
  put("displayName", 80);
  if ((MOVE_HOME_VERTICALS as readonly string[]).includes(draft.vertical)) out.vertical = draft.vertical;
  put("genre", 60);
  put("bioSeed", 600);
  put("tagline", 160);
  put("location", 80);
  put("handle", 40);
  put("starterProductTitle", 120);
  return out;
}

/** The answers the draft run needs before it can do honest work. */
export function moveHomeAnswersReady(draft: MoveHomeAnswersDraft): boolean {
  return draft.displayName.trim().length > 0 && (MOVE_HOME_VERTICALS as readonly string[]).includes(draft.vertical);
}

/** The completion line when every step has settled. */
export const MOVE_HOME_ALL_SETTLED_COPY =
  "Your move is complete — every step is live or skipped by your choice. You can reopen any step below to change it.";

export const MOVE_HOME_PROMOTION =
  "Move Home in the My Studio stack: the guided five-step setup on the page's own free rails — the intake answers, the draft run, per-step previews with typed editors on each step's own schema, and approve / skip / reopen with the rail's own titles, blurbs, and blockers shown as-is";
