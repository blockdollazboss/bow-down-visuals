/**
 * Notification-truth tests for the challenge judge bells
 * (routes/challenge-engine, stack900 L4).
 *
 * THE DEFECT: POST /admin/challenges/:slug/judge belled EVERY entrant
 * on EVERY run with identical copy. Two lies fell out:
 *  1. A winner whose prize was budget-capped (deliberately left
 *     claimable for a later re-judge, per the weekly 1,000 VB prize
 *     law) was told "N Visual Bucs just landed in your balance" when
 *     nothing had landed.
 *  2. A re-judge — a designed flow, the cap retry — re-rang every
 *     winner's "just landed" bell and every entrant's results bell.
 *
 * buildJudgeNotifications composes the bells from each winner's
 * post-call money state; these tests pin the matrix. The judge
 * handler itself is DB/Supabase-bound and covered by the engine's
 * route suites; the composition is the truth-bearing part.
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
  const fakeDb: any = {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => [],
            then: (res: any, rej: any) => Promise.resolve([]).then(res, rej),
          }),
          limit: async () => [],
          then: (res: any, rej: any) => Promise.resolve([]).then(res, rej),
        }),
      }),
    }),
    insert: () => ({ values: () => ({ onConflictDoNothing: async () => [] }) }),
    update: () => ({ set: () => ({ where: async () => [] }) }),
    delete: () => ({ where: async () => [] }),
    execute: async () => ({ rows: [] }),
    transaction: async (fn: any) => fn(fakeDb),
  };
  return { ...actual, db: fakeDb };
});

import { buildJudgeNotifications } from "../challenge-engine";

const base = {
  challengeTitle: "October Heat",
  challengeSlug: "october-heat",
  entrantUserIds: ["winner-1", "winner-2", "entrant-a", "entrant-b"],
};

describe("buildJudgeNotifications — the judge bell truth matrix", () => {
  it("first announcement, paid winner: the landed copy, naming the amount", () => {
    const notes = buildJudgeNotifications({
      ...base,
      firstAnnouncement: true,
      winners: [{ userId: "winner-1", place: 1, prizeCredits: 500, state: "paid_now" }],
    });
    const win = notes.find((n) => n.userId === "winner-1");
    expect(win).toMatchObject({ kind: "challenge_win", link: "/challenge/october-heat/winners" });
    expect(win!.body).toContain("500 Visual Bucs just landed in your balance");
    // Entrants (non-winners) get the results bell; the winner doesn't.
    expect(notes.filter((n) => n.kind === "challenge_results").map((n) => n.userId).sort())
      .toEqual(["entrant-a", "entrant-b", "winner-2"]);
  });

  it("first announcement, budget-capped winner: crowned, but NEVER told the prize landed", () => {
    const notes = buildJudgeNotifications({
      ...base,
      firstAnnouncement: true,
      winners: [{ userId: "winner-1", place: 1, prizeCredits: 500, state: "queued" }],
    });
    const win = notes.find((n) => n.userId === "winner-1");
    expect(win).toMatchObject({ kind: "challenge_win" });
    expect(win!.title).toContain("1st place");
    expect(win!.body).toContain("hasn't landed yet");
    expect(win!.body).not.toContain("just landed");
  });

  it("re-judge: already-paid winners and entrants stay silent; the newly paid winner gets the landed bell", () => {
    const notes = buildJudgeNotifications({
      ...base,
      firstAnnouncement: false,
      winners: [
        { userId: "winner-1", place: 1, prizeCredits: 500, state: "already_paid" },
        { userId: "winner-2", place: 2, prizeCredits: 300, state: "paid_now" },
      ],
    });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ userId: "winner-2", kind: "challenge_win" });
    expect(notes[0]!.body).toContain("300 Visual Bucs just landed in your balance");
  });

  it("re-judge: a still-queued winner stays silent (their bell arrives with the paying call)", () => {
    const notes = buildJudgeNotifications({
      ...base,
      firstAnnouncement: false,
      winners: [{ userId: "winner-1", place: 1, prizeCredits: 500, state: "queued" }],
    });
    expect(notes).toHaveLength(0);
  });

  it("zero-prize winner: the crown copy claims no money, on the announcement only", () => {
    const first = buildJudgeNotifications({
      ...base,
      firstAnnouncement: true,
      winners: [{ userId: "winner-1", place: 1, prizeCredits: 0, state: "queued" }],
    });
    const win = first.find((n) => n.userId === "winner-1");
    expect(win!.body).toBe("The crown is yours. Wear it loud.");
    const again = buildJudgeNotifications({
      ...base,
      firstAnnouncement: false,
      winners: [{ userId: "winner-1", place: 1, prizeCredits: 0, state: "queued" }],
    });
    expect(again.filter((n) => n.userId === "winner-1")).toHaveLength(0);
  });
});
