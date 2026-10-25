/**
 * pitch-fix-rewards.test.ts — the reward rail (owner ruling, Oct 25,
 * 18:12 EDT) against an in-memory store + fake payment deps.
 *
 * Pins the ruled money behavior:
 * - Amounts: shipped pitch 500 VB; fixed fix 100 VB; blocks_me fix
 *   250 VB; pop-up feedback follows the uniform fix rule (100 VB).
 * - Paid ONLY on the team-set Shipped/Fixed transition, via the
 *   queue — never at submission, approval, or any self-serve path.
 * - EXACTLY ONCE: claim-first + the keyed strict ledger
 *   (`pitch-fix-reward:<id>`); reprocessing, re-shipping after pay,
 *   and duplicate-key replays never move money twice.
 * - FAILURE: a grant/ledger failure claws back and RELEASES the
 *   claim to queued — the next run pays it. Never lost.
 * - POOL: one shared 1,000 VB/week envelope (Monday-UTC anchor),
 *   strict FIFO; the item that doesn't fit — and everything behind
 *   it — stays queued and pays when the next week opens.
 * - DUPLICATES: same-title resubmissions are auto-marked ineligible
 *   (first voice only); the team can mark paraphrase duplicates;
 *   a paid item can never be marked after the fact.
 */
import { describe, expect, it } from "vitest";
import {
  getRewardPoolState,
  markDuplicate,
  moderateSubmission,
  rewardAmountFor,
  setSubmissionStatus,
  submitFeedback,
  submitFix,
  submitPitch,
  type FeedbackPrefsRow,
  type NewSubmissionRow,
  type PitchFixStore,
  type SubmissionWire,
} from "../pitch-fix";
import {
  pitchFixRewardLedgerKey,
  processRewardQueue,
  type RewardPayDeps,
} from "../pitch-fix-rewards";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const ADMIN = "99999999-9999-4999-8999-999999999999";

/* Sun Oct 25 2026, 12:00 UTC — week anchor Mon Oct 19; next week
   opens Mon Oct 26. */
const T_SHIP = new Date("2026-10-25T12:00:00Z");
const T_NEXT_WEEK = new Date("2026-10-26T09:00:00Z");

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
        id: `sub-${seq}`, ...input,
        moderationStatus: "pending", upvoteCount: 0,
        rewardStatus: input.rewardStatus ?? "none",
        rewardAmount: null, rewardQueuedAt: null, rewardPaidAt: null,
        duplicateOfId: input.duplicateOfId ?? null,
        shippedAt: null, createdAt: stamp(), updatedAt: stamp(),
      };
      rows.set(row.id, row);
      return { ...row };
    },
    async listSubmissions() { return [...rows.values()].map((r) => ({ ...r })); },
    async getSubmission(id) { const r = rows.get(id); return r ? { ...r } : null; },
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
    async hasVote(submissionId, userId) { return votes.has(`${submissionId}:${userId}`); },
    async setVote(submissionId, userId, on) {
      const key = `${submissionId}:${userId}`;
      if (on) votes.add(key); else votes.delete(key);
      const r = rows.get(submissionId)!;
      const count = [...votes].filter((v) => v.startsWith(`${submissionId}:`)).length;
      rows.set(submissionId, { ...r, upvoteCount: count });
      return count;
    },
    async listVotesForUser(userId) { return [...votes].filter((v) => v.endsWith(`:${userId}`)).map((v) => v.split(":")[0]!); },
    async getFeedbackPrefs(userId) { const p = prefs.get(userId); return p ? { ...p } : null; },
    async upsertFeedbackPrefs(userId, p) { prefs.set(userId, { ...p }); },
  };
}

/** Fake money deps: balances + a ledger set that throws a 23505-shaped
 *  error on a duplicate key, like the real credit_usage unique index. */
function fakeDeps(fail: { grant?: boolean; ledger?: boolean } = {}) {
  const balances = new Map<string, number>();
  const ledger = new Map<string, { userId: string; creditsUsed: number }>();
  const deps: RewardPayDeps = {
    async addCredits(userId, amount) {
      if (fail.grant) throw new Error("grant rail down");
      balances.set(userId, (balances.get(userId) ?? 0) + amount);
    },
    async recordLedger(record) {
      if (fail.ledger) throw new Error("ledger write failed");
      if (ledger.has(record.idempotencyKey)) {
        throw Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
      }
      ledger.set(record.idempotencyKey, { userId: record.userId, creditsUsed: record.creditsUsed });
      return "recorded";
    },
  };
  return { deps, balances, ledger };
}

async function shippedPitch(store: PitchFixStore, userId = USER_A, title = "Duet mode") {
  const row = await submitPitch(store, { userId, submitterName: "Maya", title, body: "b", category: "create" });
  await moderateSubmission(store, ADMIN, row.id, "approved");
  await setSubmissionStatus(store, row.id, "shipped", T_SHIP);
  return row;
}

describe("reward amounts + transition trigger", () => {
  it("amounts follow the ruling exactly", () => {
    expect(rewardAmountFor({ kind: "pitch", severity: null })).toBe(500);
    expect(rewardAmountFor({ kind: "fix", severity: "annoying" })).toBe(100);
    expect(rewardAmountFor({ kind: "fix", severity: "blocks_me" })).toBe(250);
    expect(rewardAmountFor({ kind: "feedback", severity: null })).toBe(100);
  });

  it("nothing queues before the terminal transition — not at submit, not at approval", async () => {
    const store = memoryStore();
    const row = await submitPitch(store, { userId: USER_A, title: "Idea", body: "b", category: "world" });
    expect(row.rewardStatus).toBe("none");
    await moderateSubmission(store, ADMIN, row.id, "approved");
    await setSubmissionStatus(store, row.id, "building", T_SHIP);
    const mid = await store.getSubmission(row.id);
    expect(mid!.rewardStatus).toBe("none");
    const shipped = await setSubmissionStatus(store, row.id, "shipped", T_SHIP);
    expect(shipped.rewardStatus).toBe("queued");
    expect(shipped.rewardAmount).toBe(500);
    expect(shipped.rewardQueuedAt).toBe(T_SHIP.toISOString());
  });

  it("a blocks_me fix queues 250 and a pop-up feedback queues the uniform 100", async () => {
    const store = memoryStore();
    const fix = await submitFix(store, { userId: USER_A, title: "Export broken", page: "video_editor", severity: "blocks_me" });
    await moderateSubmission(store, ADMIN, fix.id, "approved");
    const fixed = await setSubmissionStatus(store, fix.id, "fixed", T_SHIP);
    expect(fixed.rewardAmount).toBe(250);
    const fb = await submitFeedback(store, { userId: USER_B, rating: 5, text: "Love it" });
    await moderateSubmission(store, ADMIN, fb.id, "approved");
    const fbFixed = await setSubmissionStatus(store, fb.id, "fixed", T_SHIP);
    expect(fbFixed.rewardAmount).toBe(100);
  });
});

describe("exactly-once payment on the referral pattern", () => {
  it("pays the pitcher 500 with ONE keyed negative-credit ledger row; reprocessing pays nothing more", async () => {
    const store = memoryStore();
    const { deps, balances, ledger } = fakeDeps();
    const pitch = await shippedPitch(store);
    const first = await processRewardQueue(store, deps, T_SHIP);
    expect(first.paidIds).toEqual([pitch.id]);
    expect(balances.get(USER_A)).toBe(500);
    expect(ledger.size).toBe(1);
    expect(ledger.get(pitchFixRewardLedgerKey(pitch.id))).toEqual({ userId: USER_A, creditsUsed: -500 });
    const after = await store.getSubmission(pitch.id);
    expect(after!.rewardStatus).toBe("paid");
    expect(after!.rewardPaidAt).toBe(T_SHIP.toISOString());
    const second = await processRewardQueue(store, deps, T_SHIP);
    expect(second.paidIds).toEqual([]);
    expect(balances.get(USER_A)).toBe(500);
    expect(ledger.size).toBe(1);
  });

  it("un-shipping before payment un-queues; re-shipping after payment never pays twice", async () => {
    const store = memoryStore();
    const { deps, balances, ledger } = fakeDeps();
    const pitch = await shippedPitch(store);
    await setSubmissionStatus(store, pitch.id, "building", T_SHIP);
    let row = await store.getSubmission(pitch.id);
    expect(row!.rewardStatus).toBe("none");
    await setSubmissionStatus(store, pitch.id, "shipped", T_SHIP);
    await processRewardQueue(store, deps, T_SHIP);
    expect(balances.get(USER_A)).toBe(500);
    await setSubmissionStatus(store, pitch.id, "building", T_SHIP);
    row = await store.getSubmission(pitch.id);
    expect(row!.rewardStatus).toBe("paid"); // paid is a terminal money state
    await setSubmissionStatus(store, pitch.id, "shipped", T_SHIP);
    const again = await processRewardQueue(store, deps, T_SHIP);
    expect(again.paidIds).toEqual([]);
    expect(balances.get(USER_A)).toBe(500);
    expect(ledger.size).toBe(1);
  });

  it("a ledger failure claws the grant back and releases the claim to queued — the retry pays", async () => {
    const store = memoryStore();
    const pitch = await shippedPitch(store);
    const broken = fakeDeps({ ledger: true });
    const failed = await processRewardQueue(store, broken.deps, T_SHIP);
    expect(failed.failedId).toBe(pitch.id);
    expect(broken.balances.get(USER_A) ?? 0).toBe(0); // granted then clawed back
    expect(broken.ledger.size).toBe(0);
    const row = await store.getSubmission(pitch.id);
    expect(row!.rewardStatus).toBe("queued"); // released, not lost
    const healthy = fakeDeps();
    const retried = await processRewardQueue(store, healthy.deps, T_SHIP);
    expect(retried.paidIds).toEqual([pitch.id]);
    expect(healthy.balances.get(USER_A)).toBe(500);
  });

  it("a grant failure releases the claim with no ledger row and no balance movement", async () => {
    const store = memoryStore();
    const pitch = await shippedPitch(store);
    const broken = fakeDeps({ grant: true });
    const failed = await processRewardQueue(store, broken.deps, T_SHIP);
    expect(failed.failedId).toBe(pitch.id);
    expect(broken.ledger.size).toBe(0);
    expect((await store.getSubmission(pitch.id))!.rewardStatus).toBe("queued");
  });
});

describe("the shared 1,000 VB/week pool + roll-over queue", () => {
  it("three 500 VB pitches in one week: two pay, the third queues — and pays when the next week opens", async () => {
    const store = memoryStore();
    const { deps, balances } = fakeDeps();
    const p1 = await shippedPitch(store, USER_A, "Idea one");
    const p2 = await shippedPitch(store, USER_B, "Idea two");
    const p3 = await shippedPitch(store, USER_A, "Idea three");
    const week1 = await processRewardQueue(store, deps, T_SHIP);
    expect(week1.paidIds).toEqual([p1.id, p2.id]);
    expect(week1.stillQueuedIds).toEqual([p3.id]);
    const pool = await getRewardPoolState(store, T_SHIP);
    expect(pool.spentVb).toBe(1000);
    expect(pool.remainingVb).toBe(0);
    expect(pool.queued.map((q) => q.id)).toEqual([p3.id]);
    // Same week, another run: still no room — queued is never dropped.
    expect((await processRewardQueue(store, deps, T_SHIP)).paidIds).toEqual([]);
    // Next week opens: the queued reward pays, first in line.
    const week2 = await processRewardQueue(store, deps, T_NEXT_WEEK);
    expect(week2.paidIds).toEqual([p3.id]);
    expect(balances.get(USER_A)).toBe(1000);
    expect(balances.get(USER_B)).toBe(500);
  });

  it("strict FIFO: a head item that doesn't fit stops the line — smaller items behind it do not jump", async () => {
    const store = memoryStore();
    const { deps, balances } = fakeDeps();
    // Spend 600 of the pool first (500 pitch + 100 fix).
    const a = await shippedPitch(store, USER_A, "First pitch");
    const f = await submitFix(store, { userId: USER_A, title: "Small bug", page: "profile", severity: "small" });
    await moderateSubmission(store, ADMIN, f.id, "approved");
    await setSubmissionStatus(store, f.id, "fixed", T_SHIP);
    await processRewardQueue(store, deps, T_SHIP);
    expect(balances.get(USER_A)).toBe(600);
    // Head: a 500 pitch (only 400 left). Behind it: a 100 fix that WOULD fit.
    const head = await shippedPitch(store, USER_B, "Big pitch");
    const behind = await submitFix(store, { userId: USER_B, title: "Tiny bug", page: "profile", severity: "small" });
    await moderateSubmission(store, ADMIN, behind.id, "approved");
    await setSubmissionStatus(store, behind.id, "fixed", T_SHIP);
    const run = await processRewardQueue(store, deps, T_SHIP);
    expect(run.paidIds).toEqual([]);
    expect(run.stillQueuedIds).toEqual([head.id, behind.id]);
    expect(balances.get(USER_B) ?? 0).toBe(0);
    void a;
  });
});

describe("duplicates — first voice only", () => {
  it("a same-title resubmission is auto-marked ineligible and never pays; the first voice does", async () => {
    const store = memoryStore();
    const { deps, balances } = fakeDeps();
    const first = await submitFix(store, { userId: USER_A, title: "Export spins forever!", page: "video_editor", severity: "annoying" });
    const copy = await submitFix(store, { userId: USER_B, title: "export  spins forever", page: "video_editor", severity: "annoying" });
    expect(copy.rewardStatus).toBe("ineligible");
    expect(copy.duplicateOfId).toBe(first.id);
    await moderateSubmission(store, ADMIN, copy.id, "approved");
    const fixedCopy = await setSubmissionStatus(store, copy.id, "fixed", T_SHIP);
    expect(fixedCopy.rewardStatus).toBe("ineligible"); // never queues
    await moderateSubmission(store, ADMIN, first.id, "approved");
    await setSubmissionStatus(store, first.id, "fixed", T_SHIP);
    const run = await processRewardQueue(store, deps, T_SHIP);
    expect(run.paidIds).toEqual([first.id]);
    expect(balances.get(USER_A)).toBe(100);
    expect(balances.get(USER_B) ?? 0).toBe(0);
  });

  it("the team can mark a paraphrase duplicate — a queued reward leaves the queue", async () => {
    const store = memoryStore();
    const first = await submitPitch(store, { userId: USER_A, title: "Duet mode", body: "b", category: "create" });
    const para = await submitPitch(store, { userId: USER_B, title: "Sing together mode", body: "b", category: "create" });
    await moderateSubmission(store, ADMIN, para.id, "approved");
    await setSubmissionStatus(store, para.id, "shipped", T_SHIP);
    expect((await store.getSubmission(para.id))!.rewardStatus).toBe("queued");
    const marked = await markDuplicate(store, para.id, first.id);
    expect(marked.rewardStatus).toBe("ineligible");
    expect(marked.duplicateOfId).toBe(first.id);
    expect((await getRewardPoolState(store, T_SHIP)).queued).toEqual([]);
  });

  it("marking refuses: self, cross-kind, a duplicate as the target, and an already-paid item", async () => {
    const store = memoryStore();
    const { deps } = fakeDeps();
    const pitch = await shippedPitch(store);
    const fix = await submitFix(store, { userId: USER_B, title: "Bug", page: "profile", severity: "small" });
    await expect(markDuplicate(store, pitch.id, pitch.id)).rejects.toMatchObject({ code: "invalid_duplicate" });
    await expect(markDuplicate(store, pitch.id, fix.id)).rejects.toMatchObject({ code: "invalid_duplicate" });
    await processRewardQueue(store, deps, T_SHIP); // pitch now PAID
    const other = await submitPitch(store, { userId: USER_B, title: "Another", body: "b", category: "social" });
    await expect(markDuplicate(store, pitch.id, other.id)).rejects.toMatchObject({ code: "already_paid" });
    // A duplicate cannot itself be the "first voice" target:
    const copy = await submitPitch(store, { userId: USER_B, title: "Duet mode", body: "b", category: "create" });
    expect(copy.duplicateOfId).toBe(pitch.id);
    await expect(markDuplicate(store, other.id, copy.id)).rejects.toMatchObject({ code: "invalid_duplicate" });
  });
});
