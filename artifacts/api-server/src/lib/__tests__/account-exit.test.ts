/**
 * Account exit truth (stack1000 lane R2) — lib/account-exit.ts over
 * pg-mem with DDL mirroring the real schema's columns + the two
 * foreign-key cascades the design leans on (creator_profiles children,
 * gift_cards → creator_profiles).
 *
 * Pins:
 *  - blockers fire for every pot of someone else's money in flight
 *    (funded sponsor escrow on EITHER side, funded booking escrow,
 *    held feature-verse escrow, paid fan time still owed, live
 *    gift-card balances the member sold) and stay silent for every
 *    terminal / unpaid / someone-else's state;
 *  - the member's own plan is cancelled at Stripe immediately, and a
 *    Stripe refusal propagates (the route aborts the exit on it);
 *  - API keys are revoked in place and the overlay token row is gone;
 *  - erasure removes the member's content + public presence (the
 *    creator-profile cascade takes posts / store products with it),
 *    pauses the shop's products, and leaves every transaction record
 *    standing.
 *
 * Harness note: the pg-mem client shim cannot hold a real transaction
 * session, so rollback atomicity of eraseAccountData is NOT provable
 * here — production runs the same code on a real pg Pool, where
 * db.transaction has its ordinary semantics. What is proven here is
 * the full delete set and its effects.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "crypto";

const h = vi.hoisted(() => ({
  db: null as any,
  stripeCancel: null as any,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return h.db; } };
});

vi.mock("../stripe-client", () => ({
  createGuardedStripeClient: () => ({
    subscriptions: { cancel: (id: string) => h.stripeCancel(id) },
  }),
}));

import {
  findAccountExitBlockers,
  cancelOwnCreatorPlan,
  revokeAccountSessions,
  eraseAccountData,
} from "../account-exit";
import { createTestDb } from "./test-db";

const DDL = `
CREATE TABLE creator_profiles (id uuid PRIMARY KEY, user_id uuid NOT NULL, slug text, display_name text, follower_count integer NOT NULL DEFAULT 0);
CREATE TABLE creator_subscriptions (
  id uuid PRIMARY KEY, profile_id uuid NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  tier text NOT NULL DEFAULT 'free', status text NOT NULL DEFAULT 'active',
  stripe_subscription_id text, stripe_customer_id text,
  current_period_end timestamptz, cancel_at_period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE store_products (id uuid PRIMARY KEY, profile_id uuid NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE);
CREATE TABLE posts (id uuid PRIMARY KEY, profile_id uuid NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE);
CREATE TABLE follows (follower_user_id uuid NOT NULL, profile_id uuid NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE playlists (id uuid PRIMARY KEY, profile_id uuid NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE, follower_count integer NOT NULL DEFAULT 0);
CREATE TABLE playlist_follows (user_id uuid NOT NULL, playlist_id uuid NOT NULL REFERENCES playlists(id) ON DELETE CASCADE, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE gift_cards (
  id uuid PRIMARY KEY, profile_id uuid NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  buyer_user_id uuid, status text NOT NULL DEFAULT 'active', balance_cents integer NOT NULL DEFAULT 0);
CREATE TABLE sponsor_deals (id uuid PRIMARY KEY, posted_by text NOT NULL, accepted_user_id text, status text NOT NULL DEFAULT 'active', escrow_status text NOT NULL DEFAULT 'unfunded');
CREATE TABLE performance_bookings (id uuid PRIMARY KEY, artist_user_id text NOT NULL, promoter_user_id text NOT NULL, status text NOT NULL DEFAULT 'proposed', escrow_status text NOT NULL DEFAULT 'unfunded');
CREATE TABLE feature_verse_orders (id uuid PRIMARY KEY, buyer_user_id uuid NOT NULL, creator_user_id uuid NOT NULL, status text NOT NULL DEFAULT 'terms_proposed', escrow_status text NOT NULL DEFAULT 'none');
CREATE TABLE feature_verse_listings (id uuid PRIMARY KEY, creator_user_id uuid NOT NULL);
CREATE TABLE fan_tiers (id uuid PRIMARY KEY, user_id uuid NOT NULL);
CREATE TABLE fan_members (id uuid PRIMARY KEY, user_id uuid NOT NULL, fan_user_id uuid, tier_id uuid NOT NULL, status text NOT NULL DEFAULT 'active');
CREATE TABLE api_keys (id uuid PRIMARY KEY, user_id uuid NOT NULL, name text NOT NULL, key_prefix text NOT NULL, key_hash text NOT NULL, scopes text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), last_used_at timestamptz, revoked_at timestamptz);
CREATE TABLE creator_overlay_tokens (user_id uuid PRIMARY KEY, token text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE artist_vaults (id uuid PRIMARY KEY, user_id uuid NOT NULL);
CREATE TABLE artist_vault_identity_photos (id uuid PRIMARY KEY, user_id uuid NOT NULL);
CREATE TABLE artist_character_links (id uuid PRIMARY KEY, user_id uuid NOT NULL);
CREATE TABLE artist_outfits (id uuid PRIMARY KEY, vault_id uuid NOT NULL);
CREATE TABLE songs (id uuid PRIMARY KEY, user_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE song_dj_analysis (id uuid PRIMARY KEY, song_id uuid NOT NULL, user_id uuid);
CREATE TABLE dj_crate_items (id uuid PRIMARY KEY, song_id uuid NOT NULL);
CREATE TABLE albums (id uuid PRIMARY KEY, user_id uuid NOT NULL);
CREATE TABLE album_tracks (id uuid PRIMARY KEY, album_id uuid NOT NULL REFERENCES albums(id) ON DELETE CASCADE, song_id uuid NOT NULL REFERENCES songs(id) ON DELETE CASCADE);
CREATE TABLE project_drafts (id uuid PRIMARY KEY, user_id uuid NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE generated_clips (id uuid PRIMARY KEY, user_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE hub_projects (id uuid PRIMARY KEY, user_id uuid NOT NULL);
CREATE TABLE beats (id uuid PRIMARY KEY, user_id uuid NOT NULL);
CREATE TABLE beat_license_templates (id uuid PRIMARY KEY, producer_id uuid NOT NULL);
CREATE TABLE shop_products (id uuid PRIMARY KEY, user_id uuid NOT NULL, status text NOT NULL DEFAULT 'active');
CREATE TABLE bio_pages (id uuid PRIMARY KEY, user_id uuid NOT NULL);
`;

const USER = randomUUID();
const OTHER = randomUUID();
const PROFILE = randomUUID();
const OTHER_PROFILE = randomUUID();

let mem: any;
let q: (sql: string) => any[];

beforeEach(() => {
  const t = createTestDb();
  h.db = t.db;
  mem = t.mem;
  mem.public.none(DDL);
  q = (sql: string) => mem.public.many(sql);
  h.stripeCancel = vi.fn(async () => ({}));
  mem.public.none(`INSERT INTO creator_profiles (id, user_id) VALUES ('${PROFILE}', '${USER}'), ('${OTHER_PROFILE}', '${OTHER}');`);
});

/* ─── Blockers ──────────────────────────────────────────────────────── */

describe("findAccountExitBlockers", () => {
  it("is silent for a member with nothing in flight", async () => {
    expect(await findAccountExitBlockers(USER)).toEqual([]);
  });

  it("blocks on a funded sponsor deal the member posted", async () => {
    mem.public.none(`INSERT INTO sponsor_deals (id, posted_by, escrow_status) VALUES ('${randomUUID()}', '${USER}', 'funded');`);
    const blockers = await findAccountExitBlockers(USER);
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toContain("sponsor deal");
    expect(blockers[0]).toContain("escrow");
  });

  it("blocks on a funding sponsor deal the member accepted as creator", async () => {
    mem.public.none(`INSERT INTO sponsor_deals (id, posted_by, accepted_user_id, escrow_status) VALUES ('${randomUUID()}', '${OTHER}', '${USER}', 'funding');`);
    expect(await findAccountExitBlockers(USER)).toHaveLength(1);
  });

  it("ignores sponsor deals that are unfunded or already settled", async () => {
    mem.public.none(`INSERT INTO sponsor_deals (id, posted_by, escrow_status) VALUES
      ('${randomUUID()}', '${USER}', 'unfunded'),
      ('${randomUUID()}', '${USER}', 'released'),
      ('${randomUUID()}', '${USER}', 'refunded');`);
    expect(await findAccountExitBlockers(USER)).toEqual([]);
  });

  it("blocks on a funded performance booking on either side", async () => {
    mem.public.none(`INSERT INTO performance_bookings (id, artist_user_id, promoter_user_id, escrow_status) VALUES ('${randomUUID()}', '${OTHER}', '${USER}', 'funded');`);
    const blockers = await findAccountExitBlockers(USER);
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toContain("booking");
  });

  it("blocks on held feature-verse escrow as buyer or creator", async () => {
    mem.public.none(`INSERT INTO feature_verse_orders (id, buyer_user_id, creator_user_id, escrow_status) VALUES ('${randomUUID()}', '${USER}', '${OTHER}', 'held');`);
    const blockers = await findAccountExitBlockers(USER);
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toContain("Visual Bucs");
    mem.public.none(`UPDATE feature_verse_orders SET escrow_status = 'released';`);
    expect(await findAccountExitBlockers(USER)).toEqual([]);
  });

  it("blocks while fans have paid fan-club time owed — not for trials, manual adds, or ended memberships", async () => {
    const tier = randomUUID();
    mem.public.none(`INSERT INTO fan_tiers (id, user_id) VALUES ('${tier}', '${USER}');`);
    mem.public.none(`INSERT INTO fan_members (id, user_id, fan_user_id, tier_id, status) VALUES ('${randomUUID()}', '${USER}', '${OTHER}', '${tier}', 'active');`);
    expect(await findAccountExitBlockers(USER)).toHaveLength(1);
    mem.public.none(`UPDATE fan_members SET status = 'trialing';`);
    expect(await findAccountExitBlockers(USER)).toEqual([]);
    mem.public.none(`UPDATE fan_members SET status = 'active', fan_user_id = NULL;`);
    expect(await findAccountExitBlockers(USER)).toEqual([]);
    mem.public.none(`UPDATE fan_members SET status = 'paused', fan_user_id = '${OTHER}';`);
    expect(await findAccountExitBlockers(USER)).toHaveLength(1);
    mem.public.none(`UPDATE fan_members SET status = 'expired';`);
    expect(await findAccountExitBlockers(USER)).toEqual([]);
  });

  it("blocks while gift cards the member sold still hold a balance", async () => {
    mem.public.none(`INSERT INTO gift_cards (id, profile_id, status, balance_cents) VALUES ('${randomUUID()}', '${PROFILE}', 'active', 2500);`);
    const blockers = await findAccountExitBlockers(USER);
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toContain("Gift cards");
    mem.public.none(`UPDATE gift_cards SET balance_cents = 0, status = 'depleted';`);
    expect(await findAccountExitBlockers(USER)).toEqual([]);
  });

  it("does not block on gift cards another creator sold, or cards the member merely bought", async () => {
    mem.public.none(`INSERT INTO gift_cards (id, profile_id, buyer_user_id, status, balance_cents) VALUES
      ('${randomUUID()}', '${OTHER_PROFILE}', NULL, 'active', 2500),
      ('${randomUUID()}', '${OTHER_PROFILE}', '${USER}', 'active', 2500);`);
    expect(await findAccountExitBlockers(USER)).toEqual([]);
  });

  it("reports several pots at once, one sentence each", async () => {
    mem.public.none(`INSERT INTO sponsor_deals (id, posted_by, escrow_status) VALUES ('${randomUUID()}', '${USER}', 'funded');`);
    mem.public.none(`INSERT INTO feature_verse_orders (id, buyer_user_id, creator_user_id, escrow_status) VALUES ('${randomUUID()}', '${OTHER}', '${USER}', 'held');`);
    expect(await findAccountExitBlockers(USER)).toHaveLength(2);
  });
});

/* ─── Own plan ──────────────────────────────────────────────────────── */

describe("cancelOwnCreatorPlan", () => {
  function seedSub(status: string, stripeId: string | null) {
    mem.public.none(`INSERT INTO creator_subscriptions (id, profile_id, tier, status, stripe_subscription_id)
      VALUES ('${randomUUID()}', '${PROFILE}', 'pro', '${status}', ${stripeId ? `'${stripeId}'` : "NULL"});`);
  }

  it("cancels a live plan at Stripe immediately and marks the row canceled", async () => {
    seedSub("active", "sub_live_1");
    await cancelOwnCreatorPlan(USER);
    expect(h.stripeCancel).toHaveBeenCalledWith("sub_live_1");
    const rows = q(`SELECT status FROM creator_subscriptions WHERE profile_id = '${PROFILE}';`);
    expect(rows[0].status).toBe("canceled");
  });

  it("cancels a past_due plan too — it still bills", async () => {
    seedSub("past_due", "sub_pd_1");
    await cancelOwnCreatorPlan(USER);
    expect(h.stripeCancel).toHaveBeenCalledWith("sub_pd_1");
  });

  it("never calls Stripe for an already-canceled plan", async () => {
    seedSub("canceled", "sub_old_1");
    await cancelOwnCreatorPlan(USER);
    expect(h.stripeCancel).not.toHaveBeenCalled();
  });

  it("marks a live row with no Stripe id canceled locally, without a Stripe call", async () => {
    seedSub("active", null);
    await cancelOwnCreatorPlan(USER);
    expect(h.stripeCancel).not.toHaveBeenCalled();
    expect(q(`SELECT status FROM creator_subscriptions;`)[0].status).toBe("canceled");
  });

  it("propagates a Stripe refusal so the exit can abort untouched", async () => {
    seedSub("active", "sub_live_2");
    h.stripeCancel = vi.fn(async () => { throw new Error("stripe down"); });
    await expect(cancelOwnCreatorPlan(USER)).rejects.toThrow("stripe down");
    expect(q(`SELECT status FROM creator_subscriptions;`)[0].status).toBe("active");
  });

  it("is a no-op for a member with no creator profile or no subscription", async () => {
    await cancelOwnCreatorPlan(OTHER); // profile exists, no sub row
    await cancelOwnCreatorPlan(randomUUID()); // no profile at all
    expect(h.stripeCancel).not.toHaveBeenCalled();
  });
});

/* ─── Session death ─────────────────────────────────────────────────── */

describe("revokeAccountSessions", () => {
  it("revokes the member's live API keys, leaves revoked ones and other members' alone", async () => {
    const liveKey = randomUUID();
    const deadKey = randomUUID();
    mem.public.none(`INSERT INTO api_keys (id, user_id, name, key_prefix, key_hash, scopes, revoked_at) VALUES
      ('${liveKey}', '${USER}', 'a', 'bdv_live_a', 'h1', 'read', NULL),
      ('${deadKey}', '${USER}', 'b', 'bdv_live_b', 'h2', 'read', '2026-01-01T00:00:00Z'),
      ('${randomUUID()}', '${OTHER}', 'c', 'bdv_live_c', 'h3', 'read', NULL);`);
    await revokeAccountSessions(USER);
    const rows = q(`SELECT id, revoked_at FROM api_keys ORDER BY key_prefix;`);
    const byId = new Map(rows.map((r: any) => [r.id, r.revoked_at]));
    expect(byId.get(liveKey)).not.toBeNull();
    // The already-revoked key keeps its ORIGINAL stamp — it was not re-revoked.
    expect(new Date(byId.get(deadKey)).toISOString()).toContain("2026-01-01");
    const other = q(`SELECT revoked_at FROM api_keys WHERE user_id = '${OTHER}';`);
    expect(other[0].revoked_at).toBeNull();
  });

  it("deletes the member's overlay token and nobody else's", async () => {
    mem.public.none(`INSERT INTO creator_overlay_tokens (user_id, token) VALUES ('${USER}', 'tok-a'), ('${OTHER}', 'tok-b');`);
    await revokeAccountSessions(USER);
    const rows = q(`SELECT user_id FROM creator_overlay_tokens;`);
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(OTHER);
  });
});

/* ─── Erasure ───────────────────────────────────────────────────────── */

describe("eraseAccountData", () => {
  function seedContent() {
    const vault = randomUUID();
    const userPlaylist = randomUUID();
    const otherPlaylist = randomUUID();
    const song = randomUUID();
    const album = randomUUID();
    mem.public.none(`
      INSERT INTO artist_vaults (id, user_id) VALUES ('${vault}', '${USER}');
      INSERT INTO artist_vault_identity_photos (id, user_id) VALUES ('${randomUUID()}', '${USER}');
      INSERT INTO artist_character_links (id, user_id) VALUES ('${randomUUID()}', '${USER}');
      INSERT INTO artist_outfits (id, vault_id) VALUES ('${randomUUID()}', '${vault}');
      INSERT INTO songs (id, user_id) VALUES ('${song}', '${USER}');
      INSERT INTO song_dj_analysis (id, song_id, user_id) VALUES ('${randomUUID()}', '${song}', '${USER}');
      INSERT INTO dj_crate_items (id, song_id) VALUES ('${randomUUID()}', '${song}');
      INSERT INTO albums (id, user_id) VALUES ('${album}', '${USER}');
      INSERT INTO album_tracks (id, album_id, song_id) VALUES ('${randomUUID()}', '${album}', '${song}');
      INSERT INTO project_drafts (id, user_id) VALUES ('${randomUUID()}', '${USER}');
      INSERT INTO generated_clips (id, user_id) VALUES ('${randomUUID()}', '${USER}');
      INSERT INTO hub_projects (id, user_id) VALUES ('${randomUUID()}', '${USER}');
      INSERT INTO beats (id, user_id) VALUES ('${randomUUID()}', '${USER}');
      INSERT INTO beat_license_templates (id, producer_id) VALUES ('${randomUUID()}', '${USER}');
      INSERT INTO feature_verse_listings (id, creator_user_id) VALUES ('${randomUUID()}', '${USER}');
      INSERT INTO bio_pages (id, user_id) VALUES ('${randomUUID()}', '${USER}');
      INSERT INTO posts (id, profile_id) VALUES ('${randomUUID()}', '${PROFILE}');
      INSERT INTO store_products (id, profile_id) VALUES ('${randomUUID()}', '${PROFILE}');
      INSERT INTO follows (follower_user_id, profile_id) VALUES ('${USER}', '${OTHER_PROFILE}'), ('${OTHER}', '${PROFILE}');
      INSERT INTO playlists (id, profile_id) VALUES ('${userPlaylist}', '${PROFILE}'), ('${otherPlaylist}', '${OTHER_PROFILE}');
      INSERT INTO playlist_follows (user_id, playlist_id) VALUES ('${USER}', '${otherPlaylist}'), ('${OTHER}', '${userPlaylist}'), ('${OTHER}', '${otherPlaylist}');
      INSERT INTO shop_products (id, user_id, status) VALUES ('${randomUUID()}', '${USER}', 'active');
    `);
    return { vault, song, album };
  }

  function seedRecords() {
    const tier = randomUUID();
    mem.public.none(`
      INSERT INTO fan_tiers (id, user_id) VALUES ('${tier}', '${USER}');
      INSERT INTO fan_members (id, user_id, fan_user_id, tier_id, status) VALUES ('${randomUUID()}', '${USER}', '${OTHER}', '${tier}', 'expired');
      INSERT INTO sponsor_deals (id, posted_by, escrow_status) VALUES ('${randomUUID()}', '${USER}', 'released');
      INSERT INTO feature_verse_orders (id, buyer_user_id, creator_user_id, escrow_status) VALUES ('${randomUUID()}', '${OTHER}', '${USER}', 'refunded');
      INSERT INTO gift_cards (id, profile_id, buyer_user_id, status, balance_cents) VALUES ('${randomUUID()}', '${OTHER_PROFILE}', '${USER}', 'active', 900);
    `);
  }

  it("erases the member's content and public presence; the profile cascade takes posts and store products", async () => {
    seedContent();
    await eraseAccountData(USER);
    for (const table of [
      "artist_vaults", "artist_vault_identity_photos", "artist_character_links", "artist_outfits",
      "songs", "song_dj_analysis", "dj_crate_items", "albums", "album_tracks",
      "project_drafts", "generated_clips", "hub_projects", "beats", "beat_license_templates",
      "feature_verse_listings", "bio_pages", "posts", "store_products", "follows",
    ]) {
      expect(q(`SELECT * FROM ${table};`), table).toHaveLength(0);
    }
    expect(q(`SELECT * FROM creator_profiles WHERE id = '${PROFILE}';`)).toHaveLength(0);
    // Playlist follows (migration 0303, join-composed R2×M3): the row BY
    // the member is erased by the explicit delete; the row pointing at
    // the member's own playlist cascades with it; the other member's
    // follow of their own playlist — and that playlist — stand.
    const pf = q(`SELECT user_id FROM playlist_follows;`);
    expect(pf).toHaveLength(1);
    expect(pf[0].user_id).toBe(OTHER);
    expect(q(`SELECT * FROM playlists;`)).toHaveLength(1);
    // The shop's products are paused, not deleted — the shop record stays.
    const shop = q(`SELECT status FROM shop_products WHERE user_id = '${USER}';`);
    expect(shop).toHaveLength(1);
    expect(shop[0].status).toBe("paused");
    // The other member is untouched.
    expect(q(`SELECT * FROM creator_profiles WHERE id = '${OTHER_PROFILE}';`)).toHaveLength(1);
  });

  it("takes the member's follows with their counts: followed profiles and playlists lose exactly the landed rows (stack1100 X5)", async () => {
    seedContent();
    // Counter truth going in, derived from the rows themselves:
    // OTHER_PROFILE is followed by USER (seedContent) and by OTHER
    // (added here) = 2 rows; other's playlist is followed by USER and
    // OTHER (seedContent) = 2 rows. Counts start in agreement.
    mem.public.none(`
      INSERT INTO follows (follower_user_id, profile_id) VALUES ('${OTHER}', '${OTHER_PROFILE}');
      UPDATE creator_profiles SET follower_count = 2 WHERE id = '${OTHER_PROFILE}';
      UPDATE playlists SET follower_count = 2 WHERE profile_id = '${OTHER_PROFILE}';
      UPDATE playlists SET follower_count = 1 WHERE profile_id = '${PROFILE}';
    `);
    await eraseAccountData(USER);
    // USER's profile-follow row left, so OTHER_PROFILE's count drops to
    // the one row that stands (OTHER's). A ghost follower would leave 2.
    const prof = q(`SELECT follower_count FROM creator_profiles WHERE id = '${OTHER_PROFILE}';`);
    expect(prof).toHaveLength(1);
    expect(prof[0].follower_count).toBe(1);
    expect(q(`SELECT * FROM follows WHERE profile_id = '${OTHER_PROFILE}';`)).toHaveLength(1);
    // Same law on the playlist side: only OTHER's follow of their own
    // playlist stands, and its count agrees with the row.
    const pl = q(`SELECT follower_count FROM playlists WHERE profile_id = '${OTHER_PROFILE}';`);
    expect(pl).toHaveLength(1);
    expect(pl[0].follower_count).toBe(1);
    expect(q(`SELECT * FROM playlist_follows;`)).toHaveLength(1);
  });

  it("keeps every transaction record: settled deals, terminal memberships, gift cards the member bought", async () => {
    seedRecords();
    await eraseAccountData(USER);
    expect(q(`SELECT * FROM sponsor_deals;`)).toHaveLength(1);
    expect(q(`SELECT * FROM feature_verse_orders;`)).toHaveLength(1);
    expect(q(`SELECT * FROM fan_members;`)).toHaveLength(1);
    expect(q(`SELECT * FROM gift_cards WHERE buyer_user_id = '${USER}';`)).toHaveLength(1);
    // …while the member's own fan-club tiers (their content) are gone.
    expect(q(`SELECT * FROM fan_tiers;`)).toHaveLength(0);
  });

  it("runs clean for a member with no creator profile and no content", async () => {
    const nobody = randomUUID();
    await eraseAccountData(nobody);
    mem.public.none(`INSERT INTO project_drafts (id, user_id) VALUES ('${randomUUID()}', '${nobody}');`);
    await eraseAccountData(nobody);
    expect(q(`SELECT * FROM project_drafts;`)).toHaveLength(0);
  });
});
