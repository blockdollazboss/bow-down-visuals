import { apiErrorMessage } from "./api-error";
/* ─── Top-Supporter Recognition — client (Wave-4 #49 + N6 delta) ────────
   The board lives on the creator's public profile (no standalone
   page): GET /api/supporter-board/by-slug/:slug ranks the creator's
   top supporters from real ledgers only, for a period ("month" default
   or "all"). Creator controls (on/off + N6 perks in their own words)
   dock in profile setup; a fan's opt-out docks on the board itself.
   Recognition only — nothing here moves Visual Bucs or charges. */

export type SupporterPeriod = "month" | "all";

export interface SupporterBadgeDto {
  tier: "front_row" | "top_supporter";
  label: string;
  rank: number;
}

export interface SupporterBoardEntryDto {
  rank: number;
  userId: string;
  displayName: string | null;
  profileSlug: string | null;
  avatarUrl: string | null;
  totalSupport: number;
  spentVb: number;
  spentUsdCents: number;
  ticketVb: number;
  purchaseCount: number;
  attendanceCount: number;
  firstSupportAt: string | null;
  lastSupportAt: string | null;
  badge: SupporterBadgeDto | null;
}

export interface SupporterBoardDto {
  creator: { slug: string; displayName: string; avatarUrl: string | null };
  enabled: boolean;
  period: SupporterPeriod;
  periodLabel: string;
  basis: string;
  perksText: string;
  entries: SupporterBoardEntryDto[];
  empty: boolean;
  emptyCopy: string;
  viewer: {
    userId: string;
    isCreator: boolean;
    standing: SupporterBoardEntryDto | null;
    optedOut: boolean;
  } | null;
}

export interface SupporterBoardSettingsDto {
  enabled: boolean;
  perksText: string;
  ready: boolean;
}

/* The honesty copy — MUST stay sentence-identical to the API's
   SUPPORTER_BOARD_COPY (api-server src/lib/supporter-board.ts). */
export const SUPPORTER_BOARD_COPY = {
  rankedFromRealSupport:
    "Ranked from real support only — purchases, Visual Bucs tips, paid memberships, and ticketed live shows. Follows alone never rank.",
  x100Explainer: "Totals meet on the house scale: 100 Visual Bucs counts the same as $1 of purchases.",
  optOut: "You can leave this board any time — your name and badge come off the public board, and your support still counts for the creator privately.",
  perksHeading: "What top supporters get — in the creator's own words",
  boardOff: "This creator has turned their supporter board off for now.",
} as const;

export const SUPPORTER_BOARD_PATH = "/api/supporter-board";

export function supporterBoardBySlugPath(slug: string, period: SupporterPeriod): string {
  return `${SUPPORTER_BOARD_PATH}/by-slug/${encodeURIComponent(slug)}?period=${period}`;
}

/* ─── View state (pure; unit-tested) ───────────────────────────────────
   loading / error are their own honest states. A board the creator
   turned OFF is hidden from visitors entirely and shows the owner an
   "off" notice on their own profile. An enabled board with nobody on
   it yet shows the honest empty copy — never invented supporters. */
export type SupporterBoardLoadStatus = "loading" | "ready" | "error";
export type SupporterBoardView = "loading" | "error" | "hidden" | "off" | "empty" | "ready";

export function supporterBoardViewState(input: {
  status: SupporterBoardLoadStatus;
  board: SupporterBoardDto | null;
  isOwner: boolean;
}): SupporterBoardView {
  if (input.status === "loading") return "loading";
  if (input.status === "error" || !input.board) return "error";
  if (!input.board.enabled) return input.isOwner ? "off" : "hidden";
  if (input.board.entries.length === 0) return "empty";
  return "ready";
}

/** One entry's support, in plain words, from the same facts the board
 *  ranked by — no totals without their makeup. */
export function supportBreakdown(entry: SupporterBoardEntryDto): string[] {
  const parts: string[] = [];
  if (entry.spentUsdCents > 0) parts.push(`$${(entry.spentUsdCents / 100).toFixed(2)} in purchases`);
  if (entry.spentVb > 0) parts.push(`${entry.spentVb.toLocaleString("en-US")} VB in tips`);
  if (entry.ticketVb > 0) parts.push(`${entry.ticketVb.toLocaleString("en-US")} VB in show tickets`);
  if (entry.attendanceCount > 0)
    parts.push(`${entry.attendanceCount} ticketed show${entry.attendanceCount === 1 ? "" : "s"} attended`);
  return parts;
}

export function supporterDisplayName(entry: SupporterBoardEntryDto): string {
  return entry.displayName?.trim() ? entry.displayName : "A supporter";
}

/* ─── Fetch helpers (same error contract as lib/royal-court.ts) ────── */
async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(
      apiErrorMessage(body, `Request failed (${res.status})`),
    ) as Error & { status?: number; code?: string };
    err.status = res.status;
    err.code = (body as { error?: string }).error;
    throw err;
  }
  return res.json() as Promise<T>;
}

export async function fetchSupporterBoard(slug: string, period: SupporterPeriod): Promise<SupporterBoardDto> {
  const res = await fetch(supporterBoardBySlugPath(slug, period));
  return json<SupporterBoardDto>(res);
}

export async function fetchMySupporterSettings(): Promise<SupporterBoardSettingsDto> {
  const res = await fetch(`${SUPPORTER_BOARD_PATH}/me/settings`);
  return json<SupporterBoardSettingsDto>(res);
}

export async function saveMySupporterSettings(input: {
  enabled?: boolean;
  perksText?: string;
}): Promise<{ enabled: boolean; perksText: string }> {
  const res = await fetch(`${SUPPORTER_BOARD_PATH}/me/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return json<{ enabled: boolean; perksText: string }>(res);
}

export async function setSupporterOptOut(slug: string, optedOut: boolean): Promise<{ optedOut: boolean }> {
  const res = await fetch(
    `${SUPPORTER_BOARD_PATH}/by-slug/${encodeURIComponent(slug)}/${optedOut ? "opt-out" : "opt-in"}`,
    { method: "POST" },
  );
  return json<{ optedOut: boolean }>(res);
}
