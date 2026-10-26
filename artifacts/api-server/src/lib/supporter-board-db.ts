/* ─── Top-supporter recognition — loader (Wave-4 #49 + N6 delta) ──────
   Reads the REAL ledgers for ONE creator and hands period-filtered
   events to the pure ranking in lib/supporter-board.ts. The filters
   are the Fan Graph's own (lib/fan-graph.ts), so a row that does not
   count as spend there never counts here:
     - store_orders / digital_sales: status 'completed' only.
     - live_shop_sales: status 'paid' only ('test' rows never moved money).
     - fan_members: paid joins only — stripe_session_id present and
       status not 'refunded'; the join's price_cents at joined_at.
       Manual tracking rows never invent spend.
     - world_stage_tips: creator_credited_at set (the VB actually landed).
     - live_stream_tickets: status 'active' (refunded tickets revoked).
   shop_events sales are deliberately NOT a source: they carry only a
   buyer email, and an email alone cannot be seated on a public board
   or badged to an account without guessing an identity.
   Every query is scoped to the one creator — profile ids for store /
   digital, the creator's user id everywhere else. */
import { and, eq, gte, inArray, isNotNull, lt, ne } from "drizzle-orm";
import {
  db,
  creatorProfilesTable,
  digitalSalesTable,
  fanMembersTable,
  liveShopSalesTable,
  liveStreamTicketsTable,
  storeOrdersTable,
  supporterBoardOptOutsTable,
  supporterBoardSettingsTable,
  worldStageTipsTable,
} from "@workspace/db";
import {
  aggregateSupporterEvents,
  buildSupporterBoard,
  filterTicketsForPeriod,
  isMissingSupporterBoardTable,
  resolveSupporterBoardSettings,
  type SupporterBoardEntry,
  type SupporterBoardSettings,
  type SupporterPeriodWindow,
  type SupporterSupportEvent,
  type SupporterTicketFact,
} from "./supporter-board";

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface LoadedSupporterBoard {
  settings: SupporterBoardSettings;
  entries: SupporterBoardEntry[];
  optedOutUserIds: Set<string>;
  /** False when the provisional migration hasn't landed: settings and
   *  opt-outs read as defaults and the board itself still ranks. */
  ready: boolean;
}

export async function loadSupporterSettings(creatorUserId: string): Promise<{ settings: SupporterBoardSettings; ready: boolean }> {
  try {
    const rows = await db
      .select({ enabled: supporterBoardSettingsTable.enabled, perksText: supporterBoardSettingsTable.perksText })
      .from(supporterBoardSettingsTable)
      .where(eq(supporterBoardSettingsTable.creatorUserId, creatorUserId))
      .limit(1);
    return { settings: resolveSupporterBoardSettings(rows[0] ?? null), ready: true };
  } catch (err) {
    if (isMissingSupporterBoardTable(err)) return { settings: resolveSupporterBoardSettings(null), ready: false };
    throw err;
  }
}

export async function loadSupporterOptOuts(creatorUserId: string): Promise<{ optedOutUserIds: Set<string>; ready: boolean }> {
  try {
    const rows = await db
      .select({ fanUserId: supporterBoardOptOutsTable.fanUserId })
      .from(supporterBoardOptOutsTable)
      .where(eq(supporterBoardOptOutsTable.creatorUserId, creatorUserId));
    return { optedOutUserIds: new Set(rows.map((r) => r.fanUserId)), ready: true };
  } catch (err) {
    if (isMissingSupporterBoardTable(err)) return { optedOutUserIds: new Set(), ready: false };
    throw err;
  }
}

export async function loadSupporterBoard(
  creatorUserId: string,
  window: SupporterPeriodWindow,
): Promise<LoadedSupporterBoard> {
  const [{ settings, ready: settingsReady }, { optedOutUserIds, ready: optOutsReady }] = await Promise.all([
    loadSupporterSettings(creatorUserId),
    loadSupporterOptOuts(creatorUserId),
  ]);
  const ready = settingsReady && optOutsReady;
  if (!settings.enabled) return { settings, entries: [], optedOutUserIds, ready };

  const myProfiles = await db
    .select({ id: creatorProfilesTable.id })
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.userId, creatorUserId));
  const profileIds = myProfiles.map((p) => p.id);

  /* Half-open period bounds for the month window; all-time adds none. */
  const since = window.startAt ? new Date(window.startAt) : null;
  const until = window.period === "month" ? new Date(window.endAt) : null;

  const events: SupporterSupportEvent[] = [];
  const push = (userId: string | null, ev: Omit<SupporterSupportEvent, "userId">) => {
    if (userId) events.push({ userId, ...ev });
  };

  if (profileIds.length) {
    const storeRows = await db
      .select({ buyerUserId: storeOrdersTable.buyerUserId, amountCents: storeOrdersTable.amountCents, createdAt: storeOrdersTable.createdAt })
      .from(storeOrdersTable)
      .where(
        and(
          inArray(storeOrdersTable.profileId, profileIds),
          eq(storeOrdersTable.status, "completed"),
          ...(since ? [gte(storeOrdersTable.createdAt, since)] : []),
          ...(until ? [lt(storeOrdersTable.createdAt, until)] : []),
        ),
      );
    for (const r of storeRows) push(r.buyerUserId, { spentUsdCents: r.amountCents, purchaseCount: 1, at: r.createdAt });

    const digitalRows = await db
      .select({ buyerUserId: digitalSalesTable.buyerUserId, amountCents: digitalSalesTable.amountCents, createdAt: digitalSalesTable.createdAt })
      .from(digitalSalesTable)
      .where(
        and(
          inArray(digitalSalesTable.profileId, profileIds),
          eq(digitalSalesTable.status, "completed"),
          ...(since ? [gte(digitalSalesTable.createdAt, since)] : []),
          ...(until ? [lt(digitalSalesTable.createdAt, until)] : []),
        ),
      );
    for (const r of digitalRows) push(r.buyerUserId, { spentUsdCents: r.amountCents, purchaseCount: 1, at: r.createdAt });
  }

  const liveRows = await db
    .select({ buyerUserId: liveShopSalesTable.buyer_user_id, amountCents: liveShopSalesTable.price_cents, createdAt: liveShopSalesTable.created_at })
    .from(liveShopSalesTable)
    .where(
      and(
        eq(liveShopSalesTable.user_id, creatorUserId),
        eq(liveShopSalesTable.status, "paid"),
        ...(since ? [gte(liveShopSalesTable.created_at, since)] : []),
        ...(until ? [lt(liveShopSalesTable.created_at, until)] : []),
      ),
    );
  for (const r of liveRows) push(r.buyerUserId, { spentUsdCents: r.amountCents, purchaseCount: 1, at: r.createdAt });

  const memberRows = await db
    .select({ fanUserId: fanMembersTable.fan_user_id, priceCents: fanMembersTable.price_cents, joinedAt: fanMembersTable.joined_at })
    .from(fanMembersTable)
    .where(
      and(
        eq(fanMembersTable.user_id, creatorUserId),
        isNotNull(fanMembersTable.fan_user_id),
        isNotNull(fanMembersTable.stripe_session_id),
        ne(fanMembersTable.status, "refunded"),
        ...(since ? [gte(fanMembersTable.joined_at, since)] : []),
        ...(until ? [lt(fanMembersTable.joined_at, until)] : []),
      ),
    );
  for (const r of memberRows) push(r.fanUserId, { spentUsdCents: r.priceCents, purchaseCount: 0, at: r.joinedAt });

  const tipRows = await db
    .select({ fromUserId: worldStageTipsTable.fromUserId, amountVb: worldStageTipsTable.amountVb, createdAt: worldStageTipsTable.createdAt })
    .from(worldStageTipsTable)
    .where(
      and(
        eq(worldStageTipsTable.toUserId, creatorUserId),
        isNotNull(worldStageTipsTable.creatorCreditedAt),
        ...(since ? [gte(worldStageTipsTable.createdAt, since)] : []),
        ...(until ? [lt(worldStageTipsTable.createdAt, until)] : []),
      ),
    );
  for (const r of tipRows) push(r.fromUserId, { spentVb: r.amountVb, at: r.createdAt });

  const ticketRows = await db
    .select({ buyerUserId: liveStreamTicketsTable.buyer_user_id, priceVb: liveStreamTicketsTable.price_vb, createdAt: liveStreamTicketsTable.created_at })
    .from(liveStreamTicketsTable)
    .where(and(eq(liveStreamTicketsTable.creator_user_id, creatorUserId), eq(liveStreamTicketsTable.status, "active")));
  const tickets: SupporterTicketFact[] = ticketRows.map((r) => ({
    buyerUserId: r.buyerUserId,
    priceVb: r.priceVb,
    attendedAt: r.createdAt,
  }));

  /* Display cards for the account fans this board actually contains. */
  const fanUserIds = new Set<string>();
  for (const e of events) if (UUID_SHAPE.test(e.userId)) fanUserIds.add(e.userId);
  for (const t of tickets) if (UUID_SHAPE.test(t.buyerUserId)) fanUserIds.add(t.buyerUserId);
  const profileCards = new Map<string, { displayName: string | null; slug: string | null; avatarUrl: string | null }>();
  if (fanUserIds.size) {
    const cards = await db
      .select({
        userId: creatorProfilesTable.userId,
        displayName: creatorProfilesTable.displayName,
        slug: creatorProfilesTable.slug,
        avatarUrl: creatorProfilesTable.avatarUrl,
      })
      .from(creatorProfilesTable)
      .where(inArray(creatorProfilesTable.userId, [...fanUserIds]));
    for (const c of cards) profileCards.set(c.userId, { displayName: c.displayName, slug: c.slug, avatarUrl: c.avatarUrl });
  }

  const entries = buildSupporterBoard({
    fans: aggregateSupporterEvents(events, window),
    tickets: filterTicketsForPeriod(tickets, window),
    profileCards,
    optedOutUserIds,
    creatorUserId,
  });
  return { settings, entries, optedOutUserIds, ready };
}
