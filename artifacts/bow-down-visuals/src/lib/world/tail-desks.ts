/**
 * tail-desks.ts — Stage D tail (stack-100 #93-remainder, #94, #95,
 * #96): the seam the World's last account/games desks ride.
 *
 * #93-remainder — the moderation queue. The person lock-out half of
 * #93 shipped with the lock verbs (routes/world.ts + the host panel).
 * The queue half needed no new surface: Thy Cheat Code's trouble-flag
 * duty (api-server lib/operator-duties.ts, peace law) files its flags
 * as rows of `content_reports` — reporter = the house account,
 * targetType "profile", the note reading "Operator flag: …" — and
 * GET /api/admin/reports serves exactly that table. The in-world
 * ModerationBench (#82, SocialWave2) lists that queue and works it
 * (status PATCH on the same rail). One queue, already served; the
 * tests here pin the operator-flag row shape through the bench's own
 * normalizer so the chain can't silently break.
 *
 * #94 — Account settings. The settings page is a composite; its
 * account rails are: GET/PATCH /api/retention/prefs (the nudge
 * switches RetentionPrefsSettings rides), GET/PATCH
 * /api/retention/delight-prefs (delight switches), the cursor choice
 * (lib/cursor-settings, localStorage — the same store CursorCard
 * points at), and the danger zone: GET /api/account/export (the full
 * download, completable in-world) and DELETE /api/account, which
 * stays behind the 2D page's type-DELETE confirmation BY DESIGN —
 * the in-world desk states that and hands off; it never deletes.
 *
 * #95 — 2D giveaway contests. /api/contests is the fan-contest
 * system (routes/generate/contests.ts), SEPARATE from World
 * Contests (/api/world/contests). It is owner-scoped: the list is
 * the caller's own contests, entries are added by the owner (a
 * handle + one of the contest's entry methods), verification and
 * the provably-fair draw are the owner's verbs, and the AI winner
 * announcement is the one charged action — CONTEST_ANNOUNCE_CREDIT_
 * COST on the server, 100 Visual Bucs by default, charged only
 * after the graphic succeeds. The in-world desk mirrors the 2D
 * page's verbs on the same rails, with the announcement behind the
 * World's two-tap confirmation for charged actions.
 *
 * #96 — Jackpot. The cheat-code jackpot (routes/cheat-code.ts):
 * GET /api/cheat-code/status (public event shape — code_hash never
 * served), POST /api/cheat-code/attempt { sequence } (auth; 3 tries
 * a day, cooldown between tries, the prize is Visual Bucs granted
 * to the winner's balance — the site pays nobody real money), and
 * the admin surface GET/POST /api/cheat-code/admin/events +
 * POST …/:id/activate|deactivate (requireAuth + requireAdmin
 * server-side). The in-world admin half gates on GET
 * /api/admin/status and renders nothing for non-admins, fail-closed
 * like the moderation bench; the server re-checks regardless.
 */

import { normalizeAdminReports, type AdminReportRow } from "./social-desk";

/* ─── #93-remainder: the operator-flag queue is the reports queue ── */

/** The queue the operator's trouble flags land in — the admin
 *  reports rail the in-world bench already works. Pinned here so a
 *  future "new queue" can't quietly fork the peace law's one queue. */
export const MODERATION_QUEUE_PATH = "/api/admin/reports";

/** True when a reports-queue row is one of Thy Cheat Code's operator
 *  trouble flags: a profile target whose note carries the duty's own
 *  "Operator flag:" prefix (operator-duties.ts files it verbatim).
 *  The bench renders these rows in the same queue as member reports —
 *  this only names them, it never filters them out. */
export function isOperatorFlagRow(row: Pick<AdminReportRow, "targetType" | "note">): boolean {
  return row.targetType === "profile" && typeof row.note === "string" && row.note.startsWith("Operator flag:");
}

/** The operator-flag rows inside a reports payload, shaped by the
 *  bench's own normalizer — the evidence chain in one function:
 *  duty → content_reports → GET /api/admin/reports → bench. */
export function operatorFlagsInQueue(payload: unknown): AdminReportRow[] {
  return normalizeAdminReports(payload).filter(isOperatorFlagRow);
}

/* ─── #94: account settings rails ────────────────────────────────── */

export const ACCOUNT_EXPORT_PATH = "/api/account/export";
export const RETENTION_PREFS_PATH = "/api/retention/prefs";
export const DELIGHT_PREFS_PATH = "/api/retention/delight-prefs";
/** Where account deletion lives — the 2D settings danger zone, with
 *  its type-DELETE confirmation. The in-world desk links here and
 *  never calls DELETE /api/account itself. */
export const ACCOUNT_DELETE_HANDOFF_PATH = "/settings";

export const ACCOUNT_EXPORT_FILENAME = "bow-down-visuals-export.json";

export interface RetentionPrefDef {
  key: string;
  label: string;
  blurb: string;
}

/** RetentionPrefsSettings' eight switches, in the page's order. */
export const RETENTION_PREF_DEFS: RetentionPrefDef[] = [
  { key: "daily_drop_enabled", label: "Daily Drop", blurb: "The daily free-Visual-Bucs drop on your dashboard." },
  { key: "away_digest_enabled", label: "While-you-were-away digest", blurb: "A catch-up digest when you come back." },
  { key: "creation_streaks_enabled", label: "Creation streaks", blurb: "Streak tracking for days you create." },
  { key: "quests_enabled", label: "Quests", blurb: "Quest offers and quest rewards." },
  { key: "login_streaks_enabled", label: "Login streaks", blurb: "Streak tracking for days you show up." },
  { key: "share_to_earn_enabled", label: "Share to earn", blurb: "Share-to-earn prompts and rewards." },
  { key: "contests_enabled", label: "Contests", blurb: "Contest invites and reminders." },
  { key: "fomo_feed_enabled", label: "FOMO feed", blurb: "The trending-now feed nudges." },
];

export interface DelightPrefDef {
  key: string;
  label: string;
  blurb: string;
}

/** retention-delight's three prefs (delightPrefsSchema's fields). */
export const DELIGHT_PREF_DEFS: DelightPrefDef[] = [
  { key: "sharkDropsEnabled", label: "Shark Drops", blurb: "Surprise Visual Bucs drops while you browse." },
  { key: "levelCelebrationsEnabled", label: "Level-up celebrations", blurb: "The celebration moment when you level up." },
  { key: "leaderboardVisible", label: "Show me on leaderboards", blurb: "Your name on the public leaderboards." },
];

/** Shape a /api/retention/prefs payload into the eight switches.
 *  The page's own rule: anything missing reads as ON (the server's
 *  defaults), a non-object payload reads as all-on defaults too —
 *  but the desk only renders switches after a successful load, so a
 *  failed fetch never dresses up as these defaults. */
export function normalizeRetentionPrefs(payload: unknown): Record<string, boolean> {
  const p = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const out: Record<string, boolean> = {};
  for (const def of RETENTION_PREF_DEFS) out[def.key] = p[def.key] !== false;
  return out;
}

/** Shape a /api/retention/delight-prefs payload ({ prefs: {...} }). */
export function normalizeDelightPrefs(payload: unknown): Record<string, boolean> {
  const wrap = payload && typeof payload === "object" ? (payload as { prefs?: unknown }) : {};
  const p = wrap.prefs && typeof wrap.prefs === "object" ? (wrap.prefs as Record<string, unknown>) : {};
  const out: Record<string, boolean> = {};
  for (const def of DELIGHT_PREF_DEFS) out[def.key] = p[def.key] !== false;
  return out;
}

/** The export's honest summary line: what the download carried.
 *  Counts come from the payload itself (profile/projects/drafts/
 *  clips/songs — account.ts's shape), never invented. */
export function exportSummary(payload: unknown): { exportedAt: string | null; counts: Record<string, number> } {
  const p = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const len = (v: unknown) => (Array.isArray(v) ? v.length : 0);
  return {
    exportedAt: typeof p["exportedAt"] === "string" ? p["exportedAt"] : null,
    counts: {
      projects: len(p["projects"]),
      drafts: len(p["drafts"]),
      clips: len(p["clips"]),
      songs: len(p["songs"]),
    },
  };
}

/* ─── #95: giveaway contests (/api/contests) ─────────────────────── */

export const GIVEAWAY_CONTESTS_PATH = "/api/contests";

export function giveawayContestPath(id: string): string {
  return `/api/contests/${encodeURIComponent(id)}`;
}
export function giveawayEntriesPath(id: string): string {
  return `${giveawayContestPath(id)}/entries`;
}
export function giveawayEntryPath(id: string, entryId: string): string {
  return `${giveawayEntriesPath(id)}/${encodeURIComponent(entryId)}`;
}
export function giveawayDrawPath(id: string): string {
  return `${giveawayContestPath(id)}/draw`;
}
export function giveawayAnnouncePath(id: string): string {
  return `${giveawayContestPath(id)}/announce`;
}

/** The announcement graphic's price: the server's
 *  CONTEST_ANNOUNCE_CREDIT_COST default (env-overridable there).
 *  Every other contest verb is free — pure interface, per the
 *  route's own header. */
export const GIVEAWAY_ANNOUNCE_COST_VB = 100;

export const GIVEAWAY_ENTRY_METHODS = ["follow", "comment", "share", "purchase"] as const;
export const GIVEAWAY_STATUSES = ["draft", "active", "ended"] as const;

export interface GiveawayContest {
  id: string;
  title: string;
  prize: string;
  description: string;
  rules: string;
  entryMethods: string[];
  startsAt: string | null;
  endsAt: string | null;
  status: string;
  winnerEntryId: string | null;
  drawAudit: { algorithm?: string; seed?: string; entryCount?: number; winnerIndex?: number; drawnAt?: string } | null;
  announcementImageUrl: string | null;
  entryCount: number;
  createdAt: string | null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

export function normalizeGiveawayContest(row: unknown): GiveawayContest | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  if (typeof r["id"] !== "string" || !r["id"]) return null;
  return {
    id: r["id"],
    title: str(r["title"]) || "Untitled contest",
    prize: str(r["prize"]),
    description: str(r["description"]),
    rules: str(r["rules"]),
    entryMethods: Array.isArray(r["entryMethods"]) ? r["entryMethods"].filter((m): m is string => typeof m === "string") : [],
    startsAt: strOrNull(r["startsAt"]),
    endsAt: strOrNull(r["endsAt"]),
    status: str(r["status"]) || "draft",
    winnerEntryId: strOrNull(r["winnerEntryId"]),
    drawAudit:
      r["drawAudit"] && typeof r["drawAudit"] === "object"
        ? (r["drawAudit"] as GiveawayContest["drawAudit"])
        : null,
    announcementImageUrl: strOrNull(r["announcementImageUrl"]),
    entryCount: typeof r["entryCount"] === "number" ? r["entryCount"] : 0,
    createdAt: strOrNull(r["createdAt"]),
  };
}

export function normalizeGiveawayContests(payload: unknown): GiveawayContest[] {
  const rows = payload && typeof payload === "object" ? (payload as { contests?: unknown }).contests : null;
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizeGiveawayContest).filter((c): c is GiveawayContest => c !== null);
}

export interface GiveawayEntry {
  id: string;
  handle: string;
  email: string | null;
  entryMethod: string;
  isVerified: boolean;
  createdAt: string | null;
}

export interface GiveawayDetail {
  contest: GiveawayContest;
  entries: GiveawayEntry[];
  stats: { total: number; verified: number; byMethod: Record<string, number> };
}

export function normalizeGiveawayDetail(payload: unknown): GiveawayDetail | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const contest = normalizeGiveawayContest(p["contest"]);
  if (!contest) return null;
  const rawEntries = Array.isArray(p["entries"]) ? p["entries"] : [];
  const entries: GiveawayEntry[] = [];
  for (const e of rawEntries) {
    if (!e || typeof e !== "object") continue;
    const r = e as Record<string, unknown>;
    if (typeof r["id"] !== "string" || !r["id"]) continue;
    entries.push({
      id: r["id"],
      handle: str(r["handle"]),
      email: strOrNull(r["email"]),
      entryMethod: str(r["entry_method"] ?? r["entryMethod"]),
      isVerified: r["is_verified"] === true || r["isVerified"] === true,
      createdAt: strOrNull(r["created_at"] ?? r["createdAt"]),
    });
  }
  const s = p["stats"] && typeof p["stats"] === "object" ? (p["stats"] as Record<string, unknown>) : {};
  return {
    contest: { ...contest, entryCount: entries.length },
    entries,
    stats: {
      total: typeof s["total"] === "number" ? s["total"] : entries.length,
      verified: typeof s["verified"] === "number" ? s["verified"] : entries.filter((e) => e.isVerified).length,
      byMethod: s["byMethod"] && typeof s["byMethod"] === "object" ? (s["byMethod"] as Record<string, number>) : {},
    },
  };
}

/** The create form's readiness, mirroring createContestSchema:
 *  title 1–120, prize 1–200, at least one entry method, and an
 *  ends-after-starts window when both dates are set. */
export function giveawayCreateReady(input: {
  title: string;
  prize: string;
  entryMethods: string[];
  startsAt?: string;
  endsAt?: string;
}): boolean {
  const title = input.title.trim();
  const prize = input.prize.trim();
  if (title.length < 1 || title.length > 120) return false;
  if (prize.length < 1 || prize.length > 200) return false;
  if (input.entryMethods.length < 1 || input.entryMethods.length > 4) return false;
  if (!input.entryMethods.every((m) => (GIVEAWAY_ENTRY_METHODS as readonly string[]).includes(m))) return false;
  if (input.startsAt && input.endsAt && new Date(input.endsAt).getTime() <= new Date(input.startsAt).getTime()) return false;
  return true;
}

/** The body POST /api/contests takes — datetimes ride as ISO with
 *  offset (the schema demands it), empty dates ride as null. */
export function giveawayCreateBody(input: {
  title: string;
  prize: string;
  description: string;
  rules: string;
  entryMethods: string[];
  startsAt?: string;
  endsAt?: string;
  status: string;
}): Record<string, unknown> {
  const iso = (v?: string) => {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  };
  return {
    title: input.title.trim(),
    prize: input.prize.trim(),
    description: input.description.trim(),
    rules: input.rules.trim(),
    entryMethods: [...input.entryMethods],
    startsAt: iso(input.startsAt),
    endsAt: iso(input.endsAt),
    status: (GIVEAWAY_STATUSES as readonly string[]).includes(input.status) ? input.status : "draft",
  };
}

/* ─── #96: the cheat-code jackpot ────────────────────────────────── */

export const JACKPOT_STATUS_PATH = "/api/cheat-code/status";
export const JACKPOT_ATTEMPT_PATH = "/api/cheat-code/attempt";
export const JACKPOT_ADMIN_EVENTS_PATH = "/api/cheat-code/admin/events";
export const JACKPOT_ADMIN_STATUS_PATH = "/api/admin/status";

export function jackpotAdminEventActionPath(id: string, action: "activate" | "deactivate"): string {
  return `${JACKPOT_ADMIN_EVENTS_PATH}/${encodeURIComponent(id)}/${action}`;
}

export const JACKPOT_DIRECTIONS = ["up", "down", "left", "right"] as const;
export type JackpotDirection = (typeof JACKPOT_DIRECTIONS)[number];

/** Sequence bounds — SequenceSchema's 4–10, shared by player
 *  attempts and admin event codes. */
export const JACKPOT_SEQUENCE_MIN = 4;
export const JACKPOT_SEQUENCE_MAX = 10;

export function jackpotSequenceReady(seq: readonly string[]): boolean {
  return (
    seq.length >= JACKPOT_SEQUENCE_MIN &&
    seq.length <= JACKPOT_SEQUENCE_MAX &&
    seq.every((d) => (JACKPOT_DIRECTIONS as readonly string[]).includes(d))
  );
}

/** The admin page's own prize bounds (admin.tsx's create form):
 *  100 to 1,000,000 Visual Bucs. */
export const JACKPOT_PRIZE_MIN_VB = 100;
export const JACKPOT_PRIZE_MAX_VB = 1_000_000;

export function jackpotPrizeReady(prize: number): boolean {
  return Number.isInteger(prize) && prize >= JACKPOT_PRIZE_MIN_VB && prize <= JACKPOT_PRIZE_MAX_VB;
}

export type JackpotPhase = "live" | "claimed" | "upcoming" | "ended" | "none";

export interface JackpotStatus {
  phase: JackpotPhase;
  name: string | null;
  prizeCredits: number;
  codeLength: number;
  startsAt: string | null;
  endsAt: string | null;
  winnerDisplayName: string | null;
  claimedAt: string | null;
}

export function normalizeJackpotStatus(payload: unknown): JackpotStatus {
  const p = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const phaseRaw = str(p["phase"]);
  const phase: JackpotPhase = (["live", "claimed", "upcoming", "ended", "none"] as string[]).includes(phaseRaw)
    ? (phaseRaw as JackpotPhase)
    : "none";
  return {
    phase,
    name: strOrNull(p["name"]),
    prizeCredits: typeof p["prizeCredits"] === "number" ? p["prizeCredits"] : 0,
    codeLength: typeof p["codeLength"] === "number" ? p["codeLength"] : 0,
    startsAt: strOrNull(p["startsAt"]),
    endsAt: strOrNull(p["endsAt"]),
    winnerDisplayName: strOrNull(p["winnerDisplayName"]),
    claimedAt: strOrNull(p["claimedAt"]),
  };
}

export interface JackpotAttemptOutcome {
  correct: boolean;
  claimed: boolean;
  triesLeft: number | null;
  prizeCredits: number | null;
  winnerDisplayName: string | null;
  message: string | null;
}

export function normalizeJackpotAttempt(payload: unknown): JackpotAttemptOutcome {
  const p = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  return {
    correct: p["correct"] === true,
    claimed: p["claimed"] === true,
    triesLeft: typeof p["triesLeft"] === "number" ? p["triesLeft"] : null,
    prizeCredits: typeof p["prizeCredits"] === "number" ? p["prizeCredits"] : null,
    winnerDisplayName: strOrNull(p["winnerDisplayName"]),
    message: strOrNull(p["message"]) ?? strOrNull(p["error"]),
  };
}

export interface JackpotAdminEvent {
  id: string;
  name: string;
  codeLength: number;
  codeSequence: string | null;
  prizeCredits: number;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
  winnerUserId: string | null;
  winnerDisplayName: string | null;
  claimedAt: string | null;
}

export function normalizeJackpotAdminEvents(payload: unknown): JackpotAdminEvent[] {
  const rows = payload && typeof payload === "object" ? (payload as { events?: unknown }).events : null;
  if (!Array.isArray(rows)) return [];
  const out: JackpotAdminEvent[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (typeof r["id"] !== "string" || !r["id"]) continue;
    out.push({
      id: r["id"],
      name: str(r["name"]) || "Jackpot event",
      codeLength: typeof r["codeLength"] === "number" ? r["codeLength"] : 0,
      codeSequence: strOrNull(r["codeSequence"]),
      prizeCredits: typeof r["prizeCredits"] === "number" ? r["prizeCredits"] : 0,
      startsAt: strOrNull(r["startsAt"]),
      endsAt: strOrNull(r["endsAt"]),
      isActive: r["isActive"] === true,
      winnerUserId: strOrNull(r["winnerUserId"]),
      winnerDisplayName: strOrNull(r["winnerDisplayName"]),
      claimedAt: strOrNull(r["claimedAt"]),
    });
  }
  return out;
}

/** The admin page's phase read for one event (admin.tsx phaseOf):
 *  claimed beats live beats ended beats upcoming. */
export function jackpotEventPhase(ev: Pick<JackpotAdminEvent, "winnerUserId" | "isActive" | "endsAt">, now: number = Date.now()): string {
  if (ev.winnerUserId) return "claimed";
  if (ev.isActive) return "live";
  if (ev.endsAt && new Date(ev.endsAt).getTime() <= now) return "ended";
  return "upcoming";
}

/** The create body POST /api/cheat-code/admin/events takes
 *  (CreateEventSchema): datetimes as ISO strings. */
export function jackpotCreateBody(input: {
  name: string;
  codeSequence: readonly string[];
  prizeCredits: number;
  startsAt?: string;
  endsAt?: string;
}): Record<string, unknown> {
  const iso = (v?: string) => {
    if (!v) return undefined;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  };
  return {
    name: input.name.trim(),
    codeSequence: [...input.codeSequence],
    prizeCredits: input.prizeCredits,
    startsAt: iso(input.startsAt),
    endsAt: iso(input.endsAt),
  };
}
