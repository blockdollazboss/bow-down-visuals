/**
 * pitch-fix.test.ts — UPGRADES 196 + 180: the Pitch & Fix intake
 * against an in-memory store.
 *
 * Pins:
 * - MODERATION GATE: submissions are born pending; the public board
 *   NEVER returns a pending or rejected row, for any kind.
 * - Doors validate their vocabularies (pitch category; fix page +
 *   severity); feedback requires a 1–5 rating and keeps ONE line.
 * - Pitch Board votes: toggle on/off, one count per member, only on
 *   approved pitches; Top sort is votes-then-newest.
 * - Team statuses: pitch statuses refuse fix rows and vice versa;
 *   shipped/fixed stamps shippedAt (the RECENTLY SHIPPED strip).
 * - Feedback Pop-Up cap: default ON + never prompted = eligible;
 *   a showing caps for exactly 7 days; toggle OFF refuses showings
 *   and submissions of eligibility alike; accounts are isolated.
 * - NO money: no wire shape carries a price/credit/reward field.
 */
import { describe, expect, it } from "vitest";
import {
  FEEDBACK_PROMPT_CAP_MS,
  PitchFixError,
  feedbackEligibility,
  getFeedbackEligibility,
  getFeedbackPrefs,
  getPublicBoard,
  listModerationQueue,
  listMySubmissions,
  moderateSubmission,
  recordPromptShown,
  setFeedbackEnabled,
  setSubmissionStatus,
  submitFeedback,
  submitFix,
  submitPitch,
  togglePitchVote,
  type FeedbackPrefsRow,
  type NewSubmissionRow,
  type PitchFixStore,
  type SubmissionWire,
} from "../pitch-fix";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const ADMIN = "99999999-9999-4999-8999-999999999999";

function memoryStore(): PitchFixStore {
  const rows = new Map<string, SubmissionWire>();
  const votes = new Set<string>();
  const prefs = new Map<string, FeedbackPrefsRow>();
  let seq = 0;
  const stamp = () => new Date(Date.UTC(2026, 9, 25, 12, 0, seq)).toISOString();
  return {
    async insertSubmission(input: NewSubmissionRow) {
      seq += 1;
      const row: SubmissionWire = {
        id: `sub-${seq}`,
        ...input,
        moderationStatus: "pending",
        upvoteCount: 0,
        rewardStatus: input.rewardStatus ?? "none",
        rewardAmount: null,
        rewardQueuedAt: null,
        rewardPaidAt: null,
        duplicateOfId: input.duplicateOfId ?? null,
        shippedAt: null,
        createdAt: stamp(),
        updatedAt: stamp(),
      };
      rows.set(row.id, row);
      return { ...row };
    },
    async listSubmissions() {
      return [...rows.values()].map((r) => ({ ...r }));
    },
    async getSubmission(id) {
      const r = rows.get(id);
      return r ? { ...r } : null;
    },
    async updateSubmission(id, patch) {
      const r = rows.get(id);
      if (!r) return null;
      const next = { ...r, ...patch, updatedAt: stamp() } as SubmissionWire;
      rows.set(id, next);
      return { ...next };
    },
    async claimReward(id, paidAt) {
      const r = rows.get(id);
      if (!r || r.rewardStatus !== "queued") return false;
      rows.set(id, { ...r, rewardStatus: "paid", rewardPaidAt: paidAt });
      return true;
    },
    async releaseRewardClaim(id) {
      const r = rows.get(id);
      if (r && r.rewardStatus === "paid") rows.set(id, { ...r, rewardStatus: "queued", rewardPaidAt: null });
    },
    async hasVote(submissionId, userId) {
      return votes.has(`${submissionId}:${userId}`);
    },
    async setVote(submissionId, userId, on) {
      const key = `${submissionId}:${userId}`;
      if (on) votes.add(key); else votes.delete(key);
      const r = rows.get(submissionId)!;
      const count = [...votes].filter((v) => v.startsWith(`${submissionId}:`)).length;
      rows.set(submissionId, { ...r, upvoteCount: count });
      return count;
    },
    async listVotesForUser(userId) {
      return [...votes].filter((v) => v.endsWith(`:${userId}`)).map((v) => v.split(":")[0]!);
    },
    async getFeedbackPrefs(userId) {
      const p = prefs.get(userId);
      return p ? { ...p } : null;
    },
    async upsertFeedbackPrefs(userId, p) {
      prefs.set(userId, { ...p });
    },
  };
}

async function approvedPitch(store: PitchFixStore, title = "Duet mode") {
  const row = await submitPitch(store, { userId: USER_A, submitterName: "Maya", title, body: "What it is", why: "Why", category: "create" });
  await moderateSubmission(store, ADMIN, row.id, "approved");
  return row;
}

describe("pitch & fix intake + moderation gate", () => {
  it("a pitch is born pending with status reviewing and never reaches the public board", async () => {
    const store = memoryStore();
    const row = await submitPitch(store, { userId: USER_A, title: "Duet mode", body: "Two creators, one beat", category: "create" });
    expect(row.moderationStatus).toBe("pending");
    expect(row.status).toBe("reviewing");
    const board = await getPublicBoard(store);
    expect(board.pitches).toHaveLength(0);
    expect(board.fixes).toHaveLength(0);
    expect(board.shipped).toHaveLength(0);
    // …but the submitter can see their own, and the team queue can.
    expect(await listMySubmissions(store, USER_A)).toHaveLength(1);
    expect(await listModerationQueue(store)).toHaveLength(1);
  });

  it("only after team approval does a pitch appear, and rejection keeps it off forever", async () => {
    const store = memoryStore();
    const ok = await submitPitch(store, { userId: USER_A, title: "Good", body: "b", category: "world" });
    const no = await submitPitch(store, { userId: USER_B, title: "Bad", body: "b", category: "world" });
    await moderateSubmission(store, ADMIN, ok.id, "approved");
    await moderateSubmission(store, ADMIN, no.id, "rejected");
    const board = await getPublicBoard(store);
    expect(board.pitches.map((p) => p.id)).toEqual([ok.id]);
  });

  it("doors reject unknown vocabularies", async () => {
    const store = memoryStore();
    await expect(submitPitch(store, { userId: USER_A, title: "x", body: "b", category: "nope" as never })).rejects.toBeInstanceOf(PitchFixError);
    await expect(submitFix(store, { userId: USER_A, title: "x", page: "nope" as never, severity: "small" })).rejects.toBeInstanceOf(PitchFixError);
    await expect(submitFix(store, { userId: USER_A, title: "x", page: "earnings", severity: "nope" as never })).rejects.toBeInstanceOf(PitchFixError);
  });

  it("a fix is born pending with status received, carrying page + severity", async () => {
    const store = memoryStore();
    const row = await submitFix(store, { userId: USER_A, title: "Export spins", page: "video_editor", severity: "blocks_me" });
    expect(row.status).toBe("received");
    expect(row.page).toBe("video_editor");
    expect(row.severity).toBe("blocks_me");
    expect((await getPublicBoard(store)).fixes).toHaveLength(0);
  });

  it("feedback requires 1–5 stars, flattens to ONE line, and boards as a fix after approval", async () => {
    const store = memoryStore();
    await expect(submitFeedback(store, { userId: USER_A, rating: 0 })).rejects.toBeInstanceOf(PitchFixError);
    await expect(submitFeedback(store, { userId: USER_A, rating: 6 })).rejects.toBeInstanceOf(PitchFixError);
    const row = await submitFeedback(store, { userId: USER_A, rating: 4, text: "Love the editor\nbut exports crawl" });
    expect(row.kind).toBe("feedback");
    expect(row.source).toBe("feedback_popup");
    expect(row.title).toBe("Love the editor but exports crawl");
    expect(row.status).toBe("received");
    await moderateSubmission(store, ADMIN, row.id, "approved");
    const board = await getPublicBoard(store);
    expect(board.fixes.map((f) => f.id)).toEqual([row.id]);
    expect(board.fixes[0]!.rating).toBe(4);
  });

  it("no wire shape carries a PRICE — rewards are ruled VB amounts, never a price", async () => {
    const store = memoryStore();
    const row = await approvedPitch(store);
    const board = await getPublicBoard(store);
    for (const obj of [row, board.pitches[0]!]) {
      const keys = Object.keys(obj).join(",");
      expect(keys).not.toMatch(/price/i);
      // The ruled reward state rides the wire (owner, Oct 25, 18:12):
      expect(obj.rewardStatus).toBe("none");
      expect(obj.rewardAmount).toBeNull();
    }
  });
});

describe("pitch board votes + statuses", () => {
  it("votes toggle per member, count exactly, and refuse non-public or non-pitch rows", async () => {
    const store = memoryStore();
    const pitch = await approvedPitch(store);
    expect(await togglePitchVote(store, USER_A, pitch.id)).toEqual({ voted: true, upvoteCount: 1 });
    expect(await togglePitchVote(store, USER_B, pitch.id)).toEqual({ voted: true, upvoteCount: 2 });
    expect(await togglePitchVote(store, USER_A, pitch.id)).toEqual({ voted: false, upvoteCount: 1 });
    const board = await getPublicBoard(store, USER_B);
    expect(board.viewerVotedIds).toEqual([pitch.id]);

    const pending = await submitPitch(store, { userId: USER_A, title: "Pending", body: "b", category: "social" });
    await expect(togglePitchVote(store, USER_A, pending.id)).rejects.toMatchObject({ code: "not_votable" });
    const fix = await submitFix(store, { userId: USER_A, title: "Broken", page: "profile", severity: "small" });
    await moderateSubmission(store, ADMIN, fix.id, "approved");
    await expect(togglePitchVote(store, USER_A, fix.id)).rejects.toMatchObject({ code: "not_votable" });
  });

  it("top sort is votes first, then newest", async () => {
    const store = memoryStore();
    const a = await approvedPitch(store, "A");
    const b = await approvedPitch(store, "B");
    await togglePitchVote(store, USER_B, a.id);
    const board = await getPublicBoard(store);
    expect(board.pitches.map((p) => p.id)).toEqual([a.id, b.id]);
  });

  it("team statuses stay inside their kind's vocabulary; terminal states stamp shippedAt and feed the strip", async () => {
    const store = memoryStore();
    const pitch = await approvedPitch(store);
    await expect(setSubmissionStatus(store, pitch.id, "fixed")).rejects.toMatchObject({ code: "invalid_status" });
    const shipped = await setSubmissionStatus(store, pitch.id, "shipped", new Date("2026-10-25T16:00:00Z"));
    expect(shipped.shippedAt).toBe("2026-10-25T16:00:00.000Z");
    let board = await getPublicBoard(store);
    expect(board.shipped.map((s) => s.id)).toEqual([pitch.id]);
    // Moving it back off shipped clears the stamp and the strip entry.
    const back = await setSubmissionStatus(store, pitch.id, "building");
    expect(back.shippedAt).toBeNull();
    board = await getPublicBoard(store);
    expect(board.shipped).toHaveLength(0);

    const fix = await submitFix(store, { userId: USER_B, title: "Broken", page: "go_live", severity: "annoying" });
    await moderateSubmission(store, ADMIN, fix.id, "approved");
    await expect(setSubmissionStatus(store, fix.id, "shipped")).rejects.toMatchObject({ code: "invalid_status" });
    await setSubmissionStatus(store, fix.id, "fixed");
    board = await getPublicBoard(store);
    expect(board.shipped.map((s) => s.id)).toEqual([fix.id]);
  });
});

describe("feedback pop-up prefs + hard cap", () => {
  const T0 = new Date("2026-10-25T12:00:00Z");

  it("defaults: prompts ON, never prompted, eligible", async () => {
    const store = memoryStore();
    expect(await getFeedbackPrefs(store, USER_A)).toEqual({ enabled: true, lastPromptedAt: null, promptCount: 0 });
    expect((await getFeedbackEligibility(store, USER_A, T0)).eligible).toBe(true);
  });

  it("a showing caps the account for exactly 7 days — submit or dismiss, the stamp is the showing", async () => {
    const store = memoryStore();
    const first = await recordPromptShown(store, USER_A, T0);
    expect(first.recorded).toBe(true);
    const sixDays = new Date(T0.getTime() + 6 * 24 * 3600 * 1000);
    expect((await getFeedbackEligibility(store, USER_A, sixDays)).reason).toBe("capped");
    const again = await recordPromptShown(store, USER_A, sixDays);
    expect(again.recorded).toBe(false);
    const sevenDays = new Date(T0.getTime() + FEEDBACK_PROMPT_CAP_MS);
    expect((await getFeedbackEligibility(store, USER_A, sevenDays)).eligible).toBe(true);
    // Another account is untouched by A's cap.
    expect((await getFeedbackEligibility(store, USER_B, sixDays)).eligible).toBe(true);
  });

  it("the Settings toggle OFF refuses eligibility and showings until turned back on", async () => {
    const store = memoryStore();
    await setFeedbackEnabled(store, USER_A, false);
    const elig = await getFeedbackEligibility(store, USER_A, T0);
    expect(elig).toMatchObject({ enabled: false, eligible: false, reason: "disabled" });
    expect((await recordPromptShown(store, USER_A, T0)).recorded).toBe(false);
    await setFeedbackEnabled(store, USER_A, true);
    expect((await getFeedbackEligibility(store, USER_A, T0)).eligible).toBe(true);
    // The pure rule agrees with the stored-state rule.
    expect(feedbackEligibility({ enabled: false, lastPromptedAt: null, promptCount: 0 }, T0).reason).toBe("disabled");
  });
});
