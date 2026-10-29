/**
 * studio-board.ts — the data shaping behind the Studio Board
 * (NATIVE-PLAN §3.1: My Studio, the Create Wing's board).
 *
 * The station used to pull up the /dashboard hub. In-world it is a
 * board: the creator's projects as rows with one action —
 * Continue, which steps through into the Visual Vibes editor
 * seeded with that project (the step-through machinery the palace
 * already has; the seeding seam is lib/world/station-panel's
 * editorStepthroughSearch, used by the panel host). The old
 * /my-projects list folds in as this board's full project list.
 * Alongside the rows: a balance + streak strip, and the vault
 * characters as a portrait row (shaped by lib/world/characters —
 * reused, not re-derived).
 *
 * Endpoints (the dashboard's own, plan §1):
 *   GET /api/projects         (project rows, newest first)
 *   GET /api/credits/history  (recent VB activity for the strip)
 *   GET /api/bonus/status     (streak + bonus balance)
 *   GET /api/artist-vaults    (vault characters — characters.ts)
 *
 * P3-E additions (parity audit, Boards & management): the board's
 * widget family and the My Projects deeper tabs, each on the site's
 * own existing rail — nothing here invents a number:
 *   GET /api/challenges/weekly     (the weekly contest — games-lobby)
 *   GET /api/world/contests        (palace contests — contests.ts)
 *   GET /api/retention/away-digest (the dashboard's away digest)
 *   GET /api/retention/leaderboard (weekly board — treasury-quests)
 *   GET /api/sponsors/pipeline/deals  (the sponsor pipeline)
 *   GET /api/drafts                (the /my-projects drafts tab)
 *   GET /api/generated-clips       (the /my-projects clips tab)
 *   GET /api/generation-history    (the /my-projects history tab)
 */

/* ─── Project rows ────────────────────────────────────────────────── */

export interface StudioProjectRow {
  id: string;
  /** Display label: the dashboard's own fallback chain — the
   *  project's title, else "artist — song", else its type. */
  label: string;
  projectType: string;
  createdAt: string | null;
  creditsUsed: number | null;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The dashboard's project label, verbatim: title first, then the
 *  artist/song pair, then the project type — never an empty row. */
export function studioProjectLabel(row: {
  title?: unknown;
  artist_name?: unknown;
  artistName?: unknown;
  song_title?: unknown;
  songTitle?: unknown;
  project_type?: unknown;
  projectType?: unknown;
}): string {
  const title = str(row.title);
  if (title) return title;
  const pair = [str(row.artist_name ?? row.artistName), str(row.song_title ?? row.songTitle)]
    .filter(Boolean)
    .join(" — ");
  if (pair) return pair;
  return str(row.project_type ?? row.projectType) ?? "Untitled project";
}

/** Shape GET /api/projects into board rows. Server order is
 *  newest-first and is preserved; rows without a usable id are
 *  skipped (Continue needs the id to seed the editor). */
export function normalizeStudioProjects(payload: unknown): StudioProjectRow[] {
  if (!isObj(payload) || !Array.isArray(payload["projects"])) return [];
  const out: StudioProjectRow[] = [];
  for (const row of payload["projects"]) {
    if (!isObj(row)) continue;
    const id = str(row["id"]);
    if (!id) continue;
    out.push({
      id,
      label: studioProjectLabel(row),
      projectType: str(row["project_type"] ?? row["projectType"]) ?? "",
      createdAt: str(row["created_at"] ?? row["createdAt"]),
      creditsUsed: num(row["credits_used"] ?? row["creditsUsed"]),
    });
  }
  return out;
}

/* ─── The balance + streak strip ──────────────────────────────────── */

export interface StudioStrip {
  streak: number;
  bonusCredits: number;
  canClaimDaily: boolean;
}

/** Shape GET /api/bonus/status into the strip's streak half. Null
 *  when the payload carries no real streak — the strip then shows
 *  the balance alone rather than a guessed flame count. */
export function normalizeStudioStrip(payload: unknown): StudioStrip | null {
  if (!isObj(payload)) return null;
  const streak = num(payload["streak"]);
  if (streak === null) return null;
  return {
    streak,
    bonusCredits: num(payload["bonusCredits"]) ?? 0,
    canClaimDaily: payload["canClaimDaily"] === true,
  };
}

/** The strip's recent-activity line: the newest VB usage entry,
 *  in words ("Latest: Song generation · −400 VB"). Null when the
 *  history is empty or unreadable — the strip just omits it. */
export function latestActivityLine(creditsPayload: unknown): string | null {
  if (!isObj(creditsPayload) || !Array.isArray(creditsPayload["usage"])) return null;
  for (const row of creditsPayload["usage"]) {
    if (!isObj(row)) continue;
    const action = str(row["action"]);
    const used = num(row["creditsUsed"]);
    if (!action || used === null) continue;
    const amount =
      used < 0 ? `+${Math.abs(used).toLocaleString("en-US")}` : used === 0 ? "0" : `−${used.toLocaleString("en-US")}`;
    return `Latest: ${action} · ${amount} VB`;
  }
  return null;
}

/* ─── My Projects deeper tabs (P3-E) ────────────────────────────────
   The /my-projects page's own tabs, folded into this board: the
   project list above stays the first tab; drafts, generated clips
   and generation history ride their own rails (the same endpoints
   the page reads) and lazy-load when first opened. */

export type StudioProjectsTabId = "projects" | "drafts" | "clips" | "history";

export const STUDIO_PROJECT_TABS: readonly { id: StudioProjectsTabId; label: string }[] = [
  { id: "projects", label: "Projects" },
  { id: "drafts", label: "Drafts" },
  { id: "clips", label: "Generated clips" },
  { id: "history", label: "History" },
];

/* Drafts — GET /api/drafts */

export interface StudioDraftRow {
  id: string;
  /** The page's own label chain: the draft's title, else the artist
   *  name typed into its form, else an honest "Unsaved draft". */
  label: string;
  workflowType: string;
  /** The page's plain name for the workflow, when it has one. */
  workflowLabel: string;
  updatedAt: string | null;
}

const DRAFT_WORKFLOW_LABELS: Record<string, string> = {
  "make-video": "Video for my song",
  "song-and-video": "Start from scratch",
};

/** Shape GET /api/drafts into board rows. Server order preserved;
 *  rows without an id are skipped (nothing could open them). */
export function normalizeStudioDrafts(payload: unknown): StudioDraftRow[] {
  if (!isObj(payload) || !Array.isArray(payload["drafts"])) return [];
  const out: StudioDraftRow[] = [];
  for (const row of payload["drafts"]) {
    if (!isObj(row)) continue;
    const id = str(row["id"]);
    if (!id) continue;
    const workflowType = str(row["workflow_type"] ?? row["workflowType"]) ?? "";
    const data = isObj(row["draft_data"]) ? row["draft_data"] : isObj(row["draftData"]) ? row["draftData"] : null;
    const form = data && isObj(data["formValues"]) ? data["formValues"] : null;
    const label =
      str(row["title"]) ??
      (form ? str(form["artistName"]) : null) ??
      "Unsaved draft";
    out.push({
      id,
      label,
      workflowType,
      workflowLabel: DRAFT_WORKFLOW_LABELS[workflowType] ?? workflowType,
      updatedAt: str(row["updated_at"] ?? row["updatedAt"]),
    });
  }
  return out;
}

/* Generated clips — GET /api/generated-clips */

export interface StudioClipRow {
  id: string;
  /** Title first, then the prompt that made it, then an honest
   *  fallback — the page's own row fields. */
  label: string;
  status: string;
  hasVideo: boolean;
  createdAt: string | null;
}

/** Shape GET /api/generated-clips into board rows. */
export function normalizeStudioClips(payload: unknown): StudioClipRow[] {
  if (!isObj(payload) || !Array.isArray(payload["clips"])) return [];
  const out: StudioClipRow[] = [];
  for (const row of payload["clips"]) {
    if (!isObj(row)) continue;
    const id = str(row["id"]);
    if (!id) continue;
    out.push({
      id,
      label: str(row["title"]) ?? str(row["prompt"]) ?? "Untitled clip",
      status: str(row["status"]) ?? "",
      hasVideo: !!str(row["video_url"] ?? row["videoUrl"]),
      createdAt: str(row["created_at"] ?? row["createdAt"]),
    });
  }
  return out;
}

/* Generation history — GET /api/generation-history */

export interface StudioHistoryRow {
  id: string;
  label: string;
  generationType: string;
  creditsUsed: number | null;
  saveStatus: string;
  refunded: boolean;
  createdAt: string | null;
}

/** Shape GET /api/generation-history into board rows. The label
 *  rides the row's own action label, else the artist — song pair,
 *  else the generation type (studioProjectLabel's chain). */
export function normalizeStudioHistory(payload: unknown): StudioHistoryRow[] {
  if (!isObj(payload) || !Array.isArray(payload["history"])) return [];
  const out: StudioHistoryRow[] = [];
  for (const row of payload["history"]) {
    if (!isObj(row)) continue;
    const id = str(row["id"]);
    if (!id) continue;
    const generationType = str(row["generation_type"] ?? row["generationType"]) ?? "";
    const label =
      str(row["action_label"] ?? row["actionLabel"]) ??
      studioProjectLabel({
        artist_name: row["artist_name"],
        song_title: row["song_title"],
        project_type: generationType,
      });
    out.push({
      id,
      label,
      generationType,
      creditsUsed: num(row["credits_used"] ?? row["creditsUsed"]),
      saveStatus: str(row["save_status"] ?? row["saveStatus"]) ?? "",
      refunded: row["refunded"] === true,
      createdAt: str(row["created_at"] ?? row["createdAt"]),
    });
  }
  return out;
}

/** The one status word a history row wears, in the page's own
 *  terms — a refund outranks the save state (the page marks both;
 *  the board row carries one honest word). Null when the row has
 *  nothing to report. */
export function historyStatusWord(row: Pick<StudioHistoryRow, "saveStatus" | "refunded">): string | null {
  if (row.refunded) return "Refunded";
  if (row.saveStatus === "saved") return "Saved";
  if (row.saveStatus === "save_failed") return "Save failed";
  return null;
}

/* ─── The widget family (P3-E) ──────────────────────────────────────
   Five widgets join the board: challenges & contests, the away
   digest, the weekly leaderboard (shaped in treasury-quests —
   reused), the sponsor pipeline, and next moves. Each widget's
   shaping lives here; each reads its own rail and degrades alone. */

/* The away digest — GET /api/retention/away-digest.
   The rail answers {show:false, reason} for most visits — those
   are honest states, not errors: the digest is off in settings,
   this is a first visit, or nothing has piled up yet. Only a
   {show:true} payload carries lines, and every line below is
   built from the payload's own fields, verbatim counts. */

export type StudioDigestState = "off" | "first-visit" | "recent" | "ready";

export interface StudioDigest {
  state: StudioDigestState;
  hoursAway: number | null;
  completedJobs: number;
  failedJobs: number;
  newProjectLabels: string[];
  bowRaceLine: string | null;
  jackpotLine: string | null;
  streakDays: number | null;
}

export function normalizeStudioDigest(payload: unknown): StudioDigest | null {
  if (!isObj(payload)) return null;
  const base: StudioDigest = {
    state: "recent",
    hoursAway: num(payload["hoursAway"]),
    completedJobs: 0,
    failedJobs: 0,
    newProjectLabels: [],
    bowRaceLine: null,
    jackpotLine: null,
    streakDays: null,
  };
  if (payload["show"] !== true) {
    const reason = str(payload["reason"]);
    if (reason === "disabled") return { ...base, state: "off" };
    if (reason === "first-visit") return { ...base, state: "first-visit" };
    return base;
  }
  const jobs = Array.isArray(payload["completedJobs"]) ? payload["completedJobs"] : [];
  const labels: string[] = [];
  if (Array.isArray(payload["newProjects"])) {
    for (const p of payload["newProjects"]) {
      if (!isObj(p)) continue;
      labels.push(
        studioProjectLabel({ title: p["title"], project_type: p["projectType"] ?? p["project_type"] }),
      );
    }
  }
  let bowRaceLine: string | null = null;
  if (isObj(payload["bowRace"])) {
    const total = num(payload["bowRace"]["totalBows"]);
    const target = num(payload["bowRace"]["target"]);
    if (total !== null && target !== null) {
      bowRaceLine = `Bow Race: ${total.toLocaleString("en-US")} of ${target.toLocaleString("en-US")} bows`;
      if (payload["bowRace"]["youWon"] === true) bowRaceLine += " — you won it";
    }
  }
  let jackpotLine: string | null = null;
  if (isObj(payload["jackpot"])) {
    const name = str(payload["jackpot"]["name"]);
    const prize = num(payload["jackpot"]["prizeCredits"]);
    if (name && prize !== null) jackpotLine = `${name}: ${prize.toLocaleString("en-US")} VB jackpot live now`;
  }
  let streakDays: number | null = null;
  if (isObj(payload["streak"])) {
    const current = num(payload["streak"]["currentStreak"]);
    if (current !== null && current > 0) streakDays = current;
  }
  return {
    ...base,
    state: "ready",
    completedJobs: jobs.length,
    failedJobs: num(payload["failedJobs"]) ?? 0,
    newProjectLabels: labels,
    bowRaceLine,
    jackpotLine,
    streakDays,
  };
}

/* The sponsor pipeline — GET /api/sponsors/pipeline/deals.
   The derivation is the dashboard's own, mirrored exactly: a deal
   is active until its stage closes it (paid / lost / rejected /
   dead), the pipeline total is the active deals' value in whole
   dollars, and the next deal to touch is the freshest active one. */

export interface SponsorPipeline {
  activeCount: number;
  pipelineDollars: number;
  next: { sponsorName: string; stage: string } | null;
}

const SPONSOR_CLOSED_STAGES: readonly string[] = ["paid", "lost", "rejected", "dead"];

export function normalizeSponsorPipeline(payload: unknown): SponsorPipeline | null {
  const deals = Array.isArray(payload)
    ? payload
    : isObj(payload) && Array.isArray(payload["deals"])
      ? payload["deals"]
      : null;
  if (!deals) return null;
  const active: { sponsorName: string; stage: string; cents: number; updatedAt: string }[] = [];
  for (const row of deals) {
    if (!isObj(row)) continue;
    const stage = str(row["stage"]) ?? "";
    if (SPONSOR_CLOSED_STAGES.includes(stage.toLowerCase())) continue;
    active.push({
      sponsorName: str(row["sponsorName"]) ?? "A sponsor",
      stage,
      cents: num(row["dealValueCents"]) ?? 0,
      updatedAt: str(row["updatedAt"]) ?? "",
    });
  }
  const cents = active.reduce((sum, d) => sum + d.cents, 0);
  const next = [...active].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
  return {
    activeCount: active.length,
    pipelineDollars: Math.round(cents / 100),
    next: next ? { sponsorName: next.sponsorName, stage: next.stage } : null,
  };
}

/* Challenges & contests — a summary over rails shaped elsewhere:
   the weekly contest (games-lobby's parseWeeklyContest) and the
   palace contests (contests.ts normalizeContests). A contest is
   live while its phase is announced, open or judging; the next
   one to close is the soonest live deadline. */

export interface StudioContestSummary {
  liveCount: number;
  nextTitle: string | null;
  nextEndsAt: string | null;
}

export function summarizeContests(
  contests: readonly import("./contests").WorldContest[],
): StudioContestSummary {
  const live = contests.filter(
    (c) => c.phase === "announced" || c.phase === "open" || c.phase === "judging",
  );
  const next = [...live]
    .filter((c) => !!c.endsAt)
    .sort((a, b) => a.endsAt.localeCompare(b.endsAt))[0];
  return {
    liveCount: live.length,
    nextTitle: next ? next.title : null,
    nextEndsAt: next ? next.endsAt : null,
  };
}

/* Next moves — the dashboard's rule-based derivation, shaped from
   real state only. The dashboard always offers: finish your
   latest project, and its money section names the next sponsor
   follow-up; the board adds the daily claim when the strip says
   it's waiting, and the trending look the dashboard offers
   unconditionally. At most three moves, in that order. */

export interface StudioNextMove {
  kind: "finish" | "sponsor" | "daily" | "trend";
  title: string;
  sub: string;
  /** Set only on the finish move — the board's Continue seam. */
  projectId: string | null;
}

export function studioNextMoves(input: {
  latestProject: { id: string; label: string } | null;
  sponsorNextName: string | null;
  canClaimDaily: boolean;
}): StudioNextMove[] {
  const moves: StudioNextMove[] = [];
  if (input.latestProject) {
    moves.push({
      kind: "finish",
      title: `Finish “${input.latestProject.label}”`,
      sub: "Pick it back up in the editor — Continue is on its row below.",
      projectId: input.latestProject.id,
    });
  }
  if (input.sponsorNextName) {
    moves.push({
      kind: "sponsor",
      title: `Follow up with ${input.sponsorNextName}`,
      sub: "Your freshest open sponsor deal.",
      projectId: null,
    });
  }
  if (input.canClaimDaily) {
    moves.push({
      kind: "daily",
      title: "Claim today's drop",
      sub: "Your daily drop is waiting at the Treasury counter.",
      projectId: null,
    });
  }
  moves.push({
    kind: "trend",
    title: "See what's trending",
    sub: "The Charts board shows what's climbing this week.",
    projectId: null,
  });
  return moves.slice(0, 3);
}
