/**
 * Live social-proof sync (C5) — owner endpoints + persistence law.
 *
 * Mounts the REAL router on the house fake DB, with the analytics
 * per-account fetcher mocked at the module seam (the seam is the
 * point: token handling lives in analytics; this suite pins what the
 * proof layer does with its honest answers):
 *
 *  - a figure renders only with a real source value (TikTok answering
 *    with stats-scope nulls produces NO figure, not a zero);
 *  - a failed refresh keeps the old figure with its ORIGINAL date;
 *  - the off switch removes the figure from the public shape, and one
 *    creator's switch can never touch another creator's row;
 *  - the public read retires disconnected accounts and >7-day figures;
 *  - disconnect + refresh drops the figure from the cache itself;
 *  - the feature is FREE: no credits module is imported by either file.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  fake: null as any,
  overview: vi.fn(),
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const u = req.headers["x-test-user"];
    if (!u) return res.status(401).json({ error: "Unauthorized" });
    req.userId = String(u);
    next();
  },
}));

vi.mock("../analytics", () => ({
  overviewForAccount: h.overview,
}));

vi.mock("../../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { createFakeDb } = await import("./_reach-fake-db");
  const fake = createFakeDb(
    {
      creatorProfiles: actual.creatorProfilesTable,
      socialAccounts: actual.socialAccountsTable,
      creatorSocialProof: actual.creatorSocialProofTable,
    },
    { creatorSocialProof: [["profileId"]] },
  );
  h.fake = fake;
  return { ...actual, db: fake.db };
});

import socialProofRouter from "../social-proof";
import { getPublicSocialProof } from "../../lib/social-proof";

let server: any;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: () => {}, info: () => {}, warn: () => {} };
    next();
  });
  app.use("/api", socialProofRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROFILE_A = "11111111-1111-4111-8111-111111111111";
const PROFILE_B = "22222222-2222-4222-8222-222222222222";
const IG_A = "33333333-3333-4333-8333-333333333333";
const TT_A = "44444444-4444-4444-8444-444444444444";

const asA = { "x-test-user": USER_A };
const asB = { "x-test-user": USER_B };

async function call(method: string, path: string, headers: Record<string, string> = {}, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}

function seedAccountsAndProfiles() {
  h.fake.seed("creatorProfiles", [
    { id: PROFILE_A, userId: USER_A, slug: "nova-reign", displayName: "Nova Reign" },
    { id: PROFILE_B, userId: USER_B, slug: "other-creator", displayName: "Other Creator" },
  ]);
  h.fake.seed("socialAccounts", [
    {
      id: IG_A, user_id: USER_A, platform: "instagram", ig_user_id: "ig-1", provider_user_id: null,
      username: "nova.reign", page_id: null, page_name: null,
      access_token_encrypted: "enc", refresh_token_encrypted: null, token_expires_at: null,
    },
    {
      id: TT_A, user_id: USER_A, platform: "tiktok", ig_user_id: null, provider_user_id: "tt-1",
      username: "novareign", page_id: null, page_name: null,
      access_token_encrypted: "enc", refresh_token_encrypted: "enc-r", token_expires_at: null,
    },
  ]);
}

function seedProofRow(profileId: string, userId: string, figures: any[], refreshedAt: Date, hiddenKeys: string[] = []) {
  h.fake.seed("creatorSocialProof", [
    { profileId, userId, figures, hiddenKeys, refreshedAt, createdAt: refreshedAt, updatedAt: refreshedAt },
  ]);
}

const igFigure = (value: number, fetchedAt: string) => ({
  key: "instagram.followers", platform: "instagram", accountId: IG_A,
  accountLabel: "nova.reign", label: "Instagram followers", value, fetchedAt,
});

beforeEach(() => {
  h.fake.clear();
  h.overview.mockReset();
  seedAccountsAndProfiles();
});

describe("GET /social-proof/me", () => {
  it("a user with no creator profile gets hasProfile=false, not an error", async () => {
    const r = await call("GET", "/social-proof/me", { "x-test-user": "cccccccc-cccc-4ccc-8ccc-cccccccccccc" });
    expect(r.status).toBe(200);
    expect(r.json.hasProfile).toBe(false);
    expect(r.json.figures).toEqual([]);
  });

  it("fresh cache is served without touching the providers", async () => {
    seedProofRow(PROFILE_A, USER_A, [igFigure(12345, new Date().toISOString())], new Date());
    const r = await call("GET", "/social-proof/me", asA);
    expect(r.status).toBe(200);
    expect(h.overview).not.toHaveBeenCalled();
    expect(r.json.figures).toEqual([
      expect.objectContaining({ key: "instagram.followers", value: 12345, visible: true, connected: true }),
    ]);
    expect(r.json.connectedPlatforms).toEqual(expect.arrayContaining(["instagram", "tiktok"]));
  });

  it("stale cache refreshes: real values land; a rail that returns no stats yields NO figure", async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 3600 * 1000);
    seedProofRow(PROFILE_A, USER_A, [], twoDaysAgo);
    h.overview.mockImplementation(async (_userId: string, account: any) => {
      if (account.platform === "instagram") {
        return {
          status: "ok",
          stats: { followers: 12345, following: 312, mediaCount: 67, totalLikes: null },
          fetchedAt: new Date().toISOString(),
        };
      }
      /* TikTok answers OK but the stats scope was never granted: every
         count is null. That must produce NO TikTok figure — not a zero,
         not an estimate. */
      return {
        status: "ok",
        stats: { followers: null, following: null, mediaCount: null, totalLikes: null },
        fetchedAt: new Date().toISOString(),
      };
    });
    const r = await call("GET", "/social-proof/me", asA);
    expect(r.status).toBe(200);
    const byKey = Object.fromEntries(r.json.figures.map((f: any) => [f.key, f]));
    expect(byKey["instagram.followers"]?.value).toBe(12345);
    expect(byKey["instagram.posts"]?.value).toBe(67);
    expect(Object.keys(byKey).some((k) => k.startsWith("tiktok."))).toBe(false);
    /* …and the cache row itself now holds the real figures. */
    const stored = h.fake.store("creatorSocialProof").rows.find((x: any) => x.profileId === PROFILE_A);
    expect(stored.figures.map((f: any) => f.key).sort()).toEqual(["instagram.followers", "instagram.posts"]);
  });

  it("a failed refresh keeps the old figure with its ORIGINAL fetch date", async () => {
    const measuredAt = new Date(Date.now() - 3 * 24 * 3600 * 1000);
    seedProofRow(PROFILE_A, USER_A, [igFigure(4200, measuredAt.toISOString())], new Date(Date.now() - 2 * 24 * 3600 * 1000));
    h.overview.mockResolvedValue({ status: "error", stats: null, fetchedAt: null });
    const r = await call("GET", "/social-proof/me", asA);
    expect(r.status).toBe(200);
    const kept = r.json.figures.find((f: any) => f.key === "instagram.followers");
    expect(kept?.value).toBe(4200);
    expect(kept?.fetchedAt).toBe(measuredAt.toISOString());
  });
});

describe("POST /social-proof/refresh", () => {
  it("forces a live fetch even when the cache is fresh", async () => {
    seedProofRow(PROFILE_A, USER_A, [igFigure(1, new Date().toISOString())], new Date());
    h.overview.mockResolvedValue({
      status: "ok",
      stats: { followers: 999, following: null, mediaCount: null, totalLikes: null },
      fetchedAt: new Date().toISOString(),
    });
    const r = await call("POST", "/social-proof/refresh", asA);
    expect(r.status).toBe(200);
    expect(h.overview).toHaveBeenCalled();
    expect(r.json.figures.find((f: any) => f.key === "instagram.followers")?.value).toBe(999);
  });

  it("disconnect + refresh drops the figure from the cache itself", async () => {
    seedProofRow(PROFILE_A, USER_A, [igFigure(500, new Date().toISOString())], new Date());
    /* The creator disconnects Instagram (the account row is gone). */
    h.fake.store("socialAccounts").rows = h.fake
      .store("socialAccounts")
      .rows.filter((x: any) => x.id !== IG_A);
    h.overview.mockResolvedValue({
      status: "ok",
      stats: { followers: null, following: null, mediaCount: null, totalLikes: 12 },
      fetchedAt: new Date().toISOString(),
    });
    const r = await call("POST", "/social-proof/refresh", asA);
    expect(r.status).toBe(200);
    expect(r.json.figures.map((f: any) => f.key)).toEqual(["tiktok.likes"]);
  });
});

describe("PUT /social-proof/visibility — the off switch, owner-scoped", () => {
  it("hiding a figure removes it from the public shape; showing restores it", async () => {
    seedProofRow(PROFILE_A, USER_A, [igFigure(777, new Date().toISOString())], new Date());
    const put = await call("PUT", "/social-proof/visibility", asA, { hiddenKeys: ["instagram.followers"] });
    expect(put.status).toBe(200);
    expect(put.json.figures[0]?.visible).toBe(false);
    expect(await getPublicSocialProof(PROFILE_A, USER_A)).toEqual([]);

    const back = await call("PUT", "/social-proof/visibility", asA, { hiddenKeys: [] });
    expect(back.status).toBe(200);
    const pub = await getPublicSocialProof(PROFILE_A, USER_A);
    expect(pub).toEqual([expect.objectContaining({ key: "instagram.followers", value: 777, stale: false })]);
  });

  it("one creator's switch never touches another creator's row", async () => {
    seedProofRow(PROFILE_A, USER_A, [igFigure(777, new Date().toISOString())], new Date());
    seedProofRow(PROFILE_B, USER_B, [], new Date());
    const putB = await call("PUT", "/social-proof/visibility", asB, { hiddenKeys: ["tiktok.likes"] });
    expect(putB.status).toBe(200);
    const rowA = h.fake.store("creatorSocialProof").rows.find((x: any) => x.profileId === PROFILE_A);
    expect(rowA.hiddenKeys).toEqual([]);
    const rowB = h.fake.store("creatorSocialProof").rows.find((x: any) => x.profileId === PROFILE_B);
    expect(rowB.hiddenKeys).toEqual(["tiktok.likes"]);
  });

  it("unknown figure keys and malformed bodies are refused", async () => {
    seedProofRow(PROFILE_A, USER_A, [], new Date());
    expect((await call("PUT", "/social-proof/visibility", asA, { hiddenKeys: ["instagram.following"] })).status).toBe(400);
    expect((await call("PUT", "/social-proof/visibility", asA, { hiddenKeys: "instagram.followers" })).status).toBe(400);
    expect((await call("PUT", "/social-proof/visibility", asA, {})).status).toBe(400);
  });

  it("guests are 401 on every endpoint", async () => {
    expect((await call("GET", "/social-proof/me")).status).toBe(401);
    expect((await call("POST", "/social-proof/refresh")).status).toBe(401);
    expect((await call("PUT", "/social-proof/visibility", {}, { hiddenKeys: [] })).status).toBe(401);
  });
});

describe("getPublicSocialProof — public read law", () => {
  it("date-labels aging figures and retires disconnected + ancient ones", async () => {
    const now = Date.now();
    const figures = [
      igFigure(100, new Date(now - 60_000).toISOString()),
      {
        key: "tiktok.likes", platform: "tiktok", accountId: TT_A, accountLabel: "novareign",
        label: "TikTok likes", value: 55, fetchedAt: new Date(now - 2 * 24 * 3600 * 1000).toISOString(),
      },
      {
        key: "tiktok.followers", platform: "tiktok", accountId: TT_A, accountLabel: "novareign",
        label: "TikTok followers", value: 56, fetchedAt: new Date(now - 8 * 24 * 3600 * 1000).toISOString(),
      },
      {
        key: "facebook.followers", platform: "facebook", accountId: "99999999-9999-4999-8999-999999999999",
        accountLabel: "Gone Page", label: "Facebook Page followers", value: 12,
        fetchedAt: new Date(now - 60_000).toISOString(),
      },
    ];
    seedProofRow(PROFILE_A, USER_A, figures as any[], new Date(now));
    const pub = await getPublicSocialProof(PROFILE_A, USER_A);
    const byKey = Object.fromEntries(pub.map((f) => [f.key, f]));
    expect(byKey["instagram.followers"]?.stale).toBe(false);
    expect(byKey["tiktok.likes"]?.stale).toBe(true); // shown WITH its date
    expect(byKey["tiktok.likes"]?.updatedAt).toBe(figures[1]!.fetchedAt);
    expect(byKey["tiktok.followers"]).toBeUndefined(); // >7 days: retired
    expect(byKey["facebook.followers"]).toBeUndefined(); // disconnected: retired
  });
});

describe("pricing law", () => {
  it("neither the lib nor the routes file imports any credits code — the feature is FREE", () => {
    for (const rel of ["../../lib/social-proof.ts", "../social-proof.ts"]) {
      const src = readFileSync(join(__dirname, rel), "utf8");
      expect(src).not.toMatch(/from\s+["'][^"']*credits["']/);
      expect(src).not.toMatch(/chargeCredits|deductCredits|refundCredits/);
    }
  });
});
