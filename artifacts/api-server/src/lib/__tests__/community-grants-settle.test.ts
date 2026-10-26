import { describe, expect, it, vi } from "vitest";
import {
  castVote,
  communityGrantLedgerKey,
  getGrantsSurface,
  openRound,
  postReportBack,
  settleRound,
  submitProject,
  updateRoundWindows,
  type GrantPayDeps,
} from "../community-grants";
import {
  AFTER_CLOSE,
  IN_SUBMISSIONS,
  IN_VOTING,
  MemoryGrantStore,
  roundInput,
} from "./community-grants-fake-store";

function payDeps() {
  const balances = new Map<string, number>();
  const ledger: Array<{ userId: string; action: string; creditsUsed: number; idempotencyKey: string }> = [];
  const deps: GrantPayDeps = {
    addCredits: vi.fn(async (userId: string, amount: number) => {
      balances.set(userId, (balances.get(userId) ?? 0) + amount);
    }),
    recordLedger: vi.fn(async (record) => {
      if (ledger.some((l) => l.idempotencyKey === record.idempotencyKey)) return "already-recorded" as const;
      ledger.push(record);
      return "recorded" as const;
    }),
  };
  return { deps, balances, ledger };
}

async function closedRound(store: MemoryGrantStore, votesFor: Record<string, number>) {
  const round = await openRound(store, "admin-1", roundInput());
  const a = await submitProject(store, round.id, "creator-a", "Creator A", { title: "Project A", description: "A in my own words." }, IN_SUBMISSIONS);
  const b = await submitProject(store, round.id, "creator-b", "Creator B", { title: "Project B", description: "B in my own words." }, IN_SUBMISSIONS);
  let n = 0;
  for (const [candidateId, count] of Object.entries(votesFor)) {
    for (let i = 0; i < count; i++) {
      await castVote(store, round.id, `voter-${n++}`, candidateId === "a" ? a.id : b.id, IN_VOTING);
    }
  }
  return { round, a, b };
}

describe("Community Grants — settle + exactly-once payout", () => {
  it("the winner is paid the round's recorded pool exactly once, with a strict ledger row", async () => {
    const store = new MemoryGrantStore();
    const { deps, balances, ledger } = payDeps();
    const { round, a } = await closedRound(store, { a: 5, b: 3 });

    const result = await settleRound(store, deps, round.id, AFTER_CLOSE);
    expect(result).toEqual({ outcome: "paid", winnerCandidateId: a.id, amountVb: 5000 });
    expect(balances.get("creator-a")).toBe(5000);
    expect(balances.get("creator-b")).toBeUndefined();
    expect(ledger).toEqual([
      {
        userId: "creator-a",
        action: "Community Grant",
        creditsUsed: -5000,
        idempotencyKey: communityGrantLedgerKey(round.id),
      },
    ]);

    const surface = await getGrantsSurface(store, undefined, AFTER_CLOSE);
    expect(surface.current?.round.resultStatus).toBe("winner");
    expect(surface.current?.round.grantStatus).toBe("paid");
    expect(surface.current?.candidates.find((c) => c.id === a.id)?.isWinner).toBe(true);
  });

  it("a replayed settle is a no-op — never a second payment", async () => {
    const store = new MemoryGrantStore();
    const { deps, balances, ledger } = payDeps();
    const { round } = await closedRound(store, { a: 2, b: 1 });
    await settleRound(store, deps, round.id, AFTER_CLOSE);
    const replay = await settleRound(store, deps, round.id, AFTER_CLOSE);
    expect(replay.outcome).toBe("already_settled");
    expect(balances.get("creator-a")).toBe(5000);
    expect(ledger).toHaveLength(1);
    expect(vi.mocked(deps.addCredits).mock.calls).toHaveLength(1);
  });

  it("a tie declares NO winner and pays NOBODY — the pool holds", async () => {
    const store = new MemoryGrantStore();
    const { deps, balances, ledger } = payDeps();
    const { round } = await closedRound(store, { a: 4, b: 4 });
    const result = await settleRound(store, deps, round.id, AFTER_CLOSE);
    expect(result).toEqual({ outcome: "tie" });
    expect(balances.size).toBe(0);
    expect(ledger).toHaveLength(0);
    const surface = await getGrantsSurface(store, undefined, AFTER_CLOSE);
    expect(surface.current?.round.resultStatus).toBe("tie");
    expect(surface.current?.round.winnerCandidateId).toBeNull();
    expect(surface.current?.round.grantStatus).toBe("none");
  });

  it("zero votes also declares no winner (recorded as a tie)", async () => {
    const store = new MemoryGrantStore();
    const { deps, balances } = payDeps();
    const { round } = await closedRound(store, {});
    const result = await settleRound(store, deps, round.id, AFTER_CLOSE);
    expect(result).toEqual({ outcome: "tie" });
    expect(balances.size).toBe(0);
  });

  it("a round with no candidates settles as no_candidates and pays nobody", async () => {
    const store = new MemoryGrantStore();
    const { deps, balances } = payDeps();
    const round = await openRound(store, "admin-1", roundInput());
    const result = await settleRound(store, deps, round.id, AFTER_CLOSE);
    expect(result).toEqual({ outcome: "no_candidates" });
    expect(balances.size).toBe(0);
  });

  it("settle before the voting window closes is refused", async () => {
    const store = new MemoryGrantStore();
    const { deps } = payDeps();
    const { round } = await closedRound(store, { a: 1 });
    await expect(settleRound(store, deps, round.id, IN_VOTING)).rejects.toMatchObject({ code: "window_not_open" });
  });

  it("tie resolution: extending the voting window reopens the round; a later settle can decide it", async () => {
    const store = new MemoryGrantStore();
    const { deps, balances } = payDeps();
    const { round, a } = await closedRound(store, { a: 2, b: 2 });
    await settleRound(store, deps, round.id, AFTER_CLOSE);
    const reopened = await updateRoundWindows(store, round.id, { votingCloseAt: "2026-11-25T00:00:00.000Z" });
    expect(reopened.resultStatus).toBe("pending");
    /* one more real vote lands in the extended window, then settle pays */
    await castVote(store, round.id, "voter-late", a.id, new Date("2026-11-22T12:00:00.000Z"));
    const decided = await settleRound(store, deps, round.id, new Date("2026-11-26T00:00:00.000Z"));
    expect(decided.outcome).toBe("paid");
    expect(balances.get("creator-a")).toBe(5000);
  });

  it("a ledger failure after the grant claws back and releases the claim — retry pays once", async () => {
    const store = new MemoryGrantStore();
    const { deps, balances, ledger } = payDeps();
    const { round } = await closedRound(store, { a: 3, b: 1 });
    vi.mocked(deps.recordLedger).mockRejectedValueOnce(new Error("ledger down"));
    const failed = await settleRound(store, deps, round.id, AFTER_CLOSE);
    expect(failed).toEqual({ outcome: "failed_released" });
    expect(balances.get("creator-a") ?? 0).toBe(0); // clawed back
    const retry = await settleRound(store, deps, round.id, AFTER_CLOSE);
    expect(retry.outcome).toBe("paid");
    expect(balances.get("creator-a")).toBe(5000);
    expect(ledger).toHaveLength(1);
  });
});

describe("Community Grants — report-back", () => {
  it("the funded creator reports back in their own words; the surface shows posted vs owed", async () => {
    const store = new MemoryGrantStore();
    const { deps } = payDeps();
    const { round, a, b } = await closedRound(store, { a: 3, b: 1 });
    await settleRound(store, deps, round.id, AFTER_CLOSE);

    let surface = await getGrantsSurface(store, undefined, AFTER_CLOSE);
    expect(surface.current?.candidates.find((c) => c.id === a.id)?.reportBackOwed).toBe(true);
    expect(surface.current?.candidates.find((c) => c.id === a.id)?.reportBack).toBeNull();

    /* the loser cannot report back */
    await expect(postReportBack(store, round.id, "creator-b", "Not mine.", AFTER_CLOSE)).rejects.toMatchObject({ code: "not_winner" });
    void b;

    const posted = await postReportBack(store, round.id, "creator-a", "We built the studio. First session is booked.", AFTER_CLOSE);
    expect(posted.reportBack).toContain("We built the studio");

    surface = await getGrantsSurface(store, undefined, AFTER_CLOSE);
    const winner = surface.current?.candidates.find((c) => c.id === a.id);
    expect(winner?.reportBackOwed).toBe(false);
    expect(winner?.reportBack).toContain("First session is booked");
  });
});
