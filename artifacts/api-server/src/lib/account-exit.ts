/**
 * account-exit.ts — the honest way out (stack1000 lane R2).
 *
 * The DELETE /api/account route used to delete only the Supabase profile
 * row + the auth user. Everything the member actually made or sold lives
 * in the app database (Render Postgres behind DATABASE_URL — see
 * lib/credits.ts: "behind DATABASE_URL has no profiles table"), so the
 * old flow left the shop sellable, the beats buyable, the API keys live
 * and every escrow exactly where it was, while Settings told the member
 * "This permanently deletes your account, projects, and data."
 *
 * This module is the missing machinery, in the order the route runs it:
 *
 *  1. findAccountExitBlockers — money OTHER people have in flight with
 *     this member (funded escrows, paid fan-club time still owed, live
 *     gift-card balances they sold). While any of it is open, deletion
 *     is refused with plain sentences naming what has to settle first.
 *     Deleting through an open escrow would strand the counterparty's
 *     money with nobody left who can release or refund it.
 *  2. cancelOwnCreatorPlan — the member's own Pro/Elite subscription is
 *     cancelled at Stripe IMMEDIATELY, so a deleted account is never
 *     billed again. If Stripe refuses, the whole deletion aborts before
 *     anything is deleted.
 *  3. revokeAccountSessions — developer API keys are revoked and the
 *     stream-overlay token is deleted. (Bearer tokens die with the
 *     Supabase auth user itself: requireAuth validates every token via
 *     auth.getUser, which a deleted user can never pass. API keys
 *     resolve from api_keys alone — lib/api-keys.ts never consults the
 *     auth user — so without this step they would outlive the account.)
 *  4. eraseAccountData — the member's own content and identity rows in
 *     the app database. Transaction records (orders, sales, escrow
 *     ledgers, payouts, the credit ledger) are NOT erased: they are the
 *     counterparty's records too, and the Settings copy says so.
 */
import { and, eq, gt, inArray, isNotNull, isNull, or } from "drizzle-orm";
import {
  db,
  albumsTable,
  apiKeysTable,
  artistCharacterLinksTable,
  artistOutfitsTable,
  artistVaultIdentityPhotosTable,
  artistVaultsTable,
  beatLicenseTemplatesTable,
  beatsTable,
  bioPagesTable,
  creatorOverlayTokensTable,
  creatorProfilesTable,
  creatorSubscriptionsTable,
  djCrateItemsTable,
  fanMembersTable,
  fanTiersTable,
  featureVerseListingsTable,
  featureVerseOrdersTable,
  followsTable,
  generatedClipsTable,
  giftCardsTable,
  hubProjectsTable,
  performanceBookingsTable,
  projectDraftsTable,
  shopProductsTable,
  songDjAnalysisTable,
  songsTable,
  sponsorDealsTable,
} from "@workspace/db";
import { createGuardedStripeClient } from "./stripe-client";
import { logger } from "./logger";

/* ─── 1. Money-in-flight blockers ─────────────────────────────────────── */

/** Sponsor-deal / performance-booking escrow states where real money is
 *  being held between the two parties (the sponsors.ts state machine:
 *  unfunded → funding → funded → released / refunded). */
const ESCROW_OPEN_STATES = ["funding", "funded"] as const;

/** Fan-club states where a fan has paid time still owed to them. Trialing
 *  is unpaid; canceled / expired / refunded owe nothing. */
const FAN_TIME_OWED_STATES = ["active", "past_due", "paused"] as const;

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/**
 * Plain sentences naming every pot of someone else's money that deleting
 * this account right now would strand. Empty array = nothing in flight.
 */
export async function findAccountExitBlockers(userId: string): Promise<string[]> {
  const blockers: string[] = [];

  // posted_by / accepted_user_id, artist/promoter, creator/buyer are
  // two-sided columns (text ids on the older rails, uuid on the newer):
  // each probe matches the member on EITHER side of the deal.
  const [sponsorDeals, bookings, verseOrders, fanMembers, profile] = await Promise.all([
    db
      .select({ id: sponsorDealsTable.id })
      .from(sponsorDealsTable)
      .where(
        and(
          inArray(sponsorDealsTable.escrowStatus, [...ESCROW_OPEN_STATES]),
          or(
            eq(sponsorDealsTable.postedBy, userId),
            eq(sponsorDealsTable.acceptedUserId, userId),
          ),
        ),
      ),
    db
      .select({ id: performanceBookingsTable.id })
      .from(performanceBookingsTable)
      .where(
        and(
          inArray(performanceBookingsTable.escrowStatus, [...ESCROW_OPEN_STATES]),
          or(
            eq(performanceBookingsTable.artistUserId, userId),
            eq(performanceBookingsTable.promoterUserId, userId),
          ),
        ),
      ),
    db
      .select({ id: featureVerseOrdersTable.id })
      .from(featureVerseOrdersTable)
      .where(
        and(
          eq(featureVerseOrdersTable.escrowStatus, "held"),
          or(
            eq(featureVerseOrdersTable.creatorUserId, userId),
            eq(featureVerseOrdersTable.buyerUserId, userId),
          ),
        ),
      ),
    db
      .select({ id: fanMembersTable.id })
      .from(fanMembersTable)
      .where(
        and(
          eq(fanMembersTable.user_id, userId),
          inArray(fanMembersTable.status, [...FAN_TIME_OWED_STATES]),
          isNotNull(fanMembersTable.fan_user_id),
        ),
      ),
    db
      .select({ id: creatorProfilesTable.id })
      .from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.userId, userId))
      .limit(1),
  ]);

  if (sponsorDeals.length > 0) {
    blockers.push(
      `You still have ${sponsorDeals.length} sponsor ${plural(sponsorDeals.length, "deal", "deals")} with money held in escrow. That money has to be released or refunded before your account can be deleted.`,
    );
  }
  if (bookings.length > 0) {
    blockers.push(
      `You still have ${bookings.length} performance ${plural(bookings.length, "booking", "bookings")} with money held in escrow. The ${plural(bookings.length, "booking has", "bookings have")} to be finished, released or refunded first.`,
    );
  }
  if (verseOrders.length > 0) {
    blockers.push(
      `You still have ${verseOrders.length} feature verse ${plural(verseOrders.length, "order", "orders")} with Visual Bucs held in escrow. The ${plural(verseOrders.length, "order has", "orders have")} to be delivered or refunded first.`,
    );
  }
  if (fanMembers.length > 0) {
    blockers.push(
      `Fans still have paid time left in your fan club (${fanMembers.length} ${plural(fanMembers.length, "member", "members")}). Your account can be deleted when their paid time has run out or their memberships have ended.`,
    );
  }

  /* Gift cards this creator SOLD that still hold a fan's money. The
   * guard is load-bearing, not decorative: gift_cards.profile_id points
   * at creator_profiles with ON DELETE CASCADE, so erasing the profile
   * (step 4) would take live cards — and their balances — with it. */
  const profileId = profile[0]?.id;
  if (profileId) {
    const liveCards = await db
      .select({ id: giftCardsTable.id })
      .from(giftCardsTable)
      .where(
        and(
          eq(giftCardsTable.profileId, profileId),
          eq(giftCardsTable.status, "active"),
          gt(giftCardsTable.balanceCents, 0),
        ),
      );
    if (liveCards.length > 0) {
      blockers.push(
        `Gift cards you sold still have money on them (${liveCards.length} ${plural(liveCards.length, "card", "cards")}). Those balances have to be spent or refunded before your account can be deleted.`,
      );
    }
  }

  return blockers;
}

/* ─── 2. The member's own plan ────────────────────────────────────────── */

const LIVE_SUBSCRIPTION_STATES = ["active", "trialing", "past_due"] as const;

/**
 * Cancel the member's own creator-plan subscription at Stripe, right now
 * — not at period end: after deletion there is no account left to sign
 * in and cancel with, so anything short of an immediate cancel bills a
 * ghost. Throws when Stripe refuses, so the route can abort the whole
 * deletion with nothing deleted. Idempotent: no profile, no row, an
 * already-canceled row, or a row with no Stripe subscription id are all
 * honest no-ops.
 */
export async function cancelOwnCreatorPlan(userId: string): Promise<void> {
  const [profile] = await db
    .select({ id: creatorProfilesTable.id })
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.userId, userId))
    .limit(1);
  if (!profile) return;

  const [sub] = await db
    .select()
    .from(creatorSubscriptionsTable)
    .where(eq(creatorSubscriptionsTable.profileId, profile.id))
    .limit(1);
  if (!sub) return;
  if (!(LIVE_SUBSCRIPTION_STATES as readonly string[]).includes(sub.status)) return;

  if (sub.stripeSubscriptionId) {
    const stripe = createGuardedStripeClient();
    await stripe.subscriptions.cancel(sub.stripeSubscriptionId);
  }
  await db
    .update(creatorSubscriptionsTable)
    .set({ status: "canceled", cancelAtPeriodEnd: null, updatedAt: new Date() })
    .where(eq(creatorSubscriptionsTable.id, sub.id));
  logger.info({ userId }, "account-exit: own creator plan cancelled ahead of deletion");
}

/* ─── 3. Session death ────────────────────────────────────────────────── */

/**
 * Kill every credential that resolves without the Supabase auth user:
 * developer API keys (revoked in place — resolveApiKey checks
 * revoked_at on every request, and the row stays as the audit trail)
 * and the stream-overlay token (row deleted — the token stops
 * resolving the moment the row is gone, the same semantics as a
 * reset). Bearer access tokens need no step here: the auth-user
 * deletion at the end of the route kills them, because requireAuth
 * validates each one against Supabase Auth itself.
 */
export async function revokeAccountSessions(userId: string): Promise<void> {
  await db
    .update(apiKeysTable)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeysTable.userId, userId), isNull(apiKeysTable.revokedAt)));
  await db
    .delete(creatorOverlayTokensTable)
    .where(eq(creatorOverlayTokensTable.userId, userId));
}

/* ─── 4. Erasure ──────────────────────────────────────────────────────── */

/**
 * Delete the member's own content and identity rows from the app
 * database, in one transaction. The creator_profiles row goes LAST:
 * the schema hangs the whole public creator surface off it with
 * ON DELETE CASCADE (posts, stories, playlists, store products,
 * profile tracks and videos, follows TO the profile, custom domains,
 * the subscription row and receipts), so deleting it is what actually
 * takes the member's public presence down.
 *
 * Deliberately NOT deleted (transaction records — the counterparty's
 * history as much as the member's, and the Settings copy says we keep
 * them): store_orders, shop order/delivery/event rows, digital_sales,
 * sponsor deals and payouts in terminal states, feature-verse orders
 * and their escrow ledger in terminal states, performance bookings in
 * terminal states, creator_payouts, invoices, credit_usage, gift cards
 * the member BOUGHT (the card belongs to whoever holds it now),
 * beat_licenses already sold (terms are snapshotted onto the license),
 * and fan_members rows in terminal states.
 *
 * The shop keeps its row and its records; its products are paused,
 * which is the shop system's own "not buyable" state (buyers only ever
 * see 'active' rows) — a deleted seller takes no new orders.
 */
export async function eraseAccountData(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [profile] = await tx
      .select({ id: creatorProfilesTable.id })
      .from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.userId, userId))
      .limit(1);

    /* Artist vaults and everything keyed off them / the user. */
    const vaults = await tx
      .select({ id: artistVaultsTable.id })
      .from(artistVaultsTable)
      .where(eq(artistVaultsTable.user_id, userId));
    if (vaults.length > 0) {
      await tx
        .delete(artistOutfitsTable)
        .where(inArray(artistOutfitsTable.vault_id, vaults.map((v) => v.id)));
    }
    await tx.delete(artistVaultIdentityPhotosTable).where(eq(artistVaultIdentityPhotosTable.user_id, userId));
    await tx.delete(artistCharacterLinksTable).where(eq(artistCharacterLinksTable.user_id, userId));
    await tx.delete(artistVaultsTable).where(eq(artistVaultsTable.user_id, userId));

    /* Songs: two tables point at songs with NO ACTION foreign keys
     * (song_dj_analysis, dj_crate_items — a crate item naming a song
     * that no longer exists is meaningless), so their rows for this
     * member's songs go first. Album tracks cascade from both parents. */
    const songs = await tx
      .select({ id: songsTable.id })
      .from(songsTable)
      .where(eq(songsTable.user_id, userId));
    if (songs.length > 0) {
      const songIds = songs.map((s) => s.id);
      await tx.delete(songDjAnalysisTable).where(inArray(songDjAnalysisTable.song_id, songIds));
      await tx.delete(djCrateItemsTable).where(inArray(djCrateItemsTable.song_id, songIds));
    }
    await tx.delete(albumsTable).where(eq(albumsTable.user_id, userId));
    await tx.delete(songsTable).where(eq(songsTable.user_id, userId));

    /* Creations and working state. */
    await tx.delete(projectDraftsTable).where(eq(projectDraftsTable.user_id, userId));
    await tx.delete(generatedClipsTable).where(eq(generatedClipsTable.user_id, userId));
    await tx.delete(hubProjectsTable).where(eq(hubProjectsTable.user_id, userId));

    /* Sellable listings come down: beats (sold licenses survive — their
     * terms are snapshotted), the feature-verse listing, fan-club tiers
     * (member rows are records and stay), and every shop product is
     * paused so the shop sells nothing new. */
    await tx.delete(beatsTable).where(eq(beatsTable.user_id, userId));
    await tx.delete(beatLicenseTemplatesTable).where(eq(beatLicenseTemplatesTable.producer_id, userId));
    await tx.delete(featureVerseListingsTable).where(eq(featureVerseListingsTable.creatorUserId, userId));
    await tx.delete(fanTiersTable).where(eq(fanTiersTable.user_id, userId));
    await tx
      .update(shopProductsTable)
      .set({ status: "paused" })
      .where(eq(shopProductsTable.user_id, userId));
    await tx.delete(bioPagesTable).where(eq(bioPagesTable.userId, userId));

    /* Follows BY this member (follows TO their profile cascade with it). */
    await tx.delete(followsTable).where(eq(followsTable.followerUserId, userId));

    /* The public creator identity — last, so its cascades take the
     * whole public surface (posts, stories, playlists, store, tracks,
     * videos, domains) in one step. */
    if (profile) {
      await tx.delete(creatorProfilesTable).where(eq(creatorProfilesTable.id, profile.id));
    }
  });
  logger.info({ userId }, "account-exit: app-database erasure complete");
}
