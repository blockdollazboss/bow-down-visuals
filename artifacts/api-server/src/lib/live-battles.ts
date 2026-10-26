/* ─── Live Battles (Stack-200 TRULY NEW #154) ──────────────────────
   Two creators, one theme, timed rounds, live audience voting —
   docked inside the EXISTING live surfaces. This module owns the
   battle itself; it builds NO second streaming stack:

   - The performance rides a host live_streams broadcast (either
     participant's live stream). The battle only references it.
   - Tips during a battle keep moving on the existing live-tips /
     stage-tips rails with their splits unchanged — and tips NEVER
     count as votes (the board's anti-fake law: no bought votes).
   - The win's World spectacle rides the palace announcement channel
     (lib/world-contests' registered announcer — the same herald the
     contest winners use).
   - Challenge / result notices ride the existing notifications
     table.

   VOTING IS RECORDED INTERACTIONS ONLY. One live_battle_votes row =
   one signed-in fan's one voice (UNIQUE battle+voter in the
   schema). The tally is always a COUNT of those rows — computed
   here from the rows themselves, never from a stored counter that
   could drift or be nudged. Guests are watch-only (the vote route
   requires auth); the two battlers can never vote in their own
   battle.

   NO PRICES: nothing charges, prices or pays out. The winner takes
   the Charts-page crown slot (read from the most recent completed
   battle — the crown passes when the next battle completes; a tie
   moves nothing) and the World spectacle. Honours, never money.

   BLOCKS SEVER: the house block is the DM conversation block
   (conversations.status = 'blocked' between the pair). A blocked
   pair cannot challenge, accept or start — and a battle in flight
   (pending / accepted / live) is voided the moment a block is seen,
   checked on every read and every mutation through the store seam.

   The store is injectable (drizzle in production, in-memory in
   tests) on the pitch-fix pattern. */

import { and, desc, eq, or } from "drizzle-orm";
import {
  db,
  liveBattlesTable,
  liveBattleVotesTable,
  liveStreamsTable,
  creatorProfilesTable,
  conversationsTable,
  notificationsTable,
  type LiveBattle,
  type LiveBattleVote,
} from "@workspace/db";
import { announceContestWinners } from "./world-contests";
import type { PalaceAnnouncement } from "./world-room";
import { logger } from "./logger";

/* ─── Format constants ───────────────────────────────────────────── */

/** The house theme list — one theme is drawn per battle so both
 *  creators prepare for the same brief. Creative prompts only. */
export const BATTLE_THEMES = [
  "Golden Hour",
  "Midnight in the City",
  "First Love",
  "The Comeback",
  "Summer Rain",
  "Neon Nights",
  "Roots & Wings",
  "The Last Dance",
  "Street Lights",
  "Ocean Drive",
  "Crown & Thorns",
  "Home Town",
] as const;

export const BATTLE_ROUND_COUNT = 3;
export const BATTLE_ROUND_SECONDS = 90;
/** Restraint (smart law): a creator may hold at most this many
 *  unanswered outgoing challenges at once. */
export const BATTLE_MAX_PENDING_OUTGOING = 3;

export type BattleSide = "challenger" | "opponent";
export type BattleResult = BattleSide | "tie";
export type BattleStatus =
  | "pending" | "accepted" | "declined" | "cancelled"
  | "live" | "completed" | "voided";

export class LiveBattleError extends Error {
  code:
    | "not_found" | "no_profile" | "self_battle" | "blocked"
    | "already_active" | "too_many_pending" | "not_participant"
    | "not_opponent" | "not_challenger" | "bad_status"
    | "stream_not_live" | "stream_not_participant" | "participant_vote"
    | "not_live" | "ended";
  constructor(code: LiveBattleError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

/* ─── Rows ───────────────────────────────────────────────────────── */

export interface BattleRow {
  id: string;
  challengerUserId: string;
  challengerProfileId: string;
  opponentUserId: string;
  opponentProfileId: string;
  streamId: string | null;
  theme: string;
  status: BattleStatus;
  roundCount: number;
  roundSeconds: number;
  startsAt: Date | null;
  endsAt: Date | null;
  winnerUserId: string | null;
  result: BattleResult | null;
  challengerVotes: number | null;
  opponentVotes: number | null;
  voidReason: string | null;
  spectacleAnnouncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BattleVoteRow {
  id: string;
  battleId: string;
  voterUserId: string;
  side: BattleSide;
  roundNumber: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProfileCardRow {
  userId: string;
  profileId: string;
  displayName: string;
  slug: string;
  avatarUrl: string | null;
}

/* ─── Pure format math ───────────────────────────────────────────── */

/** Draw one theme. The draw is the format (both creators get the
 *  same brief); the RNG is injected so tests pin the draw. */
export function drawBattleTheme(random: () => number = Math.random): string {
  const idx = Math.min(BATTLE_THEMES.length - 1, Math.max(0, Math.floor(random() * BATTLE_THEMES.length)));
  return BATTLE_THEMES[idx]!;
}

export function battleWindowMs(b: Pick<BattleRow, "roundCount" | "roundSeconds">): number {
  return b.roundCount * b.roundSeconds * 1000;
}

/** The round a moment falls in (1..roundCount), or null outside
 *  the window. Round boundaries are exact: the first instant of
 *  round 2 is startsAt + roundSeconds. */
export function roundAt(
  b: Pick<BattleRow, "startsAt" | "endsAt" | "roundSeconds">,
  at: Date,
): number | null {
  if (!b.startsAt || !b.endsAt) return null;
  const t = at.getTime();
  if (t < b.startsAt.getTime() || t >= b.endsAt.getTime()) return null;
  return Math.floor((t - b.startsAt.getTime()) / (b.roundSeconds * 1000)) + 1;
}

export interface BattleTally {
  challenger: number;
  opponent: number;
  total: number;
  perRound: Array<{ round: number; challenger: number; opponent: number }>;
}

/** THE tally — a count of recorded vote rows, and nothing else. */
export function tallyVotes(
  votes: readonly BattleVoteRow[],
  roundCount: number,
): BattleTally {
  const perRound = Array.from({ length: roundCount }, (_, i) => ({
    round: i + 1,
    challenger: 0,
    opponent: 0,
  }));
  let challenger = 0;
  let opponent = 0;
  for (const v of votes) {
    if (v.side === "challenger") challenger += 1;
    else opponent += 1;
    const bucket = perRound[v.roundNumber - 1];
    if (bucket) {
      if (v.side === "challenger") bucket.challenger += 1;
      else bucket.opponent += 1;
    }
  }
  return { challenger, opponent, total: challenger + opponent, perRound };
}

/** Winner from the recorded tally. An exact tie is a tie — no
 *  house thumb on the scale, ever. */
export function winnerFromTally(tally: Pick<BattleTally, "challenger" | "opponent">): BattleResult {
  if (tally.challenger > tally.opponent) return "challenger";
  if (tally.opponent > tally.challenger) return "opponent";
  return "tie";
}

export function sideOf(b: Pick<BattleRow, "challengerUserId" | "opponentUserId">, userId: string): BattleSide | null {
  if (b.challengerUserId === userId) return "challenger";
  if (b.opponentUserId === userId) return "opponent";
  return null;
}

export function isParticipant(b: Pick<BattleRow, "challengerUserId" | "opponentUserId">, userId: string): boolean {
  return sideOf(b, userId) !== null;
}

/** The win's World spectacle line, inside the palace channel's
 *  140 characters: who won, over whom, on what theme, by what real
 *  count. kind "show" — a stage moment — so the client's existing
 *  banner treatment carries it unchanged. */
export function battleWinAnnouncement(
  b: Pick<BattleRow, "theme">,
  winnerName: string,
  loserName: string,
  tally: Pick<BattleTally, "challenger" | "opponent">,
  winnerSide: BattleSide,
): PalaceAnnouncement {
  const w = winnerSide === "challenger" ? tally.challenger : tally.opponent;
  const l = winnerSide === "challenger" ? tally.opponent : tally.challenger;
  const text = `Live Battle decided: ${winnerName} takes the crown over ${loserName} on “${b.theme}”, ${w}–${l} by the fans' real votes.`;
  return { kind: "show", text: text.slice(0, 140), name: winnerName };
}

/* ─── Storage seam ───────────────────────────────────────────────── */

export interface LiveBattleStore {
  profileByUserId(userId: string): Promise<ProfileCardRow | null>;
  profileBySlug(slug: string): Promise<ProfileCardRow | null>;
  profileById(profileId: string): Promise<ProfileCardRow | null>;
  insertBattle(input: {
    challengerUserId: string;
    challengerProfileId: string;
    opponentUserId: string;
    opponentProfileId: string;
    theme: string;
    roundCount: number;
    roundSeconds: number;
  }): Promise<BattleRow>;
  getBattle(id: string): Promise<BattleRow | null>;
  updateBattle(id: string, patch: Partial<Omit<BattleRow, "id" | "createdAt">>): Promise<BattleRow>;
  /** Battles where the user is either participant, newest first. */
  listBattlesForUser(userId: string): Promise<BattleRow[]>;
  /** Open (pending/accepted/live) battle between a pair, if any. */
  openBattleBetween(aUserId: string, bUserId: string): Promise<BattleRow | null>;
  countPendingOutgoing(userId: string): Promise<number>;
  /** The live battle riding a stream, else its latest battle. */
  battleForStream(streamId: string): Promise<BattleRow | null>;
  latestCompletedWithWinner(): Promise<BattleRow | null>;
  listVotes(battleId: string): Promise<BattleVoteRow[]>;
  getVote(battleId: string, voterUserId: string): Promise<BattleVoteRow | null>;
  upsertVote(input: {
    battleId: string;
    voterUserId: string;
    side: BattleSide;
    roundNumber: number;
  }): Promise<BattleVoteRow>;
  /** A currently-live stream row (the host broadcast rail). */
  getStream(streamId: string): Promise<{ id: string; userId: string; status: string } | null>;
  /** The house block: a DM conversation between the pair set to
   *  'blocked' (either direction — the pair key is unordered). */
  isBlockedBetween(aUserId: string, bUserId: string): Promise<boolean>;
  notify(userId: string, kind: string, title: string, body: string, link: string): Promise<void>;
}

function toBattleRow(r: LiveBattle): BattleRow {
  return {
    id: r.id,
    challengerUserId: r.challenger_user_id,
    challengerProfileId: r.challenger_profile_id,
    opponentUserId: r.opponent_user_id,
    opponentProfileId: r.opponent_profile_id,
    streamId: r.stream_id ?? null,
    theme: r.theme,
    status: r.status as BattleStatus,
    roundCount: r.round_count,
    roundSeconds: r.round_seconds,
    startsAt: r.starts_at ? new Date(r.starts_at) : null,
    endsAt: r.ends_at ? new Date(r.ends_at) : null,
    winnerUserId: r.winner_user_id ?? null,
    result: (r.result as BattleResult | null) ?? null,
    challengerVotes: r.challenger_votes ?? null,
    opponentVotes: r.opponent_votes ?? null,
    voidReason: r.void_reason ?? null,
    spectacleAnnouncedAt: r.spectacle_announced_at ? new Date(r.spectacle_announced_at) : null,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  };
}

function toVoteRow(r: LiveBattleVote): BattleVoteRow {
  return {
    id: r.id,
    battleId: r.battle_id,
    voterUserId: r.voter_user_id,
    side: r.side as BattleSide,
    roundNumber: r.round_number,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  };
}

function toCard(r: {
  userId: string;
  id: string;
  displayName: string;
  slug: string;
  avatarUrl: string | null;
}): ProfileCardRow {
  return { userId: r.userId, profileId: r.id, displayName: r.displayName, slug: r.slug, avatarUrl: r.avatarUrl ?? null };
}

const OPEN_STATUSES = ["pending", "accepted", "live"];

export const dbLiveBattleStore: LiveBattleStore = {
  async profileByUserId(userId) {
    const rows = await db.select().from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.userId, userId)).limit(1);
    return rows[0] ? toCard(rows[0]) : null;
  },
  async profileBySlug(slug) {
    const rows = await db.select().from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.slug, slug)).limit(1);
    return rows[0] ? toCard(rows[0]) : null;
  },
  async profileById(profileId) {
    const rows = await db.select().from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.id, profileId)).limit(1);
    return rows[0] ? toCard(rows[0]) : null;
  },
  async insertBattle(input) {
    const rows = await db.insert(liveBattlesTable).values({
      challenger_user_id: input.challengerUserId,
      challenger_profile_id: input.challengerProfileId,
      opponent_user_id: input.opponentUserId,
      opponent_profile_id: input.opponentProfileId,
      theme: input.theme,
      round_count: input.roundCount,
      round_seconds: input.roundSeconds,
    }).returning();
    return toBattleRow(rows[0]!);
  },
  async getBattle(id) {
    const rows = await db.select().from(liveBattlesTable)
      .where(eq(liveBattlesTable.id, id)).limit(1);
    return rows[0] ? toBattleRow(rows[0]) : null;
  },
  async updateBattle(id, patch) {
    const set: Record<string, unknown> = { updated_at: new Date() };
    if (patch.challengerUserId !== undefined) set["challenger_user_id"] = patch.challengerUserId;
    if (patch.challengerProfileId !== undefined) set["challenger_profile_id"] = patch.challengerProfileId;
    if (patch.opponentUserId !== undefined) set["opponent_user_id"] = patch.opponentUserId;
    if (patch.opponentProfileId !== undefined) set["opponent_profile_id"] = patch.opponentProfileId;
    if (patch.streamId !== undefined) set["stream_id"] = patch.streamId;
    if (patch.theme !== undefined) set["theme"] = patch.theme;
    if (patch.status !== undefined) set["status"] = patch.status;
    if (patch.roundCount !== undefined) set["round_count"] = patch.roundCount;
    if (patch.roundSeconds !== undefined) set["round_seconds"] = patch.roundSeconds;
    if (patch.startsAt !== undefined) set["starts_at"] = patch.startsAt;
    if (patch.endsAt !== undefined) set["ends_at"] = patch.endsAt;
    if (patch.winnerUserId !== undefined) set["winner_user_id"] = patch.winnerUserId;
    if (patch.result !== undefined) set["result"] = patch.result;
    if (patch.challengerVotes !== undefined) set["challenger_votes"] = patch.challengerVotes;
    if (patch.opponentVotes !== undefined) set["opponent_votes"] = patch.opponentVotes;
    if (patch.voidReason !== undefined) set["void_reason"] = patch.voidReason;
    if (patch.spectacleAnnouncedAt !== undefined) set["spectacle_announced_at"] = patch.spectacleAnnouncedAt;
    const rows = await db.update(liveBattlesTable).set(set)
      .where(eq(liveBattlesTable.id, id)).returning();
    return toBattleRow(rows[0]!);
  },
  async listBattlesForUser(userId) {
    const rows = await db.select().from(liveBattlesTable)
      .where(or(
        eq(liveBattlesTable.challenger_user_id, userId),
        eq(liveBattlesTable.opponent_user_id, userId),
      ))
      .orderBy(desc(liveBattlesTable.created_at)).limit(50);
    return rows.map(toBattleRow);
  },
  async openBattleBetween(aUserId, bUserId) {
    const rows = await db.select().from(liveBattlesTable)
      .where(or(
        and(
          eq(liveBattlesTable.challenger_user_id, aUserId),
          eq(liveBattlesTable.opponent_user_id, bUserId),
        ),
        and(
          eq(liveBattlesTable.challenger_user_id, bUserId),
          eq(liveBattlesTable.opponent_user_id, aUserId),
        ),
      ))
      .orderBy(desc(liveBattlesTable.created_at)).limit(10);
    const open = rows.map(toBattleRow).find((r) => OPEN_STATUSES.includes(r.status));
    return open ?? null;
  },
  async countPendingOutgoing(userId) {
    const rows = await db.select({ id: liveBattlesTable.id }).from(liveBattlesTable)
      .where(and(
        eq(liveBattlesTable.challenger_user_id, userId),
        eq(liveBattlesTable.status, "pending"),
      ));
    return rows.length;
  },
  async battleForStream(streamId) {
    const rows = await db.select().from(liveBattlesTable)
      .where(eq(liveBattlesTable.stream_id, streamId))
      .orderBy(desc(liveBattlesTable.created_at)).limit(10);
    const mapped = rows.map(toBattleRow);
    return mapped.find((r) => r.status === "live") ?? mapped[0] ?? null;
  },
  async latestCompletedWithWinner() {
    const rows = await db.select().from(liveBattlesTable)
      .where(eq(liveBattlesTable.status, "completed"))
      .orderBy(desc(liveBattlesTable.updated_at)).limit(10);
    const win = rows.map(toBattleRow).find((r) => r.winnerUserId !== null);
    return win ?? null;
  },
  async listVotes(battleId) {
    const rows = await db.select().from(liveBattleVotesTable)
      .where(eq(liveBattleVotesTable.battle_id, battleId));
    return rows.map(toVoteRow);
  },
  async getVote(battleId, voterUserId) {
    const rows = await db.select().from(liveBattleVotesTable)
      .where(and(
        eq(liveBattleVotesTable.battle_id, battleId),
        eq(liveBattleVotesTable.voter_user_id, voterUserId),
      )).limit(1);
    return rows[0] ? toVoteRow(rows[0]) : null;
  },
  async upsertVote(input) {
    const rows = await db.insert(liveBattleVotesTable).values({
      battle_id: input.battleId,
      voter_user_id: input.voterUserId,
      side: input.side,
      round_number: input.roundNumber,
    }).onConflictDoUpdate({
      target: [liveBattleVotesTable.battle_id, liveBattleVotesTable.voter_user_id],
      set: { side: input.side, round_number: input.roundNumber, updated_at: new Date() },
    }).returning();
    return toVoteRow(rows[0]!);
  },
  async getStream(streamId) {
    const rows = await db.select({
      id: liveStreamsTable.id, userId: liveStreamsTable.user_id, status: liveStreamsTable.status,
    }).from(liveStreamsTable).where(eq(liveStreamsTable.id, streamId)).limit(1);
    return rows[0] ?? null;
  },
  async isBlockedBetween(aUserId, bUserId) {
    const rows = await db.select({ id: conversationsTable.id }).from(conversationsTable)
      .where(and(
        eq(conversationsTable.status, "blocked"),
        or(
          and(
            eq(conversationsTable.participantA, aUserId),
            eq(conversationsTable.participantB, bUserId),
          ),
          and(
            eq(conversationsTable.participantA, bUserId),
            eq(conversationsTable.participantB, aUserId),
          ),
        ),
      )).limit(1);
    return rows.length > 0;
  },
  async notify(userId, kind, title, body, link) {
    await db.insert(notificationsTable).values({
      userId, kind, title, body, link,
    }).catch((err) => {
      logger.warn({ err }, "[live-battles] notification insert failed (non-fatal)");
    });
  },
};

/* ─── Service ────────────────────────────────────────────────────── */

export interface LiveBattleDeps {
  now?: () => Date;
  random?: () => number;
  /** Speak the win in the World. Default: the palace announcement
   *  channel via lib/world-contests' registered announcer. Returns
   *  true when the line was actually spoken. */
  announce?: (a: PalaceAnnouncement) => boolean;
}

export function createLiveBattleService(
  store: LiveBattleStore = dbLiveBattleStore,
  deps: LiveBattleDeps = {},
) {
  const now = deps.now ?? (() => new Date());
  const random = deps.random ?? Math.random;
  const announce = deps.announce ?? ((a: PalaceAnnouncement) => announceContestWinners(a));

  /** Blocks sever: an in-flight battle dies the moment a block is
   *  seen between the pair. Returns the (possibly voided) battle. */
  async function severIfBlocked(battle: BattleRow): Promise<BattleRow> {
    if (!OPEN_STATUSES.includes(battle.status)) return battle;
    const blocked = await store.isBlockedBetween(battle.challengerUserId, battle.opponentUserId);
    if (!blocked) return battle;
    return store.updateBattle(battle.id, { status: "voided", voidReason: "blocked" });
  }

  async function mustGet(id: string): Promise<BattleRow> {
    const b = await store.getBattle(id);
    if (!b) throw new LiveBattleError("not_found", "That battle doesn't exist.");
    return b;
  }

  async function createChallenge(input: {
    challengerUserId: string;
    opponentSlug: string;
  }): Promise<BattleRow> {
    const challenger = await store.profileByUserId(input.challengerUserId);
    if (!challenger) throw new LiveBattleError("no_profile", "You need a creator profile to start a Live Battle.");
    const opponent = await store.profileBySlug(input.opponentSlug.trim().toLowerCase());
    if (!opponent) throw new LiveBattleError("not_found", "That creator doesn't exist.");
    if (opponent.userId === input.challengerUserId) {
      throw new LiveBattleError("self_battle", "You can't battle yourself.");
    }
    if (await store.isBlockedBetween(input.challengerUserId, opponent.userId)) {
      throw new LiveBattleError("blocked", "Battles can't start between you two right now.");
    }
    const open = await store.openBattleBetween(input.challengerUserId, opponent.userId);
    if (open) throw new LiveBattleError("already_active", "You two already have a battle open.");
    const pending = await store.countPendingOutgoing(input.challengerUserId);
    if (pending >= BATTLE_MAX_PENDING_OUTGOING) {
      throw new LiveBattleError("too_many_pending", "You already have challenges out — wait for answers before sending more.");
    }
    const battle = await store.insertBattle({
      challengerUserId: challenger.userId,
      challengerProfileId: challenger.profileId,
      opponentUserId: opponent.userId,
      opponentProfileId: opponent.profileId,
      theme: drawBattleTheme(random),
      roundCount: BATTLE_ROUND_COUNT,
      roundSeconds: BATTLE_ROUND_SECONDS,
    });
    await store.notify(
      opponent.userId,
      "live_battle_challenge",
      `${challenger.displayName} challenged you to a Live Battle`,
      `Theme: ${battle.theme}. ${battle.roundCount} rounds, live audience voting.`,
      "/go-live",
    );
    return battle;
  }

  async function respond(input: {
    battleId: string;
    userId: string;
    accept: boolean;
  }): Promise<BattleRow> {
    let battle = await mustGet(input.battleId);
    battle = await severIfBlocked(battle);
    if (battle.status === "voided") throw new LiveBattleError("blocked", "This battle was cut off.");
    if (battle.opponentUserId !== input.userId) {
      throw new LiveBattleError("not_opponent", "Only the challenged creator can answer this challenge.");
    }
    if (battle.status !== "pending") {
      throw new LiveBattleError("bad_status", "This challenge was already answered.");
    }
    const updated = await store.updateBattle(battle.id, {
      status: input.accept ? "accepted" : "declined",
    });
    const opponent = await store.profileByUserId(battle.opponentUserId);
    const challenger = await store.profileByUserId(battle.challengerUserId);
    if (input.accept && challenger && opponent) {
      await store.notify(
        challenger.userId,
        "live_battle_accepted",
        `${opponent.displayName} accepted your Live Battle`,
        `Theme: ${battle.theme}. Start it from either of your live streams.`,
        "/go-live",
      );
    }
    return updated;
  }

  async function cancel(input: { battleId: string; userId: string }): Promise<BattleRow> {
    const battle = await mustGet(input.battleId);
    if (battle.challengerUserId !== input.userId) {
      throw new LiveBattleError("not_challenger", "Only the challenger can call this off.");
    }
    if (battle.status !== "pending" && battle.status !== "accepted") {
      throw new LiveBattleError("bad_status", "This battle can't be cancelled now.");
    }
    return store.updateBattle(battle.id, { status: "cancelled" });
  }

  async function start(input: {
    battleId: string;
    userId: string;
    streamId: string;
  }): Promise<BattleRow> {
    let battle = await mustGet(input.battleId);
    battle = await severIfBlocked(battle);
    if (battle.status === "voided") throw new LiveBattleError("blocked", "This battle was cut off.");
    if (!isParticipant(battle, input.userId)) {
      throw new LiveBattleError("not_participant", "Only the two battlers can start this battle.");
    }
    if (battle.status !== "accepted") {
      throw new LiveBattleError("bad_status", "The challenge has to be accepted before the battle starts.");
    }
    const stream = await store.getStream(input.streamId);
    if (!stream || stream.status !== "live") {
      throw new LiveBattleError("stream_not_live", "The battle needs a stream that is live right now.");
    }
    if (!isParticipant(battle, stream.userId)) {
      throw new LiveBattleError("stream_not_participant", "The battle rides one of the two battlers' own live streams.");
    }
    const startsAt = now();
    const endsAt = new Date(startsAt.getTime() + battleWindowMs(battle));
    return store.updateBattle(battle.id, {
      status: "live",
      streamId: stream.id,
      startsAt,
      endsAt,
    });
  }

  /** Cast (or move) one fan's voice. Participants can never vote;
   *  guests never reach here (the route is auth-gated). The vote
   *  lands only inside the live window, stamped with its round. */
  async function castVote(input: {
    battleId: string;
    voterUserId: string;
    side: BattleSide;
  }): Promise<{ battle: BattleRow; tally: BattleTally; mySide: BattleSide }> {
    let battle = await mustGet(input.battleId);
    battle = await severIfBlocked(battle);
    if (battle.status === "voided") throw new LiveBattleError("blocked", "This battle was cut off.");
    if (isParticipant(battle, input.voterUserId)) {
      throw new LiveBattleError("participant_vote", "The battlers can't vote in their own battle.");
    }
    if (battle.status !== "live") {
      throw new LiveBattleError("not_live", "Voting opens when the battle is live.");
    }
    const at = now();
    if (battle.endsAt && at.getTime() >= battle.endsAt.getTime()) {
      await finalize(battle.id);
      throw new LiveBattleError("ended", "The battle just ended — the tally is final.");
    }
    const round = roundAt(battle, at);
    if (round === null) throw new LiveBattleError("not_live", "Voting opens when the battle is live.");
    await store.upsertVote({
      battleId: battle.id,
      voterUserId: input.voterUserId,
      side: input.side,
      roundNumber: round,
    });
    const votes = await store.listVotes(battle.id);
    return { battle, tally: tallyVotes(votes, battle.roundCount), mySide: input.side };
  }

  /** Declare the result from the recorded vote rows and stamp the
   *  record both creators keep. Idempotent: a completed battle
   *  returns untouched. A tie crowns nobody and speaks no
   *  spectacle; a win moves the crown and heralds it in the World. */
  async function finalize(battleId: string): Promise<BattleRow> {
    let battle = await mustGet(battleId);
    if (battle.status === "completed") return battle;
    battle = await severIfBlocked(battle);
    if (battle.status !== "live") {
      throw new LiveBattleError("bad_status", "Only a live battle can be finished.");
    }
    const at = now();
    if (battle.endsAt && at.getTime() < battle.endsAt.getTime()) {
      throw new LiveBattleError("bad_status", "The battle is still in its rounds.");
    }
    const votes = await store.listVotes(battle.id);
    const tally = tallyVotes(votes, battle.roundCount);
    const result = winnerFromTally(tally);
    const winnerUserId =
      result === "challenger" ? battle.challengerUserId
      : result === "opponent" ? battle.opponentUserId
      : null;
    let updated = await store.updateBattle(battle.id, {
      status: "completed",
      result,
      winnerUserId,
      challengerVotes: tally.challenger,
      opponentVotes: tally.opponent,
    });
    if (result !== "tie" && winnerUserId) {
      const winnerSide: BattleSide = result;
      const winner = await store.profileByUserId(winnerUserId);
      const loser = await store.profileByUserId(
        winnerSide === "challenger" ? battle.opponentUserId : battle.challengerUserId,
      );
      if (winner && loser) {
        const spoken = announce(battleWinAnnouncement(updated, winner.displayName, loser.displayName, tally, winnerSide));
        if (spoken) {
          updated = await store.updateBattle(battle.id, { spectacleAnnouncedAt: now() });
        }
      }
      const title = winner ? `${winner.displayName} won the Live Battle` : "Live Battle decided";
      const body = `Final tally on “${battle.theme}”: ${tally.challenger}–${tally.opponent}, counted from the fans' recorded votes.`;
      await store.notify(battle.challengerUserId, "live_battle_result", title, body, "/go-live");
      await store.notify(battle.opponentUserId, "live_battle_result", title, body, "/go-live");
    } else {
      const body = `Dead even on “${battle.theme}”: ${tally.challenger}–${tally.opponent}. The crown stays where it was.`;
      await store.notify(battle.challengerUserId, "live_battle_result", "Live Battle tied", body, "/go-live");
      await store.notify(battle.opponentUserId, "live_battle_result", "Live Battle tied", body, "/go-live");
    }
    return updated;
  }

  /** Read-side settle: sever on block; finish a live battle whose
   *  window has closed. Every public read goes through here, so the
   *  record the audience sees is never stale. */
  async function settle(battle: BattleRow): Promise<BattleRow> {
    const severed = await severIfBlocked(battle);
    if (severed.status === "live" && severed.endsAt && now().getTime() >= severed.endsAt.getTime()) {
      return finalize(severed.id);
    }
    return severed;
  }

  async function getCrown(): Promise<{
    battle: BattleRow;
    winner: ProfileCardRow | null;
    holderSince: Date;
  } | null> {
    const battle = await store.latestCompletedWithWinner();
    if (!battle || !battle.winnerUserId) return null;
    const winner = await store.profileByUserId(battle.winnerUserId);
    return { battle, winner, holderSince: battle.updatedAt };
  }

  return {
    createChallenge,
    respond,
    cancel,
    start,
    castVote,
    finalize,
    settle,
    mustGet,
    getCrown,
  };
}

export type LiveBattleService = ReturnType<typeof createLiveBattleService>;

export const liveBattleService = createLiveBattleService();
