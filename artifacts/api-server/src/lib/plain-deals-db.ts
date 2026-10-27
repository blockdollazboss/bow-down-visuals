/* ─── Plain-Words Deals — DB-facing helpers (Stack-200 upgrade #164) ──────
   Thin translation between `plain_deals` + `plain_deal_sides` rows and
   the pure deal machine (lib/plain-deals.ts), following the co-releases
   phase pattern (lib/co-releases-db.ts):
   - WRITE paths use the unguarded loaders and let the route translate
     a missing table (42P01) into the honest 503 PLAIN_DEAL_NOT_READY.
   - READ paths are GUARDED: any failure degrades to "no deals yet", so
     a page embedding deals (Contracts) can never 500 over them
     (resilience law — one bad section never takes a page down).

   The frozen facts (agreed shares, signed text, signature moment,
   rail attach record) live on the HEAD row and are reconstructed from
   it alone — never re-derived from the mutable proposed shares. */

import { eq, inArray } from "drizzle-orm";
import { db, plainDealsTable, plainDealSidesTable, creatorProfilesTable } from "@workspace/db";
import { isMissingPlainDealTable, type PlainDeal, type PlainDealSide } from "./plain-deals";
import { logger } from "./logger";

type PlainDealHeadRow = typeof plainDealsTable.$inferSelect;
type PlainDealSideRow = typeof plainDealSidesTable.$inferSelect;
type CreatorProfileRow = typeof creatorProfilesTable.$inferSelect;

export function rowsToPlainDeal(head: PlainDealHeadRow, rows: PlainDealSideRow[]): PlainDeal | null {
  const mine = rows.filter((r) => r.plain_deal_id === head.id);
  if (mine.length === 0) return null;
  const sides = mine.map(
    (r): PlainDealSide => ({
      profileId: r.profile_id,
      userId: r.user_id,
      role: r.role === "author" ? "author" : "partner",
      doesText: r.does_text,
      getsText: r.gets_text,
      sharePct: Number(r.share_pct),
      status: r.status as PlainDealSide["status"],
      signedName: r.signed_name ?? null,
      signedAt: r.signed_at ?? null,
    }),
  );
  sides.sort((a, b) => (a.role === b.role ? 0 : a.role === "author" ? -1 : 1));
  if (sides.length !== 2) return null;
  const agreedShares = head.agreed_shares
    ? head.agreed_shares.map((s) => ({ profileId: s.profileId, userId: s.userId, sharePct: Number(s.sharePct) }))
    : null;
  return {
    id: head.id,
    title: head.title,
    itemKind: (head.item_kind ?? "general") as PlainDeal["itemKind"],
    itemId: head.item_id ?? null,
    itemTitle: head.item_title ?? "",
    sides: sides as [PlainDealSide, PlainDealSide],
    agreedShares,
    signedText: head.signed_text ?? null,
    signedAt: head.signed_at ?? null,
    splitAttach: head.split_attach
      ? {
          rail: head.split_attach.rail,
          refId: head.split_attach.refId,
          at: head.split_attach.at,
        }
      : null,
  };
}

/** Unguarded single load (write paths): throws on a missing table so
 *  the route can answer 503. Null = no such deal. */
export async function loadPlainDeal(id: string): Promise<{ head: PlainDealHeadRow; deal: PlainDeal } | null> {
  const [head] = await db.select().from(plainDealsTable).where(eq(plainDealsTable.id, id)).limit(1);
  if (!head) return null;
  const rows = await db.select().from(plainDealSidesTable).where(eq(plainDealSidesTable.plain_deal_id, id));
  const deal = rowsToPlainDeal(head, rows);
  return deal ? { head, deal } : null;
}

/** Probe used by WRITE routes BEFORE any row is written: if the tables
 *  aren't there yet, the write must fail cleanly with nothing created
 *  and nobody notified. */
export async function probePlainDealTables(): Promise<void> {
  await db.select().from(plainDealsTable).limit(1);
  await db.select().from(plainDealSidesTable).limit(1);
}

/** Guarded batch load for READ paths — degrades to empty on ANY
 *  failure (not migrated yet, test fake, transient error). */
export async function loadPlainDealsGuarded(
  ids: string[],
): Promise<Map<string, { head: PlainDealHeadRow; deal: PlainDeal }>> {
  const out = new Map<string, { head: PlainDealHeadRow; deal: PlainDeal }>();
  if (ids.length === 0) return out;
  try {
    const heads = await db.select().from(plainDealsTable).where(inArray(plainDealsTable.id, ids));
    if (heads.length === 0) return out;
    const rows = await db
      .select()
      .from(plainDealSidesTable)
      .where(inArray(plainDealSidesTable.plain_deal_id, heads.map((h) => h.id)));
    for (const head of heads) {
      const deal = rowsToPlainDeal(head, rows);
      if (deal) out.set(head.id, { head, deal });
    }
  } catch (err) {
    if (isMissingPlainDealTable(err)) {
      logger.debug("[plain-deals] tables not present yet — serving without deal data");
    } else {
      logger.warn({ err }, "[plain-deals] read failed — serving without deal data");
    }
  }
  return out;
}

export interface PlainDealSideSummary {
  profile_id: string;
  user_id: string;
  role: string;
  status: string;
  does_text: string;
  gets_text: string;
  share_pct: number;
  agreed_share_pct: number | null;
  signed_name: string | null;
  signed_at: Date | string | null;
  display_name: string | null;
  slug: string | null;
  avatar_url: string | null;
  is_verified: boolean;
}

export function plainDealSideSummaries(
  deal: PlainDeal,
  profilesById: Map<string, CreatorProfileRow>,
): PlainDealSideSummary[] {
  const agreed = new Map((deal.agreedShares ?? []).map((s) => [s.profileId, s.sharePct]));
  return deal.sides.map((s) => {
    const p = profilesById.get(s.profileId);
    return {
      profile_id: s.profileId,
      user_id: s.userId,
      role: s.role,
      status: s.status,
      does_text: s.doesText,
      gets_text: s.getsText,
      share_pct: s.sharePct,
      agreed_share_pct: agreed.get(s.profileId) ?? null,
      signed_name: s.signedName,
      signed_at: s.signedAt,
      display_name: p?.displayName ?? null,
      slug: p?.slug ?? null,
      avatar_url: p?.avatarUrl ?? null,
      is_verified: p?.isVerified ?? false,
    };
  });
}

export async function fetchProfilesByIdPlainDeal(
  profileIds: string[],
): Promise<Map<string, CreatorProfileRow>> {
  if (profileIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(creatorProfilesTable)
    .where(inArray(creatorProfilesTable.id, [...new Set(profileIds)]));
  return new Map(rows.map((r) => [r.id, r]));
}
