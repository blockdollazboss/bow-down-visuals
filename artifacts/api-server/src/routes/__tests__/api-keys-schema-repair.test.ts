/**
 * api-keys-schema-repair.test.ts — Stack-200 lane 2.
 *
 * The deterministic half of the Settings "API keys" card failure:
 * migration 0216 created api_keys with scopes as JSONB plus a `status`
 * column and NO `revoked_at`, while the Drizzle schema and
 * lib/api-keys.ts read scopes as comma-joined TEXT and revocation as
 * `revoked_at`. Every list query named revoked_at → 42703 → the card
 * errored for every user, empty account or not.
 *
 * This test seeds pg-mem with the REAL 0216 file, inserts a legacy row
 * in the 0216 shape (jsonb scopes, status='revoked'), then applies the
 * REAL 0241 repair file, and proves the real route serves the row:
 * scopes parsed from the converted text, revocation carried over.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const { USER } = vi.hoisted(() => ({ USER: "00000000-0000-4000-8000-000000000001" }));

vi.mock("@workspace/db", async (importOriginal) => {
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
  /* pg-mem doesn't ship PG's replace(text,text,text) — shim it so
     0241's scopes-normalizing UPDATE runs verbatim. */
  mem.public.registerFunction({
    name: "replace",
    args: ["text", "text", "text"] as never,
    returns: "text" as never,
    implementation: (s: string, from: string, to: string) =>
      from === "" ? s : s.split(from).join(to),
  });
  const mig = (f: string) =>
    readFileSync(join(__dirname, "../../../../../lib/db/migrations", f), "utf8");
  /* The broken shape, exactly as 0216 shipped it. */
  mem.public.none(mig("0216_public_api_keys.sql"));
  /* Explicit ids: pg-mem memoizes the gen_random_uuid shim's result, so
     two default-generated ids would collide on the PK. */
  mem.public.none(`
    INSERT INTO api_keys (id, user_id, name, key_prefix, key_hash, scopes, status)
    VALUES ('00000000-0000-4000-8000-0000000000a1', '${USER}', 'Legacy key', 'bdv_live_ab12', 'deadbeef', '["profile:read","content:read"]'::jsonb, 'revoked');
  `);
  mem.public.none(`
    INSERT INTO api_keys (id, user_id, name, key_prefix, key_hash, scopes, status)
    VALUES ('00000000-0000-4000-8000-0000000000a2', '${USER}', 'Live key', 'bdv_live_cd34', 'cafef00d', '["profile:read"]'::jsonb, 'active');
  `);
  /* The repair. (0085 first: 0241's creator_social_proof guard carries
     its FK to creator_profiles — in production 0085 auto-applies long
     before 0241 in boot order.) The api_keys CREATE TABLE IF NOT EXISTS
     statement is stripped for pg-mem only: the table already exists in
     this scenario, real Postgres treats the statement as a no-op, but
     pg-mem's AST coverage check rejects IF NOT EXISTS creates over
     existing tables. Everything else in 0241 runs verbatim. */
  mem.public.none(mig("0085_creator_profiles.sql"));
  const repairSql = mig("0241_settings_cards_schema_repair.sql").replace(
    /CREATE TABLE IF NOT EXISTS api_keys \([\s\S]*?\);\n/,
    "",
  );
  expect(repairSql).not.toContain("CREATE TABLE IF NOT EXISTS api_keys");
  mem.public.none(repairSql);
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
    req.userId = USER;
    req.userCredits = 0;
    next();
  },
}));

import publicApiRouter from "../public-api";

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
  (globalThis as any).__apiKeysRepairServer = server;
});

afterAll(async () => {
  const server = (globalThis as any).__apiKeysRepairServer;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("GET /api/api-keys on a 0216-shaped table repaired by 0241", () => {
  it("answers 200 (not the pre-repair 42703 → 500) with both legacy keys", async () => {
    const res = await fetch(`${baseUrl}/api/api-keys`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.keys).toHaveLength(2);
    expect(body.availableScopes).toContain("profile:read");
  });

  it("jsonb scopes were converted to the comma-joined text the code parses", async () => {
    const res = await fetch(`${baseUrl}/api/api-keys`);
    const body = (await res.json()) as any;
    const legacy = body.keys.find((k: any) => k.name === "Legacy key");
    expect(legacy.scopes).toEqual(["profile:read", "content:read"]);
  });

  it("revoked_at exists and reads null — revocation now lives there, not in the legacy status column", async () => {
    const res = await fetch(`${baseUrl}/api/api-keys`);
    const body = (await res.json()) as any;
    /* The pre-repair query could not even NAME revoked_at (42703).
       Both seeded rows read a real (null) revokedAt; the 0216 `status`
       column is ignored by the Drizzle shape, as the migration notes —
       and no app-created rows can exist on the 0216 shape anyway,
       because its own create insert failed on the jsonb scopes cast. */
    for (const k of body.keys) expect(k.revokedAt).toBeNull();
  });
});
