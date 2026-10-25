/**
 * settings-cards-not-ready.test.ts — Stack-200 lane 2.
 *
 * The four Settings cards (Connected Accounts, Social Proof, Discord,
 * API keys) showed broken error cards on the Oct 24/25 live walks. The
 * code-side contract pinned here: when a card's backing table is
 * missing or mis-shaped on the server's database (baseline-migration
 * tables that never landed — see migration 0241 — or the 0216 api_keys
 * shape mismatch), the endpoint answers the honest house not-ready
 * state (503 + a stable *_not_ready error code the frontend renders as
 * a plain "isn't switched on yet" note), NEVER a bare 500.
 *
 * Shape: the REAL routers against pg-mem with NO migrations applied —
 * every backing table is absent, which is exactly the failure mode.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const { newDb } = await import("pg-mem");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const mem = newDb({ autoCreateForeignKeyIndices: true });
  const { randomUUID } = await import("node:crypto");
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: "uuid" as never,
    implementation: () => randomUUID(),
  });
  /* Deliberately NO migrations: social_accounts, discord_webhooks,
     creator_profiles, creator_social_proof and api_keys are all absent. */
  const pg = mem.adapters.createPg();
  const pool = new pg.Pool();
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

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = "00000000-0000-4000-8000-000000000001";
    req.userCredits = 0;
    next();
  },
}));

import socialRouter from "../social";
import discordRouter from "../discord";
import socialProofRouter from "../social-proof";
import publicApiRouter from "../public-api";

let baseUrl = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: () => {}, info: () => {}, warn: () => {}, debug: () => {} };
    next();
  });
  app.use("/api", socialRouter);
  app.use("/api", discordRouter);
  app.use("/api", socialProofRouter);
  app.use("/api", publicApiRouter);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  (globalThis as any).__notReadyServer = server;
});

afterAll(async () => {
  const server = (globalThis as any).__notReadyServer;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const get = async (path: string) => {
  const res = await fetch(`${baseUrl}${path}`);
  return { status: res.status, body: await res.json().catch(() => null) };
};

describe("settings card endpoints with their tables missing", () => {
  it("GET /api/social/accounts → 503 social_accounts_not_ready (not a bare 500)", async () => {
    const { status, body } = await get("/api/social/accounts");
    expect(status).toBe(503);
    expect(body.error).toBe("social_accounts_not_ready");
  });

  it("GET /api/discord/status → 503 discord_not_ready", async () => {
    const { status, body } = await get("/api/discord/status");
    expect(status).toBe(503);
    expect(body.error).toBe("discord_not_ready");
  });

  it("GET /api/social-proof/me → 503 social_proof_not_ready", async () => {
    const { status, body } = await get("/api/social-proof/me");
    expect(status).toBe(503);
    expect(body.error).toBe("social_proof_not_ready");
  });

  it("GET /api/api-keys → 503 api_keys_not_ready", async () => {
    const { status, body } = await get("/api/api-keys");
    expect(status).toBe(503);
    expect(body.error).toBe("api_keys_not_ready");
  });
});
