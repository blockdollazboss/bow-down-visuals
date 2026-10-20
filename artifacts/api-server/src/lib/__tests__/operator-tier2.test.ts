/**
 * Cloud Operator Phase 2, Lane D — the Tier-2 free writes, tested
 * through the REAL executor + REAL registry + REAL rail write paths
 * (the extracted cores in routes/community|social|scheduler|
 * storyboards|trust) over the shared fake db, so a "saved" here is a
 * row in the rail's own table, read back and asserted directly.
 *
 * The pins (design law, operator-phase2-scope.md §1 Tier 2 / §5D):
 *  - each write lands on the CALLER's rows and reads back through
 *    the rail — and can never land on another member's rows
 *  - a failed save audits `failed` with the rail's reason and the
 *    member hears a failure — never "saved" on a non-save
 *  - the audit row matches the result (summary + target from the
 *    handler's rail-built result; the legacy contact's email never
 *    becomes an audit target)
 *  - drafts refuse empty bodies BEFORE the rail (an empty body is
 *    the rail's CLEAR — a delete, and v1 has no deletes)
 *  - scheduling pins only an exact, future time; anything vaguer
 *    refuses and asks rather than guessing a fire time
 *  - the kill switch refuses a Tier-2 execution, audited
 *  - marker args ride the chat protocol end to end; a marker with
 *    no usable args degrades to {} and the handler refuses honestly
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const MEMBER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const THIRD = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CONV = "44444444-4444-4444-8444-444444444444";
const POST = "55555555-5555-4555-8555-555555555555";
const POST_UNKNOWN = "99999999-9999-4999-8999-999999999999";
const BOARD = "66666666-6666-4666-8666-666666666666";
const BOARD_AD = "77777777-7777-4777-8777-777777777777";
const FUTURE = "2027-01-15T17:00:00Z";

const h = vi.hoisted(() => ({ fake: null as any }));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { createFakeDb } = await import("../../routes/__tests__/_reach-fake-db");
  const fake = createFakeDb(
    {
      operatorActions: actual.operatorActionsTable,
      operatorPendingActions: actual.operatorPendingActionsTable,
      conversations: actual.conversationsTable,
      dmDrafts: actual.dmDraftsTable,
      posts: actual.postsTable,
      postReplyDrafts: actual.postReplyDraftsTable,
      storyboards: actual.storyboardsTable,
      legacyContacts: actual.legacyContactsTable,
      scheduledPosts: actual.scheduledPostsTable,
      creatorProfiles: actual.creatorProfilesTable,
    },
    {
      dmDrafts: [["conversationId", "userId"]],
      postReplyDrafts: [["postId", "userId"]],
      legacyContacts: [["user_id"]],
    },
  );
  h.fake = fake;
  return { ...actual, db: fake.db };
});

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/optional-auth", () => ({
  resolveOptionalSession: async () => undefined,
}));

vi.mock("../../lib/ai-clients", () => ({
  getOpenAI: () => {
    throw new Error("no model in operator-tier2 tests");
  },
  getTextModel: () => "test-model",
}));

vi.mock("../../lib/credits", () => {
  class OutOfCreditsError extends Error { readonly code = "OUT_OF_CREDITS"; }
  class LedgerWriteError extends Error { readonly code = "LEDGER_WRITE"; }
  return {
    OutOfCreditsError,
    LedgerWriteError,
    getCreditBalance: async () => 0,
    chargeCredits: async () => 0,
    refundCredits: async () => 0,
    buildChargeIdempotencyKey: () => "test-key",
    voidChargeIdempotencyKey: async () => true,
  };
});

/* Storage + mirror seams: identity, so what a rail "saves" is exactly
   what the handler handed it (the real mirror is exercised by the
   rails' own suites). */
vi.mock("../../lib/objectStorage", () => ({
  normalizeToStorageRef: (v: unknown) => v,
  refreshSupabaseStorageUrl: async (v: unknown) => v,
  refreshSupabaseStorageUrlsDeep: async (v: unknown) => v,
  isStorageRef: () => false,
  uploadMediaToSupabaseStorage: async (name: string) => `r2://test/${name}`,
}));

vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: async () => null,
  isExternalHttpUrl: (v: unknown) => typeof v === "string" && /^https?:\/\//i.test(v),
  isPermanentMediaValue: () => false,
}));

import { executeAction } from "../operator-executor";
import { extractActionMarker, processOperatorReply } from "../operator-chat";

function rows(table: string): any[] {
  return h.fake.store(table).rows;
}
function lastAudit(): any {
  const all = rows("operatorActions");
  return all[all.length - 1];
}
function run(toolId: string, args: Record<string, unknown>, userId = MEMBER) {
  return executeAction({ userId, toolId, args, channel: "chat_text" });
}

beforeEach(() => {
  h.fake.clear();
  delete process.env["OPERATOR_HANDS_ENABLED"];
  h.fake.seed("conversations", [
    { id: CONV, participantA: MEMBER, participantB: OTHER, status: "inbox", requestedBy: MEMBER, lastMessageAt: null, createdAt: new Date() },
  ]);
  h.fake.seed("posts", [
    { id: POST, profileId: OTHER, body: "original post", mediaUrls: [], kind: "post", audience: "public", removedAt: null, createdAt: new Date() },
  ]);
  h.fake.seed("storyboards", [
    { id: BOARD, userId: MEMBER, title: "Launch Teaser", panels: [], createdAt: new Date(), updatedAt: new Date("2026-10-01T00:00:00Z") },
    { id: BOARD_AD, userId: MEMBER, title: "Ad Cut", panels: [], createdAt: new Date(), updatedAt: new Date("2026-10-02T00:00:00Z") },
  ]);
});

afterEach(() => {
  delete process.env["OPERATOR_HANDS_ENABLED"];
});

/* ─── drafts.dm ─────────────────────────────────────────────────────── */

describe("drafts.dm — DM reply draft (0160/0157 rail: routes/community saveDmDraft)", () => {
  it("saves the caller's draft, reads back through the rail table, audits done", async () => {
    const out = await run("drafts.dm", { conversationId: CONV, body: "Draft words for the thread" });
    expect(out.status).toBe("done");
    expect(out.replyText).toContain("Draft words for the thread");
    const saved = rows("dmDrafts");
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ conversationId: CONV, userId: MEMBER, body: "Draft words for the thread" });
    const audit = lastAudit();
    expect(audit).toMatchObject({ toolId: "drafts.dm", result: "done", target: CONV, summary: "Saved a DM reply draft" });
  });

  it("a second save replaces the caller's row — still one row", async () => {
    await run("drafts.dm", { conversationId: CONV, body: "first take" });
    const out = await run("drafts.dm", { conversationId: CONV, body: "second take" });
    expect(out.status).toBe("done");
    const saved = rows("dmDrafts");
    expect(saved).toHaveLength(1);
    expect(saved[0].body).toBe("second take");
  });

  it("the other participant's draft is their own row — the caller's is untouched", async () => {
    await run("drafts.dm", { conversationId: CONV, body: "mine" });
    const out = await run("drafts.dm", { conversationId: CONV, body: "theirs" }, OTHER);
    expect(out.status).toBe("done");
    const saved = rows("dmDrafts");
    expect(saved).toHaveLength(2);
    expect(saved.find((r) => r.userId === MEMBER)?.body).toBe("mine");
    expect(saved.find((r) => r.userId === OTHER)?.body).toBe("theirs");
  });

  it("a non-participant cannot draft in the thread — failed audit, nothing written", async () => {
    const out = await run("drafts.dm", { conversationId: CONV, body: "sneaky" }, THIRD);
    expect(out.status).toBe("failed");
    expect(rows("dmDrafts")).toHaveLength(0);
    const audit = lastAudit();
    expect(audit.result).toBe("failed");
    expect(audit.resultReason).toContain("couldn't find that message thread");
  });

  it("an unknown conversation fails honestly", async () => {
    const out = await run("drafts.dm", { conversationId: POST_UNKNOWN, body: "hello?" });
    expect(out.status).toBe("failed");
    expect(rows("dmDrafts")).toHaveLength(0);
  });

  it("an empty body refuses BEFORE the rail — it never becomes the rail's clear", async () => {
    await run("drafts.dm", { conversationId: CONV, body: "keep me" });
    const out = await run("drafts.dm", { conversationId: CONV, body: "   " });
    expect(out.status).toBe("failed");
    expect(lastAudit().resultReason).toContain("no text to save");
    const saved = rows("dmDrafts");
    expect(saved).toHaveLength(1);
    expect(saved[0].body).toBe("keep me");
  });

  it("the rail's own 2,000-char cap refuses with the rail's words", async () => {
    const out = await run("drafts.dm", { conversationId: CONV, body: "x".repeat(2001) });
    expect(out.status).toBe("failed");
    expect(lastAudit().resultReason).toContain("2000");
    expect(rows("dmDrafts")).toHaveLength(0);
  });
});

/* ─── drafts.reply ──────────────────────────────────────────────────── */

describe("drafts.reply — post reply draft (routes/social savePostReplyDraft)", () => {
  it("saves with the composer's default tone and audits done", async () => {
    const out = await run("drafts.reply", { postId: POST, body: "Great track, fin-friend" });
    expect(out.status).toBe("done");
    expect(out.replyText).toContain("Great track, fin-friend");
    const saved = rows("postReplyDrafts");
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ postId: POST, userId: MEMBER, body: "Great track, fin-friend", tone: "hype" });
    expect(lastAudit()).toMatchObject({ toolId: "drafts.reply", result: "done", target: POST });
  });

  it("honors a named tone from the rail's own set", async () => {
    const out = await run("drafts.reply", { postId: POST, body: "Thank you!", tone: "grateful" });
    expect(out.status).toBe("done");
    expect(rows("postReplyDrafts")[0].tone).toBe("grateful");
  });

  it("another member's draft on the same post is a separate row", async () => {
    await run("drafts.reply", { postId: POST, body: "mine" });
    await run("drafts.reply", { postId: POST, body: "theirs" }, OTHER);
    const saved = rows("postReplyDrafts");
    expect(saved).toHaveLength(2);
    expect(saved.find((r) => r.userId === MEMBER)?.body).toBe("mine");
  });

  it("an unknown post fails honestly — no row, failed audit", async () => {
    const out = await run("drafts.reply", { postId: POST_UNKNOWN, body: "hello?" });
    expect(out.status).toBe("failed");
    expect(rows("postReplyDrafts")).toHaveLength(0);
    expect(lastAudit().result).toBe("failed");
  });

  it("a tone outside the rail's set fails the rail's validation", async () => {
    const out = await run("drafts.reply", { postId: POST, body: "words", tone: "sarcastic" });
    expect(out.status).toBe("failed");
    expect(rows("postReplyDrafts")).toHaveLength(0);
  });

  it("an empty body refuses before the rail — an existing draft survives", async () => {
    await run("drafts.reply", { postId: POST, body: "keep me" });
    const out = await run("drafts.reply", { postId: POST, body: "" });
    expect(out.status).toBe("failed");
    expect(rows("postReplyDrafts")).toHaveLength(1);
    expect(rows("postReplyDrafts")[0].body).toBe("keep me");
  });
});

/* ─── posts.schedule ────────────────────────────────────────────────── */

describe("posts.schedule — scheduled post (routes/scheduler createLegacyScheduledPost)", () => {
  const baseArgs = {
    content: "New drop Friday",
    mediaUrl: "https://cdn.example.com/clip.mp4",
    platform: "instagram",
    scheduledAt: FUTURE,
  };

  it("creates the schedule entry on the caller's rows and says the poller fires it", async () => {
    const out = await run("posts.schedule", baseArgs);
    expect(out.status).toBe("done");
    expect(out.replyText).toContain("schedule entry");
    expect(out.replyText).toContain("job runner");
    const saved = rows("scheduledPosts");
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      user_id: MEMBER,
      status: "scheduled",
      caption: "New drop Friday",
      media_url: "https://cdn.example.com/clip.mp4",
      platforms: ["instagram"],
    });
    expect(new Date(saved[0].scheduled_at).toISOString()).toBe(new Date(FUTURE).toISOString());
    expect(lastAudit()).toMatchObject({ toolId: "posts.schedule", result: "done", target: "instagram" });
  });

  it("an unpinnable time refuses and asks — nothing is scheduled", async () => {
    const out = await run("posts.schedule", { ...baseArgs, scheduledAt: "next Friday-ish" });
    expect(out.status).toBe("failed");
    expect(lastAudit().resultReason).toContain("pin that time");
    expect(rows("scheduledPosts")).toHaveLength(0);
  });

  it("a past time refuses — nothing is scheduled", async () => {
    const out = await run("posts.schedule", { ...baseArgs, scheduledAt: "2020-01-01T00:00:00Z" });
    expect(out.status).toBe("failed");
    expect(lastAudit().resultReason).toContain("already past");
    expect(rows("scheduledPosts")).toHaveLength(0);
  });

  it("a platform the rail doesn't post to refuses", async () => {
    const out = await run("posts.schedule", { ...baseArgs, platform: "myspace" });
    expect(out.status).toBe("failed");
    expect(rows("scheduledPosts")).toHaveLength(0);
  });

  it("missing media refuses — the rail requires it", async () => {
    const out = await run("posts.schedule", { content: "words", platform: "tiktok", scheduledAt: FUTURE });
    expect(out.status).toBe("failed");
    expect(rows("scheduledPosts")).toHaveLength(0);
  });
});

/* ─── storyboard.save ───────────────────────────────────────────────── */

describe("storyboard.save — storyboard panel (routes/storyboards cores)", () => {
  it("appends a panel to the caller's named board and audits the board", async () => {
    const out = await run("storyboard.save", { boardId: BOARD, title: "Opening shot", notes: "Drone over the palace" });
    expect(out.status).toBe("done");
    expect(out.replyText).toContain("Launch Teaser");
    expect(out.replyText).toContain("panel 1");
    const board = rows("storyboards").find((b) => b.id === BOARD);
    expect(board.panels).toHaveLength(1);
    expect(board.panels[0]).toMatchObject({ title: "Opening shot", notes: "Drone over the palace" });
    expect(lastAudit()).toMatchObject({ toolId: "storyboard.save", result: "done", target: BOARD });
  });

  it("resolves a board by the caller's own board title", async () => {
    const out = await run("storyboard.save", { boardTitle: "Ad Cut", title: "Logo sting" });
    expect(out.status).toBe("done");
    const ad = rows("storyboards").find((b) => b.id === BOARD_AD);
    expect(ad.panels).toHaveLength(1);
    const teaser = rows("storyboards").find((b) => b.id === BOARD);
    expect(teaser.panels).toHaveLength(0);
  });

  it("creates a board for a member who has none, owned by them", async () => {
    h.fake.store("storyboards").rows.length = 0;
    const out = await run("storyboard.save", { title: "First panel" }, OTHER);
    expect(out.status).toBe("done");
    const boards = rows("storyboards");
    expect(boards).toHaveLength(1);
    expect(boards[0].userId).toBe(OTHER);
    expect(boards[0].panels).toHaveLength(1);
  });

  it("another member's board id is a not_found — their board is never written", async () => {
    const out = await run("storyboard.save", { boardId: BOARD, title: "vandalism" }, OTHER);
    expect(out.status).toBe("failed");
    expect(lastAudit().resultReason).toContain("couldn't find that storyboard");
    const board = rows("storyboards").find((b) => b.id === BOARD);
    expect(board.panels).toHaveLength(0);
  });

  it("a panel with nothing on it refuses", async () => {
    const out = await run("storyboard.save", { boardId: BOARD });
    expect(out.status).toBe("failed");
    const board = rows("storyboards").find((b) => b.id === BOARD);
    expect(board.panels).toHaveLength(0);
  });

  it("an over-long panel title fails the rail's own schema", async () => {
    const out = await run("storyboard.save", { boardId: BOARD, title: "x".repeat(161) });
    expect(out.status).toBe("failed");
    const board = rows("storyboards").find((b) => b.id === BOARD);
    expect(board.panels).toHaveLength(0);
  });
});

/* ─── settings.legacy-contact ───────────────────────────────────────── */

describe("settings.legacy-contact — legacy contact (routes/trust saveLegacyContact)", () => {
  it("saves the caller's contact; the email never becomes an audit target", async () => {
    const out = await run("settings.legacy-contact", { name: "Maya Reef", email: "maya@example.com", note: "my sister" });
    expect(out.status).toBe("done");
    expect(out.replyText).toContain("Maya Reef");
    expect(out.replyText).toContain("maya@example.com");
    const saved = rows("legacyContacts");
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ user_id: MEMBER, contact_name: "Maya Reef", contact_email: "maya@example.com", note: "my sister" });
    const audit = lastAudit();
    expect(audit).toMatchObject({ toolId: "settings.legacy-contact", result: "done", summary: "Set legacy contact" });
    expect(audit.target).toBeNull();
  });

  it("a second save updates the caller's one row in place", async () => {
    await run("settings.legacy-contact", { name: "Maya Reef", email: "maya@example.com" });
    const out = await run("settings.legacy-contact", { name: "Maya Reef", email: "maya@new.example.com" });
    expect(out.status).toBe("done");
    const saved = rows("legacyContacts");
    expect(saved).toHaveLength(1);
    expect(saved[0].contact_email).toBe("maya@new.example.com");
    expect(lastAudit().summary).toBe("Updated legacy contact");
  });

  it("another member's contact is their own row — the caller's is untouched", async () => {
    await run("settings.legacy-contact", { name: "Mine", email: "mine@example.com" });
    await run("settings.legacy-contact", { name: "Theirs", email: "theirs@example.com" }, OTHER);
    const saved = rows("legacyContacts");
    expect(saved).toHaveLength(2);
    expect(saved.find((r) => r.user_id === MEMBER)?.contact_email).toBe("mine@example.com");
    expect(saved.find((r) => r.user_id === OTHER)?.contact_email).toBe("theirs@example.com");
  });

  it("an invalid email fails the rail's validation — nothing saved", async () => {
    const out = await run("settings.legacy-contact", { name: "Maya Reef", email: "not-an-email" });
    expect(out.status).toBe("failed");
    expect(rows("legacyContacts")).toHaveLength(0);
    expect(lastAudit().result).toBe("failed");
  });
});

/* ─── protocol: kill switch + marker args ───────────────────────────── */

describe("protocol — kill switch and marker args", () => {
  it("the kill switch refuses a Tier-2 write, audited, nothing written", async () => {
    process.env["OPERATOR_HANDS_ENABLED"] = "off";
    const out = await run("drafts.dm", { conversationId: CONV, body: "words" });
    expect(out.status).toBe("refused");
    expect(out.reason).toBe("hands_disabled");
    expect(rows("dmDrafts")).toHaveLength(0);
    expect(lastAudit()).toMatchObject({ result: "refused", resultReason: "hands_disabled" });
  });

  it("marker args ride the chat protocol end to end", async () => {
    const turn = await processOperatorReply({
      userId: MEMBER,
      channel: "chat_text",
      modelReply: `On it.\n[[DO:drafts.dm {"conversationId":"${CONV}","body":"see you at the show"}]]`,
    });
    expect(turn?.action.status).toBe("done");
    expect(turn?.replyText).toContain("see you at the show");
    expect(rows("dmDrafts")).toHaveLength(1);
  });

  it("a marker with no args degrades to {} and the handler refuses honestly", async () => {
    const turn = await processOperatorReply({
      userId: MEMBER,
      channel: "chat_text",
      modelReply: "Saving that now.\n[[DO:drafts.dm]]",
    });
    expect(turn?.action.status).toBe("failed");
    expect(rows("dmDrafts")).toHaveLength(0);
  });

  it("extractActionMarker: args parse, degrade, and stay optional", () => {
    expect(extractActionMarker("x [[DO:credits.balance]]")).toEqual({ toolId: "credits.balance", args: {} });
    expect(extractActionMarker(`x [[DO:drafts.dm {"conversationId":"c1"}]]`)).toEqual({
      toolId: "drafts.dm",
      args: { conversationId: "c1" },
    });
    expect(extractActionMarker("x [[DO:drafts.dm {nope}]]")).toEqual({ toolId: "drafts.dm", args: {} });
    expect(extractActionMarker("x [[DO:drafts.dm [1,2]]]")).toBeNull();
    expect(extractActionMarker("no marker here")).toBeNull();
  });
});
