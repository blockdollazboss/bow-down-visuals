/* ─── Live Battles (Stack-200 TRULY NEW #154) — client contract ─────────
   Two creators, one theme, timed rounds, live audience voting —
   docked inside the EXISTING live surfaces (watch page + Go Live
   hub). This module mirrors the server vocabulary (api-server
   lib/live-battles + routes/live-battles): paths, labels, viewer
   actions, and the vote-eligibility mirror for instant UI feedback
   (the server re-decides everything — this mirror never substitutes
   for it).

   THE RULES the UI must SAY, not just implement:
   - Votes are recorded interactions only: one signed-in fan, one
     voice, counted from the recorded rows. Tips NEVER count as
     votes — tipping keeps moving on the existing tips rail and
     buys nobody a vote.
   - Guests watch only. Battlers never vote in their own battle.
   - NO PRICES: a battle charges nothing and pays out nothing. The
     winner takes the Charts crown slot + the World spectacle —
     honours, never money. */

export type BattleSide = "challenger" | "opponent";
export type BattleResult = BattleSide | "tie";
export type BattleStatus =
  | "pending" | "accepted" | "declined" | "cancelled"
  | "live" | "completed" | "voided";

export interface BattleCard {
  user_id: string;
  profile_id: string;
  display_name: string;
  slug: string;
  avatar_url: string | null;
}

export interface BattleTally {
  challenger: number;
  opponent: number;
  total: number;
  perRound: Array<{ round: number; challenger: number; opponent: number }>;
}

export interface LiveBattle {
  id: string;
  theme: string;
  status: BattleStatus;
  round_count: number;
  round_seconds: number;
  stream_id: string | null;
  starts_at: string | null;
  ends_at: string | null;
  result: BattleResult | null;
  winner_user_id: string | null;
  void_reason: string | null;
  spectacle_announced_at: string | null;
  challenger: BattleCard | null;
  opponent: BattleCard | null;
  tally: BattleTally;
  current_round: number | null;
  viewer_side: BattleSide | null;
  my_vote: BattleSide | null;
  created_at: string;
  updated_at: string;
}

export interface BattleCrown {
  battle: LiveBattle;
  winner: BattleCard | null;
  holder_since: string;
}

/* Honest copy — pinned by tests so no surface can quietly reword
   the anti-fake law or invent a prize. */
export const LIVE_BATTLE_COPY = {
  votesAreRecorded:
    "Votes are counted from the fans' recorded votes only — one signed-in fan, one voice. Tips never count as votes.",
  guestsWatchOnly:
    "Guests can watch the battle and the tally — voting takes a sign-in.",
  noMoney:
    "Battles charge nothing and pay out nothing. The winner takes the Charts crown and a World spectacle — honours, never money.",
  tieKeepsCrown:
    "An exact tie crowns nobody — the crown stays with its holder.",
} as const;

export const LIVE_BATTLES_PATH = "/api/live-battles";
export const LIVE_BATTLES_MINE_PATH = "/api/live-battles/mine";
export const LIVE_BATTLES_CROWN_PATH = "/api/live-battles/crown";

export function liveBattleByStreamPath(streamId: string): string {
  return `/api/live-battles/by-stream/${encodeURIComponent(streamId)}`;
}
export function liveBattlePath(id: string): string {
  return `/api/live-battles/${encodeURIComponent(id)}`;
}
export function liveBattleTallyPath(id: string): string {
  return `/api/live-battles/${encodeURIComponent(id)}/tally`;
}
export function liveBattleActionPath(
  id: string,
  action: "accept" | "decline" | "cancel" | "start" | "vote" | "finalize",
): string {
  return `/api/live-battles/${encodeURIComponent(id)}/${action}`;
}

export function battleStatusLabel(status: string): string {
  switch (status) {
    case "pending":
      return "Challenge sent — waiting for an answer";
    case "accepted":
      return "Accepted — ready to start on a live stream";
    case "declined":
      return "Declined";
    case "cancelled":
      return "Called off";
    case "live":
      return "Live now — voting open";
    case "completed":
      return "Decided";
    case "voided":
      return "Cut off";
    default:
      return status;
  }
}

/** Who won, in display words — from the stamped result, never
 *  re-derived from a stale tally on screen. */
export function battleWinnerLabel(battle: Pick<LiveBattle, "status" | "result" | "challenger" | "opponent">): string | null {
  if (battle.status !== "completed") return null;
  if (battle.result === "tie") return "Dead even — no winner";
  const winner = battle.result === "challenger" ? battle.challenger : battle.opponent;
  return winner ? `${winner.display_name} takes the crown` : "Decided";
}

/** Each side's share of the recorded vote, as a whole percent.
 *  Zero votes reads 0/0 — never a fabricated 50/50. */
export function tallyShare(tally: Pick<BattleTally, "challenger" | "opponent" | "total">): { challenger: number; opponent: number } {
  if (tally.total <= 0) return { challenger: 0, opponent: 0 };
  const challenger = Math.round((tally.challenger / tally.total) * 100);
  return { challenger, opponent: 100 - challenger };
}

/** The round a moment falls in (1..roundCount), or null outside the
 *  window — the client mirror of the service's roundAt. */
export function battleRoundAt(
  battle: Pick<LiveBattle, "starts_at" | "ends_at" | "round_seconds">,
  at: Date,
): number | null {
  if (!battle.starts_at || !battle.ends_at) return null;
  const start = new Date(battle.starts_at).getTime();
  const end = new Date(battle.ends_at).getTime();
  const t = at.getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || t < start || t >= end) return null;
  return Math.floor((t - start) / (battle.round_seconds * 1000)) + 1;
}

export type BattleViewerAction = "accept" | "decline" | "cancel" | "start" | "finalize";

/** Actions the VIEWER may take on a battle, mirroring the service:
 *  the opponent answers a pending challenge; the challenger cancels
 *  a pending/accepted one; either battler starts an accepted one
 *  (on their live stream — the panel supplies the stream id) or
 *  closes a live one whose window has ended. Fans and guests act
 *  through vote eligibility below, never through this list. */
export function battleViewerActions(
  battle: Pick<LiveBattle, "status" | "viewer_side" | "ends_at">,
  now: Date = new Date(),
): BattleViewerAction[] {
  const side = battle.viewer_side;
  if (!side) return [];
  const actions: BattleViewerAction[] = [];
  if (side === "opponent" && battle.status === "pending") actions.push("accept", "decline");
  if (side === "challenger" && (battle.status === "pending" || battle.status === "accepted")) actions.push("cancel");
  if (battle.status === "accepted") actions.push("start");
  if (
    battle.status === "live" &&
    battle.ends_at &&
    now.getTime() >= new Date(battle.ends_at).getTime()
  ) {
    actions.push("finalize");
  }
  return actions;
}

export interface VoteEligibility {
  canVote: boolean;
  reason: string | null;
}

/** Mirror of the service's castVote guards, for honest buttons:
 *  signed-in fans only, never the battlers, only while the battle
 *  is live inside its window. The server re-checks every word. */
export function voteEligibility(
  battle: Pick<LiveBattle, "status" | "viewer_side" | "starts_at" | "ends_at" | "round_seconds">,
  opts: { signedIn: boolean; now?: Date },
): VoteEligibility {
  if (battle.status !== "live") {
    return { canVote: false, reason: "Voting opens when the battle is live." };
  }
  if (!opts.signedIn) {
    return { canVote: false, reason: LIVE_BATTLE_COPY.guestsWatchOnly };
  }
  if (battle.viewer_side) {
    return { canVote: false, reason: "The battlers can't vote in their own battle." };
  }
  if (battleRoundAt(battle, opts.now ?? new Date()) === null) {
    return { canVote: false, reason: "The voting window has closed." };
  }
  return { canVote: true, reason: null };
}

/** The side a card belongs to — challenger card or opponent card. */
export function cardForSide(battle: Pick<LiveBattle, "challenger" | "opponent">, side: BattleSide): BattleCard | null {
  return side === "challenger" ? battle.challenger : battle.opponent;
}
