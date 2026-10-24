/**
 * empty-account-cards.test.ts — the settings/sponsor data cards on a
 * brand-new account (live-verified gap, Oct 24 2026).
 *
 * Post-push verification found /sponsors/dashboard ("Couldn't load
 * your earnings" + "Could not load your dashboard") and the /settings
 * cards (Connected Accounts, Social proof, Discord) all showing load
 * errors for the owner. The existing route tests mock the DB, so
 * they cannot see a real-SQL failure. This probe is the opposite
 * shape: the REAL routers run against pg-mem seeded from the REAL
 * migration files (the exact DDL production applied), as a user with
 * nothing — no deals, no accounts, no webhook, no proof profile.
 * Every card endpoint must answer 200 with an honest empty payload.
 * An error copy for an empty state is itself a defect.
 *
 * RESULT of the Oct 24 investigation: all four endpoints answer 200
 * with honest empty payloads for a zero-row user AND correct payloads
 * for a seeded owner-like user (profile + stale proof row, one deal,
 * one social account, one webhook). The handlers are therefore sound
 * against the migration-shaped schema; the live production errors
 * are environment-specific (the long-lived production Postgres was
 * built under the retired drizzle-kit-push regime — its actual state
 * is not readable from here). Production log tags for the follow-up
 * pull: "[sponsors] failed to load dashboard", "social-proof/me
 * error", "[discord] status failed". This file stays as the
 * regression pin for the code side of that contract.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const EMPTY_USER = "00000000-0000-4000-8000-000000000001";

vi.mock("@workspace/db", async (importOriginal) => {
  const MIGRATIONS = [
    "0002_social_accounts.sql",
    "0004_social_facebook.sql",
    "0007_social_accounts_provider_id.sql",
    "0008_discord.sql",
    "0010_sponsor_deals.sql",
    "0033_sponsor_escrow.sql",
    "0085_creator_profiles.sql",
    "0203_social_proof.sql",
  ];
  const actual = (await importOriginal()) as Record<string, unknown>;
  const { newDb } = await import("pg-mem");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const mem = newDb({ autoCreateForeignKeyIndices: true });
  const { randomUUID } = await import("node:crypto");
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: "uuid" as never,
    implementation: () => randomUUID(),
  });
  for (const file of MIGRATIONS) {
    mem.public.none(
      readFileSync(join(__dirname, "../../../../../lib/db/migrations", file), "utf8"),
    );
  }
  /* Seed a SECOND user's state too: a creator profile with a STALE
     social-proof row (drives /me into its refresh branch), one posted
     sponsor deal, one connected social account, one Discord webhook. */
  mem.public.none(`
    INSERT INTO creator_profiles (id, user_id, slug, display_name)
    VALUES ('00000000-0000-4000-8000-0000000000ab', '00000000-0000-4000-8000-000000000002', 'seeded-probe', 'Seeded Probe')
    ON CONFLICT DO NOTHING;
    INSERT INTO creator_social_proof (profile_id, user_id, figures, hidden_keys, refreshed_at)
    VALUES ('00000000-0000-4000-8000-0000000000ab', '00000000-0000-4000-8000-000000000002', '[]'::jsonb, '[]'::jsonb, '2000-01-01T00:00:00Z')
    ON CONFLICT DO NOTHING;
    INSERT INTO sponsor_deals (id, brand_name, budget_min, budget_max, niche, deliverables, description, deadline, posted_by, status)
    VALUES ('00000000-0000-4000-8000-0000000000bb', 'Probe Brand', 100, 200, 'music', 'one video', 'probe', '2030-01-01T00:00:00Z', '00000000-0000-4000-8000-000000000002', 'active')
    ON CONFLICT DO NOTHING;
    INSERT INTO social_accounts (id, user_id, platform, username, token_expires_at)
    VALUES ('00000000-0000-4000-8000-0000000000cc', '00000000-0000-4000-8000-000000000002', 'instagram', 'probe', '2030-01-01T00:00:00Z')
    ON CONFLICT DO NOTHING;
    INSERT INTO discord_webhooks (id, user_id, webhook_url_encrypted, channel_name, mention_everyone)
    VALUES ('00000000-0000-4000-8000-0000000000dd', '00000000-0000-4000-8000-000000000002', 'enc:probe', 'general', false)
    ON CONFLICT DO NOTHING;
  `);
  const pg = mem.adapters.createPg();
  const pool = new pg.Pool();
  /* House pg-mem shim (same shape as catalog-import.test.ts): strip
     the pg type-parser/rowMode config pg-mem cannot serve. */
  const shim = {
    query: async (config: unknown, values?: unknown[]) => {
      let cfg: unknown = config;
      let wantArray = false;
      if (cfg !== null && typeof cfg === "object" && !Array.isArray(cfg)) {
        const { types: _t, rowMode, ...rest } = cfg as Record<string, unknown>;
        wantArray = rowMode === "array";
        cfg = rest;
      }
      const result = (await (pool as any).query(cfg, values)) as any;
      if (wantArray && Array.isArray(result?.rows) && result.rows.length > 0) {
        const names = Object.keys(result.rows[0]);
        return { ...result, rows: result.rows.map((row: any) => names.map((n: string) => row[n])) };
      }
      return result;
    },
    connect: async () => ({
      query: (config: unknown, values?: unknown[]) =>
        (shim.query as (c: unknown, v?: unknown[]) => Promise<unknown>)(config, values),
      release: () => undefined,
    }),
  };
  return { ...actual, db: drizzle(shim as never) };
});

const authState = vi.hoisted(() => ({ userId: "00000000-0000-4000-8000-000000000001" }));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = authState.userId;
    req.userCredits = 0;
    next();
  },
}));

import sponsorsRouter from "../generate/sponsors";
import socialRouter from "../social";
import discordRouter from "../discord";
import socialProofRouter from "../social-proof";

let baseUrl = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", sponsorsRouter);
  app.use("/api", socialRouter);
  app.use("/api", discordRouter);
  app.use("/api", socialProofRouter);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  (globalThis as any).__emptyCardsServer = server;
});

afterAll(async () => {
  const server = (globalThis as any).__emptyCardsServer;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const get = async (path: string) => {
  const res = await fetch(`${baseUrl}${path}`);
  return { status: res.status, body: await res.json().catch(() => null) };
};

describe("empty-account data cards (real routers, real migration DDL, zero rows)", () => {
  it("GET /api/sponsors/dashboard → 200 with empty lists and zero earned", async () => {
    const { status, body } = await get("/api/sponsors/dashboard");
    expect(status).toBe(200);
    expect(body.postedDeals).toEqual([]);
    expect(body.applications).toEqual([]);
    expect(body.payouts).toEqual([]);
    expect(body.totalEarnedCents).toBe(0);
  });

  it("GET /api/social/accounts → 200 with no accounts", async () => {
    const { status, body } = await get("/api/social/accounts");
    expect(status).toBe(200);
    expect(body.accounts).toEqual([]);
  });

  it("GET /api/discord/status → 200, not configured", async () => {
    const { status, body } = await get("/api/discord/status");
    expect(status).toBe(200);
    expect(body.configured).toBe(false);
  });

  it("GET /api/social-proof/me → 200 with the no-profile state", async () => {
    const { status, body } = await get("/api/social-proof/me");
    expect(status).toBe(200);
    expect(body.hasProfile).toBe(false);
  });
});

describe("seeded-account data cards (same routers, owner-like rows present)", () => {
  const SEEDED = "00000000-0000-4000-8000-000000000002";

  it("sponsors dashboard serves the posted deal", async () => {
    authState.userId = SEEDED;
    const { status, body } = await get("/api/sponsors/dashboard");
    expect(status).toBe(200);
    expect(body.postedDeals).toHaveLength(1);
    expect(body.totalEarnedCents).toBe(0);
  });

  it("social accounts lists the connected account", async () => {
    authState.userId = SEEDED;
    const { status, body } = await get("/api/social/accounts");
    expect(status).toBe(200);
    expect(body.accounts).toHaveLength(1);
    expect(body.accounts[0].platform).toBe("instagram");
  });

  it("discord status reports configured", async () => {
    authState.userId = SEEDED;
    const { status, body } = await get("/api/discord/status");
    expect(status).toBe(200);
    expect(body.configured).toBe(true);
    expect(body.channel_name).toBe("general");
  });

  it("social-proof /me serves a profile with a stale proof row (refresh path included)", async () => {
    authState.userId = SEEDED;
    const { status, body } = await get("/api/social-proof/me");
    expect(status).toBe(200);
    expect(body.hasProfile).toBe(true);
  });
});
