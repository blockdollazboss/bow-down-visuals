/**
 * Fan segments — saved audiences over the One Fan Graph
 * (Stack-100 #3, fan-graph phase 2).
 *
 * A fan segment is a RULE SET over the merged fan records phase 1
 * built (lib/fan-graph): follow state, subscription state, club
 * membership, purchase count, USD/VB spend, identity sources, and
 * last activity. Membership is ALWAYS computed live from the
 * current graph — a segment is a view, never a frozen snapshot —
 * so the count a creator previews is the membership a send
 * resolves at send time (the send re-evaluates; it never reuses a
 * previewed list).
 *
 * Predicates use ONLY fields FanRecord actually carries. There is
 * no per-fan open/click field in the graph (engagement counters
 * live on subscriber rows, not fan records), so no engagement
 * predicate exists here — inventing one would be a lie.
 *
 * Rules that never bend:
 *   - Every predicate present must hold (AND); absent = no opinion.
 *   - The conservative merge is INHERITED: evaluation runs on the
 *     merged records buildFanGraph produced, so an unbridged
 *     email-buyer and account-follower stay two fans here too.
 *   - Scoping is by construction: this module only ever sees the
 *     fans loadFanGraph(creatorUserId) returned — there is no
 *     creator parameter and no cross-creator read path.
 *   - Mailability is a separate, desk-side question (see
 *     resolveSegmentAudience): being IN a segment never implies
 *     being emailable. Unsubscribed fans are segment members for
 *     counting, but the audience resolver can never return an
 *     unsubscribed subscriber row.
 */
import type { FanRecord, FanSourceKind } from "./fan-graph";

export const FAN_SOURCE_KINDS: readonly FanSourceKind[] = [
  "follow",
  "subscriber",
  "member",
  "store",
  "digital",
  "shop",
  "live",
  "tips",
] as const;

export type TriState = "yes" | "no" | "any";
export type MemberState = "any" | "active" | "member" | "none";

export interface FanSegmentRules {
  /** follows the creator. */
  follows: TriState;
  /** holds an ACTIVE subscription (FanRecord.subscribed). */
  subscribed: TriState;
  /** is a buyer (purchaseCount > 0). */
  buyer: TriState;
  /** club membership: any = no opinion; active = live member
      (active/trialing); member = holds any membership row;
      none = no membership row at all. */
  member: MemberState;
  /** spentUsdCents >= this (integer cents, 0 = no floor). */
  minSpentUsdCents: number;
  /** spentVb >= this (0 = no floor). */
  minSpentVb: number;
  /** purchaseCount >= this (0 = no floor). */
  minPurchases: number;
  /** when true, the fan must carry at least one email. */
  hasEmail: boolean;
  /** fan carries at least one of these identity sources (OR). */
  sourcesAny: FanSourceKind[];
  /** lastActivityAt within this many days of `now` (0 = no window). */
  activeWithinDays: number;
}

export const EMPTY_FAN_RULES: FanSegmentRules = {
  follows: "any",
  subscribed: "any",
  buyer: "any",
  member: "any",
  minSpentUsdCents: 0,
  minSpentVb: 0,
  minPurchases: 0,
  hasEmail: false,
  sourcesAny: [],
  activeWithinDays: 0,
};

const TRI_STATES: readonly string[] = ["yes", "no", "any"];
const MEMBER_STATES: readonly string[] = ["any", "active", "member", "none"];
const MAX_CENTS = 100_000_000; // $1,000,000 — a sanity cap, not a price
const MAX_VB = 2_000_000_000;
const MAX_COUNT = 100_000;
const MAX_DAYS = 3650;

/** Validate + normalize untrusted rules (route input or stored JSON).
    Returns null on any malformed field — a segment whose rules can't
    be read exactly is refused, never approximated. */
export function normalizeFanSegmentRules(raw: unknown): FanSegmentRules | null {
  if (raw === null || raw === undefined) return { ...EMPTY_FAN_RULES, sourcesAny: [] };
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  const tri = (v: unknown): TriState | null => {
    if (v === undefined) return "any";
    return typeof v === "string" && TRI_STATES.includes(v) ? (v as TriState) : null;
  };
  const follows = tri(r["follows"]);
  const subscribed = tri(r["subscribed"]);
  const buyer = tri(r["buyer"]);
  if (!follows || !subscribed || !buyer) return null;

  const member =
    r["member"] === undefined
      ? "any"
      : typeof r["member"] === "string" && MEMBER_STATES.includes(r["member"])
        ? (r["member"] as MemberState)
        : null;
  if (!member) return null;

  const floor = (v: unknown, max: number): number | null => {
    if (v === undefined) return 0;
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    const n = Math.floor(v);
    return n >= 0 && n <= max ? n : null;
  };
  const minSpentUsdCents = floor(r["minSpentUsdCents"], MAX_CENTS);
  const minSpentVb = floor(r["minSpentVb"], MAX_VB);
  const minPurchases = floor(r["minPurchases"], MAX_COUNT);
  const activeWithinDays = floor(r["activeWithinDays"], MAX_DAYS);
  if (minSpentUsdCents === null || minSpentVb === null || minPurchases === null || activeWithinDays === null) {
    return null;
  }

  const hasEmail = r["hasEmail"] === undefined ? false : r["hasEmail"];
  if (typeof hasEmail !== "boolean") return null;

  let sourcesAny: FanSourceKind[] = [];
  if (r["sourcesAny"] !== undefined) {
    if (!Array.isArray(r["sourcesAny"])) return null;
    for (const s of r["sourcesAny"]) {
      if (typeof s !== "string" || !(FAN_SOURCE_KINDS as readonly string[]).includes(s)) return null;
      if (!sourcesAny.includes(s as FanSourceKind)) sourcesAny.push(s as FanSourceKind);
    }
    if (sourcesAny.length > FAN_SOURCE_KINDS.length) return null;
  }

  return {
    follows,
    subscribed,
    buyer,
    member,
    minSpentUsdCents,
    minSpentVb,
    minPurchases,
    hasEmail,
    sourcesAny,
    activeWithinDays,
  };
}

export function parseStoredFanRules(stored: string): FanSegmentRules {
  try {
    return normalizeFanSegmentRules(JSON.parse(stored)) ?? { ...EMPTY_FAN_RULES, sourcesAny: [] };
  } catch {
    return { ...EMPTY_FAN_RULES, sourcesAny: [] };
  }
}

/* ─── Evaluation ──────────────────────────────────────────────────── */

function triHolds(state: TriState, value: boolean): boolean {
  return state === "any" || (state === "yes") === value;
}

export function fanMatchesRules(fan: FanRecord, rules: FanSegmentRules, now: Date = new Date()): boolean {
  if (!triHolds(rules.follows, fan.follows)) return false;
  if (!triHolds(rules.subscribed, fan.subscribed)) return false;
  if (!triHolds(rules.buyer, fan.purchaseCount > 0)) return false;
  switch (rules.member) {
    case "any":
      break;
    case "none":
      if (fan.member) return false;
      break;
    case "member":
      if (!fan.member) return false;
      break;
    case "active":
      if (!fan.member || (fan.member.status !== "active" && fan.member.status !== "trialing")) return false;
      break;
  }
  if (fan.spentUsdCents < rules.minSpentUsdCents) return false;
  if (fan.spentVb < rules.minSpentVb) return false;
  if (fan.purchaseCount < rules.minPurchases) return false;
  if (rules.hasEmail && fan.emails.length === 0) return false;
  if (rules.sourcesAny.length > 0 && !rules.sourcesAny.some((s) => fan.sources.includes(s))) return false;
  if (rules.activeWithinDays > 0) {
    if (!fan.lastActivityAt) return false;
    const ageMs = now.getTime() - new Date(fan.lastActivityAt).getTime();
    if (ageMs < 0 || ageMs > rules.activeWithinDays * 86_400_000) return false;
  }
  return true;
}

/** Live membership: the segment evaluated against the CURRENT graph. */
export function evaluateFanSegment(
  fans: FanRecord[],
  rules: FanSegmentRules,
  now: Date = new Date(),
): FanRecord[] {
  return fans.filter((f) => fanMatchesRules(f, rules, now));
}

/** Count + a small preview list. Preview order is the desk's useful
    order — biggest spenders first, then most recent — NOT graph
    order, so a creator recognizes their segment at a glance. */
export function previewFanSegment(
  fans: FanRecord[],
  rules: FanSegmentRules,
  opts: { limit?: number; now?: Date } = {},
): { count: number; preview: FanRecord[] } {
  const members = evaluateFanSegment(fans, rules, opts.now);
  const sorted = [...members].sort(
    (a, b) =>
      b.spentUsdCents - a.spentUsdCents ||
      b.spentVb - a.spentVb ||
      (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? "") ||
      (a.displayName ?? a.email ?? a.id).localeCompare(b.displayName ?? b.email ?? b.id),
  );
  const limit = Math.min(25, Math.max(1, Math.floor(opts.limit ?? 5)));
  return { count: members.length, preview: sorted.slice(0, limit) };
}

/* ─── Presets ─────────────────────────────────────────────────────── */

export interface FanSegmentPreset {
  id: string;
  name: string;
  description: string;
  rules: FanSegmentRules;
}

export const FAN_SEGMENT_PRESETS: readonly FanSegmentPreset[] = [
  {
    id: "buyers-not-followers",
    name: "Buyers who don't follow",
    description: "Fans who bought from you but don't follow you yet — the warmest follow ask there is.",
    rules: { ...EMPTY_FAN_RULES, sourcesAny: [], buyer: "yes", follows: "no" },
  },
  {
    id: "top-spenders",
    name: "Top spenders",
    description: "Fans who have spent money with you, biggest spenders first in every preview.",
    rules: { ...EMPTY_FAN_RULES, sourcesAny: [], minSpentUsdCents: 1 },
  },
  {
    id: "subscribed-not-buyers",
    name: "Subscribers who haven't bought",
    description: "Active email subscribers who have never bought — the audience a first offer is for.",
    rules: { ...EMPTY_FAN_RULES, sourcesAny: [], subscribed: "yes", buyer: "no" },
  },
] as const;

export function fanSegmentPreset(id: string): FanSegmentPreset | null {
  return FAN_SEGMENT_PRESETS.find((p) => p.id === id) ?? null;
}

/* ─── Mailable-audience resolution (the desk-side question) ──────── */

export interface SegmentSubscriberRow {
  id: string;
  email: string;
  unsubscribedAt: Date | string | null;
}

export interface SegmentAudience {
  /** One ACTIVE subscriber row per matched fan — the exact rows a
      desk send may email. Deduped: a fan with two subscribed
      addresses on the list is emailed once (lowest address wins,
      deterministically). */
  audience: SegmentSubscriberRow[];
  matchedFans: number;
  /** Segment fans the desk cannot email, by honest reason. */
  notMailable: {
    /** fan carries no email at all (account/label-only record). */
    noEmail: number;
    /** fan has an email but no subscriber row on this list. */
    notSubscribed: number;
    /** fan's only rows on this list are unsubscribed — suppression
        is absolute; the desk never re-includes them. */
    unsubscribed: number;
  };
}

/**
 * Resolve segment membership to the subscriber rows of ONE list.
 * `subscribers` must be that list's rows only (the caller loads them
 * scoped by list id, and the list itself is owner-checked before
 * this runs). A fan matches a row by ANY of its proven emails —
 * the merge's email set, never a guessed address.
 */
export function resolveSegmentAudience(
  members: FanRecord[],
  subscribers: SegmentSubscriberRow[],
): SegmentAudience {
  const byEmail = new Map<string, SegmentSubscriberRow[]>();
  for (const s of subscribers) {
    const key = s.email.trim().toLowerCase();
    const rows = byEmail.get(key) ?? [];
    rows.push(s);
    byEmail.set(key, rows);
  }
  const audience: SegmentSubscriberRow[] = [];
  const usedSubIds = new Set<string>();
  const notMailable = { noEmail: 0, notSubscribed: 0, unsubscribed: 0 };

  for (const fan of members) {
    if (fan.emails.length === 0) {
      notMailable.noEmail++;
      continue;
    }
    const rows = fan.emails.flatMap((e) => byEmail.get(e.trim().toLowerCase()) ?? []);
    const active = rows
      .filter((r) => !r.unsubscribedAt && !usedSubIds.has(r.id))
      .sort((a, b) => a.email.localeCompare(b.email));
    if (active.length > 0) {
      usedSubIds.add(active[0]!.id);
      audience.push(active[0]!);
      continue;
    }
    if (rows.length > 0) notMailable.unsubscribed++;
    else notMailable.notSubscribed++;
  }
  return { audience, matchedFans: members.length, notMailable };
}
