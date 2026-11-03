/**
 * Public Creator API keys — pure logic + auth middleware.
 *
 * Covers the abuse posture: keys are hashed (never stored plaintext),
 * scoped from a closed set, revoked/unknown/malformed keys fail CLOSED,
 * a resolver crash fails CLOSED, and a key resolves to its owner only.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../supabase-admin", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { credits: 700 } }),
        }),
      }),
    }),
  }),
}));

/* Hoisted fake @workspace/db (pg-mem) for the cap tests below — the
   same pattern as affiliates.test.ts: the real schema, a swapped db. */
const h = vi.hoisted(() => ({ db: null as any }));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return h.db; } };
});

import {
  API_KEY_ACTIVE_LIMIT,
  API_KEY_LIMIT_MESSAGE,
  API_KEY_SCOPES,
  ApiKeyLimitError,
  countActiveApiKeys,
  createApiKey,
  generateApiKey,
  hashApiKey,
  hashesEqual,
  isApiKeyFormat,
  normalizeScopes,
  parseScopes,
  revokeApiKey,
} from "../api-keys";
import { createTestDb } from "./test-db";
import { randomUUID } from "crypto";
import { createRequireApiKey } from "../../middlewares/require-api-key";
import type { ResolvedApiKey } from "../api-keys";

describe("generateApiKey / hashApiKey", () => {
  it("mints a bdv_live_ key whose hash is not the plaintext", () => {
    const k = generateApiKey();
    expect(k.plaintext.startsWith("bdv_live_")).toBe(true);
    expect(k.keyHash).toBe(hashApiKey(k.plaintext));
    expect(k.keyHash).not.toContain(k.plaintext);
    expect(k.keyPrefix).toBe(k.plaintext.slice(0, k.keyPrefix.length));
    expect(k.keyPrefix.length).toBeLessThan(k.plaintext.length);
  });

  it("mints unique keys", () => {
    expect(generateApiKey().plaintext).not.toBe(generateApiKey().plaintext);
  });

  it("hashesEqual is exact", () => {
    const h = hashApiKey("bdv_live_x");
    expect(hashesEqual(h, h)).toBe(true);
    expect(hashesEqual(h, hashApiKey("bdv_live_y"))).toBe(false);
  });

  it("isApiKeyFormat rejects junk", () => {
    expect(isApiKeyFormat(generateApiKey().plaintext)).toBe(true);
    expect(isApiKeyFormat("bdv_live_short")).toBe(false);
    expect(isApiKeyFormat("sk_live_whatever_long_enough_to_pass_length")).toBe(false);
    expect(isApiKeyFormat("")).toBe(false);
  });
});

describe("scopes", () => {
  it("exposes exactly the v1 set", () => {
    expect([...API_KEY_SCOPES].sort()).toEqual(
      ["content:read", "earnings:read", "generate:bio", "profile:read"].sort(),
    );
  });

  it("normalizeScopes rejects unknown scopes and empty lists", () => {
    expect(normalizeScopes(["profile:read", "admin:all"])).toBeNull();
    expect(normalizeScopes([])).toBeNull();
    expect(normalizeScopes("profile:read")).toBeNull();
    expect(normalizeScopes(["profile:read", "profile:read"])).toEqual(["profile:read"]);
  });

  it("parseScopes drops anything not in the v1 set (stored-row tamper-proofing)", () => {
    expect(parseScopes("profile:read,admin:all,generate:bio")).toEqual([
      "profile:read",
      "generate:bio",
    ]);
    expect(parseScopes("")).toEqual([]);
  });
});

/* ─── middleware ─── */

function mockReqRes(headers: Record<string, string> = {}) {
  const req = { headers } as never as Parameters<ReturnType<typeof createRequireApiKey>>[0] & {
    userId?: string; apiKeyId?: string; userCredits?: number;
  };
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
  };
  const next = vi.fn();
  return { req, res, next };
}

const resolved: ResolvedApiKey = {
  keyId: "key-1",
  userId: "user-1",
  scopes: ["profile:read"],
};

describe("requireApiKey middleware (fail closed)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("401s with no Authorization header", async () => {
    const mw = createRequireApiKey("profile:read", async () => resolved);
    const { req, res, next } = mockReqRes();
    await mw(req as never, res as never, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("401s when the resolver finds nothing (unknown or revoked key)", async () => {
    const mw = createRequireApiKey("profile:read", async () => null);
    const { req, res, next } = mockReqRes({ authorization: "Bearer bdv_live_nope" });
    await mw(req as never, res as never, next);
    expect(res.statusCode).toBe(401);
    expect((res.body as { error: string }).error).toBe("invalid_api_key");
    expect(next).not.toHaveBeenCalled();
  });

  it("401s when the resolver THROWS (e.g. api_keys table not yet migrated)", async () => {
    const mw = createRequireApiKey("profile:read", async () => {
      throw new Error('relation "api_keys" does not exist');
    });
    const { req, res, next } = mockReqRes({ authorization: "Bearer bdv_live_x" });
    await mw(req as never, res as never, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("403s when the key lacks the required scope", async () => {
    const mw = createRequireApiKey("generate:bio", async () => resolved);
    const { req, res, next } = mockReqRes({ authorization: "Bearer bdv_live_x" });
    await mw(req as never, res as never, next);
    expect(res.statusCode).toBe(403);
    expect((res.body as { error: string }).error).toBe("insufficient_scope");
    expect(next).not.toHaveBeenCalled();
  });

  it("passes with owner identity + balance attached, and nothing more", async () => {
    const mw = createRequireApiKey("profile:read", async () => resolved);
    const { req, res, next } = mockReqRes({ authorization: "Bearer bdv_live_x" });
    await mw(req as never, res as never, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.userId).toBe("user-1");
    expect(req.apiKeyId).toBe("key-1");
    expect(req.userCredits).toBe(700);
  });
});

/* ─── the 10-active-key cap (owner ruling, stack1400 #9 / X6) ───
   Driven against pg-mem with the Drizzle-shaped api_keys table
   (post-0241 shape: scopes TEXT, revocation = revoked_at). */

const API_KEYS_DDL = `
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
);`;

describe("createApiKey — active-key cap", () => {
  const USER = randomUUID();
  const OTHER = randomUUID();

  beforeEach(async () => {
    const { db, mem } = createTestDb();
    mem.public.registerFunction({
      name: "gen_random_uuid",
      args: [],
      returns: "uuid" as never,
      impure: true,
      implementation: () => randomUUID(),
    });
    mem.public.none(API_KEYS_DDL);
    h.db = db;
  });

  async function fillToCap(userId: string) {
    const ids: string[] = [];
    for (let i = 0; i < API_KEY_ACTIVE_LIMIT; i++) {
      const { key } = await createApiKey(userId, `key-${i}`, ["profile:read"]);
      ids.push(key.id);
    }
    return ids;
  }

  it("exposes the cap as 10 with the ruled refusal wording", () => {
    expect(API_KEY_ACTIVE_LIMIT).toBe(10);
    expect(API_KEY_LIMIT_MESSAGE).toBe(
      "You've reached the limit of 10 active API keys. Revoke one to create another.",
    );
  });

  it("the 10th active key succeeds and the 11th is refused at the cap", async () => {
    await fillToCap(USER);
    expect(await countActiveApiKeys(USER)).toBe(10);
    const err = await createApiKey(USER, "one-too-many", ["profile:read"]).catch((e) => e);
    expect(err).toBeInstanceOf(ApiKeyLimitError);
    expect(err).toMatchObject({ code: "api_key_limit_reached", limit: 10, activeCount: 10 });
    expect((err as Error).message).toBe(API_KEY_LIMIT_MESSAGE);
    /* The refused creation inserted nothing. */
    expect(await countActiveApiKeys(USER)).toBe(10);
  });

  it("revoking a key frees a slot — revoked keys don't count", async () => {
    const ids = await fillToCap(USER);
    await expect(createApiKey(USER, "blocked", ["profile:read"])).rejects.toBeInstanceOf(ApiKeyLimitError);
    expect(await revokeApiKey(USER, ids[0]!)).toBe(true);
    expect(await countActiveApiKeys(USER)).toBe(9);
    const { key } = await createApiKey(USER, "backfill", ["profile:read"]);
    expect(key.name).toBe("backfill");
    expect(await countActiveApiKeys(USER)).toBe(10);
  });

  it("the cap is per-account — a capped user does not block anyone else", async () => {
    await fillToCap(USER);
    const { key } = await createApiKey(OTHER, "other-account-key", ["profile:read"]);
    expect(key.name).toBe("other-account-key");
    expect(await countActiveApiKeys(OTHER)).toBe(1);
    expect(await countActiveApiKeys(USER)).toBe(10);
  });
});
