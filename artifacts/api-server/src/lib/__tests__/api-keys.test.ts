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

import {
  API_KEY_SCOPES,
  generateApiKey,
  hashApiKey,
  hashesEqual,
  isApiKeyFormat,
  normalizeScopes,
  parseScopes,
} from "../api-keys";
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
