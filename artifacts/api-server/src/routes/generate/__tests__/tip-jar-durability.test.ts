/**
 * TIP-JAR DURABILITY (stack1300 late fix) — the two defects the
 * Gate #5 staging runs proved live on Nov 2 (stack1200 @ 503c61f05):
 *
 *  1. THE VANISHING JAR — a jar created in the morning (handle
 *     "testcreator", under the owner's second artist, Test Creator)
 *     resolved publicly, took two paid $5 tips, and by 11:12 the
 *     public page was back to "Tip page not found" for guests, the
 *     buyer, and the artist page's Tip Jar link; the owner's setup
 *     showed its create-a-page state again. Cause: tip-page SETTINGS
 *     lived only in a process-memory map — the staging service's
 *     restart (an env-var save redeploy) wiped every jar on the
 *     site, while the durable tip rows (and the creator's $10.00
 *     totals) survived in tip_jar_tips. These pins simulate the
 *     restart by clearing ONLY the in-memory stores
 *     (__resetTipJarStores) while the fake db keeps its rows: the
 *     jar must still resolve, by handle, for any viewer.
 *
 *  2. THE FROZEN PUBLIC COUNTER — the public page's "X tips so
 *     far · $Y total" read 0 / $0.00 at every check, even after the
 *     paid tips the creator's own record showed as $10.00 / 2 TIPS.
 *     Cause: GET /tips/page/:handle summed the in-memory tip INTENT
 *     map (the no-charge fallback records); a real checkout never
 *     writes an intent, so the counter could never move. The pin:
 *     public stats must equal the creator dashboard's totals, both
 *     derived from the same settled tip_jar_tips rows.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  fake: null as any,
  userId: "",
}));

vi.mock("../../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = h.userId;
    next();
  },
}));

vi.mock("../../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("stripe", () => ({
  default: class FakeStripe {
    checkout = { sessions: { create: async () => ({ id: "cs_fake", url: "https://checkout.example/x" }), retrieve: async () => ({}) } };
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { createFakeDb } = await import("../../__tests__/_reach-fake-db");
  const tables: Record<string, unknown> = {
    creatorProfiles: actual.creatorProfilesTable,
    tipJarTips: actual.tipJarTipsTable,
    liveStreamTips: actual.liveStreamTipsTable,
    worldStageTips: actual.worldStageTipsTable,
  };
  /* The durable tip_pages store, once the schema carries it. On the
     pre-fix tree the table does not exist and settings live only in
     process memory — which is exactly the failure these pins prove. */
  if (actual.tipPagesTable) tables.tipPages = actual.tipPagesTable;
  const fake = createFakeDb(tables, {
    tipPages: [["user_id"], ["handle"]],
  });
  h.fake = fake;
  return { ...actual, db: fake.db };
});

import router, { __resetTipJarStores } from "../tip-jar";

/* The owner account holds TWO artists (creator profiles): Shark King
   (the default) and Test Creator. The jar was created for Test
   Creator — the account's non-default artist. */
const OWNER = randomUUID();
const OTHER = randomUUID();
const SHARK_PROFILE = randomUUID();
const TESTCREATOR_PROFILE = randomUUID();
const OTHER_PROFILE = randomUUID();

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

const d = (iso: string) => new Date(iso);

async function req(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

async function createTestCreatorJar() {
  h.userId = OWNER;
  const res = await req("POST", "/tips/settings", {
    handle: "testcreator",
    displayName: "Test Creator",
    suggestedAmounts: [5, 10, 25],
  });
  expect(res.status).toBe(200);
  expect(res.json.settings.handle).toBe("testcreator");
}

beforeEach(() => {
  h.fake.clear();
  __resetTipJarStores();
  h.userId = OWNER;
  h.fake.seed("creatorProfiles", [
    { id: SHARK_PROFILE, userId: OWNER, displayName: "Shark King", slug: "sharkking", avatarUrl: null, isVerified: false },
    { id: TESTCREATOR_PROFILE, userId: OWNER, displayName: "Test Creator", slug: "testcreator", avatarUrl: null, isVerified: false },
    { id: OTHER_PROFILE, userId: OTHER, displayName: "Other Artist", slug: "otherartist", avatarUrl: null, isVerified: false },
  ]);
});

describe("the vanishing jar — settings must survive a process restart", () => {
  it("a jar created under the non-default artist resolves publicly by handle", async () => {
    await createTestCreatorJar();
    const page = await req("GET", "/tips/page/testcreator");
    expect(page.status).toBe(200);
    expect(page.json.page.handle).toBe("testcreator");
    expect(page.json.page.displayName).toBe("Test Creator");
    expect(page.json.page.suggestedAmounts).toEqual([5, 10, 25]);
  });

  it("STILL resolves after a restart (in-memory stores wiped, db rows kept)", async () => {
    await createTestCreatorJar();
    /* The 11:12 moment: the service restarted (env-save redeploy).
       Only the process-memory stores are gone; the database rows —
       including the jar's own record — persist. */
    __resetTipJarStores();

    const page = await req("GET", "/tips/page/testcreator");
    expect(page.status).toBe(200);
    expect(page.json.page.handle).toBe("testcreator");
    expect(page.json.page.displayName).toBe("Test Creator");
    expect(page.json.page.suggestedAmounts).toEqual([5, 10, 25]);

    const jar = await req("GET", "/tips/jar/testcreator");
    expect(jar.status).toBe(200);
    expect(jar.json.jar.handle).toBe("testcreator");
    expect(jar.json.jar.canonicalUrl).toBe("/tips/testcreator");
  });

  it("the owner's own settings read survives the restart too", async () => {
    await createTestCreatorJar();
    __resetTipJarStores();
    h.userId = OWNER;
    const mine = await req("GET", "/tips/settings");
    expect(mine.status).toBe(200);
    expect(mine.json.settings.handle).toBe("testcreator");
    expect(mine.json.settings.displayName).toBe("Test Creator");
  });

  it("the handle stays taken after a restart — another account cannot claim it", async () => {
    await createTestCreatorJar();
    __resetTipJarStores();
    h.userId = OTHER;
    const theft = await req("POST", "/tips/settings", {
      handle: "testcreator",
      displayName: "Other Artist",
      suggestedAmounts: [5],
    });
    expect(theft.status).toBe(409);
  });

  it("a handle with no jar anywhere still honestly 404s, before and after a restart", async () => {
    await createTestCreatorJar();
    const before = await req("GET", "/tips/page/nojarhere");
    expect(before.status).toBe(404);
    __resetTipJarStores();
    const after = await req("GET", "/tips/page/nojarhere");
    expect(after.status).toBe(404);
  });
});

describe("the frozen public counter — one settled record, two readers", () => {
  beforeEach(async () => {
    await createTestCreatorJar();
    h.fake.seed("tipJarTips", [
      {
        id: randomUUID(), page_user_id: OWNER, handle: "testcreator", fan_name: "Fan One",
        message: "", amount_cents: 500, currency: "usd", status: "paid",
        stripe_session_id: "cs_dur_paid_1", created_at: d("2026-11-02T10:20:00Z"), paid_at: d("2026-11-02T10:21:00Z"),
      },
      {
        id: randomUUID(), page_user_id: OWNER, handle: "testcreator", fan_name: "Fan Two",
        message: "", amount_cents: 500, currency: "usd", status: "paid",
        stripe_session_id: "cs_dur_paid_2", created_at: d("2026-11-02T10:32:00Z"), paid_at: d("2026-11-02T10:33:00Z"),
      },
      {
        /* An unsettled checkout row is not money and never counts. */
        id: randomUUID(), page_user_id: OWNER, handle: "testcreator", fan_name: "Window Shopper",
        message: "", amount_cents: 700, currency: "usd", status: "pending_payment",
        stripe_session_id: "cs_dur_pending", created_at: d("2026-11-02T10:40:00Z"), paid_at: null,
      },
      {
        /* Another creator's paid tip is not this page's money. */
        id: randomUUID(), page_user_id: OTHER, handle: "otherartist", fan_name: "Someone Else's Fan",
        message: "", amount_cents: 9900, currency: "usd", status: "paid",
        stripe_session_id: "cs_dur_other", created_at: d("2026-11-02T10:41:00Z"), paid_at: d("2026-11-02T10:41:30Z"),
      },
    ]);
  });

  it("public stats count the settled tips — $10.00 / 2, not 0 / $0.00", async () => {
    const page = await req("GET", "/tips/page/testcreator");
    expect(page.status).toBe(200);
    expect(page.json.stats.count).toBe(2);
    expect(page.json.stats.total).toBe(10);
    expect(page.json.stats.average).toBe(5);
  });

  it("public stats EQUAL the creator dashboard totals for the same jar", async () => {
    const page = await req("GET", "/tips/page/testcreator");
    h.userId = OWNER;
    const dash = await req("GET", "/tips/dashboard");
    expect(dash.status).toBe(200);
    expect(page.json.stats.total).toBe(dash.json.total);
    expect(page.json.stats.count).toBe(dash.json.count);
    expect(page.json.stats.average).toBe(dash.json.average);
  });

  it("public stats still tell the truth after a restart", async () => {
    __resetTipJarStores();
    const page = await req("GET", "/tips/page/testcreator");
    expect(page.status).toBe(200);
    expect(page.json.stats.count).toBe(2);
    expect(page.json.stats.total).toBe(10);
  });
});
