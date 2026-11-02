/**
 * community-grants-notify.test.ts — notification-completeness census
 * (stack1200): the Community Grant winner's prize landing must TELL
 * the winner through the one door.
 *
 * THE GAP: settleRound paid the pool to the winning creator in Visual
 * Bucs — a real prize landing, the same species as Pitch & Fix rewards
 * and referral earnings, which ride the door (category "money") — and
 * fired NO notification at all: no bell, no push, no email. The winner
 * learned only by visiting the grants page. These tests drive the real
 * settleRound over the in-memory store with a recording notify dep:
 * the paid outcome tells the winner exactly once (a replayed settle
 * is already_settled and silent), a tie tells nobody (no money moved),
 * and the copy names exactly the pool that landed.
 */
import { describe, expect, it, vi } from "vitest";
import {
  castVote,
  openRound,
  settleRound,
  submitProject,
  type GrantPayDeps,
} from "../community-grants";
import {
  AFTER_CLOSE,
  IN_SUBMISSIONS,
  IN_VOTING,
  MemoryGrantStore,
  roundInput,
} from "./community-grants-fake-store";
import type { UserEventInput } from "../push-events";

function harness() {
  const balances = new Map<string, number>();
  const events: UserEventInput[] = [];
  const deps: GrantPayDeps = {
    addCredits: vi.fn(async (userId: string, amount: number) => {
      balances.set(userId, (balances.get(userId) ?? 0) + amount);
    }),
    recordLedger: vi.fn(async () => "recorded" as const),
    notify: vi.fn(async (input: UserEventInput) => {
      events.push(input);
    }),
  };
  return { deps, balances, events };
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

describe("Community Grants — the winner hears it", () => {
  it("a paid settle tells the winner exactly once, naming the pool that landed", async () => {
    const store = new MemoryGrantStore();
    const { deps, events } = harness();
    const { round } = await closedRound(store, { a: 5, b: 3 });

    const result = await settleRound(store, deps, round.id, AFTER_CLOSE);
    expect(result.outcome).toBe("paid");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      userId: "creator-a",
      category: "money",
      kind: "community_grant_won",
      link: "/community-grants",
    });
    expect(events[0]!.body).toContain("5,000");
    expect(events[0]!.body).toContain("Project A");

    /* A replayed settle pays nothing and tells nothing more. */
    const replay = await settleRound(store, deps, round.id, AFTER_CLOSE);
    expect(replay.outcome).toBe("already_settled");
    expect(events).toHaveLength(1);
  });

  it("a tie pays nobody and tells nobody — no money moved, no landed copy", async () => {
    const store = new MemoryGrantStore();
    const { deps, events } = harness();
    const { round } = await closedRound(store, { a: 3, b: 3 });

    const result = await settleRound(store, deps, round.id, AFTER_CLOSE);
    expect(result.outcome).toBe("tie");
    expect(events).toHaveLength(0);
  });

  it("a failing notify never un-pays the grant (the outcome stays paid)", async () => {
    const store = new MemoryGrantStore();
    const { deps, balances } = harness();
    deps.notify = vi.fn(async () => {
      throw new Error("door down");
    });
    const { round } = await closedRound(store, { a: 2, b: 1 });

    const result = await settleRound(store, deps, round.id, AFTER_CLOSE);
    expect(result.outcome).toBe("paid");
    expect(balances.get("creator-a")).toBe(5000);
  });
});
