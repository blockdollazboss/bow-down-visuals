/**
 * Pitch & Fix reward landed → submitter device-push wiring (#11).
 *
 * The authoritative moment is payQueuedReward's "paid" outcome: the
 * claim flip (queued → paid, exactly one winner) plus the grant and
 * the strict ledger row all landed. Only that caller pings — a rival
 * processor gets "already_claimed", a failed payout gets
 * "failed_released", and neither pings. The notify sits AFTER the
 * money try/catch on purpose: a push failure must never claw back a
 * reward that honestly landed. Category money, link /pitch-fix.
 */
import { describe, expect, it } from "vitest";
import {
  moderateSubmission,
  setSubmissionStatus,
  submitFix,
  submitPitch,
  type FeedbackPrefsRow,
  type NewSubmissionRow,
  type PitchFixStore,
  type SubmissionWire,
} from "../pitch-fix";
import {
  buildPitchFixRewardEvent,
  payQueuedReward,
  type RewardPayDeps,
} from "../pitch-fix-rewards";
import type { UserEventInput } from "../push-events";

const USER_A = "11111111-1111-4111-8111-111111111111";
const ADMIN = "99999999-9999-4999-8999-999999999999";
const T_SHIP = new Date("2026-10-25T12:00:00Z");

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
      if (on) votes.add(key);
      else votes.delete(key);
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

function fakeDeps(opts: { failLedger?: boolean; failNotify?: boolean } = {}) {
  const balances = new Map<string, number>();
  const events: UserEventInput[] = [];
  const deps: RewardPayDeps = {
    async addCredits(userId, amount) {
      balances.set(userId, (balances.get(userId) ?? 0) + amount);
    },
    async recordLedger() {
      if (opts.failLedger) throw new Error("ledger write failed");
      return "recorded";
    },
    async notifyEvent(input) {
      if (opts.failNotify) throw new Error("push down");
      events.push(input);
    },
  };
  return { deps, balances, events };
}

async function shippedPitch(store: PitchFixStore) {
  const row = await submitPitch(store, { userId: USER_A, submitterName: "Test Creator", title: "Duet mode", body: "b", category: "create" });
  await moderateSubmission(store, ADMIN, row.id, "approved");
  await setSubmissionStatus(store, row.id, "shipped", T_SHIP);
  return (await store.getSubmission(row.id))!;
}

describe("buildPitchFixRewardEvent", () => {
  it("pitch vs fix copy, submitter addressed, money category, /pitch-fix link", () => {
    const pitch = buildPitchFixRewardEvent({ kind: "pitch", submitterUserId: USER_A } as SubmissionWire, 500);
    expect(pitch).toMatchObject({ userId: USER_A, category: "money", kind: "pitch_fix_reward", link: "/pitch-fix" });
    expect(pitch.title).toContain("pitch shipped");
    expect(pitch.body).toContain("500 VB");
    const fix = buildPitchFixRewardEvent({ kind: "fix", submitterUserId: USER_A } as SubmissionWire, 250);
    expect(fix.title).toContain("fix shipped");
  });
});

describe("payQueuedReward push wiring", () => {
  it("a paid reward pings the submitter exactly once; a rival processor pings nobody", async () => {
    const store = memoryStore();
    const sub = await shippedPitch(store);
    const { deps, events } = fakeDeps();
    const out = await payQueuedReward(store, deps, sub, T_SHIP);
    expect(out).toBe("paid");
    expect(events).toHaveLength(1);
    expect(events[0]!.userId).toBe(USER_A);
    const fresh = (await store.getSubmission(sub.id))!;
    const rival = await payQueuedReward(store, deps, fresh, T_SHIP);
    expect(rival).toBe("already_claimed");
    expect(events).toHaveLength(1);
  });

  it("a failed payout (claim released for retry) pings nobody", async () => {
    const store = memoryStore();
    const sub = await shippedPitch(store);
    const { deps, events } = fakeDeps({ failLedger: true });
    const out = await payQueuedReward(store, deps, sub, T_SHIP);
    expect(out).toBe("failed_released");
    expect(events).toHaveLength(0);
  });

  it("a throwing notifier never claws back a landed reward", async () => {
    const store = memoryStore();
    const sub = await shippedPitch(store);
    const { deps, balances } = fakeDeps({ failNotify: true });
    const out = await payQueuedReward(store, deps, sub, T_SHIP);
    expect(out).toBe("paid");
    expect(balances.get(USER_A)).toBe(500);
  });

  it("a shipped fix report pings with the fix copy", async () => {
    const store = memoryStore();
    const row = await submitFix(store, { userId: USER_A, title: "Export stuck", page: "video_editor", severity: "blocks_me" });
    await moderateSubmission(store, ADMIN, row.id, "approved");
    await setSubmissionStatus(store, row.id, "fixed", T_SHIP);
    const fresh = (await store.getSubmission(row.id))!;
    const { deps, events } = fakeDeps();
    const out = await payQueuedReward(store, deps, fresh, T_SHIP);
    expect(out).toBe("paid");
    expect(events[0]!.title).toContain("fix shipped");
    expect(events[0]!.body).toContain("250 VB");
  });
});
