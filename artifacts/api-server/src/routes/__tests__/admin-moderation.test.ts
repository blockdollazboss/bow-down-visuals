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

/* Extra mocks so the creator-platform router (home of the DMCA
   intake) can mount in the same app, exactly as production mounts
   both routers side by side. */
vi.mock("../referrals", () => ({
  getRecruiterBadgeForUser: async () => null,
}));

vi.mock("../generate/milestones", () => ({
  computeAchievements: () => [],
}));

vi.mock("../../lib/email", () => ({
  sendEmail: async () => undefined,
  emailShell: (x: string) => x,
  escapeHtml: (s: string) => s,
  isEmailConfigured: () => false,
}));

vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: async (v: unknown) => v,
  isExternalHttpUrl: (v: unknown) =>
    typeof v === "string" && /^https?:\/\//i.test(v),
  isPermanentMediaValue: (v: unknown) =>
    typeof v === "string" &&
    (v.startsWith("r2://") || v.startsWith("supabase://")),
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
import creatorPlatformRouter from "../creator-platform";

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
  app.use("/api", creatorPlatformRouter);
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

/* ─── The moderation bench: DMCA takedown queue ───────────────────────
   Before the bench, POST /api/dmca/report wrote rows that no route
   could read back. These pins cover the queue that closes that loop
   and the authorization around it. */
const REPORT_1 = "44444444-4444-4444-8444-444444444441";
const REPORT_2 = "55555555-5555-4555-8555-555555555552";

function seedReports() {
  h.fake.seed("dmcaReports", [
    {
      id: REPORT_1,
      reporterName: "Label Rep",
      reporterEmail: "legal@label.example",
      reporterOrg: "Example Records",
      infringingUrls: ["https://bowdownvisuals.com/track/abc"],
      originalUrls: ["https://label.example/original"],
      description: "This upload reproduces our recording without a license.",
      agreeUnderPenalty: "yes",
      status: "new",
      createdAt: new Date("2026-10-01T00:00:00Z"),
    },
    {
      id: REPORT_2,
      reporterName: "Indie Artist",
      reporterEmail: "indie@example.test",
      reporterOrg: null,
      infringingUrls: ["https://bowdownvisuals.com/video/xyz", "https://bowdownvisuals.com/shorts/xyz"],
      originalUrls: [],
      description: "My video was re-uploaded by another account in full.",
      agreeUnderPenalty: "yes",
      status: "reviewing",
      createdAt: new Date("2026-10-03T00:00:00Z"),
    },
  ]);
}

describe("GET /api/admin/dmca-reports — the bench queue", () => {
  it("403s a member — the queue is not a member surface", async () => {
    seedReports();
    const res = await req("GET", "/api/admin/dmca-reports", MEMBER);
    expect(res.status).toBe(403);
  });

  it("401s a guest", async () => {
    const res = await req("GET", "/api/admin/dmca-reports", null);
    expect(res.status).toBe(401);
  });

  it("serves an admin the full queue, newest first, with the report context", async () => {
    seedReports();
    const res = await req("GET", "/api/admin/dmca-reports", ADMIN);
    expect(res.status).toBe(200);
    expect(res.json.reports).toHaveLength(2);
    expect(res.json.reports[0]).toEqual({
      id: REPORT_2,
      reporterName: "Indie Artist",
      reporterEmail: "indie@example.test",
      reporterOrg: null,
      infringingUrls: ["https://bowdownvisuals.com/video/xyz", "https://bowdownvisuals.com/shorts/xyz"],
      originalUrls: [],
      description: "My video was re-uploaded by another account in full.",
      status: "reviewing",
      createdAt: "2026-10-03T00:00:00.000Z",
    });
    expect(res.json.reports[1].id).toBe(REPORT_1);
  });

  it("an empty queue is an honest empty list, not an error", async () => {
    const res = await req("GET", "/api/admin/dmca-reports", ADMIN);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ reports: [] });
  });

  it("filters to one workflow state with ?status=", async () => {
    seedReports();
    const res = await req("GET", "/api/admin/dmca-reports?status=new", ADMIN);
    expect(res.status).toBe(200);
    expect(res.json.reports.map((r: any) => r.id)).toEqual([REPORT_1]);
  });

  it("400s an unknown ?status= filter instead of silently emptying the queue", async () => {
    seedReports();
    const res = await req("GET", "/api/admin/dmca-reports?status=bogus", ADMIN);
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/admin/dmca-reports/:id — working the queue", () => {
  it("403s a member trying to work the queue", async () => {
    seedReports();
    const res = await req("PATCH", `/api/admin/dmca-reports/${REPORT_1}`, MEMBER, { status: "dismissed" });
    expect(res.status).toBe(403);
    const after = await req("GET", "/api/admin/dmca-reports", ADMIN);
    expect(after.json.reports.find((r: any) => r.id === REPORT_1).status).toBe("new");
  });

  it("moves a report through its workflow and the change persists", async () => {
    seedReports();
    const res = await req("PATCH", `/api/admin/dmca-reports/${REPORT_1}`, ADMIN, { status: "actioned" });
    expect(res.status).toBe(200);
    expect(res.json.report.id).toBe(REPORT_1);
    expect(res.json.report.status).toBe("actioned");
    const after = await req("GET", "/api/admin/dmca-reports?status=actioned", ADMIN);
    expect(after.json.reports.map((r: any) => r.id)).toEqual([REPORT_1]);
  });

  it("400s a status outside the workflow vocabulary", async () => {
    seedReports();
    const res = await req("PATCH", `/api/admin/dmca-reports/${REPORT_1}`, ADMIN, { status: "deleted" });
    expect(res.status).toBe(400);
  });

  it("400s a malformed report id", async () => {
    const res = await req("PATCH", "/api/admin/dmca-reports/not-a-uuid", ADMIN, { status: "reviewing" });
    expect(res.status).toBe(400);
  });

  it("404s a report that does not exist", async () => {
    const res = await req("PATCH", "/api/admin/dmca-reports/66666666-6666-4666-8666-666666666666", ADMIN, { status: "reviewing" });
    expect(res.status).toBe(404);
  });
});

describe("the loop closes: intake → queue", () => {
  const validReport = {
    reporter_name: "Visiting Rights Holder",
    reporter_email: "rights@example.test",
    infringing_urls: ["https://bowdownvisuals.com/track/taken"],
    original_urls: ["https://example.test/mine"],
    description: "This track is my recording, uploaded without permission.",
    agree_under_penalty: "yes, I agree",
  };

  it("a report filed at the public intake lands in the admin queue as 'new'", async () => {
    const filed = await req("POST", "/api/dmca/report", null, validReport);
    expect(filed.status).toBe(201);
    expect(filed.json.ok).toBe(true);

    const queue = await req("GET", "/api/admin/dmca-reports?status=new", ADMIN);
    expect(queue.status).toBe(200);
    expect(queue.json.reports).toHaveLength(1);
    expect(queue.json.reports[0]).toMatchObject({
      id: filed.json.id,
      reporterName: "Visiting Rights Holder",
      reporterEmail: "rights@example.test",
      infringingUrls: ["https://bowdownvisuals.com/track/taken"],
      status: "new",
    });
  });

  it("the intake refuses a report without the perjury agreement", async () => {
    const filed = await req("POST", "/api/dmca/report", null, { ...validReport, agree_under_penalty: "no" });
    expect(filed.status).toBe(400);
    const queue = await req("GET", "/api/admin/dmca-reports", ADMIN);
    expect(queue.json.reports).toHaveLength(0);
  });

  it("the intake refuses a malformed report", async () => {
    const filed = await req("POST", "/api/dmca/report", null, { reporter_name: "X" });
    expect(filed.status).toBe(400);
  });
});
