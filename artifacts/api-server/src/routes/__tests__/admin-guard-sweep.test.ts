/**
 * Admin guard sweep (stack1100 lane W6) — EVERY admin route in the
 * joined tree, re-verified in one place.
 *
 * The defect class: an admin surface accidentally reachable by
 * non-admins. Each router file was censused for requireAdmin
 * registrations (git grep over the route files, not a recursive
 * grep), and every one of the 55 guarded routes is driven here as
 * (a) a guest — must be 401 from requireAuth, and (b) a signed-in
 * non-admin member — must be 403 from the one requireAdmin predicate
 * (lib/admin.ts, fail-closed ADMIN_EMAILS). A third pass unsets
 * ADMIN_EMAILS and checks even the admin identity is refused.
 *
 * GET /api/admin/status is the one deliberate exception in
 * routes/admin.ts: requireAuth only, returning the caller's OWN
 * { isAdmin } — its semantics are pinned separately below.
 *
 * The jewelry assertion at the end is admin-truth C5's figure pin:
 * the admin orders response must carry the table's real total, not
 * the 500-row page's length.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const ADMIN_ID = "00000000-0000-4000-8000-0000000000a1";
const MEMBER_ID = "00000000-0000-4000-8000-0000000000a2";
const ADMIN_EMAIL = "king@example.test";
const MEMBER_EMAIL = "member@example.test";
const SAMPLE_ID = "00000000-0000-4000-8000-0000000000ff";

const h = vi.hoisted(() => ({ jewelryOrders: [] as Array<Record<string, any>> }));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const user = req.headers["x-test-user"];
    if (!user) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    req.userId = String(user);
    req.userEmail = req.headers["x-test-email"] ? String(req.headers["x-test-email"]) : undefined;
    next();
  },
}));

/* Chainable Supabase fake: blocked requests never reach it; the
   jewelry admin read (C5) is the one handler exercised for real. */
function supabaseChain(table: string) {
  const st: any = { opts: undefined as any, limitN: null as number | null };
  const rows = () => (table === "jewelry_orders" ? h.jewelryOrders : []);
  const result = () => {
    if (st.opts?.head && st.opts?.count) return { data: null, count: rows().length, error: null };
    const data = st.limitN !== null ? rows().slice(0, st.limitN) : rows();
    return { data, count: undefined, error: null };
  };
  const chain: any = {
    select: (_cols: any, opts?: any) => { st.opts = opts; return chain; },
    insert: () => chain,
    update: () => chain,
    delete: () => chain,
    eq: () => chain, neq: () => chain, in: () => chain, ilike: () => chain,
    is: () => chain, not: () => chain, gt: () => chain, lt: () => chain,
    order: () => chain,
    limit: (n: number) => { st.limitN = n; return chain; },
    range: () => chain,
    single: async () => ({ data: rows()[0] ?? null, error: null }),
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    then: (res: any, rej: any) => Promise.resolve().then(result).then(res, rej),
  };
  return chain;
}

vi.mock("../../lib/supabase-admin", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => supabaseChain(table),
    rpc: async () => ({ data: null, error: null }),
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: null }, error: null }),
        listUsers: async () => ({ data: { users: [] }, error: null }),
        updateUserById: async () => ({ data: {}, error: null }),
      },
    },
    storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: "" } }) }) },
  }),
  addCreditsAtomic: async () => undefined,
}));

vi.mock("../../lib/payment-record", () => ({
  recordCreditUsageStrict: async () => undefined,
  recordCreditUsage: async () => undefined,
}));

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrlsDeep: async (v: unknown) => v,
  refreshSupabaseStorageUrl: async (v: unknown) => v,
}));

vi.mock("../../lib/credits", () => ({
  getCreditBalance: async () => 0,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { createFakeDb } = await import("./_reach-fake-db");
  const fake = createFakeDb({
    operatorActions: actual.operatorActionsTable,
    operatorPendingActions: actual.operatorPendingActionsTable,
    artistVaults: actual.artistVaultsTable,
    spotlightInquiries: actual.spotlightInquiriesTable,
    contactMessages: actual.contactMessagesTable,
    dmcaReports: actual.dmcaReportsTable,
    contentReports: actual.contentReportsTable,
    posts: actual.postsTable,
    creatorProfiles: actual.creatorProfilesTable,
    pitchFixSubmissions: actual.pitchFixSubmissionsTable,
    pitchFixVotes: actual.pitchFixVotesTable,
    feedbackPromptPrefs: actual.feedbackPromptPrefsTable,
  });
  return { ...actual, db: fake.db };
});

import adminRouter from "../admin";
import bowChallengeRouter from "../bow-challenge";
import challengeEngineRouter from "../challenge-engine";
import cheatCodeRouter from "../cheat-code";
import communityGrantsRouter from "../community-grants";
import discordBotRouter from "../discord-bot";
import jewelryRouter from "../jewelry";
import nfcCardsRouter from "../nfc-cards";
import pitchFixRouter from "../pitch-fix";
import playlistRouter from "../playlist";
import remixKingRouter from "../remix-king";
import studioGearRouter from "../studio-gear";

/* Every requireAdmin registration in the joined tree (census:
   2026-11-01, git grep over the twelve route files; +2 reads from
   the stack1200 admin-benches lane: GET /admin/challenges and
   GET /admin/remix-king/events — the two list reads the new /admin
   benches ride, guarded identically to every other admin door). */
const GUARDED: Array<[string, string]> = [
  // routes/admin.ts
  ["POST", "/api/admin/credits/grant"],
  ["POST", "/api/admin/plan/set"],
  ["GET", "/api/admin/export-my-artists"],
  ["POST", "/api/admin/import-artists"],
  ["POST", "/api/admin/remove-duplicate-shark"],
  ["GET", "/api/admin/spotlight-inquiries"],
  ["PATCH", `/api/admin/spotlight-inquiries/${SAMPLE_ID}`],
  ["GET", "/api/admin/contact-messages"],
  ["PATCH", `/api/admin/contact-messages/${SAMPLE_ID}`],
  ["GET", "/api/admin/dmca-reports"],
  ["PATCH", `/api/admin/dmca-reports/${SAMPLE_ID}`],
  ["GET", "/api/admin/reports"],
  ["PATCH", `/api/admin/reports/${SAMPLE_ID}`],
  ["GET", "/api/admin/content/removed"],
  ["GET", `/api/admin/content/${SAMPLE_ID}`],
  ["PATCH", `/api/admin/content/${SAMPLE_ID}`],
  ["GET", "/api/admin/users/lookup"],
  ["POST", `/api/admin/users/${SAMPLE_ID}/ban`],
  ["POST", `/api/admin/users/${SAMPLE_ID}/unban`],
  ["GET", "/api/admin/operator-actions"],
  ["GET", "/api/admin/payment-reversals"],
  // routes/bow-challenge.ts
  ["GET", "/api/admin/bow-challenge"],
  ["PUT", "/api/admin/bow-challenge"],
  // routes/challenge-engine.ts
  ["GET", "/api/admin/challenges"],
  ["POST", "/api/admin/challenges/test-slug/prizes"],
  ["POST", "/api/admin/challenges/test-slug/lifecycle"],
  ["POST", "/api/admin/challenges/test-slug/judge"],
  ["POST", "/api/admin/challenges/weekly-launch"],
  // routes/cheat-code.ts
  ["GET", "/api/cheat-code/admin/events"],
  ["POST", "/api/cheat-code/admin/events"],
  ["POST", `/api/cheat-code/admin/events/${SAMPLE_ID}/activate`],
  ["POST", `/api/cheat-code/admin/events/${SAMPLE_ID}/deactivate`],
  // routes/community-grants.ts
  ["POST", "/api/admin/community-grants/rounds"],
  ["PATCH", `/api/admin/community-grants/rounds/${SAMPLE_ID}`],
  ["POST", `/api/admin/community-grants/rounds/${SAMPLE_ID}/settle`],
  // routes/discord-bot.ts
  ["GET", "/api/discord-bot/config"],
  ["POST", "/api/discord-bot/config"],
  ["GET", "/api/discord-bot/install-url"],
  // routes/jewelry.ts
  ["GET", "/api/jewelry/admin/orders"],
  ["GET", "/api/jewelry/admin/orders.csv"],
  // routes/nfc-cards.ts
  ["GET", "/api/nfc-cards/admin/orders"],
  ["GET", "/api/nfc-cards/admin/orders.csv"],
  // routes/pitch-fix.ts
  ["GET", "/api/admin/pitch-fix/queue"],
  ["POST", "/api/admin/pitch-fix/rewards/process"],
  ["PATCH", `/api/admin/pitch-fix/${SAMPLE_ID}`],
  // routes/playlist.ts (the theme-song playlist is admin-only by design)
  ["POST", "/api/playlist/upload"],
  ["DELETE", "/api/playlist/test-track"],
  // routes/remix-king.ts
  ["GET", "/api/admin/remix-king/events"],
  ["POST", "/api/admin/remix-king/events"],
  ["PATCH", `/api/admin/remix-king/events/${SAMPLE_ID}`],
  ["POST", `/api/admin/remix-king/events/${SAMPLE_ID}/status`],
  ["POST", `/api/admin/remix-king/entries/${SAMPLE_ID}/shortlist`],
  ["POST", `/api/admin/remix-king/events/${SAMPLE_ID}/winner`],
  ["POST", `/api/admin/remix-king/releases/${SAMPLE_ID}/split-payments`],
  // routes/studio-gear.ts
  ["POST", `/api/admin/studio-gear/orders/${SAMPLE_ID}/proof/send`],
  ["GET", "/api/admin/studio-gear/orders"],
  ["POST", `/api/admin/studio-gear/orders/${SAMPLE_ID}/status`],
];

let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    next();
  });
  for (const r of [
    adminRouter, bowChallengeRouter, challengeEngineRouter, cheatCodeRouter,
    communityGrantsRouter, discordBotRouter, jewelryRouter, nfcCardsRouter,
    pitchFixRouter, playlistRouter, remixKingRouter, studioGearRouter,
  ]) {
    app.use("/api", r);
  }
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  process.env["ADMIN_EMAILS"] = ADMIN_EMAIL;
});

async function call(method: string, path: string, who?: { id: string; email: string }) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(who ? { "x-test-user": who.id, "x-test-email": who.email } : {}),
    },
    body: method === "GET" || method === "DELETE" ? undefined : "{}",
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}

describe("admin guard sweep — every admin route in the joined tree", () => {
  it("the census carries all 57 guarded routes", () => {
    expect(GUARDED).toHaveLength(57);
  });

  it("guests get 401 on every guarded route", async () => {
    for (const [method, path] of GUARDED) {
      const { status } = await call(method, path);
      expect(status, `${method} ${path}`).toBe(401);
    }
  });

  it("signed-in non-admin members get 403 on every guarded route", async () => {
    for (const [method, path] of GUARDED) {
      const { status } = await call(method, path, { id: MEMBER_ID, email: MEMBER_EMAIL });
      expect(status, `${method} ${path}`).toBe(403);
    }
  });

  it("with ADMIN_EMAILS unset, even the admin identity is refused (fail closed)", async () => {
    delete process.env["ADMIN_EMAILS"];
    for (const [method, path] of [
      ["POST", "/api/admin/credits/grant"],
      ["GET", "/api/admin/payment-reversals"],
      ["GET", "/api/admin/pitch-fix/queue"],
      ["GET", "/api/discord-bot/config"],
      ["POST", "/api/playlist/upload"],
    ] as Array<[string, string]>) {
      const { status } = await call(method, path, { id: ADMIN_ID, email: ADMIN_EMAIL });
      expect(status, `${method} ${path}`).toBe(403);
    }
  });
});

describe("GET /api/admin/status — the one auth-only admin route, by design", () => {
  it("guests 401; a member reads only their own isAdmin=false; the admin reads true", async () => {
    expect((await call("GET", "/api/admin/status")).status).toBe(401);
    const member = await call("GET", "/api/admin/status", { id: MEMBER_ID, email: MEMBER_EMAIL });
    expect(member.status).toBe(200);
    expect(member.json).toEqual({ isAdmin: false });
    const admin = await call("GET", "/api/admin/status", { id: ADMIN_ID, email: ADMIN_EMAIL });
    expect(admin.status).toBe(200);
    expect(admin.json).toEqual({ isAdmin: true });
  });
});

describe("C5 — GET /api/jewelry/admin/orders carries the real total", () => {
  it("total is the table's count (505), not the 500-row page length", async () => {
    h.jewelryOrders = Array.from({ length: 505 }, (_, i) => ({
      id: `ord-${i}`, user_id: MEMBER_ID, product_key: "pendant", finish: "gold",
      size_option: "18in", engraving: null, avatar_url: null, design_notes: null,
      quantity: 1, full_name: "Buyer", email: "b@example.test", phone: null,
      shipping_address: {}, status: "reserved", unit_price_cents: 100, total_cents: 100,
      created_at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
    }));
    const { status, json } = await call("GET", "/api/jewelry/admin/orders", { id: ADMIN_ID, email: ADMIN_EMAIL });
    expect(status).toBe(200);
    expect(json.orders).toHaveLength(500);
    expect(json.total).toBe(505);
  });
});
