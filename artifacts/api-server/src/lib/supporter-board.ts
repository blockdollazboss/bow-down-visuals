/* ─── Top-supporter recognition (Wave-4 #49 + N6 Front Row Boards) ──────
   A per-creator supporter board + profile badge, derived at read time
   from REAL support records only — the Fan Graph's joined money facts
   (lib/fan-graph.ts: completed purchases, landed Visual Bucs tips,
   paid memberships) plus ticketed-live attendance (live_stream_tickets
   rows with status `active`). Nothing is stored and nothing is
   self-reported: a fan appears only because a house ledger row says
   they supported this creator. Refunded / test / uncredited rows
   never reach this module — the loaders filter them, exactly as the
   Fan Graph does.

   Ranking (plain words, printed on the board): supporters rank by
   total support, where Visual Bucs and dollars meet on the house's
   x100 scale — 100 VB counts the same as $1 of purchases (100 cents),
   so totalSupport = spentVb + spentUsdCents + ticketVb. Attendance
   counts events attended, and a ticket's price already counts toward
   the total through ticketVb — attendance is shown as its own fact,
   never double-added as money. Ties break by who supported FIRST
   (earliest first support wins the higher seat), then by name — the
   order is deterministic and can never be bought or gamed by a rename.

   Badges: rank 1–3 earn the "Front Row" badge, ranks 4–10 earn "Top
   Supporter" — shown on the board and as the supporter's badge for
   this creator's profile. A fan can opt out of a creator's public
   board at any time: their name leaves the board and the badge, while
   their support still counts in the creator's private Fan Graph.

   N6 delta: the creator states the perks for their board in their own
   plain words (perks_text) — the house invents no perks and no prices.
   Money law: recognition only — the site pays nobody real money, and
   nothing here moves Visual Bucs. */

export interface SupporterFanFact {
  /** Fan Graph fan id (`u:<userId>` for account fans). */
  fanId: string;
  userId: string | null;
  displayName: string | null;
  profileSlug: string | null;
  avatarUrl: string | null;
  spentUsdCents: number;
  spentVb: number;
  purchaseCount: number;
  lastActivityAt: string | null;
  /** Earliest support in the aggregated window, when the aggregator
   *  knows it (period aggregation does). Falls back to lastActivityAt
   *  for Fan Graph facts, which carry no first-activity stamp. */
  firstActivityAt?: string | null;
}

export interface SupporterTicketFact {
  buyerUserId: string;
  /** The ticket's listed price in Visual Bucs (what the fan paid). */
  priceVb: number;
  attendedAt: string | Date;
}

export interface SupporterBoardEntry {
  rank: number;
  userId: string;
  displayName: string | null;
  profileSlug: string | null;
  avatarUrl: string | null;
  /** spentVb + spentUsdCents + ticketVb, on the x100 scale. */
  totalSupport: number;
  spentVb: number;
  spentUsdCents: number;
  ticketVb: number;
  purchaseCount: number;
  /** Ticketed live events attended (status `active` tickets). */
  attendanceCount: number;
  firstSupportAt: string | null;
  lastSupportAt: string | null;
  badge: SupporterBadge | null;
}

export type SupporterBadgeTier = "front_row" | "top_supporter";

export interface SupporterBadge {
  tier: SupporterBadgeTier;
  label: string;
  rank: number;
}

export const FRONT_ROW_SEATS = 3;
export const TOP_SUPPORTER_SEATS = 10;
export const SUPPORTER_BOARD_LIMIT = 20;

export function badgeForRank(rank: number): SupporterBadge | null {
  if (rank >= 1 && rank <= FRONT_ROW_SEATS) {
    return { tier: "front_row", label: rank === 1 ? "Front Row · #1 Supporter" : "Front Row Supporter", rank };
  }
  if (rank > FRONT_ROW_SEATS && rank <= TOP_SUPPORTER_SEATS) {
    return { tier: "top_supporter", label: "Top Supporter", rank };
  }
  return null;
}

/** Creator-set perks, in their own plain words: trimmed, single-spaced
 *  per line, hard length cap. Empty is honest (no perks stated). */
export const PERKS_MAX_CHARS = 600;
export function sanitizePerksText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n")
    .slice(0, PERKS_MAX_CHARS);
}

export interface BuildSupporterBoardInput {
  fans: SupporterFanFact[];
  tickets: SupporterTicketFact[];
  /** Account fans with no Fan Graph row can still have attended —
   *  their display cards, keyed by userId. */
  profileCards: Map<string, { displayName: string | null; slug: string | null; avatarUrl: string | null }>;
  /** userIds who opted out of THIS creator's public board. */
  optedOutUserIds: ReadonlySet<string>;
  /** The creator's own user id — a creator never ranks on their own board. */
  creatorUserId: string;
  limit?: number;
}

interface Accum {
  userId: string;
  displayName: string | null;
  profileSlug: string | null;
  avatarUrl: string | null;
  spentVb: number;
  spentUsdCents: number;
  ticketVb: number;
  purchaseCount: number;
  attendanceCount: number;
  firstSupportAt: string | null;
  lastSupportAt: string | null;
}

function earlier(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}
function later(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

/** Build the ranked public board. Only ACCOUNT fans can appear (a
 *  board seat needs a profile to badge); email-only Fan Graph nodes
 *  stay in the private Fan Graph where they belong. Zero-support
 *  accounts never appear — a follow alone is not support. */
export function buildSupporterBoard(input: BuildSupporterBoardInput): SupporterBoardEntry[] {
  const byUser = new Map<string, Accum>();
  const ensure = (userId: string): Accum => {
    let acc = byUser.get(userId);
    if (!acc) {
      const card = input.profileCards.get(userId);
      acc = {
        userId,
        displayName: card?.displayName ?? null,
        profileSlug: card?.slug ?? null,
        avatarUrl: card?.avatarUrl ?? null,
        spentVb: 0,
        spentUsdCents: 0,
        ticketVb: 0,
        purchaseCount: 0,
        attendanceCount: 0,
        firstSupportAt: null,
        lastSupportAt: null,
      };
      byUser.set(userId, acc);
    }
    return acc;
  };

  for (const fan of input.fans) {
    if (!fan.userId) continue;
    const acc = ensure(fan.userId);
    acc.spentVb += Math.max(0, Math.floor(fan.spentVb || 0));
    acc.spentUsdCents += Math.max(0, Math.floor(fan.spentUsdCents || 0));
    acc.purchaseCount += Math.max(0, Math.floor(fan.purchaseCount || 0));
    if (fan.displayName && !acc.displayName) acc.displayName = fan.displayName;
    if (fan.profileSlug && !acc.profileSlug) acc.profileSlug = fan.profileSlug;
    if (fan.avatarUrl && !acc.avatarUrl) acc.avatarUrl = fan.avatarUrl;
    acc.lastSupportAt = later(acc.lastSupportAt, fan.lastActivityAt);
    // The Fan Graph carries no first-activity stamp; last activity is
    // the tie-break floor for graph-only fans, refined by tickets and
    // by period aggregation's firstActivityAt when present.
    acc.firstSupportAt = earlier(acc.firstSupportAt, fan.firstActivityAt ?? fan.lastActivityAt);
  }

  for (const t of input.tickets) {
    const acc = ensure(t.buyerUserId);
    acc.ticketVb += Math.max(0, Math.floor(t.priceVb || 0));
    acc.attendanceCount += 1;
    const at = new Date(t.attendedAt).toISOString();
    acc.firstSupportAt = earlier(acc.firstSupportAt, at);
    acc.lastSupportAt = later(acc.lastSupportAt, at);
  }

  const entries: SupporterBoardEntry[] = [];
  for (const acc of byUser.values()) {
    if (acc.userId === input.creatorUserId) continue;
    if (input.optedOutUserIds.has(acc.userId)) continue;
    const totalSupport = acc.spentVb + acc.spentUsdCents + acc.ticketVb;
    if (totalSupport <= 0) continue;
    entries.push({
      rank: 0,
      userId: acc.userId,
      displayName: acc.displayName,
      profileSlug: acc.profileSlug,
      avatarUrl: acc.avatarUrl,
      totalSupport,
      spentVb: acc.spentVb,
      spentUsdCents: acc.spentUsdCents,
      ticketVb: acc.ticketVb,
      purchaseCount: acc.purchaseCount,
      attendanceCount: acc.attendanceCount,
      firstSupportAt: acc.firstSupportAt,
      lastSupportAt: acc.lastSupportAt,
      badge: null,
    });
  }

  entries.sort((a, b) => {
    if (b.totalSupport !== a.totalSupport) return b.totalSupport - a.totalSupport;
    const af = a.firstSupportAt ?? "9999";
    const bf = b.firstSupportAt ?? "9999";
    if (af !== bf) return af < bf ? -1 : 1;
    return (a.displayName ?? a.userId).localeCompare(b.displayName ?? b.userId);
  });

  const limit = Math.max(1, Math.min(input.limit ?? SUPPORTER_BOARD_LIMIT, 100));
  return entries.slice(0, limit).map((e, i) => ({ ...e, rank: i + 1, badge: badgeForRank(i + 1) }));
}

/** One fan's standing on one creator's board (for the profile badge
 *  and the opt-out control): their entry when they are on the public
 *  board, plus whether they opted out. */
export function supporterStanding(
  board: SupporterBoardEntry[],
  userId: string,
  optedOut: boolean,
): { entry: SupporterBoardEntry | null; optedOut: boolean } {
  return { entry: board.find((e) => e.userId === userId) ?? null, optedOut };
}

/** Postgres "undefined table" (42P01) guard — same discipline as
 *  co-posts: settings/opt-out writes answer an honest 503 until the
 *  provisional migration lands; board reads degrade to defaults
 *  (board enabled, no perks, no opt-outs). */
export function isMissingSupporterBoardTable(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string; cause?: { code?: string; message?: string } };
  if (e.code === "42P01") return true;
  const msg = `${e.message ?? ""} ${e.cause?.message ?? ""}`;
  return /supporter_board_(settings|opt_outs)/.test(msg) && /(does not exist|undefined table|no such table)/i.test(msg);
}

export const SUPPORTER_BOARD_NOT_READY = {
  error: "supporter_board_not_ready",
  message: "Supporter recognition is almost ready — the final setup step hasn't landed yet, so nothing was saved.",
} as const;

/* ─── Periods (Wave-4 #49 spec delta) ──────────────────────────────────
   The board is period-based: "this month" by default, "all time" on
   request. A period is a half-open UTC window [start, end) — an event
   at exactly the first instant of the month counts; an event at
   exactly the first instant of the NEXT month does not. The basis
   string is generated from the window so a surface can never label an
   all-time board "this month" or the reverse. */

export type SupporterPeriod = "month" | "all";
export const SUPPORTER_PERIODS: readonly SupporterPeriod[] = ["month", "all"];

export interface SupporterPeriodWindow {
  period: SupporterPeriod;
  /** Inclusive start (ISO), or null for all time. */
  startAt: string | null;
  /** Exclusive end (ISO). For "month" this is the next month's start. */
  endAt: string;
  /** Short label for tabs/headings: "This month" / "All time". */
  label: string;
  /** The honest basis line printed on the board. */
  basis: string;
}

export function supporterPeriodWindow(period: SupporterPeriod, now: Date = new Date()): SupporterPeriodWindow {
  if (period === "all") {
    return {
      period,
      startAt: null,
      endAt: now.toISOString(),
      label: "All time",
      basis: "Top supporters by tips + purchases, all time",
    };
  }
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return {
    period,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    label: "This month",
    basis: "Top supporters by tips + purchases this month",
  };
}

export function isWithinSupporterPeriod(at: string | Date, window: SupporterPeriodWindow): boolean {
  const t = new Date(at).getTime();
  if (Number.isNaN(t)) return false;
  if (window.startAt && t < new Date(window.startAt).getTime()) return false;
  if (window.period === "month" && t >= new Date(window.endAt).getTime()) return false;
  return true;
}

/** One real ledger row, projected by the route loader: a completed
 *  purchase, a landed tip, a paid membership join, a live-shop sale.
 *  The loader applies the Fan Graph's own filters (completed / paid /
 *  credited only) BEFORE a row becomes an event — this aggregator
 *  never sees a refunded, test, or uncredited row. */
export interface SupporterSupportEvent {
  userId: string;
  spentUsdCents?: number;
  spentVb?: number;
  /** Completed purchases this row represents (usually 1; membership
   *  joins count as their paid join, not a store purchase — loaders
   *  pass 0 for those and the money still counts). */
  purchaseCount?: number;
  at: string | Date;
}

/** Aggregate ledger events inside a period window into the fan facts
 *  buildSupporterBoard ranks. Events outside the window are dropped —
 *  the boundary is half-open, matching supporterPeriodWindow. Display
 *  cards are NOT resolved here; the loader merges profile cards into
 *  the facts' display fields via buildSupporterBoard's profileCards. */
export function aggregateSupporterEvents(
  events: SupporterSupportEvent[],
  window: SupporterPeriodWindow,
): SupporterFanFact[] {
  const byUser = new Map<string, SupporterFanFact>();
  for (const ev of events) {
    if (!ev.userId) continue;
    const atDate = new Date(ev.at);
    if (!isWithinSupporterPeriod(atDate, window)) continue;
    const at = atDate.toISOString();
    let fact = byUser.get(ev.userId);
    if (!fact) {
      fact = {
        fanId: `u:${ev.userId}`,
        userId: ev.userId,
        displayName: null,
        profileSlug: null,
        avatarUrl: null,
        spentUsdCents: 0,
        spentVb: 0,
        purchaseCount: 0,
        lastActivityAt: at,
        firstActivityAt: at,
      };
      byUser.set(ev.userId, fact);
    }
    fact.spentUsdCents += Math.max(0, Math.floor(ev.spentUsdCents || 0));
    fact.spentVb += Math.max(0, Math.floor(ev.spentVb || 0));
    fact.purchaseCount += Math.max(0, Math.floor(ev.purchaseCount || 0));
    fact.lastActivityAt = later(fact.lastActivityAt, at);
    fact.firstActivityAt = earlier(fact.firstActivityAt ?? null, at);
  }
  return [...byUser.values()];
}

/** Keep only the tickets inside the period window (attendance is a
 *  period fact too — last month's show does not seat this month). */
export function filterTicketsForPeriod(
  tickets: SupporterTicketFact[],
  window: SupporterPeriodWindow,
): SupporterTicketFact[] {
  return tickets.filter((t) => isWithinSupporterPeriod(t.attendedAt, window));
}

/** Creator settings with the house defaults applied: the board is ON
 *  until its creator turns it off, and perks are empty until the
 *  creator writes them. A missing row (or a missing table, pre-
 *  migration) resolves to exactly this. */
export interface SupporterBoardSettings {
  enabled: boolean;
  perksText: string;
}
export function resolveSupporterBoardSettings(
  row: { enabled?: boolean | null; perksText?: string | null } | null | undefined,
): SupporterBoardSettings {
  return {
    enabled: row?.enabled !== false,
    perksText: sanitizePerksText(row?.perksText ?? ""),
  };
}

/** The exact honesty copy every supporter-board surface must carry. */
export const SUPPORTER_BOARD_COPY = {
  rankedFromRealSupport:
    "Ranked from real support only — purchases, Visual Bucs tips, paid memberships, and ticketed live shows. Follows alone never rank.",
  x100Explainer: "Totals meet on the house scale: 100 Visual Bucs counts the same as $1 of purchases.",
  optOut: "You can leave this board any time — your name and badge come off the public board, and your support still counts for the creator privately.",
  perksHeading: "What top supporters get — in the creator's own words",
  emptyMonth:
    "No qualifying support yet this month. Tips, purchases, paid memberships and ticketed shows land here as they happen — nothing is back-filled or invented.",
  emptyAll:
    "No qualifying support yet. Tips, purchases, paid memberships and ticketed shows land here as they happen — nothing is back-filled or invented.",
  boardOff: "This creator has turned their supporter board off for now.",
} as const;
