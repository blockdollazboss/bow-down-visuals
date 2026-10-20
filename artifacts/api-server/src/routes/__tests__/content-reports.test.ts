/**
 * Route tests for member content reports (Stack-4 #3):
 *   POST  /api/reports              file a report (members only)
 *   GET   /api/admin/reports        the admin queue (DMCA-bench twin)
 *   PATCH /api/admin/reports/:id    move a report through its workflow
 *
 * THE CONTRACT PINNED HERE:
 * - Members only: guests 401 at POST; the admin rails repeat the
 *   DMCA gate exactly (guest 401, member-not-admin 403, allowlist
 *   unset = fail-closed 403 for everyone).
 * - The target must EXIST and match its claimed type. "comment"
 *   resolves across the three real comment stores (post thread
 *   replies, profile_comments, media_comments); a top-level post
 *   filed as a comment — or a reply filed as a post — is a 404,
 *   never a queued row against the wrong thing.
 * - Nobody reports their own content (owner resolved server-side
 *   from the target row, never trusted from the client): 400.
 * - One OPEN report per (reporter, target): re-filing while the
 *   first is still new/reviewing returns the open row with
 *   { duplicate: true } and stores NO second row; once the first is
 *   decided (actioned/dismissed), filing again lands a fresh row.
 *   The fake's contentReports registration models migration 0174's
 *   partial unique index via uniqueWhen (open statuses only).
 * - The admin queue is newest-first with the full DTO, ?status=
 *   filters, and an unknown status is a 400 — never a fake-empty
 *   queue. PATCH validation mirrors the DMCA bench (400 bad status /
 *   malformed id, 404 missing row).
 *
 * Fake db: the shared _reach-fake-db store, same as the DMCA suite.
 * The per-user report rate limiter (30 / 15 min) is no obstacle:
 * identity-sensitive tests reuse MEMBER; everything else files as a
 * fresh reporter id per test.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const ADMIN_ID = "00000000-0000-4000-8000-0000000000a1";
const MEMBER_ID = "00000000-0000-4000-8000-0000000000a2";
const OWNER_ID = "00000000-0000-4000-8000-0000000000a3";
const COMMENTER_ID = "00000000-0000-4000-8000-0000000000a4";
const ADMIN_EMAIL = "king@example.test";
const MEMBER_EMAIL = "member@example.test";

const PROFILE_ID = "00000000-0000-4000-8000-0000000000b1";
const REPORTER_PROFILE_ID = "00000000-0000-4000-8000-0000000000b2";
const POST_ID = "00000000-0000-4000-8000-0000000000c1";
const REPLY_ID = "00000000-0000-4000-8000-0000000000c2";
const OWN_POST_ID = "00000000-0000-4000-8000-0000000000c3";
const WALL_COMMENT_ID = "00000000-0000-4000-8000-0000000000d1";
const MEDIA_COMMENT_ID = "00000000-0000-4000-8000-0000000000d2";
const MEDIA_ID = "00000000-0000-4000-8000-0000000000d3";
const MISSING_ID = "00000000-0000-4000-8000-0000000000e9";

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
    throw new Error("supabase must not be touched by the reports routes");
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
  const fake = createFakeDb(
    {
      contentReports: actual.contentReportsTable,
      posts: actual.postsTable,
      creatorProfiles: actual.creatorProfilesTable,
      profileComments: actual.profileCommentsTable,
      mediaComments: actual.mediaCommentsTable,
      artistVaults: actual.artistVaultsTable,
      spotlightInquiries: actual.spotlightInquiriesTable,
      contactMessages: actual.contactMessagesTable,
      dmcaReports: actual.dmcaReportsTable,
    },
    { contentReports: [["reporterUserId", "targetType", "targetId"]] },
    { contentReports: (row: any) => row.status === "new" || row.status === "reviewing" },
  );
  h.fake = fake;
  return { ...actual, db: fake.db };
});

import adminRouter from "../admin";
import reportsRouter from "../reports";

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
  app.use("/api", reportsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
});

type Who = { id: string; email: string } | null;
const ADMIN: Who = { id: ADMIN_ID, email: ADMIN_EMAIL };
const MEMBER: Who = { id: MEMBER_ID, email: MEMBER_EMAIL };

let filerSeq = 0;
/** A distinct reporter identity for tests where the filer's identity
 *  is not the point (keeps the per-user rate limiter out of the way
 *  and proves idempotency is per-reporter, not global). */
function freshFiler(): Who {
  filerSeq += 1;
  return { id: `00000000-0000-4000-8000-${String(0xf000 + filerSeq).padStart(12, "0")}`, email: `filer${filerSeq}@example.test` };
}

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

function seedWorld() {
  h.fake.seed("creatorProfiles", [
    { id: PROFILE_ID, userId: OWNER_ID, slug: "owner-one", displayName: "Owner One" },
    { id: REPORTER_PROFILE_ID, userId: MEMBER_ID, slug: "reporter-one", displayName: "Reporter One" },
  ]);
  h.fake.seed("posts", [
    { id: POST_ID, profileId: PROFILE_ID, kind: "post", body: "Buy my mixtape now — streaming everywhere, link in bio" },
    { id: REPLY_ID, profileId: PROFILE_ID, kind: "thread_reply", body: "a heated reply in the thread" },
    { id: OWN_POST_ID, profileId: REPORTER_PROFILE_ID, kind: "post", body: "the reporter's own post" },
  ]);
  h.fake.seed("profileComments", [
    { id: WALL_COMMENT_ID, profileId: PROFILE_ID, authorUserId: COMMENTER_ID, body: "shout on the wall" },
  ]);
  h.fake.seed("mediaComments", [
    { id: MEDIA_COMMENT_ID, mediaId: MEDIA_ID, authorUserId: COMMENTER_ID, body: "comment under the track" },
  ]);
}

const reportRows = () => h.fake.store("contentReports").rows as any[];

beforeEach(() => {
  h.fake.clear();
  seedWorld();
  process.env["ADMIN_EMAILS"] = ADMIN_EMAIL;
});

describe("POST /api/reports — filing", () => {
  it("401s a guest and stores nothing", async () => {
    const res = await req("POST", "/api/reports", null, { target_type: "post", target_id: POST_ID, reason: "spam" });
    expect(res.status).toBe(401);
    expect(reportRows()).toHaveLength(0);
  });

  it("files a post report: 201, owner + summary snapshot stored, status new", async () => {
    const res = await req("POST", "/api/reports", freshFiler(), {
      target_type: "post", target_id: POST_ID, reason: "spam", note: "third time today",
    });
    expect(res.status).toBe(201);
    expect(res.json.report).toMatchObject({
      targetType: "post",
      targetId: POST_ID,
      targetOwnerUserId: OWNER_ID,
      targetSummary: "Buy my mixtape now — streaming everywhere, link in bio",
      reason: "spam",
      note: "third time today",
      status: "new",
    });
    expect(reportRows()).toHaveLength(1);
    expect(reportRows()[0].reporterUserId).toBe(res.json.report.reporterUserId);
  });

  it("stores a null note when none is given", async () => {
    const res = await req("POST", "/api/reports", freshFiler(), { target_type: "post", target_id: POST_ID, reason: "harassment" });
    expect(res.status).toBe(201);
    expect(res.json.report.note).toBeNull();
  });

  it("resolves a thread reply filed as a comment, owned via its profile", async () => {
    const res = await req("POST", "/api/reports", freshFiler(), { target_type: "comment", target_id: REPLY_ID, reason: "harassment" });
    expect(res.status).toBe(201);
    expect(res.json.report).toMatchObject({ targetType: "comment", targetId: REPLY_ID, targetOwnerUserId: OWNER_ID, targetSummary: "a heated reply in the thread" });
  });

  it("resolves a Shout Wall (profile_comments) comment", async () => {
    const res = await req("POST", "/api/reports", freshFiler(), { target_type: "comment", target_id: WALL_COMMENT_ID, reason: "hate_speech" });
    expect(res.status).toBe(201);
    expect(res.json.report).toMatchObject({ targetOwnerUserId: COMMENTER_ID, targetSummary: "shout on the wall" });
  });

  it("resolves a media comment", async () => {
    const res = await req("POST", "/api/reports", freshFiler(), { target_type: "comment", target_id: MEDIA_COMMENT_ID, reason: "scam" });
    expect(res.status).toBe(201);
    expect(res.json.report).toMatchObject({ targetOwnerUserId: COMMENTER_ID, targetSummary: "comment under the track" });
  });

  it("files a profile report with the display name as the summary", async () => {
    const res = await req("POST", "/api/reports", freshFiler(), { target_type: "profile", target_id: PROFILE_ID, reason: "copyright" });
    expect(res.status).toBe(201);
    expect(res.json.report).toMatchObject({ targetType: "profile", targetOwnerUserId: OWNER_ID, targetSummary: "Owner One" });
  });
});

describe("POST /api/reports — honesty rails", () => {
  it("404s a nonexistent post, comment, and profile — and stores nothing", async () => {
    for (const target_type of ["post", "comment", "profile"] as const) {
      const res = await req("POST", "/api/reports", freshFiler(), { target_type, target_id: MISSING_ID, reason: "spam" });
      expect(res.status).toBe(404);
    }
    expect(reportRows()).toHaveLength(0);
  });

  it("404s a reply filed as a post and a post filed as a comment (type must match)", async () => {
    const asPost = await req("POST", "/api/reports", freshFiler(), { target_type: "post", target_id: REPLY_ID, reason: "spam" });
    expect(asPost.status).toBe(404);
    const asComment = await req("POST", "/api/reports", freshFiler(), { target_type: "comment", target_id: POST_ID, reason: "spam" });
    expect(asComment.status).toBe(404);
    expect(reportRows()).toHaveLength(0);
  });

  it("400s reporting your own post, your own comment, and your own profile", async () => {
    const ownPost = await req("POST", "/api/reports", MEMBER, { target_type: "post", target_id: OWN_POST_ID, reason: "spam" });
    expect(ownPost.status).toBe(400);
    expect(ownPost.json.error).toMatch(/own content/);
    const ownProfile = await req("POST", "/api/reports", MEMBER, { target_type: "profile", target_id: REPORTER_PROFILE_ID, reason: "spam" });
    expect(ownProfile.status).toBe(400);
    expect(ownProfile.json.error).toMatch(/own profile/);
    expect(reportRows()).toHaveLength(0);
  });

  it("400s a reason outside the fixed list, an unknown target type, a malformed id, and an over-long note", async () => {
    const badReason = await req("POST", "/api/reports", freshFiler(), { target_type: "post", target_id: POST_ID, reason: "rudeness" });
    expect(badReason.status).toBe(400);
    const badType = await req("POST", "/api/reports", freshFiler(), { target_type: "video", target_id: POST_ID, reason: "spam" });
    expect(badType.status).toBe(400);
    const badId = await req("POST", "/api/reports", freshFiler(), { target_type: "post", target_id: "not-a-uuid", reason: "spam" });
    expect(badId.status).toBe(400);
    const longNote = await req("POST", "/api/reports", freshFiler(), { target_type: "post", target_id: POST_ID, reason: "spam", note: "x".repeat(501) });
    expect(longNote.status).toBe(400);
    expect(reportRows()).toHaveLength(0);
  });
});

describe("POST /api/reports — one open report per (reporter, target)", () => {
  it("re-filing while open returns the same row as a duplicate and stores no second row", async () => {
    const first = await req("POST", "/api/reports", MEMBER, { target_type: "post", target_id: POST_ID, reason: "spam" });
    expect(first.status).toBe(201);
    const second = await req("POST", "/api/reports", MEMBER, { target_type: "post", target_id: POST_ID, reason: "copyright" });
    expect(second.status).toBe(200);
    expect(second.json.duplicate).toBe(true);
    expect(second.json.report.id).toBe(first.json.report.id);
    expect(reportRows()).toHaveLength(1);
    /* The open row keeps its original reason — a duplicate filing
       never rewrites the report already in the queue. */
    expect(reportRows()[0].reason).toBe("spam");
  });

  it("a different member filing on the same target is NOT a duplicate", async () => {
    const a = await req("POST", "/api/reports", MEMBER, { target_type: "post", target_id: POST_ID, reason: "spam" });
    const b = await req("POST", "/api/reports", freshFiler(), { target_type: "post", target_id: POST_ID, reason: "spam" });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.json.report.id).not.toBe(a.json.report.id);
    expect(reportRows()).toHaveLength(2);
  });

  it("once the open report is decided, the same member may file again — a fresh row", async () => {
    const first = await req("POST", "/api/reports", MEMBER, { target_type: "post", target_id: POST_ID, reason: "spam" });
    expect(first.status).toBe(201);
    const decided = await req("PATCH", `/api/admin/reports/${first.json.report.id}`, ADMIN, { status: "dismissed" });
    expect(decided.status).toBe(200);
    const again = await req("POST", "/api/reports", MEMBER, { target_type: "post", target_id: POST_ID, reason: "spam" });
    expect(again.status).toBe(201);
    expect(again.json.report.id).not.toBe(first.json.report.id);
    expect(reportRows()).toHaveLength(2);
  });
});

describe("GET /api/admin/reports — the queue", () => {
  it("401s a guest, 403s a member, and 403s everyone when ADMIN_EMAILS is unset (fail-closed)", async () => {
    expect((await req("GET", "/api/admin/reports", null)).status).toBe(401);
    expect((await req("GET", "/api/admin/reports", MEMBER)).status).toBe(403);
    delete process.env["ADMIN_EMAILS"];
    expect((await req("GET", "/api/admin/reports", ADMIN)).status).toBe(403);
  });

  it("an empty queue is an honest empty list", async () => {
    const res = await req("GET", "/api/admin/reports", ADMIN);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ reports: [] });
  });

  it("returns the full DTO newest-first", async () => {
    h.fake.seed("contentReports", [
      { id: "00000000-0000-4000-8000-000000000101", reporterUserId: MEMBER_ID, targetType: "post", targetId: POST_ID, targetOwnerUserId: OWNER_ID, targetSummary: "older", reason: "spam", note: null, status: "new", createdAt: new Date("2026-10-01T00:00:00Z") },
      { id: "00000000-0000-4000-8000-000000000102", reporterUserId: MEMBER_ID, targetType: "profile", targetId: PROFILE_ID, targetOwnerUserId: OWNER_ID, targetSummary: "newer", reason: "copyright", note: "looks like my brand", status: "reviewing", createdAt: new Date("2026-10-02T00:00:00Z") },
    ]);
    const res = await req("GET", "/api/admin/reports", ADMIN);
    expect(res.status).toBe(200);
    expect(res.json.reports.map((r: any) => r.targetSummary)).toEqual(["newer", "older"]);
    expect(Object.keys(res.json.reports[0]).sort()).toEqual(
      ["createdAt", "id", "note", "reason", "reporterUserId", "status", "targetId", "targetOwnerUserId", "targetSummary", "targetType"].sort(),
    );
  });

  it("filters by status and 400s an unknown status instead of faking an empty queue", async () => {
    h.fake.seed("contentReports", [
      { id: "00000000-0000-4000-8000-000000000101", reporterUserId: MEMBER_ID, targetType: "post", targetId: POST_ID, targetOwnerUserId: OWNER_ID, targetSummary: "one", reason: "spam", note: null, status: "new", createdAt: new Date("2026-10-01T00:00:00Z") },
      { id: "00000000-0000-4000-8000-000000000102", reporterUserId: MEMBER_ID, targetType: "post", targetId: POST_ID, targetOwnerUserId: OWNER_ID, targetSummary: "two", reason: "spam", note: null, status: "actioned", createdAt: new Date("2026-10-02T00:00:00Z") },
    ]);
    const only = await req("GET", "/api/admin/reports?status=actioned", ADMIN);
    expect(only.status).toBe(200);
    expect(only.json.reports).toHaveLength(1);
    expect(only.json.reports[0].targetSummary).toBe("two");
    const bogus = await req("GET", "/api/admin/reports?status=bogus", ADMIN);
    expect(bogus.status).toBe(400);
  });
});

describe("PATCH /api/admin/reports/:id — the workflow", () => {
  async function fileOne(): Promise<string> {
    const res = await req("POST", "/api/reports", freshFiler(), { target_type: "post", target_id: POST_ID, reason: "spam" });
    expect(res.status).toBe(201);
    return res.json.report.id as string;
  }

  it("moves a report new → reviewing and the queue shows the new state", async () => {
    const id = await fileOne();
    const moved = await req("PATCH", `/api/admin/reports/${id}`, ADMIN, { status: "reviewing" });
    expect(moved.status).toBe(200);
    expect(moved.json.report.status).toBe("reviewing");
    const queue = await req("GET", "/api/admin/reports?status=reviewing", ADMIN);
    expect(queue.json.reports.map((r: any) => r.id)).toEqual([id]);
  });

  it("401s a guest and 403s a member — and the row does not move", async () => {
    const id = await fileOne();
    expect((await req("PATCH", `/api/admin/reports/${id}`, null, { status: "actioned" })).status).toBe(401);
    expect((await req("PATCH", `/api/admin/reports/${id}`, MEMBER, { status: "actioned" })).status).toBe(403);
    expect(reportRows()[0].status).toBe("new");
  });

  it("400s an invalid status and a malformed id; 404s a missing report", async () => {
    const id = await fileOne();
    expect((await req("PATCH", `/api/admin/reports/${id}`, ADMIN, { status: "banned" })).status).toBe(400);
    expect((await req("PATCH", "/api/admin/reports/not-a-uuid", ADMIN, { status: "reviewing" })).status).toBe(400);
    expect((await req("PATCH", `/api/admin/reports/${MISSING_ID}`, ADMIN, { status: "reviewing" })).status).toBe(404);
    expect(reportRows()[0].status).toBe("new");
  });
});
