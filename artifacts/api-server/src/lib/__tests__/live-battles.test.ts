/**
 * live-battles.test.ts — Stack-200 TRULY NEW #154, the battle service
 * against an in-memory store.
 *
 * Pins:
 * - CHALLENGE LIFECYCLE: born pending with one drawn theme; only
 *   the opponent answers; only the challenger cancels; an open
 *   battle between a pair blocks a second; start needs an accepted
 *   battle + a LIVE stream owned by one of the two battlers, and
 *   stamps the timed window (rounds × round seconds).
 * - VOTES ARE RECORDED INTERACTIONS ONLY: the tally is a COUNT of
 *   vote rows; one fan holds exactly one voice (moving it moves
 *   the count, never doubles it); battlers can never vote; votes
 *   land only inside the live window, stamped with their round.
 * - WINNER FROM THE TALLY: the higher recorded count wins; an exact
 *   tie is a tie — no winner, no crown move, no spectacle; a win
 *   stamps the record both creators keep, moves the crown, and
 *   speaks the spectacle exactly once (finalize is idempotent).
 * - BLOCKS SEVER: a blocked pair cannot challenge; a block landing
 *   mid-flight voids a pending battle on the next touch and a live
 *   battle on settle — a voided battle takes no votes and crowns
 *   nobody.
 * - NO MONEY: no row or tally path carries a price, fee or payout.
 */
import { describe, expect, it } from "vitest";
import {
  BATTLE_MAX_PENDING_OUTGOING,
  BATTLE_ROUND_COUNT,
  BATTLE_ROUND_SECONDS,
  BATTLE_THEMES,
  LiveBattleError,
  battleWinAnnouncement,
  createLiveBattleService,
  drawBattleTheme,
  roundAt,
  tallyVotes,
  winnerFromTally,
  type BattleRow,
  type BattleVoteRow,
  type LiveBattleStore,
  type ProfileCardRow,
} from "../live-battles";
import type { PalaceAnnouncement } from "../world-room";

const CH = "11111111-1111-4111-8111-111111111111"; // challenger
const OP = "22222222-2222-4222-8222-222222222222"; // opponent
const FAN1 = "33333333-3333-4333-8333-333333333333";
const FAN2 = "44444444-4444-4444-8444-444444444444";
const FAN3 = "55555555-5555-4555-8555-555555555555";
const FAN4 = "66666666-6666-4666-8666-666666666666";

function memoryStore() {
  const profiles = new Map<string, ProfileCardRow>();
  const battles = new Map<string, BattleRow>();
  const votes = new Map<string, BattleVoteRow>();
  const streams = new Map<string, { id: string; userId: string; status: string }>();
  const blockedPairs = new Set<string>();
  const notifications: Array<{ userId: string; kind: string }> = [];
  let seq = 0;
  const pairKey = (a: string, b: string) => [a, b].sort().join("|");

  const store: LiveBattleStore = {
    async profileByUserId(userId) {
      return [...profiles.values()].find((p) => p.userId === userId) ?? null;
    },
    async profileBySlug(slug) {
      return [...profiles.values()].find((p) => p.slug === slug) ?? null;
    },
    async profileById(profileId) {
      return profiles.get(profileId) ?? null;
    },
    async insertBattle(input) {
      seq += 1;
      const row: BattleRow = {
        id: `battle-${seq}`,
        challengerUserId: input.challengerUserId,
        challengerProfileId: input.challengerProfileId,
        opponentUserId: input.opponentUserId,
        opponentProfileId: input.opponentProfileId,
        streamId: null,
        theme: input.theme,
        status: "pending",
        roundCount: input.roundCount,
        roundSeconds: input.roundSeconds,
        startsAt: null,
        endsAt: null,
        winnerUserId: null,
        result: null,
        challengerVotes: null,
        opponentVotes: null,
        voidReason: null,
        spectacleAnnouncedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      battles.set(row.id, row);
      return { ...row };
    },
    async getBattle(id) {
      const r = battles.get(id);
      return r ? { ...r } : null;
    },
    async updateBattle(id, patch) {
      const r = battles.get(id);
      if (!r) throw new Error("no battle");
      Object.assign(r, patch, { updatedAt: new Date() });
      return { ...r };
    },
    async listBattlesForUser(userId) {
      return [...battles.values()]
        .filter((b) => b.challengerUserId === userId || b.opponentUserId === userId)
        .map((b) => ({ ...b }));
    },
    async openBattleBetween(a, b) {
      return [...battles.values()].find(
        (x) =>
          ((x.challengerUserId === a && x.opponentUserId === b) ||
            (x.challengerUserId === b && x.opponentUserId === a)) &&
          ["pending", "accepted", "live"].includes(x.status),
      ) ?? null;
    },
    async countPendingOutgoing(userId) {
      return [...battles.values()].filter(
        (b) => b.challengerUserId === userId && b.status === "pending",
      ).length;
    },
    async battleForStream(streamId) {
      const rows = [...battles.values()].filter((b) => b.streamId === streamId);
      return rows.find((b) => b.status === "live") ?? rows[rows.length - 1] ?? null;
    },
    async latestCompletedWithWinner() {
      const done = [...battles.values()].filter(
        (b) => b.status === "completed" && b.winnerUserId !== null,
      );
      return done[done.length - 1] ?? null;
    },
    async listVotes(battleId) {
      return [...votes.values()].filter((v) => v.battleId === battleId).map((v) => ({ ...v }));
    },
    async getVote(battleId, voterUserId) {
      return [...votes.values()].find(
        (v) => v.battleId === battleId && v.voterUserId === voterUserId,
      ) ?? null;
    },
    async upsertVote(input) {
      const key = `${input.battleId}|${input.voterUserId}`;
      const existing = votes.get(key);
      if (existing) {
        existing.side = input.side;
        existing.roundNumber = input.roundNumber;
        existing.updatedAt = new Date();
        return { ...existing };
      }
      seq += 1;
      const row: BattleVoteRow = {
        id: `vote-${seq}`,
        battleId: input.battleId,
        voterUserId: input.voterUserId,
        side: input.side,
        roundNumber: input.roundNumber,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      votes.set(key, row);
      return { ...row };
    },
    async getStream(streamId) {
      return streams.get(streamId) ?? null;
    },
    async isBlockedBetween(a, b) {
      return blockedPairs.has(pairKey(a, b));
    },
    async notify(userId, kind) {
      notifications.push({ userId, kind });
    },
  };

  return {
    store,
    profiles,
    battles,
    votes,
    streams,
    notifications,
    block(a: string, b: string) {
      blockedPairs.add(pairKey(a, b));
    },
  };
}

function setup() {
  const mem = memoryStore();
  mem.profiles.set("prof-ch", {
    userId: CH, profileId: "prof-ch", displayName: "Challenger", slug: "challenger", avatarUrl: null,
  });
  mem.profiles.set("prof-op", {
    userId: OP, profileId: "prof-op", displayName: "Opponent", slug: "opponent", avatarUrl: null,
  });
  let current = new Date("2026-10-26T12:00:00Z");
  const spoken: PalaceAnnouncement[] = [];
  const svc = createLiveBattleService(mem.store, {
    now: () => current,
    random: () => 0, // theme draw pinned to the first theme
    announce: (a) => {
      spoken.push(a);
      return true;
    },
  });
  return {
    ...mem,
    svc,
    spoken,
    setNow(d: Date) {
      current = d;
    },
    now: () => current,
  };
}

async function liveBattle(s: ReturnType<typeof setup>) {
  const b = await s.svc.createChallenge({ challengerUserId: CH, opponentSlug: "opponent" });
  await s.svc.respond({ battleId: b.id, userId: OP, accept: true });
  s.streams.set("stream-1", { id: "stream-1", userId: CH, status: "live" });
  const live = await s.svc.start({ battleId: b.id, userId: CH, streamId: "stream-1" });
  return live;
}

describe("pure format math", () => {
  it("draws themes from the house list only", () => {
    expect(drawBattleTheme(() => 0)).toBe(BATTLE_THEMES[0]);
    expect(drawBattleTheme(() => 0.999)).toBe(BATTLE_THEMES[BATTLE_THEMES.length - 1]);
    expect(BATTLE_THEMES).toContain(drawBattleTheme(() => 0.5));
  });

  it("rounds are exact slices of the window", () => {
    const start = new Date("2026-10-26T12:00:00Z");
    const b = {
      startsAt: start,
      endsAt: new Date(start.getTime() + BATTLE_ROUND_COUNT * BATTLE_ROUND_SECONDS * 1000),
      roundSeconds: BATTLE_ROUND_SECONDS,
    };
    expect(roundAt(b, start)).toBe(1);
    expect(roundAt(b, new Date(start.getTime() + 89_999))).toBe(1);
    expect(roundAt(b, new Date(start.getTime() + 90_000))).toBe(2);
    expect(roundAt(b, new Date(start.getTime() + 269_999))).toBe(3);
    expect(roundAt(b, b.endsAt)).toBeNull();
    expect(roundAt(b, new Date(start.getTime() - 1))).toBeNull();
  });

  it("tally counts rows and nothing else; ties stay ties", () => {
    const mk = (side: "challenger" | "opponent", roundNumber: number): BattleVoteRow => ({
      id: Math.random().toString(),
      battleId: "b",
      voterUserId: Math.random().toString(),
      side,
      roundNumber,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const t = tallyVotes([mk("challenger", 1), mk("challenger", 2), mk("opponent", 2)], 3);
    expect(t).toMatchObject({ challenger: 2, opponent: 1, total: 3 });
    expect(t.perRound[1]).toEqual({ round: 2, challenger: 1, opponent: 1 });
    expect(winnerFromTally(t)).toBe("challenger");
    expect(winnerFromTally({ challenger: 2, opponent: 2 })).toBe("tie");
    expect(winnerFromTally({ challenger: 0, opponent: 0 })).toBe("tie");
  });

  it("the spectacle line names winner, loser, theme and the real count, within 140 chars", () => {
    const a = battleWinAnnouncement({ theme: "Neon Nights" }, "Challenger", "Opponent", { challenger: 7, opponent: 3 }, "challenger");
    expect(a.kind).toBe("show");
    expect(a.text).toContain("Challenger");
    expect(a.text).toContain("7–3");
    expect(a.text.length).toBeLessThanOrEqual(140);
  });
});

describe("challenge lifecycle", () => {
  it("born pending with a drawn theme; the opponent is notified", async () => {
    const s = setup();
    const b = await s.svc.createChallenge({ challengerUserId: CH, opponentSlug: "opponent" });
    expect(b.status).toBe("pending");
    expect(b.theme).toBe(BATTLE_THEMES[0]);
    expect(b.roundCount).toBe(BATTLE_ROUND_COUNT);
    expect(b.roundSeconds).toBe(BATTLE_ROUND_SECONDS);
    expect(s.notifications).toContainEqual({ userId: OP, kind: "live_battle_challenge" });
  });

  it("refuses self-battles, unknown creators and a second open battle for the pair", async () => {
    const s = setup();
    await expect(s.svc.createChallenge({ challengerUserId: CH, opponentSlug: "challenger" }))
      .rejects.toMatchObject({ code: "self_battle" });
    await expect(s.svc.createChallenge({ challengerUserId: CH, opponentSlug: "nobody" }))
      .rejects.toMatchObject({ code: "not_found" });
    await s.svc.createChallenge({ challengerUserId: CH, opponentSlug: "opponent" });
    await expect(s.svc.createChallenge({ challengerUserId: OP, opponentSlug: "challenger" }))
      .rejects.toMatchObject({ code: "already_active" });
  });

  it("caps unanswered outgoing challenges (restraint)", async () => {
    const s = setup();
    for (let i = 0; i < BATTLE_MAX_PENDING_OUTGOING + 2; i++) {
      s.profiles.set(`prof-x${i}`, {
        userId: `user-x${i}`, profileId: `prof-x${i}`, displayName: `X${i}`, slug: `x${i}`, avatarUrl: null,
      });
    }
    for (let i = 0; i < BATTLE_MAX_PENDING_OUTGOING; i++) {
      await s.svc.createChallenge({ challengerUserId: CH, opponentSlug: `x${i}` });
    }
    await expect(s.svc.createChallenge({ challengerUserId: CH, opponentSlug: "x3" }))
      .rejects.toMatchObject({ code: "too_many_pending" });
  });

  it("only the opponent answers; decline ends it; only the challenger cancels", async () => {
    const s = setup();
    const b = await s.svc.createChallenge({ challengerUserId: CH, opponentSlug: "opponent" });
    await expect(s.svc.respond({ battleId: b.id, userId: CH, accept: true }))
      .rejects.toMatchObject({ code: "not_opponent" });
    const declined = await s.svc.respond({ battleId: b.id, userId: OP, accept: false });
    expect(declined.status).toBe("declined");
    await expect(s.svc.respond({ battleId: b.id, userId: OP, accept: true }))
      .rejects.toMatchObject({ code: "bad_status" });

    const b2 = await s.svc.createChallenge({ challengerUserId: CH, opponentSlug: "opponent" });
    await expect(s.svc.cancel({ battleId: b2.id, userId: OP }))
      .rejects.toMatchObject({ code: "not_challenger" });
    const cancelled = await s.svc.cancel({ battleId: b2.id, userId: CH });
    expect(cancelled.status).toBe("cancelled");
  });

  it("start needs acceptance + a live stream owned by a battler, and stamps the window", async () => {
    const s = setup();
    const b = await s.svc.createChallenge({ challengerUserId: CH, opponentSlug: "opponent" });
    s.streams.set("stream-1", { id: "stream-1", userId: CH, status: "live" });
    await expect(s.svc.start({ battleId: b.id, userId: CH, streamId: "stream-1" }))
      .rejects.toMatchObject({ code: "bad_status" });
    await s.svc.respond({ battleId: b.id, userId: OP, accept: true });
    s.streams.set("stream-2", { id: "stream-2", userId: CH, status: "ended" });
    await expect(s.svc.start({ battleId: b.id, userId: CH, streamId: "stream-2" }))
      .rejects.toMatchObject({ code: "stream_not_live" });
    s.streams.set("stream-3", { id: "stream-3", userId: FAN1, status: "live" });
    await expect(s.svc.start({ battleId: b.id, userId: CH, streamId: "stream-3" }))
      .rejects.toMatchObject({ code: "stream_not_participant" });
    const live = await s.svc.start({ battleId: b.id, userId: OP, streamId: "stream-1" });
    expect(live.status).toBe("live");
    expect(live.startsAt?.toISOString()).toBe("2026-10-26T12:00:00.000Z");
    expect(live.endsAt!.getTime() - live.startsAt!.getTime())
      .toBe(BATTLE_ROUND_COUNT * BATTLE_ROUND_SECONDS * 1000);
  });
});

describe("voting — recorded interactions only", () => {
  it("counts exactly the recorded rows; moving a voice moves the count, never doubles", async () => {
    const s = setup();
    const b = await liveBattle(s);
    const r1 = await s.svc.castVote({ battleId: b.id, voterUserId: FAN1, side: "challenger" });
    expect(r1.tally).toMatchObject({ challenger: 1, opponent: 0, total: 1 });
    await s.svc.castVote({ battleId: b.id, voterUserId: FAN2, side: "opponent" });
    const moved = await s.svc.castVote({ battleId: b.id, voterUserId: FAN1, side: "opponent" });
    expect(moved.tally).toMatchObject({ challenger: 0, opponent: 2, total: 2 });
    expect(await s.store.listVotes(b.id)).toHaveLength(2);
  });

  it("battlers can never vote in their own battle", async () => {
    const s = setup();
    const b = await liveBattle(s);
    await expect(s.svc.castVote({ battleId: b.id, voterUserId: CH, side: "challenger" }))
      .rejects.toMatchObject({ code: "participant_vote" });
    await expect(s.svc.castVote({ battleId: b.id, voterUserId: OP, side: "opponent" }))
      .rejects.toMatchObject({ code: "participant_vote" });
  });

  it("votes land only inside the window, stamped with their round", async () => {
    const s = setup();
    const b = await s.svc.createChallenge({ challengerUserId: CH, opponentSlug: "opponent" });
    await expect(s.svc.castVote({ battleId: b.id, voterUserId: FAN1, side: "challenger" }))
      .rejects.toMatchObject({ code: "not_live" });
    await s.svc.cancel({ battleId: b.id, userId: CH });
    const live = await liveBattle(s);
    s.setNow(new Date("2026-10-26T12:01:35Z")); // round 2
    const r = await s.svc.castVote({ battleId: live.id, voterUserId: FAN1, side: "challenger" });
    expect(r.tally.perRound[1]).toEqual({ round: 2, challenger: 1, opponent: 0 });
    s.setNow(new Date("2026-10-26T12:04:30Z")); // past the 4:30 window
    await expect(s.svc.castVote({ battleId: live.id, voterUserId: FAN2, side: "opponent" }))
      .rejects.toMatchObject({ code: "ended" });
    // the late vote finalized the battle on the way out
    expect((await s.store.getBattle(live.id))?.status).toBe("completed");
  });
});

describe("winner determination", () => {
  it("the higher recorded count wins; the record is stamped; the crown moves; the spectacle speaks once", async () => {
    const s = setup();
    const b = await liveBattle(s);
    await s.svc.castVote({ battleId: b.id, voterUserId: FAN1, side: "opponent" });
    await s.svc.castVote({ battleId: b.id, voterUserId: FAN2, side: "opponent" });
    await s.svc.castVote({ battleId: b.id, voterUserId: FAN3, side: "challenger" });
    expect(await s.svc.getCrown()).toBeNull();
    await expect(s.svc.finalize(b.id)).rejects.toMatchObject({ code: "bad_status" }); // still in rounds
    s.setNow(new Date("2026-10-26T12:05:00Z"));
    const done = await s.svc.finalize(b.id);
    expect(done.status).toBe("completed");
    expect(done.result).toBe("opponent");
    expect(done.winnerUserId).toBe(OP);
    expect(done.challengerVotes).toBe(1);
    expect(done.opponentVotes).toBe(2);
    expect(done.spectacleAnnouncedAt).not.toBeNull();
    expect(s.spoken).toHaveLength(1);
    expect(s.spoken[0]!.text).toContain("1–2");
    const crown = await s.svc.getCrown();
    expect(crown?.winner?.userId).toBe(OP);
    // idempotent — no second stamp, no second spectacle
    const again = await s.svc.finalize(b.id);
    expect(again.challengerVotes).toBe(1);
    expect(s.spoken).toHaveLength(1);
  });

  it("an exact tie crowns nobody, speaks no spectacle, and the crown stays put", async () => {
    const s = setup();
    const first = await liveBattle(s);
    await s.svc.castVote({ battleId: first.id, voterUserId: FAN1, side: "challenger" });
    s.setNow(new Date("2026-10-26T12:05:00Z"));
    await s.svc.finalize(first.id);
    expect((await s.svc.getCrown())?.winner?.userId).toBe(CH);
    expect(s.spoken).toHaveLength(1);

    s.setNow(new Date("2026-10-26T13:00:00Z"));
    const second = await liveBattle(s);
    await s.svc.castVote({ battleId: second.id, voterUserId: FAN1, side: "challenger" });
    await s.svc.castVote({ battleId: second.id, voterUserId: FAN2, side: "opponent" });
    await s.svc.castVote({ battleId: second.id, voterUserId: FAN3, side: "challenger" });
    await s.svc.castVote({ battleId: second.id, voterUserId: FAN4, side: "opponent" });
    s.setNow(new Date("2026-10-26T13:05:00Z"));
    const tied = await s.svc.finalize(second.id);
    expect(tied.result).toBe("tie");
    expect(tied.winnerUserId).toBeNull();
    expect(tied.challengerVotes).toBe(2);
    expect(tied.opponentVotes).toBe(2);
    expect(s.spoken).toHaveLength(1); // no new spectacle
    expect((await s.svc.getCrown())?.winner?.userId).toBe(CH); // crown unmoved
  });

  it("a battle with zero votes completes as a tie — nobody is gifted a win", async () => {
    const s = setup();
    const b = await liveBattle(s);
    s.setNow(new Date("2026-10-26T12:05:00Z"));
    const done = await s.svc.finalize(b.id);
    expect(done.result).toBe("tie");
    expect(done.challengerVotes).toBe(0);
    expect(await s.svc.getCrown()).toBeNull();
  });
});

describe("blocks sever", () => {
  it("a blocked pair cannot challenge at all", async () => {
    const s = setup();
    s.block(CH, OP);
    await expect(s.svc.createChallenge({ challengerUserId: CH, opponentSlug: "opponent" }))
      .rejects.toMatchObject({ code: "blocked" });
  });

  it("a block landing while a challenge waits voids it — it can no longer be accepted", async () => {
    const s = setup();
    const b = await s.svc.createChallenge({ challengerUserId: CH, opponentSlug: "opponent" });
    s.block(OP, CH);
    await expect(s.svc.respond({ battleId: b.id, userId: OP, accept: true }))
      .rejects.toMatchObject({ code: "blocked" });
    const row = await s.store.getBattle(b.id);
    expect(row?.status).toBe("voided");
    expect(row?.voidReason).toBe("blocked");
  });

  it("a block landing mid-battle voids it on settle: no votes, no winner, no crown", async () => {
    const s = setup();
    const b = await liveBattle(s);
    await s.svc.castVote({ battleId: b.id, voterUserId: FAN1, side: "challenger" });
    s.block(CH, OP);
    const settled = await s.svc.settle((await s.store.getBattle(b.id))!);
    expect(settled.status).toBe("voided");
    await expect(s.svc.castVote({ battleId: b.id, voterUserId: FAN2, side: "challenger" }))
      .rejects.toMatchObject({ code: "blocked" });
    s.setNow(new Date("2026-10-26T12:05:00Z"));
    await expect(s.svc.finalize(b.id)).rejects.toBeInstanceOf(LiveBattleError);
    expect(await s.svc.getCrown()).toBeNull();
    expect(s.spoken).toHaveLength(0);
  });
});
