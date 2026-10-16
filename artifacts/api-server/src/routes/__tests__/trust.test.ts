/**
 * Stack 10 route tests — driven like real callers over HTTP against
 * the house fake db (_reach-fake-db), the pattern reach-routes uses:
 *   #1 fingerprint scan → symmetric claim lifecycle, #2 legacy
 *   designation + heir respond, #4 mod console permissions + automod
 *   honesty, #6 stage room create/list/close, #7 group ladder both
 *   directions + join questions/requests, #8 retention no-data honesty
 *   + curve math. The raw-SQL surfaces (#3 manifest completeness, #5
 *   statement totals) live in trust-money.test.ts against pg-mem,
 *   because the drizzle query builder and pg-mem cannot share a suite.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { encodePcm16Base64 } from "../../lib/fingerprint";
import { evaluateAutomod } from "../../lib/automod";
import { canGroupAction, canAssignRole } from "../../lib/group-roles";

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

const OWNER = randomUUID(), UPLOADER = randomUUID(), HEIR = randomUUID(), STRANGER = randomUUID();
const PROFILE = randomUUID(), GROUP = randomUUID(), VIDEO = randomUUID();
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

async function call(method: string, path: string, user: string | null, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method, headers: { "Content-Type": "application/json", ...(user ? { "x-test-user": user } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* pdf etc */ }
  return { status: r.status, json, text, headers: r.headers };
}

const CHORD_SETS: Record<string, number[][]> = {
  song: [[220, 330, 440], [262, 392, 523], [294, 440, 587], [330, 494, 659], [349, 523, 698], [392, 587, 784]],
  other: [[110, 165, 220], [131, 196, 262], [147, 220, 294], [165, 247, 330], [175, 262, 349], [196, 294, 392]],
};
function synthAudio(chords: number[][], seconds: number): string {
  const sr = 8000; const out = new Float32Array(seconds * sr);
  const seg = Math.floor(out.length / chords.length);
  for (let i = 0; i < out.length; i++) {
    const chord = chords[Math.min(chords.length - 1, Math.floor(i / seg))]!;
    let v = 0;
    for (const f of chord) v += 0.3 * Math.sin((2 * Math.PI * f * i) / sr);
    v += 0.12 * Math.sin((2 * Math.PI * chord[0]! * 2 * i) / sr);
    out[i] = v;
  }
  return encodePcm16Base64(out);
}
const SONG = CHORD_SETS.song!;

describe("#1 fingerprints + symmetric claims", () => {
  it("reference at opt-in, scan finds it, claim flows pending → disputed → resolved with both parties seeing the same evidence", async () => {
    const audio = synthAudio(SONG, 6);
    const fp = await call("POST", "/content-id/fingerprints", OWNER, { trackTitle: "My Song", audioBase64: audio });
    expect(fp.status).toBe(201);
    expect(fp.json.fingerprint.landmarkCount).toBeGreaterThan(20);

    const scan = await call("POST", "/content-id/scan", UPLOADER, { audioBase64: audio, sourceLabel: "upload-1" });
    expect(scan.status).toBe(201);
    expect(scan.json.scanScope).toBe("match-on-upload");
    expect(scan.json.remainder).toMatch(/not running/);
    expect(scan.json.matches).toHaveLength(1);
    const claim = scan.json.matches[0];
    expect(claim.status).toBe("pending");
    expect(claim.confidence).toBeGreaterThan(0.5);
    expect(Math.abs(claim.offsetSeconds)).toBeLessThan(0.2);

    expect((await call("PATCH", `/content-id/claims/${claim.id}`, OWNER, { action: "dispute", note: "mine" })).status).toBe(409);
    expect((await call("PATCH", `/content-id/claims/${claim.id}`, UPLOADER, { action: "accept" })).status).toBe(409);
    expect((await call("GET", "/content-id/claims", STRANGER)).json.claims).toHaveLength(0);
    const disputed = await call("PATCH", `/content-id/claims/${claim.id}`, UPLOADER, { action: "dispute", note: "Licensed beat lease #42" });
    expect(disputed.json.claim.status).toBe("disputed");
    const ownerView = await call("GET", "/content-id/claims", OWNER);
    expect(ownerView.json.claims[0].disputeNote).toBe("Licensed beat lease #42");
    expect(ownerView.json.claims[0].confidence).toBe(claim.confidence);
    expect((await call("PATCH", `/content-id/claims/${claim.id}`, OWNER, { action: "resolve" })).status).toBe(400);
    const resolved = await call("PATCH", `/content-id/claims/${claim.id}`, OWNER, { action: "resolve", note: "Lease verified — claim released." });
    expect(resolved.json.claim.status).toBe("resolved");
    expect(resolved.json.claim.resolutionNote).toMatch(/Lease verified/);
  });

  it("unrelated audio produces no claim", async () => {
    await call("POST", "/content-id/fingerprints", OWNER, { trackTitle: "My Song", audioBase64: synthAudio(SONG, 6) });
    const scan = await call("POST", "/content-id/scan", UPLOADER, { audioBase64: synthAudio(CHORD_SETS.other!, 6) });
    expect(scan.json.matches).toHaveLength(0);
    expect(scan.json.scannedReferences).toBe(1);
  });

  it("the owner accepting a pending claim works, and a terminal claim refuses more moves", async () => {
    const audio = synthAudio(SONG, 6);
    await call("POST", "/content-id/fingerprints", OWNER, { trackTitle: "My Song", audioBase64: audio });
    const scan = await call("POST", "/content-id/scan", UPLOADER, { audioBase64: audio });
    const claim = scan.json.matches[0];
    const accepted = await call("PATCH", `/content-id/claims/${claim.id}`, OWNER, { action: "accept" });
    expect(accepted.json.claim.status).toBe("accepted");
  });
});

describe("#2 legacy designation", () => {
  it("designate → heir sees pending → accepts; excludes are stated; self-heir refused; revoke works", async () => {
    expect((await call("POST", "/legacy/designation", OWNER, { heirUserId: OWNER })).status).toBe(400);
    const made = await call("POST", "/legacy/designation", OWNER, { heirUserId: HEIR, instructions: "Keep the page live." });
    expect(made.status).toBe(201);
    expect(made.json.designation.includes).toEqual(["catalog", "page"]);
    expect(made.json.designation.excludes).toContain("payment rails and payout credentials");
    expect(made.json.designation.activation).toBe("manual_review");
    const inbox = await call("GET", "/legacy/inbox", HEIR);
    expect(inbox.json.designations).toHaveLength(1);
    const id = inbox.json.designations[0].id;
    expect((await call("POST", `/legacy/inbox/${id}/respond`, STRANGER, { response: "accept" })).status).toBe(404);
    const accepted = await call("POST", `/legacy/inbox/${id}/respond`, HEIR, { response: "accept" });
    expect(accepted.json.designation.status).toBe("accepted");
    const revoked = await call("DELETE", "/legacy/designation", OWNER);
    expect(revoked.json.designation.status).toBe("revoked");
  });
});

describe("#3 catalog export (job shell; completeness in trust-money.test.ts)", () => {
  it("creates a completed job carrying the honest format choice", async () => {
    const made = await call("POST", "/catalog-export", OWNER);
    expect(made.status).toBe(201);
    expect(made.json.job.status).toBe("complete");
    expect(made.json.job.progress).toBe(100);
    expect(made.json.job.manifest.format).toBe("manifest+links");
    const list = await call("GET", "/catalog-export", OWNER);
    expect(list.json.jobs).toHaveLength(1);
    expect((await call("GET", `/catalog-export/${made.json.job.id}`, STRANGER)).status).toBe(404);
  });
});

describe("#4 mod console + automod", () => {
  it("automod verdicts name the rule that fired", () => {
    const rules = { blockLinks: true, blockedWords: ["spamword"], capsPercent: 80, capsMinLength: 12 };
    expect(evaluateAutomod("check https://example.com now", rules)).toMatchObject({ action: "flag", rule: "block_links" });
    expect(evaluateAutomod("this has SPAMWORD in it", rules)).toMatchObject({ action: "flag", rule: "blocked_word" });
    expect(evaluateAutomod("THIS IS ALL SHOUTING HERE", rules)).toMatchObject({ action: "flag", rule: "caps_limit" });
    expect(evaluateAutomod("a normal message", rules)).toMatchObject({ action: "allow" });
  });

  it("console is owner/mods only; mods can't set rules; actions require a reason; the flagged chatter can see why", async () => {
    seed("creatorProfiles", [{ id: PROFILE, userId: OWNER, slug: "me", displayName: "Me" }]);
    seed("liveChannelModerators", [{ profile_id: PROFILE, moderator_user_id: HEIR, appointed_by_user_id: OWNER }]);
    expect((await call("GET", `/mod-console?profileId=${PROFILE}`, STRANGER)).status).toBe(403);
    expect((await call("PUT", "/mod-console/automod", HEIR, { profileId: PROFILE, blockLinks: true })).status).toBe(403);
    const saved = await call("PUT", "/mod-console/automod", OWNER, { profileId: PROFILE, blockLinks: true, blockedWords: ["spamword"] });
    expect(saved.json.automod.blockLinks).toBe(true);
    expect((await call("POST", "/mod-console/actions", HEIR, { profileId: PROFILE, targetUserId: UPLOADER, action: "mute", reason: "" })).status).toBe(400);
    const logged = await call("POST", "/mod-console/actions", HEIR, { profileId: PROFILE, targetUserId: UPLOADER, action: "mute", reason: "Flooding the chat" });
    expect(logged.status).toBe(201);
    const console_ = await call("GET", `/mod-console?profileId=${PROFILE}`, OWNER);
    expect(console_.json.actions[0].reason).toBe("Flooding the chat");
    expect(console_.json.automod.blockedWords).toEqual(["spamword"]);
    const mine = await call("GET", "/mod-console/my-flags", UPLOADER);
    expect(mine.json.flags[0].reason).toBe("Flooding the chat");
  });
});

describe("#6 stage rooms REST", () => {
  it("create → listed open with caps stated → only the host closes", async () => {
    const made = await call("POST", "/stage-rooms", OWNER, { title: "Listening party" });
    expect(made.status).toBe(201);
    expect(made.json.room.speakerCap).toBe(8);
    expect(made.json.room.presenceCap).toBe(25);
    const list = await call("GET", "/stage-rooms", null);
    expect(list.json.rooms).toHaveLength(1);
    expect((await call("POST", `/stage-rooms/${made.json.room.id}/close`, STRANGER)).status).toBe(404);
    const closed = await call("POST", `/stage-rooms/${made.json.room.id}/close`, OWNER);
    expect(closed.json.room.status).toBe("closed");
    expect((await call("GET", "/stage-rooms", null)).json.rooms).toHaveLength(0);
  });
});

describe("#7 group ladder + onboarding", () => {
  it("ladder holds both directions (unit)", () => {
    expect(canGroupAction("member", "deletePost")).toBe(false);
    expect(canGroupAction("moderator", "deletePost")).toBe(true);
    expect(canGroupAction("moderator", "setJoinQuestions")).toBe(false);
    expect(canGroupAction("admin", "setJoinQuestions")).toBe(true);
    expect(canGroupAction("mod", "reviewJoinRequests")).toBe(true); // legacy value
    expect(canAssignRole("moderator", "member", "moderator")).toBe(false);
    expect(canAssignRole("admin", "member", "moderator")).toBe(true);
    expect(canAssignRole("admin", "admin", "member")).toBe(false); // peers are out of reach
    expect(canAssignRole("owner", "admin", "moderator")).toBe(true);
    expect(canAssignRole("owner", "member", "owner")).toBe(false); // ownership never moves this way
  });

  it("questions (admin+) → request with answers → moderator reviews with answers in view → approval joins", async () => {
    seed("groups", [{ id: GROUP, slug: "crew-a", name: "Crew A", memberCount: 3, description: "", isPublic: true, ownerProfileId: null, coverUrl: null }]);
    seed("groupMembers", [
      { groupId: GROUP, userId: OWNER, role: "owner" },
      { groupId: GROUP, userId: HEIR, role: "moderator" },
      { groupId: GROUP, userId: UPLOADER, role: "member" },
    ]);
    expect((await call("PUT", "/groups/crew-a/join-questions", HEIR, { questions: ["Why join?"] })).status).toBe(403);
    const set = await call("PUT", "/groups/crew-a/join-questions", OWNER, { questions: ["Why join?", "Your main link?"] });
    expect(set.json.questions).toHaveLength(2);
    const qs = set.json.questions;
    expect((await call("POST", "/groups/crew-a/join-requests", STRANGER, { answers: [{ questionId: qs[0].id, answer: "fans" }] })).status).toBe(400);
    const reqMade = await call("POST", "/groups/crew-a/join-requests", STRANGER, { answers: [{ questionId: qs[0].id, answer: "I make beats" }, { questionId: qs[1].id, answer: "example.com/me" }] });
    expect(reqMade.status).toBe(201);
    expect((await call("GET", "/groups/crew-a/join-requests", UPLOADER)).status).toBe(403);
    const queue = await call("GET", "/groups/crew-a/join-requests", HEIR);
    expect(queue.json.requests[0].answers[0].answer).toBe("I make beats");
    expect(queue.json.requests[0].answers[0].question).toBe("Why join?");
    const reviewed = await call("POST", `/groups/crew-a/join-requests/${queue.json.requests[0].id}/review`, HEIR, { decision: "approve" });
    expect(reviewed.json.status).toBe("approved");
    const role = await call("GET", "/groups/crew-a/my-role", STRANGER);
    expect(role.json.role).toBe("member");
  });

  it("role changes enforce the ladder over HTTP", async () => {
    seed("groups", [{ id: GROUP, slug: "crew-b", name: "Crew B", memberCount: 2, description: "", isPublic: true, ownerProfileId: null, coverUrl: null }]);
    seed("groupMembers", [
      { groupId: GROUP, userId: HEIR, role: "moderator" },
      { groupId: GROUP, userId: UPLOADER, role: "member" },
    ]);
    expect((await call("PATCH", `/groups/crew-b/members/${UPLOADER}/role`, HEIR, { role: "moderator" })).status).toBe(403);
    seed("groupMembers", [{ groupId: GROUP, userId: OWNER, role: "owner" }]);
    const ok = await call("PATCH", `/groups/crew-b/members/${UPLOADER}/role`, OWNER, { role: "moderator" });
    expect(ok.status).toBe(200);
    expect(ok.json.role).toBe("moderator");
  });
});

describe("#8 retention analytics", () => {
  it("a video with no heartbeats reads hasData:false — never a fabricated curve", async () => {
    const r = await call("GET", `/analytics/videos/${VIDEO}/retention`, OWNER);
    expect(r.json.hasData).toBe(false);
    expect(r.json.curve).toEqual([]);
    expect(r.json.note).toMatch(/never back-filled/);
  });

  it("heartbeats build a real curve and a follower/new-vs-returning breakdown from recorded rows", async () => {
    seed("creatorProfiles", [{ id: PROFILE, userId: OWNER, slug: "me", displayName: "Me" }]);
    seed("follows", [{ followerUserId: HEIR, profileId: PROFILE }]);
    for (const pos of [10, 50, 100]) await call("POST", "/analytics/retention/heartbeat", HEIR, { videoId: VIDEO, ownerUserId: OWNER, positionSeconds: pos, durationSeconds: 100 });
    await call("POST", "/analytics/retention/heartbeat", UPLOADER, { videoId: VIDEO, ownerUserId: OWNER, positionSeconds: 20, durationSeconds: 100 });
    const r = await call("GET", `/analytics/videos/${VIDEO}/retention`, OWNER);
    expect(r.json.hasData).toBe(true);
    expect(r.json.uniqueViewers).toBe(2);
    expect(r.json.curve[0].retainedPct).toBe(100);
    expect(r.json.curve[9].retainedPct).toBe(50);
    expect(r.json.audience).toMatchObject({ followers: 1, nonFollowers: 1, newViewers: 2, returningViewers: 0 });
  });
});
