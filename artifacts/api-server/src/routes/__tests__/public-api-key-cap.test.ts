/**
 * public-api-key-cap.test.ts — owner ruling, stack1400 #9 (X6).
 *
 * Per-account cap of 10 ACTIVE API keys, proven at the HTTP surface
 * against the REAL public-api router over pg-mem:
 * - the 10th POST /api-keys succeeds (201), the 11th is refused with a
 *   distinct 409 { error: "api_key_limit_reached", message: <the ruled
 *   words>, limit: 10, activeCount: 10 } — never a generic 500;
 * - GET /api-keys carries activeKeyCount + activeKeyLimit;
 * - revoking a key frees a slot (revoked keys don't count);
 * - the cap is per-account: a second user creates freely while the
 *   first sits at the cap.
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
    impure: true,
    implementation: () => randomUUID(),
  });
  mem.public.none(`
    CREATE TABLE api_keys (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      name text NOT NULL,
      key_prefix text NOT NULL,
      key_hash text NOT NULL UNIQUE,
      scopes text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      last_used_at timestamptz,
      revoked_at timestamptz
    );
  `);
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

/* The test user rides a header so one server can act as two accounts. */
vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = req.headers["x-test-user"] ?? "00000000-0000-4000-8000-00000000000a";
    req.userCredits = 0;
    next();
  },
}));

import publicApiRouter from "../public-api";

const USER_A = "00000000-0000-4000-8000-00000000000a";
const USER_B = "00000000-0000-4000-8000-00000000000b";
const LIMIT_MESSAGE =
  "You've reached the limit of 10 active API keys. Revoke one to create another.";

let baseUrl = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: () => {}, info: () => {}, warn: () => {}, debug: () => {} };
    next();
  });
  app.use("/api", publicApiRouter);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  (globalThis as any).__keyCapServer = server;
});

afterAll(async () => {
  const server = (globalThis as any).__keyCapServer;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function postKey(user: string, name: string) {
  const res = await fetch(`${baseUrl}/api/api-keys`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-test-user": user },
    body: JSON.stringify({ name, scopes: ["profile:read"] }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe("POST /api-keys — 10 active key cap", () => {
  it("10 keys succeed, the 11th is a 409 with the ruled words, revoke frees a slot, and the cap is per-account", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      const r = await postKey(USER_A, `key-${i}`);
      expect(r.status).toBe(201);
      ids.push(r.body.key.id as string);
    }

    const refused = await postKey(USER_A, "one-too-many");
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({
      error: "api_key_limit_reached",
      message: LIMIT_MESSAGE,
      limit: 10,
      activeCount: 10,
    });

    /* Per-account: USER_B is untouched by USER_A's cap. */
    const other = await postKey(USER_B, "b-key");
    expect(other.status).toBe(201);

    /* The list carries the count + limit the Developer door renders. */
    const listRes = await fetch(`${baseUrl}/api/api-keys`, { headers: { "x-test-user": USER_A } });
    const list = await listRes.json();
    expect(list.activeKeyCount).toBe(10);
    expect(list.activeKeyLimit).toBe(10);

    /* Revoking one frees exactly one slot. */
    const del = await fetch(`${baseUrl}/api/api-keys/${ids[0]}`, {
      method: "DELETE",
      headers: { "x-test-user": USER_A },
    });
    expect(del.status).toBe(200);
    const backfill = await postKey(USER_A, "backfill");
    expect(backfill.status).toBe(201);
    const refusedAgain = await postKey(USER_A, "still-capped");
    expect(refusedAgain.status).toBe(409);
    expect(refusedAgain.body.error).toBe("api_key_limit_reached");
  });
});
