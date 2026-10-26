import { describe, expect, it } from "vitest";
import {
  CommunityGrantError,
  castVote,
  getGrantsSurface,
  openRound,
  postReportBack,
  submitProject,
  withdrawVote,
} from "../community-grants";
import {
  AFTER_CLOSE,
  IN_SUBMISSIONS,
  IN_VOTING,
  MemoryGrantStore,
  roundInput,
} from "./community-grants-fake-store";

async function votingRound(store: MemoryGrantStore) {
  const round = await openRound(store, "admin-1", roundInput());
  const a = await submitProject(store, round.id, "creator-a", "Creator A", { title: "Studio for my block", description: "In my own words: a real project." }, IN_SUBMISSIONS);
  const b = await submitProject(store, round.id, "creator-b", "Creator B", { title: "Free beat camp", description: "My words, unedited." }, IN_SUBMISSIONS);
  return { round, a, b };
}

describe("Community Grants — rounds", () => {
  it("no round ⇒ the public surface is the honest empty state", async () => {
    const store = new MemoryGrantStore();
    const surface = await getGrantsSurface(store, undefined, IN_VOTING);
    expect(surface.current).toBeNull();
    expect(surface.past).toEqual([]);
  });

  it("the pool size is the admin-entered figure recorded on the round", async () => {
    const store = new MemoryGrantStore();
    const round = await openRound(store, "admin-1", roundInput({ poolVb: 7777 }));
    expect(round.poolVb).toBe(7777);
    const surface = await getGrantsSurface(store, undefined, IN_SUBMISSIONS);
    expect(surface.current?.round.poolVb).toBe(7777);
    expect(surface.current?.phase).toBe("submissions");
  });

  it("one round per month — a second round for the same month is refused", async () => {
    const store = new MemoryGrantStore();
    await openRound(store, "admin-1", roundInput());
    await expect(openRound(store, "admin-1", roundInput())).rejects.toMatchObject({ code: "round_exists" });
  });

  it("a non-positive or fractional pool is refused — no invented amounts", async () => {
    const store = new MemoryGrantStore();
    await expect(openRound(store, "admin-1", roundInput({ poolVb: 0 }))).rejects.toMatchObject({ code: "validation" });
    await expect(openRound(store, "admin-1", roundInput({ poolVb: 12.5 }))).rejects.toMatchObject({ code: "validation" });
  });

  it("windows out of order are refused", async () => {
    const store = new MemoryGrantStore();
    await expect(
      openRound(store, "admin-1", roundInput({ votingCloseAt: "2026-11-05T00:00:00.000Z" })),
    ).rejects.toMatchObject({ code: "validation" });
  });
});

describe("Community Grants — candidates", () => {
  it("a creator submits their own project, in their own words, once per round", async () => {
    const store = new MemoryGrantStore();
    const round = await openRound(store, "admin-1", roundInput());
    const cand = await submitProject(store, round.id, "creator-a", "Creator A", { title: "My project", description: "Exactly what I typed." }, IN_SUBMISSIONS);
    expect(cand.title).toBe("My project");
    expect(cand.description).toBe("Exactly what I typed.");
    await expect(
      submitProject(store, round.id, "creator-a", "Creator A", { title: "Second", description: "Nope." }, IN_SUBMISSIONS),
    ).rejects.toMatchObject({ code: "already_submitted" });
  });

  it("submissions outside the submission window are refused", async () => {
    const store = new MemoryGrantStore();
    const round = await openRound(store, "admin-1", roundInput());
    await expect(
      submitProject(store, round.id, "creator-a", "Creator A", { title: "Late", description: "Too late." }, IN_VOTING),
    ).rejects.toMatchObject({ code: "window_closed" });
  });

  it("an empty surface says 'no candidates yet' by simply having none", async () => {
    const store = new MemoryGrantStore();
    const round = await openRound(store, "admin-1", roundInput());
    void round;
    const surface = await getGrantsSurface(store, undefined, IN_SUBMISSIONS);
    expect(surface.current?.candidates).toEqual([]);
    expect(surface.current?.totalVotes).toBe(0);
  });
});

describe("Community Grants — voting (one member, one row)", () => {
  it("repeat votes for the same project never double-count", async () => {
    const store = new MemoryGrantStore();
    const { round, a } = await votingRound(store);
    await castVote(store, round.id, "voter-1", a.id, IN_VOTING);
    await castVote(store, round.id, "voter-1", a.id, IN_VOTING);
    await castVote(store, round.id, "voter-1", a.id, IN_VOTING);
    const surface = await getGrantsSurface(store, "voter-1", IN_VOTING);
    expect(surface.current?.totalVotes).toBe(1);
    expect(surface.current?.candidates.find((c) => c.id === a.id)?.votes).toBe(1);
    expect(store.votes.size).toBe(1);
  });

  it("changing a vote MOVES the single row — tally still counts the member once", async () => {
    const store = new MemoryGrantStore();
    const { round, a, b } = await votingRound(store);
    await castVote(store, round.id, "voter-1", a.id, IN_VOTING);
    const changed = await castVote(store, round.id, "voter-1", b.id, IN_VOTING);
    expect(changed.votes).toBe(1);
    expect(store.votes.size).toBe(1);
    const surface = await getGrantsSurface(store, "voter-1", IN_VOTING);
    expect(surface.current?.totalVotes).toBe(1);
    expect(surface.current?.candidates.find((c) => c.id === a.id)?.votes).toBe(0);
    expect(surface.current?.candidates.find((c) => c.id === b.id)?.votes).toBe(1);
    expect(surface.current?.myVoteCandidateId).toBe(b.id);
  });

  it("withdrawing removes the row and the tally drops", async () => {
    const store = new MemoryGrantStore();
    const { round, a } = await votingRound(store);
    await castVote(store, round.id, "voter-1", a.id, IN_VOTING);
    await withdrawVote(store, round.id, "voter-1", IN_VOTING);
    const surface = await getGrantsSurface(store, "voter-1", IN_VOTING);
    expect(surface.current?.totalVotes).toBe(0);
    expect(surface.current?.myVoteCandidateId).toBeNull();
  });

  it("tally is exactly the row count across many voters", async () => {
    const store = new MemoryGrantStore();
    const { round, a, b } = await votingRound(store);
    for (let i = 0; i < 7; i++) await castVote(store, round.id, `voter-${i}`, a.id, IN_VOTING);
    for (let i = 7; i < 10; i++) await castVote(store, round.id, `voter-${i}`, b.id, IN_VOTING);
    const surface = await getGrantsSurface(store, undefined, IN_VOTING);
    expect(surface.current?.totalVotes).toBe(10);
    expect(surface.current?.candidates.find((c) => c.id === a.id)?.votes).toBe(7);
    expect(surface.current?.candidates.find((c) => c.id === b.id)?.votes).toBe(3);
    /* candidates sort by real votes, most first */
    expect(surface.current?.candidates[0]?.id).toBe(a.id);
  });

  it("votes outside the voting window are refused, and guests get no myVote", async () => {
    const store = new MemoryGrantStore();
    const { round, a } = await votingRound(store);
    await expect(castVote(store, round.id, "voter-1", a.id, IN_SUBMISSIONS)).rejects.toMatchObject({ code: "window_closed" });
    await expect(castVote(store, round.id, "voter-1", a.id, AFTER_CLOSE)).rejects.toMatchObject({ code: "window_closed" });
    await castVote(store, round.id, "voter-1", a.id, IN_VOTING);
    const guest = await getGrantsSurface(store, undefined, IN_VOTING);
    expect(guest.current?.myVoteCandidateId).toBeNull();
    expect(guest.current?.totalVotes).toBe(1);
  });

  it("voting for a project from another round is refused", async () => {
    const store = new MemoryGrantStore();
    const { round, a } = await votingRound(store);
    const other = await openRound(store, "admin-1", roundInput({ monthKey: "2026-12" }));
    await expect(castVote(store, other.id, "voter-1", a.id, IN_VOTING)).rejects.toBeInstanceOf(CommunityGrantError);
  });
});

describe("Community Grants — report-back gate (before any grant)", () => {
  it("nobody can report back before a grant is paid", async () => {
    const store = new MemoryGrantStore();
    const { round } = await votingRound(store);
    await expect(postReportBack(store, round.id, "creator-a", "We did it.", AFTER_CLOSE)).rejects.toMatchObject({ code: "not_winner" });
  });
});
