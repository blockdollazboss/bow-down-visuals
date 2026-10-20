/**
 * Route tests for the site-admin moderation home (routes/admin):
 *   GET   /api/admin/status                 { isAdmin } self-check
 *   GET   /api/admin/contact-messages       an existing admin-gated read
 *   PATCH /api/admin/contact-messages/:id   an existing admin-gated write
 *
 * THE CONTRACT PINNED HERE (existed before the moderation bench; the
 * bench docks into this router, so its gate is the bench's gate):
 * - The ONLY site-wide moderation role the server recognizes is the
 *   ADMIN_EMAILS allowlist (comma-separated, case-insensitive),
 *   checked by requireAdmin AFTER requireAuth.
 * - It FAILS CLOSED: with ADMIN_EMAILS unset, /admin/status reports
 *   isAdmin:false for every email and every gated route 403s — an
 *   unconfigured site has NO admins, never accidental ones.
 * - A signed-in member whose email is not listed is not an admin:
 *   status says false and the gated routes answer 403, so no
 *   moderation surface (inboxes today, the report queue next) is
 *   reachable by regular members.
 * - Guests fail earlier, at requireAuth (401).
 *
 * Fake db mirrors world-contests.test.ts: real table objects via
 * importOriginal, rows in the shared _reach-fake-db store.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const ADMIN_ID = "00000000-0000-4000-8000-0000000000a1";
const MEMBER_ID = "00000000-0000-4000-8000-0000000000a2";
const MSG_1 = "11111111-1111-4111-8111-111111111111";
const MSG_2 = "22222222-2222-4222-8222-222222222222";
const ADMIN_EMAIL = "king@example.test";
const MEMBER_EMAIL = "member@example.test";

const h = vi.hoisted(() => ({ fake: null as any }));

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

vi.mock("../../lib/supabase-admin", () => ({
  getSupabaseAdmin: () => {
    throw new Error("supabase must not be touched by the gated inbox routes");
  },
}));

vi.mock("../../lib/payment-record", () => ({
  recordCreditUsageStrict: async () => undefined,
}));

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrlsDeep: async (v: unknown) => v,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { createFakeDb } = await import("./_reach-fake-db");
  const fake = createFakeDb({
    artistVaults: actual.artistVaultsTable,
    spotlightInquiries: actual.spotlightInquiriesTable,
    contactMessages: actual.contactMessagesTable,
    dmcaReports: actual.dmcaReportsTable,
  });
  h.fake = fake;
  return { ...actual, db: fake.db };
});

import adminRouter from "../admin";

let base = "";
let server: ReturnType<express.Express["listen"]>;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    next();
  });
  app.use("/api", adminRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
});

type Who = { id: string; email: string } | null;
const ADMIN: Who = { id: ADMIN_ID, email: ADMIN_EMAIL };
const MEMBER: Who = { id: MEMBER_ID, email: MEMBER_EMAIL };

async function req(method: string, path: string, who: Who, body?: unknown) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (who) {
    headers["x-test-user"] = who.id;
    headers["x-test-email"] = who.email;
  }
  const r = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

function seedMessages() {
  h.fake.seed("contactMessages", [
    { id: MSG_1, name: "Fan One", email: "fan1@example.test", message: "Love the site.", read: false, createdAt: new Date("2026-10-01T00:00:00Z") },
    { id: MSG_2, name: "Fan Two", email: "fan2@example.test", message: "Bug report.", read: true, createdAt: new Date("2026-10-02T00:00:00Z") },
  ]);
}

beforeEach(() => {
  h.fake.clear();
  process.env["ADMIN_EMAILS"] = ADMIN_EMAIL;
});

describe("GET /api/admin/status — who is an admin", () => {
  it("401s a guest (requireAuth runs before the admin question)", async () => {
    const res = await req("GET", "/api/admin/status", null);
    expect(res.status).toBe(401);
  });

  it("reports isAdmin:false for a signed-in member not on the allowlist", async () => {
    const res = await req("GET", "/api/admin/status", MEMBER);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ isAdmin: false });
  });

  it("reports isAdmin:true for the allowlisted email", async () => {
    const res = await req("GET", "/api/admin/status", ADMIN);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ isAdmin: true });
  });

  it("matches the allowlist case-insensitively", async () => {
    const res = await req("GET", "/api/admin/status", { id: ADMIN_ID, email: "KING@Example.Test" });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ isAdmin: true });
  });

  it("fails closed when ADMIN_EMAILS is unset: nobody is an admin", async () => {
    delete process.env["ADMIN_EMAILS"];
    const res = await req("GET", "/api/admin/status", ADMIN);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ isAdmin: false });
  });
});

describe("the admin gate on the bench's home routes", () => {
  it("403s a member on an admin-gated read", async () => {
    seedMessages();
    const res = await req("GET", "/api/admin/contact-messages", MEMBER);
    expect(res.status).toBe(403);
  });

  it("403s a member on an admin-gated write", async () => {
    seedMessages();
    const res = await req("PATCH", `/api/admin/contact-messages/${MSG_1}`, MEMBER, { read: true });
    expect(res.status).toBe(403);
  });

  it("fails closed when ADMIN_EMAILS is unset — even the would-be admin 403s", async () => {
    delete process.env["ADMIN_EMAILS"];
    seedMessages();
    const read = await req("GET", "/api/admin/contact-messages", ADMIN);
    expect(read.status).toBe(403);
    const write = await req("PATCH", `/api/admin/contact-messages/${MSG_1}`, ADMIN, { read: true });
    expect(write.status).toBe(403);
  });

  it("serves the inbox to an admin, newest first, as the camelCase DTO", async () => {
    seedMessages();
    const res = await req("GET", "/api/admin/contact-messages", ADMIN);
    expect(res.status).toBe(200);
    expect(res.json.messages).toHaveLength(2);
    expect(res.json.messages[0]).toEqual({
      id: MSG_2,
      name: "Fan Two",
      email: "fan2@example.test",
      message: "Bug report.",
      read: true,
      createdAt: "2026-10-02T00:00:00.000Z",
    });
  });

  it("lets an admin flip read state — and only that message changes", async () => {
    seedMessages();
    const res = await req("PATCH", `/api/admin/contact-messages/${MSG_1}`, ADMIN, { read: true });
    expect(res.status).toBe(200);
    expect(res.json.message.read).toBe(true);
    const after = await req("GET", "/api/admin/contact-messages", ADMIN);
    const byId = Object.fromEntries(after.json.messages.map((m: any) => [m.id, m.read]));
    expect(byId).toEqual({ [MSG_1]: true, [MSG_2]: true });
  });

  it("404s an admin patching a message that does not exist", async () => {
    const res = await req("PATCH", "/api/admin/contact-messages/33333333-3333-4333-8333-333333333333", ADMIN, { read: true });
    expect(res.status).toBe(404);
  });

  it("400s an admin patch with a malformed body", async () => {
    seedMessages();
    const res = await req("PATCH", `/api/admin/contact-messages/${MSG_1}`, ADMIN, { read: "yes" });
    expect(res.status).toBe(400);
  });
});
