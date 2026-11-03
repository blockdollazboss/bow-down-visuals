/**
 * Route tests for group bans at the join-request doors (stack1400
 * ruling #11, Y4 OD2) — routes/trust.ts.
 *
 * THE CONVICTIONS PINNED HERE:
 *  T1 — A banned user cannot even CREATE a join request: the request
 *    door is an entry door, and a request an admin could never
 *    approve must not enter the queue.
 *  T2 — A join request filed BEFORE the ban landed still cannot be
 *    approved into membership while the ban stands (review-approve
 *    checks the ban itself, it does not trust that creation checked).
 *    The refusal is not a decision: the request stays pending and
 *    untouched, and the SAME request approves cleanly once the ban
 *    is lifted.
 *  T3 — Denying a banned user's request still works — a denial
 *    admits nobody, so the ban gate never traps a request in the
 *    queue with no way out.
 *  T4 — Control: an unbanned user's request creates and approves
 *    exactly as before.
 *
 * Harness mirrors trust.test.ts: the REAL router over the house
 * fake db (_reach-fake-db), with groupBans registered alongside the
 * tables trust.test.ts already registers.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({ fake: null as any }));
vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const u = req.headers["x-test-user"];
    if (!u) { res.status(401).json({ error: "unauthorized" }); return; }
    req.userId = String(u); next();
  },
}));
vi.mock("../../lib/rate-limit", () => ({ publicApiLimiter: (_q: any, _s: any, n: any) => n() }));
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { createFakeDb } = await import("./_reach-fake-db");
  const fake = createFakeDb({
    contentIdOptins: actual.contentIdOptinsTable,
    contentIdFingerprints: actual.contentIdFingerprintsTable,
    contentIdMatches: actual.contentIdMatchesTable,
    legacyDesignations: actual.legacyDesignationsTable,
    catalogExportJobs: actual.catalogExportJobsTable,
    chatAutomodRules: actual.chatAutomodRulesTable,
    chatModActions: actual.chatModActionsTable,
    stageRooms: actual.stageRoomsTable,
    groupJoinQuestions: actual.groupJoinQuestionsTable,
    groupJoinRequests: actual.groupJoinRequestsTable,
    videoRetentionEvents: actual.videoRetentionEventsTable,
    creatorProfiles: actual.creatorProfilesTable,
    groups: actual.groupsTable,
    groupMembers: actual.groupMembersTable,
    groupBans: actual.groupBansTable,
    follows: actual.followsTable,
    liveChannelModerators: actual.liveChannelModeratorsTable,
    liveStreams: actual.liveStreamsTable,
    liveChatMessages: actual.liveChatMessagesTable,
    liveChatMutes: actual.liveChatMutesTable,
    liveStreamTips: actual.liveStreamTipsTable,
    notifications: actual.notificationsTable,
  });
  h.fake = fake;
  return { ...actual, db: fake.db };
});

import trustRouter from "../trust";

const OWNER = randomUUID(), MOD = randomUUID(), APPLICANT = randomUUID(), SECOND = randomUUID();
const GROUP = randomUUID(), Q1 = randomUUID();
const realFetch = globalThis.fetch;
let server: any; let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: "20mb" }));
  app.use((req: any, _res: any, next: any) => { req.log = { error: () => {}, info: () => {} }; next(); });
  app.use(trustRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });
beforeEach(() => { h.fake.clear(); });
const seed = (name: string, rows: Array<Record<string, unknown>>) => h.fake.seed(name, rows);
const rows = (name: string) => h.fake.store(name).rows as Array<Record<string, any>>;

async function call(method: string, path: string, user: string | null, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method, headers: { "Content-Type": "application/json", ...(user ? { "x-test-user": user } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* non-json */ }
  return { status: r.status, json, text, headers: r.headers };
}

function seedGroup() {
  seed("groups", [{ id: GROUP, slug: "crew-bans", name: "Crew Bans", memberCount: 2, description: "", isPublic: true, ownerProfileId: null, coverUrl: null }]);
  seed("groupMembers", [
    { groupId: GROUP, userId: OWNER, role: "owner" },
    { groupId: GROUP, userId: MOD, role: "moderator" },
  ]);
  seed("groupJoinQuestions", [{ id: Q1, group_id: GROUP, question: "Why join?", position: 0 }]);
}
function seedBan(userId: string) {
  seed("groupBans", [{ groupId: GROUP, userId, bannedByUserId: OWNER, reason: "Seeded ban.", createdAt: new Date() }]);
}
function liftBan(userId: string) {
  const store = h.fake.store("groupBans");
  store.rows = store.rows.filter((r: any) => r.userId !== userId);
}
async function fileRequest(user: string) {
  return call("POST", "/groups/crew-bans/join-requests", user, { answers: [{ questionId: Q1, answer: "I make beats" }] });
}

describe("group bans at the join-request doors (stack1400 #11)", () => {
  it("T4 control: an unbanned user's request creates, and approval admits them", async () => {
    seedGroup();
    const made = await fileRequest(APPLICANT);
    expect(made.status).toBe(201);
    const reviewed = await call("POST", `/groups/crew-bans/join-requests/${made.json.request.id}/review`, MOD, { decision: "approve" });
    expect(reviewed.status).toBe(200);
    expect(reviewed.json.status).toBe("approved");
    expect(rows("groupMembers").some((m) => m.userId === APPLICANT)).toBe(true);
  });

  it("T1: a banned user cannot create a join request — nothing enters the queue", async () => {
    seedGroup();
    seedBan(APPLICANT);
    const r = await fileRequest(APPLICANT);
    expect(r.status).toBe(403);
    expect(r.json.error).toMatch(/banned/i);
    expect(rows("groupJoinRequests")).toHaveLength(0);
    const queue = await call("GET", "/groups/crew-bans/join-requests", MOD);
    expect(queue.json.requests).toHaveLength(0);
  });

  it("T2: a request filed before the ban cannot be approved while banned; the same request approves after the ban lifts", async () => {
    seedGroup();
    const made = await fileRequest(APPLICANT);
    expect(made.status).toBe(201);
    const requestId = made.json.request.id;
    seedBan(APPLICANT); // the ban lands while the request is waiting
    const refused = await call("POST", `/groups/crew-bans/join-requests/${requestId}/review`, MOD, { decision: "approve" });
    expect(refused.status).toBe(403);
    expect(refused.json.error).toMatch(/banned/i);
    // Nobody was admitted, and the refusal was NOT a decision.
    expect(rows("groupMembers").some((m) => m.userId === APPLICANT)).toBe(false);
    expect(rows("groupJoinRequests").find((r) => r.id === requestId)?.status).toBe("pending");
    // Lift the ban (the unban door itself is pinned in the community
    // suite) — the very same request now approves into membership.
    liftBan(APPLICANT);
    const approved = await call("POST", `/groups/crew-bans/join-requests/${requestId}/review`, MOD, { decision: "approve" });
    expect(approved.status).toBe(200);
    expect(approved.json.status).toBe("approved");
    expect(rows("groupMembers").some((m) => m.userId === APPLICANT)).toBe(true);
  });

  it("T3: denying a banned user's waiting request still works — a denial admits nobody", async () => {
    seedGroup();
    const made = await fileRequest(SECOND);
    expect(made.status).toBe(201);
    seedBan(SECOND);
    const denied = await call("POST", `/groups/crew-bans/join-requests/${made.json.request.id}/review`, MOD, { decision: "deny" });
    expect(denied.status).toBe(200);
    expect(denied.json.status).toBe("denied");
    expect(rows("groupMembers").some((m) => m.userId === SECOND)).toBe(false);
  });

  it("the ban is per-group: banned here, the same user can still request into another group", async () => {
    seedGroup();
    const OTHER_GROUP = randomUUID(), Q2 = randomUUID();
    seed("groups", [{ id: OTHER_GROUP, slug: "crew-open", name: "Crew Open", memberCount: 1, description: "", isPublic: true, ownerProfileId: null, coverUrl: null }]);
    seed("groupMembers", [{ groupId: OTHER_GROUP, userId: OWNER, role: "owner" }]);
    seed("groupJoinQuestions", [{ id: Q2, group_id: OTHER_GROUP, question: "Why join?", position: 0 }]);
    seedBan(APPLICANT);
    const r = await call("POST", "/groups/crew-open/join-requests", APPLICANT, { answers: [{ questionId: Q2, answer: "New crew, clean slate" }] });
    expect(r.status).toBe(201);
  });

  it("my-role advertises the ban rungs honestly (admin+ only)", async () => {
    seedGroup();
    seed("groupMembers", [{ groupId: GROUP, userId: SECOND, role: "admin" }]);
    const ownerView = await call("GET", "/groups/crew-bans/my-role", OWNER);
    expect(ownerView.json.can.banMember).toBe(true);
    expect(ownerView.json.can.unbanMember).toBe(true);
    const adminView = await call("GET", "/groups/crew-bans/my-role", SECOND);
    expect(adminView.json.can.banMember).toBe(true);
    const modView = await call("GET", "/groups/crew-bans/my-role", MOD);
    expect(modView.json.can.banMember).toBe(false);
    expect(modView.json.can.unbanMember).toBe(false);
  });
});
