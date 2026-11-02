/**
 * challenge-judge-door.test.ts — notification-completeness census
 * (stack1200): a challenge prize LANDING must ping the winner's
 * devices, not just leave a bell row.
 *
 * THE GAP: the judge handler delivered every note through
 * notifyMany — a direct notifications-table insert. The bell landed
 * with truthful copy (stack900 L4), but no device push ever fired:
 * the one door (notifyUserEvent) was never entered, so the Settings
 * "money" gate never even got a say. Prize landings are money events
 * (the same species as Pitch & Fix rewards, which ride the door).
 *
 * The fix partitions delivery: notes for winners THIS call paid
 * (paid_now, prize > 0) ride the door at category "money"; the
 * queued crown bell, the zero-prize crown, and the entrants' results
 * bell stay bell-only by the L4 design (no money has landed for
 * them). These tests compose the real buildJudgeNotifications
 * matrix and deliver it through the REAL notifyUserEvent with fake
 * door legs, proving: the paid winner's bell + push fire; the gate
 * (money off) silences the push but never the bell; nobody else's
 * note ever enters the door.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = "00000000-0000-4000-8000-000000000099";
    next();
  },
}));

vi.mock("../admin", () => ({
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/supabase-admin", () => ({
  getSupabaseAdmin: () => null,
}));

vi.mock("../../lib/payment-record", () => ({
  recordCreditUsageStrict: async () => undefined,
}));

vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: async (u: string | null) => u ?? null,
}));

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrlsDeep: async (x: unknown) => x,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    db: {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
      insert: () => ({ values: async () => undefined }),
    },
  };
});

import { buildJudgeNotifications, deliverJudgeNotifications } from "../challenge-engine";
import { notifyUserEvent, type NotifyDeps, type PushPreferenceMap, type UserEventInput } from "../../lib/push-events";

const ON: PushPreferenceMap = { money: true, messages: true, live: true, mentions: true, social: false };
const MONEY_OFF: PushPreferenceMap = { ...ON, money: false };

function fakeDoorLegs(prefs: PushPreferenceMap) {
  const bells: UserEventInput[] = [];
  const pushes: Array<{ userId: string; payload: unknown }> = [];
  const deps: NotifyDeps = {
    getPrefs: async () => prefs,
    insertBell: async (input) => { bells.push(input); },
    sendPush: async (userId, payload) => {
      pushes.push({ userId, payload });
      return { sent: 1, pruned: 0, failed: 0, skippedReason: null };
    },
  };
  return { bells, pushes, deps };
}

function composedNotes() {
  return buildJudgeNotifications({
    challengeTitle: "Weekly Creator Contest",
    challengeSlug: "weekly-creator-contest",
    firstAnnouncement: true,
    winners: [
      { userId: "winner-paid", place: 1, prizeCredits: 500, state: "paid_now" },
      { userId: "winner-queued", place: 2, prizeCredits: 300, state: "queued" },
      { userId: "winner-crown", place: 3, prizeCredits: 0, state: "paid_now" },
    ],
    entrantUserIds: ["winner-paid", "winner-queued", "winner-crown", "entrant-1"],
  });
}

describe("challenge judge delivery — the prize landing rides the door", () => {
  it("the paid winner gets bell + push at category money; every other note stays in the bell batch", async () => {
    const notes = composedNotes();
    const { bells, pushes, deps } = fakeDoorLegs(ON);
    const batch: Array<{ userId: string; kind: string }> = [];

    await deliverJudgeNotifications(notes, new Set(["winner-paid"]), {
      door: (input) => notifyUserEvent(input, deps),
      bell: async (items) => { batch.push(...items); },
    });

    /* The door saw exactly the paid winner, as a money event with
       the L4 landed copy intact. */
    expect(bells).toHaveLength(1);
    expect(bells[0]).toMatchObject({
      userId: "winner-paid",
      category: "money",
      kind: "challenge_win",
      link: "/challenge/weekly-creator-contest/winners",
    });
    expect(bells[0]!.body).toContain("500 Visual Bucs just landed");
    expect(pushes).toHaveLength(1);
    expect(pushes[0]!.userId).toBe("winner-paid");

    /* The batch kept the rest: queued crown, zero-prize crown,
       entrant results — and NOT the paid winner (no double bell). */
    expect(batch.map((b) => `${b.userId}:${b.kind}`).sort()).toEqual([
      "entrant-1:challenge_results",
      "winner-crown:challenge_win",
      "winner-queued:challenge_win",
    ]);
  });

  it("the Settings gate silences the push, never the bell", async () => {
    const notes = composedNotes();
    const { bells, pushes, deps } = fakeDoorLegs(MONEY_OFF);
    const batch: Array<{ userId: string; kind: string }> = [];

    await deliverJudgeNotifications(notes, new Set(["winner-paid"]), {
      door: (input) => notifyUserEvent(input, deps),
      bell: async (items) => { batch.push(...items); },
    });

    expect(bells).toHaveLength(1);
    expect(pushes).toHaveLength(0);
    expect(batch).toHaveLength(3);
  });

  it("a re-judge that paid nobody new sends nothing through the door", async () => {
    const notes = buildJudgeNotifications({
      challengeTitle: "Weekly Creator Contest",
      challengeSlug: "weekly-creator-contest",
      firstAnnouncement: false,
      winners: [{ userId: "winner-paid", place: 1, prizeCredits: 500, state: "already_paid" }],
      entrantUserIds: ["winner-paid"],
    });
    const { bells, pushes, deps } = fakeDoorLegs(ON);
    const batch: Array<{ userId: string; kind: string }> = [];

    await deliverJudgeNotifications(notes, new Set(), {
      door: (input) => notifyUserEvent(input, deps),
      bell: async (items) => { batch.push(...items); },
    });

    expect(bells).toHaveLength(0);
    expect(pushes).toHaveLength(0);
    expect(batch).toHaveLength(0);
  });
});
