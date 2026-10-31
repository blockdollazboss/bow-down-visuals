/**
 * Account exit truth (stack1000 lane R2) — routes/account.ts end to
 * end (real express app, real lib/account-exit.ts over pg-mem, faked
 * Supabase + Stripe + requireAuth).
 *
 * Pins the route's ordering guarantees, which ARE the honesty:
 *  - a 409 blocker refusal deletes NOTHING (no Stripe call, no
 *    erasure, no auth deletion) and answers with the plain sentences;
 *  - a Stripe refusal aborts the exit at 502 with NOTHING deleted —
 *    the member is never left billed-but-deleted or deleted-but-billed;
 *  - the clean path runs every step: plan cancelled, keys revoked,
 *    content erased, Supabase profile + auth user deleted;
 *  - the pre-existing guards stand (400 without the DELETE
 *    confirmation, 403 for admin accounts);
 *  - GET /account/export returns the member's real app-database rows.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { randomUUID } from "crypto";
import express from "express";

const h = vi.hoisted(() => ({
  db: null as any,
  userId: "",
  userEmail: "member@example.com",
  stripeCancel: null as any,
  deleteUser: null as any,
  profileDelete: null as any,
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = h.userId;
    req.userEmail = h.userEmail;
    next();
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return h.db; } };
});

vi.mock("../../lib/stripe-client", () => ({
  createGuardedStripeClient: () => ({
    subscriptions: { cancel: (id: string) => h.stripeCancel(id) },
  }),
}));

vi.mock("../../lib/supabase-admin", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table !== "profiles" && table !== "projects") throw new Error(`unexpected table ${table}`);
      if (table === "projects") {
        return {
          select: () => ({
            eq: () => ({ order: async () => ({ data: [], error: null }) }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: { id: h.userId }, error: null }) }),
        }),
        delete: () => ({ eq: async (col: string, val: string) => h.profileDelete(col, val) }),
      };
    },
    auth: { admin: { deleteUser: (id: string) => h.deleteUser(id) } },
  }),
}));

import accountRouter from "../account";
import { createTestDb } from "../../lib/__tests__/test-db";

const DDL = `
CREATE TABLE creator_profiles (id uuid PRIMARY KEY, user_id uuid NOT NULL, slug text, display_name text);
CREATE TABLE creator_subscriptions (
  id uuid PRIMARY KEY, profile_id uuid NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  tier text NOT NULL DEFAULT 'free', status text NOT NULL DEFAULT 'active',
  stripe_subscription_id text, stripe_customer_id text,
  current_period_end timestamptz, cancel_at_period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE gift_cards (id uuid PRIMARY KEY, profile_id uuid NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
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
CREATE TABLE songs (id uuid PRIMARY KEY, user_id uuid NOT NULL, title text NOT NULL DEFAULT '', audio_url text NOT NULL DEFAULT '', audio_path text, source text NOT NULL DEFAULT 'upload', parent_song_id uuid, artist_vault_id uuid, mashup_sources jsonb, mashup_style text, duration_sec text, lyrics text, karaoke_enabled boolean NOT NULL DEFAULT false, karaoke_share_enabled boolean NOT NULL DEFAULT false, timed_lyrics text, genre text, isrc text, cover_art_url text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE song_dj_analysis (id uuid PRIMARY KEY, song_id uuid NOT NULL, user_id uuid);
CREATE TABLE dj_crate_items (id uuid PRIMARY KEY, song_id uuid NOT NULL);
CREATE TABLE albums (id uuid PRIMARY KEY, user_id uuid NOT NULL);
CREATE TABLE album_tracks (id uuid PRIMARY KEY, album_id uuid NOT NULL REFERENCES albums(id) ON DELETE CASCADE, song_id uuid NOT NULL REFERENCES songs(id) ON DELETE CASCADE);
CREATE TABLE project_drafts (id uuid PRIMARY KEY, user_id uuid NOT NULL, workflow_type text NOT NULL DEFAULT 'music-video', title text, draft_data jsonb NOT NULL DEFAULT '{}', updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE generated_clips (id uuid PRIMARY KEY, user_id uuid NOT NULL, project_id uuid, scene_id text, title text, prompt text, final_prompt text, runway_job_id text, artist_vault_id uuid, video_url text, thumbnail_url text, status text NOT NULL DEFAULT 'completed', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE hub_projects (id uuid PRIMARY KEY, user_id uuid NOT NULL);
CREATE TABLE beats (id uuid PRIMARY KEY, user_id uuid NOT NULL);
CREATE TABLE beat_license_templates (id uuid PRIMARY KEY, producer_id uuid NOT NULL);
CREATE TABLE shop_products (id uuid PRIMARY KEY, user_id uuid NOT NULL, status text NOT NULL DEFAULT 'active');
CREATE TABLE bio_pages (id uuid PRIMARY KEY, user_id uuid NOT NULL);
CREATE TABLE follows (follower_user_id uuid NOT NULL, profile_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
`;

const USER = randomUUID();
const PROFILE = randomUUID();

let mem: any;
let server: ReturnType<typeof express.application.listen>;
let base = "";

beforeEach(async () => {
  const t = createTestDb();
  h.db = t.db;
  mem = t.mem;
  mem.public.none(DDL);
  h.userId = USER;
  h.userEmail = "member@example.com";
  h.stripeCancel = vi.fn(async () => ({}));
  h.deleteUser = vi.fn(async () => ({ error: null }));
  h.profileDelete = vi.fn(async () => ({ error: null }));
  delete process.env["ADMIN_EMAILS"];

  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { info: () => {}, error: () => {} };
    next();
  });
  app.use("/api", accountRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function del(body: unknown) {
  return fetch(`${base}/api/account`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function seedCleanMemberWithPlan() {
  mem.public.none(`
    INSERT INTO creator_profiles (id, user_id) VALUES ('${PROFILE}', '${USER}');
    INSERT INTO creator_subscriptions (id, profile_id, tier, status, stripe_subscription_id)
      VALUES ('${randomUUID()}', '${PROFILE}', 'pro', 'active', 'sub_route_1');
    INSERT INTO api_keys (id, user_id, name, key_prefix, key_hash, scopes) VALUES ('${randomUUID()}', '${USER}', 'k', 'bdv_live_x', 'hx', 'read');
    INSERT INTO creator_overlay_tokens (user_id, token) VALUES ('${USER}', 'tok-route');
    INSERT INTO project_drafts (id, user_id) VALUES ('${randomUUID()}', '${USER}');
  `);
}

describe("DELETE /api/account", () => {
  it("400s without the DELETE confirmation and deletes nothing", async () => {
    seedCleanMemberWithPlan();
    const res = await del({ confirm: "yes" });
    expect(res.status).toBe(400);
    expect(h.deleteUser).not.toHaveBeenCalled();
    expect(mem.public.many(`SELECT * FROM project_drafts;`)).toHaveLength(1);
  });

  it("403s for admin accounts", async () => {
    process.env["ADMIN_EMAILS"] = "member@example.com";
    seedCleanMemberWithPlan();
    const res = await del({ confirm: "DELETE" });
    expect(res.status).toBe(403);
    expect(h.deleteUser).not.toHaveBeenCalled();
  });

  it("409s with plain sentences while escrow is in flight — and deletes nothing", async () => {
    seedCleanMemberWithPlan();
    mem.public.none(`INSERT INTO sponsor_deals (id, posted_by, escrow_status) VALUES ('${randomUUID()}', '${USER}', 'funded');`);
    const res = await del({ confirm: "DELETE" });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; blockers: string[] };
    expect(body.blockers).toHaveLength(1);
    expect(body.error).toContain("escrow");
    expect(h.stripeCancel).not.toHaveBeenCalled();
    expect(h.deleteUser).not.toHaveBeenCalled();
    expect(mem.public.many(`SELECT * FROM project_drafts;`)).toHaveLength(1);
    expect(mem.public.many(`SELECT * FROM creator_profiles;`)).toHaveLength(1);
    expect(mem.public.many(`SELECT revoked_at FROM api_keys;`)[0].revoked_at).toBeNull();
  });

  it("aborts at 502 when Stripe refuses the plan cancel — nothing is deleted", async () => {
    seedCleanMemberWithPlan();
    h.stripeCancel = vi.fn(async () => { throw new Error("stripe down"); });
    const res = await del({ confirm: "DELETE" });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("was not deleted");
    expect(h.deleteUser).not.toHaveBeenCalled();
    expect(mem.public.many(`SELECT * FROM project_drafts;`)).toHaveLength(1);
    expect(mem.public.many(`SELECT * FROM creator_profiles;`)).toHaveLength(1);
  });

  it("runs the whole exit on the clean path: plan, keys, erasure, profile, auth user", async () => {
    seedCleanMemberWithPlan();
    const res = await del({ confirm: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(h.stripeCancel).toHaveBeenCalledWith("sub_route_1");
    expect(mem.public.many(`SELECT revoked_at FROM api_keys;`)[0].revoked_at).not.toBeNull();
    expect(mem.public.many(`SELECT * FROM creator_overlay_tokens;`)).toHaveLength(0);
    expect(mem.public.many(`SELECT * FROM project_drafts;`)).toHaveLength(0);
    expect(mem.public.many(`SELECT * FROM creator_profiles;`)).toHaveLength(0);
    expect(h.profileDelete).toHaveBeenCalledWith("id", USER);
    expect(h.deleteUser).toHaveBeenCalledWith(USER);
  });
});

describe("GET /api/account/export", () => {
  it("returns the member's real app-database drafts, clips and songs", async () => {
    mem.public.none(`
      INSERT INTO project_drafts (id, user_id) VALUES ('${randomUUID()}', '${USER}');
      INSERT INTO generated_clips (id, user_id, title) VALUES ('${randomUUID()}', '${USER}', 'Clip A');
      INSERT INTO songs (id, user_id, title, audio_url) VALUES ('${randomUUID()}', '${USER}', 'Song A', 'https://x/a.mp3');
    `);
    const res = await fetch(`${base}/api/account/export`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.drafts).toHaveLength(1);
    expect(body.clips).toHaveLength(1);
    expect(body.songs).toHaveLength(1);
    expect(body.profile).toMatchObject({ id: USER });
  });
});
