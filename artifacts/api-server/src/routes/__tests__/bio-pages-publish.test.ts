/**
 * Route tests for the link-in-bio publish lifecycle (Ring 4 parity
 * tail: bio-page publish/unpublish management).
 *
 * VERIFY-FIRST RESULT (code-proven before this file was written): the
 * management already exists end to end — `bio_pages.is_published`
 * (migration 0076, schema in lib/db/src/schema/bio-pages.ts), a paid
 * publish rail (POST /api/bio-publish/:id — 100 VB, auto-refund on
 * post-charge failure, 409 on re-publish), a free unpublish
 * (POST /api/bio-pages/:id/unpublish), owner-only enforcement by 404
 * (a non-owner cannot even learn the page exists), and a public read
 * (GET /api/bio-pages/public/:slug) that 404s drafts, unpublished and
 * never-published pages alike so draft content can never leak. The
 * builder (Promote → LinkInBioBuilder) already swaps Publish ↔
 * View/Unpublish/Share on that state. What was missing: any
 * real-handler test pinning the contract, and a plain-text Live/Draft
 * state label in the builder (added alongside, pinned by
 * link-in-bio-builder.test.ts on the frontend).
 *
 * These tests pin, over HTTP against the REAL router:
 *  - create lands as a draft; the public URL 404s and leaks nothing;
 *  - the owner reads the full draft via /bio-pages/me; strangers'
 *    /me is empty;
 *  - publish charges exactly 100 VB once, flips the page live, and
 *    the public DTO carries no owner/state fields;
 *  - re-publish is a 409 with no second charge;
 *  - publish validation (no links / blank name) 400s BEFORE charging;
 *  - an empty wallet 402s with no charge and the page stays a draft;
 *  - a write failure AFTER the charge refunds the 100 VB in full;
 *  - a non-owner gets 404 on publish / unpublish / update / delete
 *    and nothing changes;
 *  - unauthenticated calls 401;
 *  - unpublish takes the page offline (public 404, no leak, clicks
 *    404) while the owner keeps the full draft in /me;
 *  - re-publishing after unpublish works (and charges again — the
 *    standing per-publish price, pinned as observed behavior);
 *  - a never-existent slug 404s in the same shape.
 *
 * Harness: the house generic fake db (_reach-fake-db) over the REAL
 * table objects; credits mocked with a controllable balance; auth
 * rides a test Bearer token via a mocked require-auth.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { createFakeDb } from "./_reach-fake-db";

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STRANGER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const testState = vi.hoisted(() => ({
  fake: null as null | ReturnType<typeof createFakeDb>,
  viewerUserId: null as string | null,
  balance: 1000,
  charges: [] as number[],
  refunds: [] as number[],
  failNextBioUpdate: false,
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!testState.viewerUserId || req.headers["authorization"] !== "Bearer test") {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.userId = testState.viewerUserId;
    req.log = { info: () => {}, error: () => {} };
    next();
  },
}));

vi.mock("../../lib/credits", () => {
  class OutOfCreditsError extends Error {}
  class LedgerWriteError extends Error {}
  return {
    OutOfCreditsError,
    LedgerWriteError,
    chargeCredits: async (_userId: string, amount: number) => {
      if (testState.balance < amount) throw new OutOfCreditsError("insufficient");
      testState.balance -= amount;
      testState.charges.push(amount);
      return testState.balance;
    },
    refundCredits: async (_userId: string, amount: number) => {
      testState.balance += amount;
      testState.refunds.push(amount);
    },
  };
});

vi.mock("../../lib/supabase-admin", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null }),
        }),
      }),
    }),
  }),
}));

vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: async (v: unknown) => v,
  isExternalHttpUrl: (v: unknown) => typeof v === "string" && /^https?:\/\//i.test(v),
  isPermanentMediaValue: () => false,
}));

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrl: async (v: unknown) => v,
  refreshSupabaseStorageUrlsDeep: async (v: unknown) => v,
  isStorageRef: () => false,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const fake = createFakeDb(
    {
      bioPages: actual.bioPagesTable,
      bioLinkClicks: actual.bioLinkClicksTable,
    },
    { bioPages: [["slug"]] },
  );
  const db: any = {
    ...fake.db,
    update: (table: unknown) => {
      if (testState.failNextBioUpdate && table === actual.bioPagesTable) {
        testState.failNextBioUpdate = false;
        throw new Error("simulated publish write failure");
      }
      return fake.db.update(table);
    },
  };
  testState.fake = fake;
  return { ...actual, db };
});

import router from "../bio-pages";

let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  testState.fake!.clear();
  testState.viewerUserId = OWNER;
  testState.balance = 1000;
  testState.charges = [];
  testState.refunds = [];
  testState.failNextBioUpdate = false;
});

async function call(
  method: string,
  path: string,
  opts: { user?: string | null; body?: unknown } = {},
): Promise<{ status: number; json: any; text: string }> {
  const user = opts.user === undefined ? OWNER : opts.user;
  testState.viewerUserId = user;
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(user ? { Authorization: "Bearer test" } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* leave null */
  }
  return { status: res.status, json, text };
}

const DRAFT_BODY = {
  displayName: "Secret Draft Name",
  headline: "Unreleased headline",
  bio: "Draft-only bio text",
  links: [{ title: "Secret Single", url: "https://example.com/secret-single", icon: "music" }],
  theme: "gold-royal",
};

async function createDraft(body: unknown = DRAFT_BODY): Promise<{ id: string; slug: string }> {
  const res = await call("POST", "/bio-pages", { body });
  expect(res.status).toBe(200);
  expect(res.json.ok).toBe(true);
  expect(res.json.page.isPublished).toBe(false);
  return { id: res.json.page.id, slug: res.json.page.slug };
}

async function publish(id: string, user?: string | null) {
  return call("POST", `/bio-publish/${id}`, user === undefined ? {} : { user });
}

describe("bio page publish lifecycle", () => {
  it("create lands as a draft; the public URL 404s and leaks no draft content", async () => {
    const { slug } = await createDraft();
    const pub = await call("GET", `/bio-pages/public/${slug}`, { user: null });
    expect(pub.status).toBe(404);
    expect(pub.json.ok).toBe(false);
    expect(pub.text).not.toContain("Secret Draft Name");
    expect(pub.text).not.toContain("secret-single");
    expect(pub.text).not.toContain("Draft-only bio text");
  });

  it("a never-existent slug 404s in the same shape as an unpublished page", async () => {
    const pub = await call("GET", "/bio-pages/public/no-such-page", { user: null });
    expect(pub.status).toBe(404);
    expect(pub.json).toEqual({ ok: false, error: "Page not found" });
  });

  it("the owner reads the full draft via /me; a stranger's /me is empty", async () => {
    await createDraft();
    const mine = await call("GET", "/bio-pages/me");
    expect(mine.status).toBe(200);
    expect(mine.json.pages).toHaveLength(1);
    expect(mine.json.pages[0].isPublished).toBe(false);
    expect(mine.json.pages[0].displayName).toBe("Secret Draft Name");
    expect(mine.json.pages[0].links[0].url).toBe("https://example.com/secret-single");

    const theirs = await call("GET", "/bio-pages/me", { user: STRANGER });
    expect(theirs.status).toBe(200);
    expect(theirs.json.pages).toEqual([]);
  });

  it("publish charges exactly 100 VB once and the public page serves a clean DTO", async () => {
    const { id, slug } = await createDraft();
    const res = await publish(id);
    expect(res.status).toBe(200);
    expect(res.json.ok).toBe(true);
    expect(res.json.url).toBe(`https://bowdownvisuals.com/bio/${slug}`);
    expect(res.json.creditsRemaining).toBe(900);
    expect(testState.charges).toEqual([100]);
    expect(testState.refunds).toEqual([]);

    const pub = await call("GET", `/bio-pages/public/${slug}`, { user: null });
    expect(pub.status).toBe(200);
    expect(pub.json.page.displayName).toBe("Secret Draft Name");
    expect(pub.json.page.links[0].url).toBe("https://example.com/secret-single");
    // DTO discipline: no owner id, no publish state, no internal ids.
    expect(pub.json.page).not.toHaveProperty("userId");
    expect(pub.json.page).not.toHaveProperty("isPublished");
    expect(pub.json.page).not.toHaveProperty("id");

    const mine = await call("GET", "/bio-pages/me");
    expect(mine.json.pages[0].isPublished).toBe(true);
  });

  it("re-publishing a live page is a 409 and never charges twice", async () => {
    const { id } = await createDraft();
    await publish(id);
    const again = await publish(id);
    expect(again.status).toBe(409);
    expect(testState.charges).toEqual([100]);
    expect(testState.balance).toBe(900);
  });

  it("publish refuses a page with no links BEFORE charging", async () => {
    const { id } = await createDraft({ displayName: "No Links Yet", links: [] });
    const res = await publish(id);
    expect(res.status).toBe(400);
    expect(testState.charges).toEqual([]);
    const mine = await call("GET", "/bio-pages/me");
    expect(mine.json.pages[0].isPublished).toBe(false);
  });

  it("publish refuses a blank display name BEFORE charging", async () => {
    testState.fake!.seed("bioPages", [
      {
        id: "11111111-1111-4111-8111-111111111111",
        userId: OWNER,
        slug: "blank-name-page",
        displayName: "",
        headline: "",
        bio: "",
        avatarUrl: null,
        links: [{ title: "One", url: "https://example.com/one", icon: "link" }],
        socials: {},
        theme: "gold-royal",
        featured: [],
        tipJarUrl: null,
        isPublished: false,
        viewCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    const res = await publish("11111111-1111-4111-8111-111111111111");
    expect(res.status).toBe(400);
    expect(testState.charges).toEqual([]);
  });

  it("an empty wallet gets a 402, no charge, and the page stays a draft", async () => {
    const { id, slug } = await createDraft();
    testState.balance = 50;
    const res = await publish(id);
    expect(res.status).toBe(402);
    expect(res.json.error).toBe("out_of_credits");
    expect(testState.charges).toEqual([]);
    const pub = await call("GET", `/bio-pages/public/${slug}`, { user: null });
    expect(pub.status).toBe(404);
  });

  it("a write failure AFTER the charge refunds the 100 VB in full", async () => {
    const { id, slug } = await createDraft();
    testState.failNextBioUpdate = true;
    const res = await publish(id);
    expect(res.status).toBe(500);
    expect(testState.charges).toEqual([100]);
    expect(testState.refunds).toEqual([100]);
    expect(testState.balance).toBe(1000);
    const pub = await call("GET", `/bio-pages/public/${slug}`, { user: null });
    expect(pub.status).toBe(404);
    const mine = await call("GET", "/bio-pages/me");
    expect(mine.json.pages[0].isPublished).toBe(false);
  });

  it("a non-owner gets 404 on publish, unpublish, update and delete — and nothing changes", async () => {
    const { id, slug } = await createDraft();

    const pubAttempt = await publish(id, STRANGER);
    expect(pubAttempt.status).toBe(404);
    expect(testState.charges).toEqual([]);

    const upd = await call("PUT", `/bio-pages/${id}`, {
      user: STRANGER,
      body: { displayName: "Hijacked" },
    });
    expect(upd.status).toBe(404);

    const del = await call("DELETE", `/bio-pages/${id}`, { user: STRANGER });
    expect(del.status).toBe(404);

    // Owner publishes for real; a stranger still cannot take it offline.
    await publish(id);
    const unpub = await call("POST", `/bio-pages/${id}/unpublish`, { user: STRANGER });
    expect(unpub.status).toBe(404);
    const pub = await call("GET", `/bio-pages/public/${slug}`, { user: null });
    expect(pub.status).toBe(200);
    expect(pub.json.page.displayName).toBe("Secret Draft Name");
  });

  it("unauthenticated publish, unpublish and create are 401", async () => {
    const { id } = await createDraft();
    expect((await publish(id, null)).status).toBe(401);
    expect((await call("POST", `/bio-pages/${id}/unpublish`, { user: null })).status).toBe(401);
    expect((await call("POST", "/bio-pages", { user: null, body: DRAFT_BODY })).status).toBe(401);
    expect(testState.charges).toEqual([]);
  });

  it("unpublish takes the page offline for visitors while the owner keeps the full draft", async () => {
    const { id, slug } = await createDraft();
    await publish(id);
    expect((await call("GET", `/bio-pages/public/${slug}`, { user: null })).status).toBe(200);

    const res = await call("POST", `/bio-pages/${id}/unpublish`);
    expect(res.status).toBe(200);
    expect(res.json.ok).toBe(true);
    expect(testState.charges).toEqual([100]); // unpublishing is free

    const pub = await call("GET", `/bio-pages/public/${slug}`, { user: null });
    expect(pub.status).toBe(404);
    expect(pub.text).not.toContain("Secret Draft Name");
    expect(pub.text).not.toContain("secret-single");

    const click = await call("POST", `/bio-pages/public/${slug}/click`, {
      user: null,
      body: { linkIndex: 0, linkTitle: "Secret Single", kind: "link" },
    });
    expect(click.status).toBe(404);

    const mine = await call("GET", "/bio-pages/me");
    expect(mine.json.pages[0].isPublished).toBe(false);
    expect(mine.json.pages[0].displayName).toBe("Secret Draft Name");
    expect(mine.json.pages[0].links[0].url).toBe("https://example.com/secret-single");
  });

  it("re-publishing after unpublish brings the page back (charging the standing price again)", async () => {
    const { id, slug } = await createDraft();
    await publish(id);
    await call("POST", `/bio-pages/${id}/unpublish`);
    expect((await call("GET", `/bio-pages/public/${slug}`, { user: null })).status).toBe(404);

    const res = await publish(id);
    expect(res.status).toBe(200);
    expect(testState.charges).toEqual([100, 100]);
    expect((await call("GET", `/bio-pages/public/${slug}`, { user: null })).status).toBe(200);
  });

  it("clicks record on a live page", async () => {
    const { id, slug } = await createDraft();
    await publish(id);
    const click = await call("POST", `/bio-pages/public/${slug}/click`, {
      user: null,
      body: { linkIndex: 0, linkTitle: "Secret Single", kind: "link" },
    });
    expect(click.status).toBe(200);
    expect(click.json.ok).toBe(true);
    expect(testState.fake!.store("bioLinkClicks").rows).toHaveLength(1);
  });
});
