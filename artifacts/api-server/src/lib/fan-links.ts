/* ─── Fan Links That Prove It (N17) ───────────────────────────────────────
   A fan mints THEIR OWN share link for a creator's content. The link is
   only worth showing a creator if every number behind it is a recorded
   event: a click on the public redirect, an arrival (a play of the
   linked content made while carrying the code), a signup attributed
   after the fact. This module is the pure core — code minting, the
   landing path, the arrival/signup attribution decisions, and the
   creator-side aggregation. The route owns the DB.

   Honesty rules baked in:
   - The fan's OWN plays through their own link never count as arrivals
     (no self-farming); a fan can never attribute their own signup.
   - An arrival counts only when the played media IS the linked content
     (song ↔ track kind, video ↔ video kind, same content id).
   - Aggregation counts rows, nothing else — no estimates, no modelling. */

import { FAN_LINK_EVENT_KINDS, type FanLinkEventKind } from "@workspace/db";

export { FAN_LINK_EVENT_KINDS };
export type { FanLinkEventKind };

/* The share vocabulary a fan link can point at (routes/shares.ts
   CONTENT_TYPES — one truth for what a share surface can name). */
export const FAN_LINK_CONTENT_TYPES = [
  "video",
  "song",
  "thumbnail",
  "showcase",
  "image",
  "review_link",
  "winner_card",
  "other",
] as const;
export type FanLinkContentType = (typeof FAN_LINK_CONTENT_TYPES)[number];

export function isFanLinkContentType(v: unknown): v is FanLinkContentType {
  return typeof v === "string" && (FAN_LINK_CONTENT_TYPES as readonly string[]).includes(v);
}

/* ─── Codes ───
   Short codes from an unambiguous alphabet (no 0/O/1/l/I) so a code
   read aloud or retyped survives. Randomness is injected so tests are
   deterministic; the route passes crypto-grade randomness. */
export const FAN_LINK_CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const FAN_LINK_CODE_LENGTH = 8;

export function mintFanLinkCode(rand: () => number): string {
  let out = "";
  for (let i = 0; i < FAN_LINK_CODE_LENGTH; i++) {
    const idx = Math.min(
      FAN_LINK_CODE_ALPHABET.length - 1,
      Math.floor(rand() * FAN_LINK_CODE_ALPHABET.length),
    );
    out += FAN_LINK_CODE_ALPHABET[idx];
  }
  return out;
}

export function isFanLinkCode(v: unknown): v is string {
  return (
    typeof v === "string" &&
    v.length === FAN_LINK_CODE_LENGTH &&
    [...v].every((c) => FAN_LINK_CODE_ALPHABET.includes(c))
  );
}

/* Where the public redirect lands: the creator's public page, carrying
   the code so the play surfaces can hand it back to /api/play (the
   arrival) and the post-signup hook can attribute. The content anchor
   names the exact piece when the link points at one. */
export function fanLinkLandingPath(args: {
  creatorSlug: string;
  contentType: string;
  contentId: string | null;
  code: string;
}): string {
  const anchor = args.contentId ? `#${args.contentType}-${args.contentId}` : "";
  return `/artist/${args.creatorSlug}?fan=${args.code}${anchor}`;
}

export function fanLinkPublicPath(code: string): string {
  return `/api/f/${code}`;
}

/* ─── Attribution decisions ─── */

/* Play kinds (play_events vocabulary) a fan-link content type can
   arrive as. Non-playable content types can be clicked but can never
   produce an arrival — the play endpoints only know track/video. */
export function playKindForContentType(contentType: string): "track" | "video" | null {
  if (contentType === "song") return "track";
  if (contentType === "video") return "video";
  return null;
}

export interface ArrivalFacts {
  link: { fanUserId: string; contentType: string; contentId: string | null };
  play: { kind: string; mediaId: string; userId: string | null };
}

/* An arrival is proven when: the content is playable, the play IS the
   linked content (kind maps + id matches, or the link names no single
   piece — a creator-level link — and the play is of that creator's
   playable content, which the route verifies by ownership), and the
   player is not the fan themselves. */
export function shouldRecordArrival(facts: ArrivalFacts): boolean {
  const kind = playKindForContentType(facts.link.contentType);
  if (!kind || facts.play.kind !== kind) return false;
  if (facts.link.contentId && facts.link.contentId !== facts.play.mediaId) return false;
  if (facts.play.userId && facts.play.userId === facts.link.fanUserId) return false;
  return true;
}

export function shouldRecordSignup(args: {
  fanUserId: string;
  newUserId: string;
}): boolean {
  return args.fanUserId !== args.newUserId;
}

/* ─── Aggregation (creator-side + fan-side views) ─── */

export interface FanLinkRow {
  id: string;
  code: string;
  fanUserId: string;
  creatorUserId: string;
  contentType: string;
  contentId: string | null;
  createdAt: Date;
}

export interface FanLinkEventRow {
  fanLinkId: string;
  kind: string;
  visitorUserId: string | null;
  createdAt: Date;
}

export interface FanLinkStats {
  linkId: string;
  clicks: number;
  arrivals: number;
  signups: number;
  /* arrivals ÷ clicks when there were clicks — a proven ratio of two
     counted numbers, shown only when the denominator exists. */
  arrivalRate: number | null;
}

export function statsForLink(linkId: string, events: FanLinkEventRow[]): FanLinkStats {
  let clicks = 0;
  let arrivals = 0;
  let signups = 0;
  for (const e of events) {
    if (e.fanLinkId !== linkId) continue;
    if (e.kind === "click") clicks++;
    else if (e.kind === "arrival") arrivals++;
    else if (e.kind === "signup") signups++;
  }
  return {
    linkId,
    clicks,
    arrivals,
    signups,
    arrivalRate: clicks > 0 ? arrivals / clicks : null,
  };
}

export interface CreatorFanLinkRollup {
  totalLinks: number;
  totalClicks: number;
  totalArrivals: number;
  totalSignups: number;
  /* Fans ranked by proven impact: signups first, then arrivals, then
     clicks — every number a row count. */
  topFans: { fanUserId: string; clicks: number; arrivals: number; signups: number }[];
  perLink: FanLinkStats[];
}

export function rollupForCreator(
  links: FanLinkRow[],
  events: FanLinkEventRow[],
  creatorUserId: string,
): CreatorFanLinkRollup {
  const mine = links.filter((l) => l.creatorUserId === creatorUserId);
  const perLink = mine.map((l) => statsForLink(l.id, events));
  const byFan = new Map<string, { fanUserId: string; clicks: number; arrivals: number; signups: number }>();
  mine.forEach((link, i) => {
    const s = perLink[i];
    const cur = byFan.get(link.fanUserId) ?? { fanUserId: link.fanUserId, clicks: 0, arrivals: 0, signups: 0 };
    cur.clicks += s.clicks;
    cur.arrivals += s.arrivals;
    cur.signups += s.signups;
    byFan.set(link.fanUserId, cur);
  });
  const topFans = [...byFan.values()].sort(
    (a, b) =>
      b.signups - a.signups ||
      b.arrivals - a.arrivals ||
      b.clicks - a.clicks ||
      (a.fanUserId < b.fanUserId ? -1 : 1),
  );
  return {
    totalLinks: mine.length,
    totalClicks: perLink.reduce((n, s) => n + s.clicks, 0),
    totalArrivals: perLink.reduce((n, s) => n + s.arrivals, 0),
    totalSignups: perLink.reduce((n, s) => n + s.signups, 0),
    topFans,
    perLink,
  };
}
