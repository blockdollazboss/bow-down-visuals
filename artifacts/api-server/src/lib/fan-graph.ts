/**
 * One Fan Graph — the unified fan view (Stack-100 #3, feature #11).
 *
 * A creator's fans live in separate tables that never meet: followers
 * in `follows`, email subscribers in `email_subscribers` (no user id
 * on the row), fan-club members in `fan_members`, and buyers spread
 * across `store_orders` / `digital_sales` / `shop_events` /
 * `live_shop_sales`, plus Visual Bucs stage tips in
 * `world_stage_tips`. This module joins them — read-only, at read
 * time, derived from the rows the house already keeps (the same
 * discipline as lib/email-segments) — into ONE record per fan for ONE
 * creator. Nothing is stored, so the graph can never drift from the
 * source tables.
 *
 * THE MERGE RULE (identity resolution — read before touching):
 *   - Every sighting attaches to an identity key: `u:<userId>` when a
 *     source row carries the fan's account id, else `e:<email>` when
 *     it carries an email (normalized: trimmed + lowercased), else
 *     `l:<label>` for a free-form fan-club label with neither.
 *   - Two keys merge ONLY when a single source row itself carries
 *     both: a `fan_members` row with `fan_user_id` set AND an
 *     email-shaped `fan_label` asserts "this account is this email"
 *     for THIS creator's club, so the account node and the email node
 *     become one fan. That is the only bridge.
 *   - Two different account ids NEVER merge. Two different emails
 *     never merge. An email-only subscriber and an account follower
 *     stay separate fans unless the creator's own club row bridges
 *     them — a shared email string across two accounts is treated as
 *     two people, never one (the board's named risk, resolved
 *     conservatively).
 *
 * WHAT COUNTS AS SPEND (the loader filters; the builder only sums
 * what it is handed):
 *   - store_orders / digital_sales: status 'completed' only (a
 *     'refunded' row is clawed back — it is not spend).
 *   - shop_events: event_type 'sale' rows owned by the creator (the
 *     row only becomes 'sale' through the paid flip; the buyer is the
 *     row's buyer_email — user_id on shop_events is the SHOP OWNER).
 *   - live_shop_sales: status 'paid' only ('test' rows are demo
 *     sales — no money moved, per the schema's own contract).
 *   - fan_members: price_cents counts only when the row carries a
 *     stripe_session_id (a verified checkout join) and its status is
 *     not 'refunded' — manual tracking rows never invent spend.
 *   - world_stage_tips: rows whose credit actually landed
 *     (creator_credited_at set) — a standing-but-uncredited row is an
 *     in-flight transfer, not spend yet.
 *   - tip_jar_tips is deliberately NOT a source: it records only a
 *     free-form fan name — no account id, no email — so no tip there
 *     can be attributed to a fan without guessing.
 *   - Sales with no buyer identity at all (store_orders with a null
 *     buyer_user_id, shop sales with no buyer_email, live sales with
 *     a null buyer_user_id) cannot attach to any fan and are skipped.
 *
 * SCOPING: every loader query is filtered by the requesting creator
 * (their profile ids, their list ids, or their user id). A creator
 * sees their own fans only — there is no cross-creator read path.
 */
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import {
  db,
  creatorProfilesTable,
  digitalSalesTable,
  emailListsTable,
  emailSubscribersTable,
  fanMembersTable,
  fanTiersTable,
  followsTable,
  liveShopSalesTable,
  shopEventsTable,
  storeOrdersTable,
  worldStageTipsTable,
} from "@workspace/db";

/* ─── Source row shapes (the loader projects rows into these) ────── */

export interface FanGraphSubscriberRow {
  email: string;
  name: string | null;
  subscribedAt: Date;
  unsubscribedAt: Date | null;
}

export interface FanGraphMemberRow {
  fanLabel: string;
  fanUserId: string | null;
  tierName: string | null;
  status: string;
  priceCents: number;
  /** True when the row carries a Stripe checkout session id — the
      schema's proof a real paid join stands behind price_cents. */
  hasPaidCheckout: boolean;
  joinedAt: Date;
  updatedAt: Date;
}

export interface FanGraphFollowRow {
  followerUserId: string;
  createdAt: Date;
}

export interface FanGraphUsdSaleRow {
  buyerUserId: string | null;
  amountCents: number;
  createdAt: Date;
}

export interface FanGraphShopSaleRow {
  buyerEmail: string | null;
  amountCents: number;
  createdAt: Date;
}

export interface FanGraphTipRow {
  fromUserId: string;
  amountVb: number;
  createdAt: Date;
}

export interface FanGraphProfileCard {
  displayName: string;
  slug: string;
  avatarUrl: string | null;
}

export interface FanGraphSources {
  subscribers: FanGraphSubscriberRow[];
  members: FanGraphMemberRow[];
  follows: FanGraphFollowRow[];
  storeOrders: FanGraphUsdSaleRow[];
  digitalSales: FanGraphUsdSaleRow[];
  shopSales: FanGraphShopSaleRow[];
  liveSales: FanGraphUsdSaleRow[];
  tips: FanGraphTipRow[];
  /** Display cards for account fans who own a creator profile. */
  profileCards: Map<string, FanGraphProfileCard>;
}

/* ─── The merged record ───────────────────────────────────────────── */

export type FanSourceKind =
  | "follow"
  | "subscriber"
  | "member"
  | "store"
  | "digital"
  | "shop"
  | "live"
  | "tips";

export interface FanMemberInfo {
  tierName: string | null;
  status: string;
  joinedAt: string;
}

export interface FanRecord {
  /** Stable graph id: `u:<userId>` when the fan has an account node,
      else `e:<email>`, else `l:<label>`. */
  id: string;
  userId: string | null;
  /** Every email the merge proved belongs to this fan (usually one). */
  emails: string[];
  email: string | null;
  displayName: string | null;
  profileSlug: string | null;
  avatarUrl: string | null;
  follows: boolean;
  followingSince: string | null;
  /** True when an ACTIVE (not unsubscribed) subscription stands. */
  subscribed: boolean;
  unsubscribed: boolean;
  member: FanMemberInfo | null;
  spentUsdCents: number;
  spentVb: number;
  purchaseCount: number;
  lastActivityAt: string | null;
  sources: FanSourceKind[];
}

export interface FanGraphSummary {
  totalFans: number;
  followers: number;
  subscribers: number;
  members: number;
  buyers: number;
  totalSpentUsdCents: number;
  totalSpentVb: number;
}

/* ─── Identity merge ──────────────────────────────────────────────── */

const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isEmailShaped(raw: string): boolean {
  return EMAIL_SHAPE.test(raw.trim());
}

class DisjointSet {
  private parent = new Map<string, string>();
  find(x: string): string {
    let root = x;
    while (this.parent.get(root) !== undefined && this.parent.get(root) !== root) {
      root = this.parent.get(root)!;
    }
    let cur = x;
    while (this.parent.get(cur) !== undefined && this.parent.get(cur) !== cur) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }
  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(rb, ra);
  }
  key(x: string) {
    if (!this.parent.has(x)) this.parent.set(x, x);
    return x;
  }
}

interface FanAcc {
  userId: string | null;
  emails: Set<string>;
  labels: Set<string>;
  subscriberEmails: Set<string>;
  follows: boolean;
  followingSince: Date | null;
  subscribed: boolean;
  unsubscribed: boolean;
  subscriberName: string | null;
  member: { tierName: string | null; status: string; joinedAt: Date; rank: number } | null;
  spentUsdCents: number;
  spentVb: number;
  purchaseCount: number;
  lastActivityAt: Date | null;
  sources: Set<FanSourceKind>;
}

function newAcc(): FanAcc {
  return {
    userId: null,
    emails: new Set(),
    labels: new Set(),
    subscriberEmails: new Set(),
    follows: false,
    followingSince: null,
    subscribed: false,
    unsubscribed: false,
    subscriberName: null,
    member: null,
    spentUsdCents: 0,
    spentVb: 0,
    purchaseCount: 0,
    lastActivityAt: null,
    sources: new Set(),
  };
}

/** Higher rank wins when a fan holds several membership rows: a live
    membership describes the fan; a dead one is history. */
function memberStatusRank(status: string): number {
  switch (status) {
    case "active":
    case "trialing":
      return 3;
    case "past_due":
      return 2;
    default:
      return 1; // canceled / expired / refunded
  }
}

function touch(acc: FanAcc, at: Date) {
  if (!acc.lastActivityAt || at > acc.lastActivityAt) acc.lastActivityAt = at;
}

export function buildFanGraph(sources: FanGraphSources): { fans: FanRecord[]; summary: FanGraphSummary } {
  const dsu = new DisjointSet();
  const userKey = (id: string) => dsu.key(`u:${id}`);
  const emailKey = (email: string) => dsu.key(`e:${email}`);
  const labelKey = (label: string) => dsu.key(`l:${label}`);

  /* Pass 1 — declare every identity key and apply the ONLY bridge:
     a fan_members row carrying both an account id and an
     email-shaped label unions the account node with the email node. */
  for (const s of sources.subscribers) emailKey(normalizeEmail(s.email));
  for (const f of sources.follows) userKey(f.followerUserId);
  for (const m of sources.members) {
    const label = m.fanLabel.trim();
    if (m.fanUserId) userKey(m.fanUserId);
    if (isEmailShaped(label)) emailKey(normalizeEmail(label));
    else if (!m.fanUserId) labelKey(label.toLowerCase());
    if (m.fanUserId && isEmailShaped(label)) {
      dsu.union(userKey(m.fanUserId), emailKey(normalizeEmail(label)));
    }
  }
  for (const o of sources.storeOrders) if (o.buyerUserId) userKey(o.buyerUserId);
  for (const o of sources.digitalSales) if (o.buyerUserId) userKey(o.buyerUserId);
  for (const o of sources.liveSales) if (o.buyerUserId) userKey(o.buyerUserId);
  for (const s of sources.shopSales) if (s.buyerEmail) emailKey(normalizeEmail(s.buyerEmail));
  for (const t of sources.tips) userKey(t.fromUserId);

  /* Pass 2 — apply every sighting to its merged accumulator. */
  const accs = new Map<string, FanAcc>();
  const accFor = (key: string): FanAcc => {
    const root = dsu.find(key);
    let acc = accs.get(root);
    if (!acc) {
      acc = newAcc();
      accs.set(root, acc);
    }
    return acc;
  };

  for (const s of sources.subscribers) {
    const email = normalizeEmail(s.email);
    const acc = accFor(emailKey(email));
    acc.emails.add(email);
    acc.subscriberEmails.add(email);
    if (s.unsubscribedAt) acc.unsubscribed = true;
    else acc.subscribed = true;
    if (s.name && !acc.subscriberName) acc.subscriberName = s.name;
    acc.sources.add("subscriber");
    touch(acc, s.subscribedAt);
    if (s.unsubscribedAt) touch(acc, s.unsubscribedAt);
  }

  for (const f of sources.follows) {
    const acc = accFor(userKey(f.followerUserId));
    acc.userId = f.followerUserId;
    acc.follows = true;
    if (!acc.followingSince || f.createdAt < acc.followingSince) acc.followingSince = f.createdAt;
    acc.sources.add("follow");
    touch(acc, f.createdAt);
  }

  for (const m of sources.members) {
    const label = m.fanLabel.trim();
    const key = m.fanUserId
      ? userKey(m.fanUserId)
      : isEmailShaped(label)
        ? emailKey(normalizeEmail(label))
        : labelKey(label.toLowerCase());
    const acc = accFor(key);
    if (m.fanUserId) acc.userId = m.fanUserId;
    if (isEmailShaped(label)) acc.emails.add(normalizeEmail(label));
    else acc.labels.add(label);
    const rank = memberStatusRank(m.status);
    if (
      !acc.member ||
      rank > acc.member.rank ||
      (rank === acc.member.rank && m.joinedAt > acc.member.joinedAt)
    ) {
      acc.member = { tierName: m.tierName, status: m.status, joinedAt: m.joinedAt, rank };
    }
    if (m.hasPaidCheckout && m.status !== "refunded") {
      acc.spentUsdCents += m.priceCents;
      acc.purchaseCount += 1;
    }
    acc.sources.add("member");
    touch(acc, m.updatedAt);
  }

  const applyUsdSale = (key: string, o: FanGraphUsdSaleRow, kind: FanSourceKind) => {
    const acc = accFor(key);
    if (o.buyerUserId) acc.userId = o.buyerUserId;
    acc.spentUsdCents += o.amountCents;
    acc.purchaseCount += 1;
    acc.sources.add(kind);
    touch(acc, o.createdAt);
  };
  for (const o of sources.storeOrders) if (o.buyerUserId) applyUsdSale(userKey(o.buyerUserId), o, "store");
  for (const o of sources.digitalSales) if (o.buyerUserId) applyUsdSale(userKey(o.buyerUserId), o, "digital");
  for (const o of sources.liveSales) if (o.buyerUserId) applyUsdSale(userKey(o.buyerUserId), o, "live");
  for (const s of sources.shopSales) {
    if (!s.buyerEmail) continue;
    const acc = accFor(emailKey(normalizeEmail(s.buyerEmail)));
    acc.emails.add(normalizeEmail(s.buyerEmail));
    acc.spentUsdCents += s.amountCents;
    acc.purchaseCount += 1;
    acc.sources.add("shop");
    touch(acc, s.createdAt);
  }
  for (const t of sources.tips) {
    const acc = accFor(userKey(t.fromUserId));
    acc.userId = t.fromUserId;
    acc.spentVb += t.amountVb;
    acc.purchaseCount += 1;
    acc.sources.add("tips");
    touch(acc, t.createdAt);
  }

  /* Pass 3 — materialize records. */
  const fans: FanRecord[] = [];
  for (const acc of accs.values()) {
    const emails = [...acc.emails].sort((a, b) => {
      const as = acc.subscriberEmails.has(a) ? 0 : 1;
      const bs = acc.subscriberEmails.has(b) ? 0 : 1;
      return as - bs || a.localeCompare(b);
    });
    const card = acc.userId ? sources.profileCards.get(acc.userId) : undefined;
    const label = [...acc.labels][0] ?? null;
    fans.push({
      id: acc.userId ? `u:${acc.userId}` : emails[0] ? `e:${emails[0]}` : `l:${[...acc.labels][0]?.toLowerCase() ?? "unknown"}`,
      userId: acc.userId,
      emails,
      email: emails[0] ?? null,
      displayName: card?.displayName ?? acc.subscriberName ?? label,
      profileSlug: card?.slug ?? null,
      avatarUrl: card?.avatarUrl ?? null,
      follows: acc.follows,
      followingSince: acc.followingSince ? acc.followingSince.toISOString() : null,
      subscribed: acc.subscribed,
      unsubscribed: acc.unsubscribed && !acc.subscribed,
      member: acc.member
        ? { tierName: acc.member.tierName, status: acc.member.status, joinedAt: acc.member.joinedAt.toISOString() }
        : null,
      spentUsdCents: acc.spentUsdCents,
      spentVb: acc.spentVb,
      purchaseCount: acc.purchaseCount,
      lastActivityAt: acc.lastActivityAt ? acc.lastActivityAt.toISOString() : null,
      sources: [...acc.sources],
    });
  }

  const summary: FanGraphSummary = {
    totalFans: fans.length,
    followers: fans.filter((f) => f.follows).length,
    subscribers: fans.filter((f) => f.subscribed).length,
    members: fans.filter((f) => f.member && (f.member.status === "active" || f.member.status === "trialing")).length,
    buyers: fans.filter((f) => f.purchaseCount > 0).length,
    totalSpentUsdCents: fans.reduce((n, f) => n + f.spentUsdCents, 0),
    totalSpentVb: fans.reduce((n, f) => n + f.spentVb, 0),
  };
  return { fans, summary };
}

/* ─── Search / sort / paginate (pure) ─────────────────────────────── */

export type FanGraphSort = "recent" | "spent" | "name";
export const FAN_GRAPH_SORTS: readonly FanGraphSort[] = ["recent", "spent", "name"];

export interface FanGraphQuery {
  search?: string;
  sort?: FanGraphSort;
  page?: number;
  pageSize?: number;
}

export function queryFanGraph(
  fans: FanRecord[],
  q: FanGraphQuery,
): { fans: FanRecord[]; total: number; page: number; pageSize: number } {
  const needle = (q.search ?? "").trim().toLowerCase();
  const filtered = needle
    ? fans.filter((f) =>
        [f.displayName ?? "", f.email ?? "", f.profileSlug ?? "", ...f.emails]
          .join("\n")
          .toLowerCase()
          .includes(needle),
      )
    : [...fans];

  const byName = (a: FanRecord, b: FanRecord) =>
    (a.displayName ?? a.email ?? a.id).localeCompare(b.displayName ?? b.email ?? b.id);
  const byRecent = (a: FanRecord, b: FanRecord) =>
    (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? "") || byName(a, b);
  switch (q.sort ?? "recent") {
    case "spent":
      filtered.sort(
        (a, b) => b.spentUsdCents - a.spentUsdCents || b.spentVb - a.spentVb || byRecent(a, b),
      );
      break;
    case "name":
      filtered.sort(byName);
      break;
    default:
      filtered.sort(byRecent);
  }

  const pageSize = Math.min(100, Math.max(1, Math.floor(q.pageSize ?? 25)));
  const total = filtered.length;
  const page = Math.min(Math.max(1, Math.floor(q.page ?? 1)), Math.max(1, Math.ceil(total / pageSize)));
  return { fans: filtered.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize };
}

/* ─── Loader (every query scoped to the requesting creator) ─────── */

export async function loadFanGraph(
  creatorUserId: string,
): Promise<{ fans: FanRecord[]; summary: FanGraphSummary }> {
  const myProfiles = await db
    .select({ id: creatorProfilesTable.id })
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.userId, creatorUserId));
  const profileIds = myProfiles.map((p) => p.id);

  const myLists = await db
    .select({ id: emailListsTable.id })
    .from(emailListsTable)
    .where(eq(emailListsTable.userId, creatorUserId));
  const listIds = myLists.map((l) => l.id);

  const subscriberRows = listIds.length
    ? await db
        .select({
          email: emailSubscribersTable.email,
          name: emailSubscribersTable.name,
          subscribedAt: emailSubscribersTable.subscribedAt,
          unsubscribedAt: emailSubscribersTable.unsubscribedAt,
        })
        .from(emailSubscribersTable)
        .where(inArray(emailSubscribersTable.listId, listIds))
    : [];

  const followRows = profileIds.length
    ? await db
        .select({ followerUserId: followsTable.followerUserId, createdAt: followsTable.createdAt })
        .from(followsTable)
        .where(inArray(followsTable.profileId, profileIds))
    : [];

  const memberRows = await db
    .select({
      fanLabel: fanMembersTable.fan_label,
      fanUserId: fanMembersTable.fan_user_id,
      tierId: fanMembersTable.tier_id,
      status: fanMembersTable.status,
      priceCents: fanMembersTable.price_cents,
      stripeSessionId: fanMembersTable.stripe_session_id,
      joinedAt: fanMembersTable.joined_at,
      updatedAt: fanMembersTable.updated_at,
    })
    .from(fanMembersTable)
    .where(eq(fanMembersTable.user_id, creatorUserId));

  const tierIds = [...new Set(memberRows.map((m) => m.tierId))];
  const tierRows = tierIds.length
    ? await db
        .select({ id: fanTiersTable.id, name: fanTiersTable.name })
        .from(fanTiersTable)
        .where(inArray(fanTiersTable.id, tierIds))
    : [];
  const tierName = new Map(tierRows.map((t) => [t.id, t.name]));

  const storeOrderRows = profileIds.length
    ? await db
        .select({
          buyerUserId: storeOrdersTable.buyerUserId,
          amountCents: storeOrdersTable.amountCents,
          createdAt: storeOrdersTable.createdAt,
        })
        .from(storeOrdersTable)
        .where(and(inArray(storeOrdersTable.profileId, profileIds), eq(storeOrdersTable.status, "completed")))
    : [];

  const digitalSaleRows = profileIds.length
    ? await db
        .select({
          buyerUserId: digitalSalesTable.buyerUserId,
          amountCents: digitalSalesTable.amountCents,
          createdAt: digitalSalesTable.createdAt,
        })
        .from(digitalSalesTable)
        .where(and(inArray(digitalSalesTable.profileId, profileIds), eq(digitalSalesTable.status, "completed")))
    : [];

  const shopSaleRows = await db
    .select({
      buyerEmail: shopEventsTable.buyer_email,
      amountCents: shopEventsTable.amount_cents,
      createdAt: shopEventsTable.created_at,
    })
    .from(shopEventsTable)
    .where(and(eq(shopEventsTable.user_id, creatorUserId), eq(shopEventsTable.event_type, "sale")));

  const liveSaleRows = await db
    .select({
      buyerUserId: liveShopSalesTable.buyer_user_id,
      amountCents: liveShopSalesTable.price_cents,
      createdAt: liveShopSalesTable.created_at,
    })
    .from(liveShopSalesTable)
    .where(and(eq(liveShopSalesTable.user_id, creatorUserId), eq(liveShopSalesTable.status, "paid")));

  const tipRows = await db
    .select({
      fromUserId: worldStageTipsTable.fromUserId,
      amountVb: worldStageTipsTable.amountVb,
      createdAt: worldStageTipsTable.createdAt,
    })
    .from(worldStageTipsTable)
    .where(and(eq(worldStageTipsTable.toUserId, creatorUserId), isNotNull(worldStageTipsTable.creatorCreditedAt)));

  /* Display cards for the account fans this graph actually contains. */
  const fanUserIds = new Set<string>();
  for (const f of followRows) fanUserIds.add(f.followerUserId);
  for (const m of memberRows) if (m.fanUserId) fanUserIds.add(m.fanUserId);
  for (const o of storeOrderRows) if (o.buyerUserId) fanUserIds.add(o.buyerUserId);
  for (const o of digitalSaleRows) fanUserIds.add(o.buyerUserId);
  for (const o of liveSaleRows) if (o.buyerUserId) fanUserIds.add(o.buyerUserId);
  for (const t of tipRows) fanUserIds.add(t.fromUserId);

  const profileCards = new Map<string, FanGraphProfileCard>();
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
    for (const c of cards) {
      profileCards.set(c.userId, { displayName: c.displayName, slug: c.slug, avatarUrl: c.avatarUrl });
    }
  }

  return buildFanGraph({
    subscribers: subscriberRows,
    members: memberRows.map((m) => ({
      fanLabel: m.fanLabel,
      fanUserId: m.fanUserId,
      tierName: tierName.get(m.tierId) ?? null,
      status: m.status,
      priceCents: m.priceCents,
      hasPaidCheckout: m.stripeSessionId != null,
      joinedAt: m.joinedAt,
      updatedAt: m.updatedAt,
    })),
    follows: followRows,
    storeOrders: storeOrderRows,
    digitalSales: digitalSaleRows,
    shopSales: shopSaleRows,
    liveSales: liveSaleRows,
    tips: tipRows,
    profileCards,
  });
}
